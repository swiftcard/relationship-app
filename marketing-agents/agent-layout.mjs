// ── Pix · Layout — the once-a-day pass in a real browser ────────────────────
// Usage: node marketing-agents/agent-layout.mjs
//
// Every other watchdog reads the server's HTML. A page can pass all of them
// and still be broken for the person looking at it: a column that overflows
// the phone, a hero image that never loads, a JavaScript error that leaves a
// button dead, a body with no text because a client component threw. This
// renders the public pages at phone (390px) and desktop (1280px) width and
// measures. Read-only: it browses like a visitor — no account, no writes.
//
// The watchdog loop dispatches this once a day; the same loop watches the
// stylesheet every 30 minutes (lib/detectors-servicing.mjs pixLayoutCheck).
// Code-only, $0.00 per run — no LLM anywhere in this file.
import { appendFileSync } from "node:fs";
import { chromium } from "playwright";
import { safeMain, email, sb } from "./lib/agentkit.mjs";

const BASE = process.env.HEALTH_BASE_URL || "https://swiftcard.me";
const WIDTHS = [{ name: "phone", width: 390, height: 844 }, { name: "desktop", width: 1280, height: 900 }];
const STATIC_PAGES = ["/", "/pricing", "/templates", "/login", "/signup", "/blog", "/compare/blinq-alternative", "/compare/hihello-alternative", "/products", "/for/real-estate-agents", "/testimonials", "/contact"];
// Console noise that is not a product bug.
const CONSOLE_IGNORE = /favicon|third-party cookie|ResizeObserver loop|hydration|Download the React DevTools|net::ERR_BLOCKED_BY_CLIENT|preload/i;

async function livePages() {
  const pages = [...STATIC_PAGES];
  // One real card page and its /links page — the product itself.
  try {
    const rows = await sb("GET", "cards", { params: "select=username&is_offline=eq.false&order=created_at.desc&limit=25" });
    const live = (rows ?? []).filter((r) => r.username);
    if (live.length) {
      const pick = live[Math.floor(Date.now() / 86400e3) % live.length].username.toLowerCase();
      pages.push(`/${pick}`, `/links/${pick}`);
    }
  } catch { /* the static list still runs */ }
  return pages;
}

async function inspect(page, path, vp) {
  const errors = [], failed = [];
  page.on("pageerror", (e) => errors.push(String(e?.message ?? e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error" && !CONSOLE_IGNORE.test(m.text())) errors.push(m.text().slice(0, 200)); });
  page.on("response", (r) => { try { if (r.status() >= 400 && new URL(r.url()).host === new URL(BASE).host && !/favicon/.test(r.url())) failed.push(`${r.status()} ${new URL(r.url()).pathname}`); } catch { /* ignore */ } });
  const res = await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 45000 }).catch(() => null);
  if (!res) return [{ key: `layout:${path}:timeout`, severity: "critical", title: `${path} never finished loading (${vp.name})`, detail: `Playwright waited 45s for ${BASE}${path} at ${vp.width}px and the network never went idle.` }];
  if (res.status() >= 400) return [{ key: `layout:${path}:status`, severity: "critical", title: `${path} returns HTTP ${res.status()}`, detail: `${BASE}${path} answered ${res.status()} in a real browser.` }];
  await page.waitForTimeout(1500);
  const m = await page.evaluate(() => {
    const se = document.scrollingElement || document.documentElement;
    const imgs = [...document.images];
    const broken = imgs.filter((i) => i.getAttribute("src") && i.complete && i.naturalWidth === 0 && i.getBoundingClientRect().width > 0).map((i) => (i.currentSrc || i.getAttribute("src") || "").slice(0, 120));
    const noAlt = imgs.filter((i) => !i.hasAttribute("alt") && i.getBoundingClientRect().width > 40).length;
    const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    const nameless = [...document.querySelectorAll("a[href],button")].filter((el) => {
      const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return false;
      return !(el.innerText || "").trim() && !el.getAttribute("aria-label") && !el.getAttribute("title") && !el.querySelector("img[alt]:not([alt=''])") && !el.querySelector("svg[aria-label], svg title");
    }).length;
    return { overflow: se.scrollWidth - window.innerWidth, broken, noAlt, textLen: text.length, nameless };
  });
  const f = [];
  const tag = (k) => `layout:${path}:${vp.name}:${k}`;
  if (m.overflow > 8) f.push({ key: tag("overflow"), severity: "warn", title: `${path} scrolls sideways on ${vp.name} (${m.overflow}px too wide)`, detail: `At ${vp.width}px the page is ${m.overflow}px wider than the screen — something is not wrapping. On a phone that means a horizontal wobble and cut-off content.` });
  if (m.broken.length) f.push({ key: tag("images"), severity: "warn", title: `${m.broken.length} broken image(s) on ${path} (${vp.name})`, detail: `Images that rendered a box but no pixels: ${m.broken.join(", ")}` });
  if (m.textLen < 120) f.push({ key: tag("blank"), severity: "critical", title: `${path} renders almost no text on ${vp.name}`, detail: `The page's visible text is ${m.textLen} characters — the client-side render most likely threw. Console: ${errors.slice(0, 3).join(" | ") || "(nothing logged)"}` });
  if (errors.length) f.push({ key: tag("console"), severity: errors.length >= 3 ? "warn" : "warn", title: `${errors.length} JavaScript error(s) on ${path} (${vp.name})`, detail: errors.slice(0, 5).join("\n") });
  if (failed.length) f.push({ key: tag("requests"), severity: "warn", title: `${failed.length} failed request(s) while loading ${path} (${vp.name})`, detail: [...new Set(failed)].slice(0, 8).join("\n") });
  if (m.noAlt >= 3) f.push({ key: tag("alt"), severity: "warn", title: `${m.noAlt} images without alt text on ${path}`, detail: "Screen readers announce these as \"image\" and Google cannot describe them. Add alt text (empty alt=\"\" for purely decorative ones)." });
  if (m.nameless >= 3) f.push({ key: tag("a11y-names"), severity: "warn", title: `${m.nameless} buttons/links with no accessible name on ${path}`, detail: "Icon-only controls without aria-label. Keyboard and screen-reader users cannot tell what they do." });
  return f;
}

await safeMain("layout", async (run) => {
  const pages = await livePages();
  await run.note(`Rendering ${pages.length} pages at ${WIDTHS.length} widths…`);
  const browser = await chromium.launch();
  const findings = [];
  try {
    for (const vp of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, userAgent: `Mozilla/5.0 SwiftCard-Layout-Watchdog (${vp.name})`, isMobile: vp.name === "phone", deviceScaleFactor: vp.name === "phone" ? 3 : 1 });
      for (const path of pages) {
        await run.checkpoint();
        const page = await ctx.newPage();
        try { findings.push(...await inspect(page, path, vp)); } catch (e) { findings.push({ key: `layout:${path}:${vp.name}:probe`, severity: "warn", title: `Could not inspect ${path} (${vp.name})`, detail: String(e?.message ?? e).slice(0, 300) }); }
        await page.close();
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  // Same bug on both widths is one finding.
  const merged = new Map();
  for (const f of findings) { const k = f.key.replace(/:(phone|desktop):/, ":"); if (!merged.has(k)) merged.set(k, { ...f, key: k }); }
  const list = [...merged.values()];
  const critical = list.filter((f) => f.severity === "critical");
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const item = await run.addItem({
    item_type: "layout_finding", platform: "site", target: `${pages.length} pages × phone + desktop`,
    title: list.length ? `Layout check: ${list.length} visual problem(s) — ${stamp}` : `Layout check: every page renders cleanly ✓ — ${stamp}`,
    content: [
      list.length ? "FOUND:\n" + list.map((f) => `${f.severity === "critical" ? "🔴" : "🟠"} ${f.title}\n   ${f.detail}`).join("\n") : `All ${pages.length} pages rendered without overflow, broken images, JavaScript errors or failed requests at 390px and 1280px.`,
      `\nPAGES: ${pages.join(", ")}`,
      "\nRead-only: browsed like a visitor, nothing created or changed.",
    ].join("\n"),
    context: "Rendered in headless Chromium and measured — the class of bug the HTML checks cannot see.",
    status: list.length ? "pending" : "acknowledged",
    payload: { findings: list.map((f) => ({ key: f.key, severity: f.severity, title: f.title })), pages },
  });
  if (critical.length) {
    await email(`🔴 Layout: ${critical[0].title}${critical.length > 1 ? ` (+${critical.length - 1} more)` : ""}`,
      `<h3>A page is visibly broken</h3><ul>${critical.map((c) => `<li><b>${c.title}</b><br>${c.detail}</li>`).join("")}</ul><p>Details are in the agent_queue_items table.</p>`);
  }
  try { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `findings=${list.length}\nitem_id=${item?.id ?? ""}\n`); } catch { /* not in Actions */ }
  await run.finish("success", `${list.length} visual problem(s) across ${pages.length} pages. $0.00 (no LLM).`);
});
