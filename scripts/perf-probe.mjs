// node scripts/perf-probe.mjs   env: BASE=<url>  PAGES=/,/pricing  RUNS=2  OUT=<file.json>
//
// Loads each page as a mid-range phone on a throttled 4G link (4x CPU slowdown,
// 1.6 Mbps / 150 ms RTT — Lighthouse's "slow 4G" profile) and records what the
// person actually waits for: TTFB, FCP, LCP, CLS, total blocking time, JS bytes,
// request count, and console errors. Cold cache every run. Read-only, and its
// traffic is marked internal so it never lands in the product funnel.
import { chromium, devices } from "playwright";
import { writeFileSync } from "node:fs";
import { markInternal } from "./qa-internal.mjs";

const BASE = process.env.BASE || "https://swiftcard.me";
const PAGES = (process.env.PAGES || "/,/pricing,/templates,/login,/cards/new,/card/demo-sales,/links/demo-sales,/blog,/compare").split(",");
const RUNS = Number(process.env.RUNS || 2);

const browser = await chromium.launch();
const results = [];
for (const path of PAGES) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const ctx = await markInternal(await browser.newContext({ ...devices["iPhone 13"], serviceWorkers: "block" }), BASE);
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const errors = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 160)));
    page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text().slice(0, 160)));
    const bytes = { js: 0, css: 0, img: 0, font: 0, doc: 0, other: 0 };
    let requests = 0;
    const failed = [];
    page.on("response", async (r) => {
      requests++;
      if (r.status() >= 400) failed.push(`${r.status()} ${r.url().replace(BASE, "").slice(0, 100)}`);
      try {
        const len = Number((await r.headerValue("content-length")) || 0) || (await r.body()).length;
        const t = r.request().resourceType();
        const k = t === "script" ? "js" : t === "stylesheet" ? "css" : t === "image" ? "img" : t === "font" ? "font" : t === "document" ? "doc" : "other";
        bytes[k] += len;
      } catch {}
    });
    await page.addInitScript(() => {
      window.__m = { lcp: 0, cls: 0, tbt: 0 };
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__m.cls += e.value; }).observe({ type: "layout-shift", buffered: true });
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.tbt += Math.max(0, e.duration - 50); }).observe({ type: "longtask", buffered: true });
    });
    const t0 = Date.now();
    let status = 0;
    try {
      const res = await page.goto(BASE + path, { waitUntil: "load", timeout: 60000 });
      status = res?.status() ?? 0;
    } catch (e) { errors.push("goto: " + e.message.slice(0, 120)); }
    const load = Date.now() - t0;
    await page.waitForTimeout(2500);
    const m = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      const fcp = performance.getEntriesByName("first-contentful-paint")[0];
      return { ttfb: Math.round(nav?.responseStart ?? 0), fcp: Math.round(fcp?.startTime ?? 0), lcp: Math.round(window.__m.lcp), cls: +window.__m.cls.toFixed(3), tbt: Math.round(window.__m.tbt), dom: document.querySelectorAll("*").length, finalPath: location.pathname };
    }).catch(() => ({}));
    runs.push({ status, load, ...m, requests, kb: Object.fromEntries(Object.entries(bytes).map(([k, v]) => [k, Math.round(v / 1024)])), errors, failed });
    await ctx.close();
  }
  const med = (k) => runs.map((r) => r[k] ?? 0).sort((a, b) => a - b)[Math.floor(runs.length / 2)];
  const row = { path, status: runs[0].status, finalPath: runs[0].finalPath, ttfb: med("ttfb"), fcp: med("fcp"), lcp: med("lcp"), cls: med("cls"), tbt: med("tbt"), load: med("load"), requests: med("requests"), kb: runs[0].kb, dom: runs[0].dom, errors: [...new Set(runs.flatMap((r) => r.errors))], failed: [...new Set(runs.flatMap((r) => r.failed))] };
  results.push(row);
  console.log(`${path.padEnd(22)} ${row.status} ttfb ${row.ttfb} fcp ${row.fcp} lcp ${row.lcp} cls ${row.cls} tbt ${row.tbt} load ${row.load} req ${row.requests} js ${row.kb.js}KB css ${row.kb.css}KB img ${row.kb.img}KB font ${row.kb.font}KB dom ${row.dom}${row.errors.length ? "\n   errors: " + row.errors.join(" | ") : ""}${row.failed.length ? "\n   failed: " + row.failed.join(" | ") : ""}`);
}
await browser.close();
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(results, null, 2));
