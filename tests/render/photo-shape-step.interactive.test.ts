import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";

// ─────────────────────────────────────────────────────────────────────────────
// PHOTO FIRST'S "PHOTO SHAPE" STEP, MOUNTED AND TAPPED.
//
// Owner, 2026-10-09: an option to make the photo a circle or keep it as it is,
// and with the circle, a colour for the photo panel behind it. The step is the
// shared design panel's (TemplateStyleControls), so this one test covers the
// card builder, Edit card (web and app), the homepage builders and Office
// branding at once. Phone-sized and touch-emulated, as owners use it.
// ─────────────────────────────────────────────────────────────────────────────

const MIN_TAP = 44;

const ENTRY = `
  import { createRoot } from "react-dom/client";
  import { createElement, useState } from "react";
  import TemplateStyleControls from "@/components/card-templates/TemplateStyleControls";
  const params = new URLSearchParams(location.hash.slice(1));
  const initial = JSON.parse(params.get("v") || "{}");
  const hasPhoto = params.get("photo");
  function App() {
    const [v, setV] = useState(initial);
    (window as any).__value = v;
    return createElement(TemplateStyleControls, {
      value: v,
      onChange: (p: any) => { (window as any).__patches = [...((window as any).__patches || []), p]; setV((prev: any) => ({ ...prev, ...p })); },
      template: params.get("t") || "photo-first",
      ...(hasPhoto === null ? {} : { hasPhoto: hasPhoto === "1" }),
    });
  }
  createRoot(document.getElementById("root")!).render(createElement(App));
`;

let browser: Browser;
let tmp: string;
let bundle = "";

beforeAll(async () => {
  browser = await launchBrowser();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "photo-shape-step-"));
  writeFileSync(join(tmp, "entry.tsx"), ENTRY);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")], bundle: true, write: false, format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "@": resolve("src") },
    loader: { ".svg": "text" },
    banner: { js: "var process = { env: { NODE_ENV: \"production\" } };" },
  });
  bundle = out.outputFiles[0].text;
}, 180_000);
afterAll(async () => { await browser?.close(); if (tmp) rmSync(tmp, { recursive: true, force: true }); });

async function mount(hash: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(`about:blank#${hash}`);
  await page.setContent(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${await appCss()}</style>
     <style>body{margin:0;padding:12px;background:#0b0f16}</style></head>
     <body class="sc-app"><div id="root"></div></body></html>`,
  );
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.addScriptTag({ content: bundle });
  await page.waitForTimeout(400);
  return page;
}

const step = (page: Page) => page.locator('li[data-design-step="surface"]');
const swatchCount = (page: Page) => step(page).locator('button[aria-label="Color preset"]').count();

describe("Photo First's Photo shape step", () => {
  it("offers Original and Circle, Original first and selected, both proper thumb targets", async () => {
    const page = await mount("photo=1");
    await expect(step(page).textContent()).resolves.toContain("Photo shape");
    const segs = await step(page).locator('[role="group"][aria-label="Photo shape"] button').evaluateAll((bs) =>
      bs.map((b) => ({ text: b.textContent?.trim(), pressed: b.getAttribute("aria-pressed"), h: b.getBoundingClientRect().height })));
    expect(segs.map((s) => s.text)).toEqual(["Original", "Circle"]);
    expect(segs[0].pressed).toBe("true");
    for (const s of segs) expect(s.h, `${s.text} is ${s.h}px tall`).toBeGreaterThanOrEqual(MIN_TAP);
    await page.context().close();
  });

  it("with a full-height photo, hides the panel colour and says to choose Circle for it", async () => {
    const page = await mount("photo=1");
    expect(await swatchCount(page)).toBe(0);
    await expect(step(page).textContent()).resolves.toContain("Choose Circle to pick the color behind it.");
    await page.context().close();
  });

  it("Circle saves photoShape and opens the colour behind the photo; a swatch saves surfaceColor", async () => {
    const page = await mount("photo=1");
    await step(page).getByRole("button", { name: "Circle" }).tap();
    expect(await page.evaluate(() => (window as unknown as { __patches: unknown[] }).__patches.at(-1))).toEqual({ photoShape: "circle" });
    await expect(step(page).textContent()).resolves.toContain("Color behind your photo");
    expect(await swatchCount(page)).toBeGreaterThan(0);
    await step(page).locator('button[aria-label="Color preset"]').nth(2).tap();
    const v = await page.evaluate(() => (window as unknown as { __value: Record<string, unknown> }).__value);
    expect(v.photoShape).toBe("circle");
    expect(typeof v.surfaceColor).toBe("string");
    await page.context().close();
  });

  it("back to Original clears the shape and hides the colour, but remembers it", async () => {
    const page = await mount(`photo=1&v=${encodeURIComponent(JSON.stringify({ photoShape: "circle", surfaceColor: "#0e1b35" }))}`);
    expect(await swatchCount(page)).toBeGreaterThan(0);
    await step(page).getByRole("button", { name: "Original" }).tap();
    const v = await page.evaluate(() => (window as unknown as { __value: Record<string, unknown> }).__value);
    expect(v.photoShape).toBeUndefined();
    expect(v.surfaceColor).toBe("#0e1b35");
    expect(await swatchCount(page)).toBe(0);
    await page.context().close();
  });

  it("with no photo yet, or where the caller can't say (Office branding), the colour shows with Original", async () => {
    for (const hash of ["photo=0", ""]) {
      const page = await mount(hash);
      expect(await swatchCount(page), `hash "${hash}"`).toBeGreaterThan(0);
      await page.context().close();
    }
  });

  it("is Photo First's alone — other templates keep their plain second-panel step", async () => {
    const page = await mount("t=classic-pro&photo=1");
    await expect(step(page).textContent()).resolves.not.toContain("Photo shape");
    expect(await swatchCount(page)).toBeGreaterThan(0);
    await page.context().close();
  });
});
