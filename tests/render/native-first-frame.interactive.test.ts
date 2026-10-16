import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { chromium, webkit, type Browser } from "playwright";
import { PlanGate } from "@/components/PlanGate";
import NativeRequestProvider from "@/components/NativeRequestProvider";

// ── The app never paints the website's "Upgrade to Pro" (audit NS-04) ────────
//
// Before: the server HTML of every gate was the WEBSITE branch, and the app
// showed it for the 1–3 s before hydration, then swapped — the exact screen an
// App Review reviewer opens. Now the server, knowing the request is the app
// (NativeRequestBoundary), renders the app's branch, and the first client
// render agrees. This loads that server HTML in Chromium and WebKit with the
// native bridge present, checks the first frame, then hydrates and checks
// React raised no hydration mismatch and nothing swapped.

const ORIGIN = "https://sc.test";
const COPY = "Card scanning is a Pro feature.";
let ssr: { app: string; web: string };
let bundle: string;
let tmp: string;
const browsers: Record<string, Browser> = {};

const tree = (native: boolean) =>
  h(NativeRequestProvider, { native }, h("main", null, h(PlanGate, { feature: "scan", nativeCopy: COPY }, h("a", { href: "/upgrade" }, "Upgrade to Pro"))));

beforeAll(async () => {
  ssr = { app: renderToString(tree(true)), web: renderToString(tree(false)) };
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "nativefirst-"));
  writeFileSync(join(tmp, "entry.tsx"), `
    import { hydrateRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import { PlanGate } from "@/components/PlanGate";
    import NativeRequestProvider from "@/components/NativeRequestProvider";
    const w = window as unknown as { __hydrationErrors: string[]; __native: boolean };
    w.__hydrationErrors = [];
    const tree = h(NativeRequestProvider, { native: w.__native }, h("main", null, h(PlanGate, { feature: "scan", nativeCopy: ${JSON.stringify(COPY)} }, h("a", { href: "/upgrade" }, "Upgrade to Pro"))));
    hydrateRoot(document.getElementById("root")!, tree, {
      onRecoverableError: (e: unknown) => { w.__hydrationErrors.push(String((e as Error)?.message ?? e)); },
    });
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

async function load(engine: string, native: boolean) {
  const page = await (await browsers[engine].newContext()).newPage();
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  // The app shell: the native bridge exists before any page script runs.
  const bridge = native ? "window.webkit={messageHandlers:{bridge:{postMessage(){}}}};" : "";
  // The bundle is held until we have looked at the server HTML on its own.
  await page.route("**/*", (route) => route.fulfill({
    status: 200, contentType: "text/html",
    body: `<!doctype html><html><head><meta charset="utf-8"><script>${bridge}window.__native=${native};window.process={env:{}};</script></head><body><div id="root">${native ? ssr.app : ssr.web}</div></body></html>`,
  }));
  await page.goto(`${ORIGIN}/dashboard`);
  const firstFrame = await page.locator("#root").innerText();
  await page.addScriptTag({ content: bundle });
  await page.waitForTimeout(500);
  const hydrated = await page.locator("#root").innerText();
  const hydrationErrors = await page.evaluate(() => (window as unknown as { __hydrationErrors: string[] }).__hydrationErrors);
  await page.context().close();
  return { firstFrame, hydrated, hydrationErrors, errors };
}

describe.each(["Chromium", "WebKit"])("%s", (engine) => {
  it("in the app: the first frame is the app's notice, and hydration keeps it (no mismatch)", async () => {
    const r = await load(engine, true);
    expect(r.firstFrame).toContain(COPY);
    expect(r.firstFrame).not.toContain("Upgrade to Pro");
    expect(r.hydrated).toContain(COPY);
    expect(r.hydrated).not.toContain("Upgrade to Pro");
    expect(r.hydrationErrors).toEqual([]);
    expect(r.errors.filter((e) => /hydrat/i.test(e))).toEqual([]);
  });

  it("on the website: unchanged — the web gate, hydrated as before", async () => {
    const r = await load(engine, false);
    expect(r.firstFrame).toContain("Upgrade to Pro");
    expect(r.hydrated).toContain("Upgrade to Pro");
    expect(r.hydrationErrors).toEqual([]);
  });
});
