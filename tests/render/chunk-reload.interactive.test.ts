import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright";

// ── A page from before a deploy recovers by itself, once ─────────────────────
//
// Audit NS-06: after a deploy the old /_next/static chunks 404, and the next
// lazy import on a page loaded before it fails. In the app shell that was the
// sign-in return leg: Google succeeded and the user landed back on the login
// form, until they force-quit the app.
//
// This drives the REAL ClientErrorReporter and the REAL error boundary in
// Chromium and WebKit, with a chunk that really 404s, so the browsers' own
// error wording is what lib/chunk-reload has to recognise. Note that WKWebView,
// the iPhone app's engine, words it differently from Chrome. Each case
// counts document loads: one reload is the fix, two would be a loop.

const ORIGIN = "https://sc.test";
let bundle: string;
let tmp: string;
const browsers: Record<string, Browser> = {};

beforeAll(async () => {
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "chunkreload-"));
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import ClientErrorReporter from "@/components/ClientErrorReporter";
    import GlobalError from "@/app/error";
    const boundary = location.hash === "#boundary";
    const err = Object.assign(new Error("Failed to load chunk /_next/static/chunks/0abc.js from runtime for chunk"), { name: "ChunkLoadError" });
    createRoot(document.getElementById("root")!).render(
      h("main", null, h(ClientErrorReporter), boundary ? h(GlobalError, { error: err, reset() {} }) : h("p", null, "ready"))
    );
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")],
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    loader: { ".css": "empty" },
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "@": resolve("src") },
  });
  bundle = out.outputFiles[0].text;
  browsers.Chromium = await chromium.launch();
  browsers.WebKit = await webkit.launch();
}, 240_000);

afterAll(async () => {
  await Promise.all(Object.values(browsers).map((b) => b.close()));
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

async function open(engine: string, hash = ""): Promise<{ page: Page; loads: () => number; reports: string[] }> {
  const ctx = await browsers[engine].newContext();
  const page = await ctx.newPage();
  let loads = 0;
  const reports: string[] = [];
  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname === "/") {
      loads++;
      return route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script>window.process={env:{}};</script><script>${bundle}</script></body></html>` });
    }
    if (url.pathname === "/api/client-error") {
      try { reports.push(String(JSON.parse(req.postData() || "{}").context)); } catch { /* ignore */ }
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    // Every chunk from "the previous deployment" is gone.
    return route.fulfill({ status: 404, contentType: "text/plain", body: "not found" });
  });
  await page.goto(`${ORIGIN}/${hash}`);
  return { page, loads: () => loads, reports };
}

/**
 * A lazy import of a chunk that no longer exists, unhandled, in the shape the
 * app's own code uses: `await import(…)` inside an async function. (A bare
 * import() written straight into a classic script never reports its rejection
 * in WebKit; no app code is written that way.)
 */
const importDeadChunk = (page: Page) =>
  page.evaluate(() => {
    const s = document.createElement("script");
    s.textContent = '(async () => { await import("/_next/static/chunks/gone-' + Math.random().toString(36).slice(2) + '.js"); })();';
    document.body.appendChild(s);
  });

const settle = (page: Page) => page.waitForTimeout(1500);

describe.each(["Chromium", "WebKit"])("%s: stale-deploy chunk failure", (engine) => {
  it("reloads once, then refuses to loop", async () => {
    const { page, loads, reports } = await open(engine);
    await page.getByText("ready").waitFor();
    expect(loads()).toBe(1);

    await importDeadChunk(page);
    await expect.poll(loads, { timeout: 10_000 }).toBe(2);
    await page.getByText("ready").waitFor();

    // The fresh page hits a dead chunk too (a chunk that is genuinely gone):
    // no second reload.
    await importDeadChunk(page);
    await settle(page);
    expect(loads()).toBe(2);
    expect(reports).toContain("chunk.reload");
    // ...and the chunk that stayed gone is filed as the fault it is.
    expect(reports).toContain("chunk.missing");
    await page.context().close();
  });

  it("the error boundary reloads instead of retrying the dead import, and does not loop", async () => {
    const { page, loads } = await open(engine, "#boundary");
    // Same document, so the boundary keeps rendering the stale error on
    // every load; the guard is what stops it at one reload.
    await expect.poll(loads, { timeout: 10_000 }).toBe(2);
    await settle(page);
    expect(loads()).toBe(2);
    await page.getByRole("button", { name: "Try again" }).waitFor();
    await page.context().close();
  });

  it("an ordinary error never reloads", async () => {
    const { page, loads, reports } = await open(engine);
    await page.getByText("ready").waitFor();
    await page.evaluate(() => { setTimeout(() => { throw new Error("TypeError: boom"); }, 0); });
    await page.evaluate(() => { void Promise.reject(new Error("something else")); });
    await settle(page);
    expect(loads()).toBe(1);
    expect(reports).toContain("window.error");
    await page.context().close();
  });
});
