import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";

// ── A lazy homepage mock holds its space while its code downloads ───────────
//
// Paint check, 2026-10-14 (issue #85): on a phone, the homepage's dashboard
// replica measured 350×0. HomeLazy mounts WideDemo the moment the block nears
// the screen, but the mock inside is a dynamic import still on the wire, so
// WideDemo measured an EMPTY inner block — 0 tall — and a 0 height under
// `contain: size` collapsed the section. The page below jumped up 520px, then
// back down when the mock arrived, and stayed collapsed if it never did.
// `naturalHeight` holds the mock's own height (scaled) until it renders.

const ENTRY = `
  import { createRoot } from "react-dom/client";
  import { createElement as h, useState } from "react";
  import WideDemo from "@/components/site/WideDemo";
  function Mock() { return h("div", { style: { height: 740, background: "#2563eb" } }); }
  function App() {
    const [arrived, setArrived] = useState(false);
    (window as any).arrive = () => setArrived(true);
    const held = location.hash !== "#bare";
    return h("main", { style: { padding: "0 20px" } },
      h(WideDemo, { minWidth: 760, ...(held ? { naturalHeight: 740 } : {}) }, arrived ? h(Mock) : null),
      h("p", { id: "below" }, "Next section"));
  }
  createRoot(document.getElementById("root")!).render(h(App));
`;

let browser: Browser;
let tmp: string;
let bundle = "";

beforeAll(async () => {
  browser = await launchBrowser();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "wide-demo-hold-"));
  writeFileSync(join(tmp, "entry.tsx"), ENTRY);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")], bundle: true, write: false, format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "@": resolve("src") },
  });
  bundle = out.outputFiles[0].text;
}, 120_000);
afterAll(async () => { await browser?.close(); if (tmp) rmSync(tmp, { recursive: true, force: true }); });

async function mount(width: number, hash = ""): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(`about:blank${hash}`);
  await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${await appCss()}</style>
    <style>body{margin:0}</style></head><body><div id="root"></div></body></html>`);
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.addScriptTag({ content: bundle });
  await page.waitForTimeout(300);
  return page;
}

const outerHeight = (page: Page) => page.evaluate(() => document.querySelector("main")!.firstElementChild!.getBoundingClientRect().height);
const belowTop = (page: Page) => page.evaluate(() => document.getElementById("below")!.getBoundingClientRect().top);

describe("WideDemo holds a lazy mock's space", () => {
  for (const width of [390, 600, 1280]) {
    it(`${width}px: the same height before and after the mock arrives, so nothing below moves`, async () => {
      const page = await mount(width);
      const before = await outerHeight(page);
      const belowBefore = await belowTop(page);
      expect(before, "collapsed while the mock downloads").toBeGreaterThan(100);
      await page.evaluate(() => (window as unknown as { arrive: () => void }).arrive());
      await page.waitForTimeout(300);
      expect(Math.abs((await outerHeight(page)) - before)).toBeLessThanOrEqual(1);
      expect(Math.abs((await belowTop(page)) - belowBefore)).toBeLessThanOrEqual(1);
      await page.context().close();
    });
  }

  it("without naturalHeight (a mock that is already there, e.g. /products) nothing is held", async () => {
    const page = await mount(390, "#bare");
    expect(await outerHeight(page)).toBe(0);
    await page.evaluate(() => (window as unknown as { arrive: () => void }).arrive());
    await page.waitForTimeout(300);
    expect(await outerHeight(page)).toBeGreaterThan(300);
    await page.context().close();
  });
});
