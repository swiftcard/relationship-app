import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";

// ─────────────────────────────────────────────────────────────────────────────
// THE TOUR'S SECOND STEP IS THE HELP BUBBLE.
//
// Owner, 2026-09-29: the tour is long and people skip it after a few steps, so
// "where do I ask for help" comes right after the welcome. This mounts the REAL
// GuidedTour and the REAL floating HelpWidget together on /dashboard in
// Chromium, resumes the tour at step 2, and measures: the step spotlights the
// bubble, the tooltip is fully on screen and never covers the bubble, and a tap
// on the spotlighted bubble cannot open the chat panel over the tour.
// ─────────────────────────────────────────────────────────────────────────────

const ORIGIN = "http://app.swiftcard.test";
const NAV_STUB = `
  export const usePathname = () => location.pathname;
  export const useSearchParams = () => new URLSearchParams(location.search);
  export const useRouter = () => ({ push() {}, replace() {}, refresh() {}, back() {}, prefetch() {} });
`;
const ENTRY = `
  import { createRoot } from "react-dom/client";
  import { createElement as h } from "react";
  import GuidedTour from "@/components/GuidedTour";
  import HelpWidget from "@/components/HelpWidget";
  createRoot(document.getElementById("root")!).render(
    h("div", { style: { minHeight: "150vh" } }, h(HelpWidget, { floating: true }), h(GuidedTour)),
  );
`;

let browser: Browser;
let tmp: string;
let bundle = "";
let css = "";

beforeAll(async () => {
  browser = await launchBrowser();
  css = await appCss();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "tour-help-bubble-"));
  writeFileSync(join(tmp, "nav-stub.ts"), NAV_STUB);
  writeFileSync(join(tmp, "entry.tsx"), ENTRY);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")], bundle: true, write: false, format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "@": resolve("src"), "next/navigation": join(tmp, "nav-stub.ts") },
    loader: { ".svg": "text" },
    banner: { js: "var process = { env: { NODE_ENV: \"production\" } };" },
  });
  bundle = out.outputFiles[0].text;
}, 180_000);
afterAll(async () => { await browser?.close(); if (tmp) rmSync(tmp, { recursive: true, force: true }); });

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };

async function openAtHelpStep(width: number, height: number, native: boolean): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: width < 768, isMobile: width < 768 });
  if (native) await ctx.addInitScript(() => { (window as unknown as { webkit: unknown }).webkit = { messageHandlers: { bridge: { postMessage() {} } } }; });
  // Resume the running tour at index 1 — the step right after the welcome.
  await ctx.addInitScript(() => {
    sessionStorage.setItem("sc_tour_running", "1");
    sessionStorage.setItem("sc_tour_index", "1");
  });
  const page = await ctx.newPage();
  await page.route(`${ORIGIN}/dashboard*`, (route) => route.fulfill({
    status: 200, contentType: "text/html",
    body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head>
           <body class="sc-app bg-gray-950"><div id="root"></div><script>${bundle}</script></body></html>`,
  }));
  await page.goto(`${ORIGIN}/dashboard`);
  await page.getByText("Questions? Ask here").waitFor({ timeout: 8000 });
  // The tooltip reveals itself once positioned (visibility: visible).
  await page.waitForFunction(() => {
    const tip = [...document.querySelectorAll<HTMLElement>("div.fixed")].find((d) => d.textContent?.includes("Questions? Ask here"));
    return !!tip && getComputedStyle(tip).visibility === "visible";
  }, null, { timeout: 5000 });
  await page.waitForTimeout(400); // entrance animation + a layout frame
  return page;
}

async function rects(page: Page): Promise<{ tip: Rect; bubble: Rect; vw: number; vh: number }> {
  return page.evaluate(() => {
    const r = (el: Element) => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
    const tip = [...document.querySelectorAll<HTMLElement>("div.fixed")].find((d) => d.textContent?.includes("Questions? Ask here"))!;
    const bubble = document.querySelector('[data-tour="help-bubble"]')!;
    return { tip: r(tip), bubble: r(bubble), vw: window.innerWidth, vh: window.innerHeight };
  });
}

const overlaps = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

describe.each([
  ["phone, website", 390, 844, false],
  ["phone, iPhone app", 390, 844, true],
  ["small phone", 320, 568, false],
  ["desktop", 1280, 800, false],
])("%s (%ipx)", (label, w, h, native) => {
  it("step 2 spotlights the help bubble with its tooltip fully on screen and clear of the bubble", async () => {
    const page = await openAtHelpStep(w, h, native);
    try {
      await page.screenshot({ path: `node_modules/.cache/tour-help-bubble-${w}${native ? "-app" : ""}.png` });
      expect(await page.getByText(/Step 2 of \d+/).isVisible()).toBe(true);
      const { tip, bubble, vw, vh } = await rects(page);
      expect(bubble.width, "the bubble must render").toBeGreaterThan(40);
      expect(tip.left, `${label}: tooltip off the left edge`).toBeGreaterThanOrEqual(0);
      expect(tip.top, `${label}: tooltip off the top`).toBeGreaterThanOrEqual(0);
      expect(tip.right, `${label}: tooltip off the right edge`).toBeLessThanOrEqual(vw);
      expect(tip.bottom, `${label}: tooltip off the bottom`).toBeLessThanOrEqual(vh);
      expect(overlaps(tip, bubble), `${label}: the tooltip covers the bubble it points at`).toBe(false);
      // The spotlight hole is square; its corners are dimmed to the ring's
      // round shape so the bubble does not sit in a bright square.
      const corner = await page.evaluate(() => {
        const layer = [...document.querySelectorAll<HTMLElement>(".sc-tour div.fixed.overflow-hidden")][0];
        const shape = layer?.firstElementChild as HTMLElement | null;
        const bubble = document.querySelector('[data-tour="help-bubble"]')!;
        return {
          visible: layer ? getComputedStyle(layer).opacity : null,
          taps: layer ? getComputedStyle(layer).pointerEvents : null,
          radius: shape?.style.borderRadius ?? null,
          bubbleRadius: getComputedStyle(bubble).borderRadius,
        };
      });
      expect(corner.visible).toBe("1");
      expect(corner.taps).toBe("none");
      expect(corner.radius).toBe(corner.bubbleRadius);
    } finally { await page.context().close(); }
  });

  it("tapping the spotlighted bubble does not open the chat over the tour, and Next moves on", async () => {
    const page = await openAtHelpStep(w, h, native);
    try {
      const { bubble } = await rects(page);
      await page.mouse.click(bubble.left + bubble.width / 2, bubble.top + bubble.height / 2);
      await page.waitForTimeout(300);
      expect(await page.locator(".sc-help-panel").count(), "chat panel opened mid-tour").toBe(0);
      expect(await page.getByText("Questions? Ask here").isVisible()).toBe(true);
      await page.getByRole("button", { name: "Next →" }).click();
      await page.waitForFunction(() => sessionStorage.getItem("sc_tour_index") === "2", null, { timeout: 3000 });
    } finally { await page.context().close(); }
  });
});
