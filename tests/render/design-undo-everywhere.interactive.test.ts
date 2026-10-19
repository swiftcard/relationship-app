import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright";
import { appCss } from "./harness";

// ── Undo on EVERY design screen, used for real ──────────────────────────────
//
// Owner, 2026-10-15: Undo is on Card design and Social design when editing or
// adding a card — but it was missing from the other places a card or a Swift
// Links page is designed: Office admin → Branding (Card and Links) and the
// homepage "see how it would look" builders. "Make sure it's there, make sure
// it works perfectly, and make sure it's in a perfect place, not covering
// anything." (Edit card and the builder are driven in design-undo and the
// title-company rig.)
//
// Each screen is mounted for real in Chromium and WebKit (the iPhone app and
// Safari), at a phone width and a computer width: make one change, find Undo
// where that screen's preview is, check nothing covers it and it covers
// nothing, press it, and the change is gone.

const ORIGIN = "https://sc.test";
let bundle: string;
let css: string;
let tmp: string;
const browsers: Record<string, Browser> = {};

beforeAll(async () => {
  css = await appCss();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "undo-everywhere-"));
  writeFileSync(join(tmp, "nav-stub.tsx"), `
    export function useRouter() { return { push() {}, replace() {}, refresh() {}, back() {}, prefetch() {} }; }
    export function usePathname() { return "/"; }
    export function useSearchParams() { return new URLSearchParams(); }
  `);
  writeFileSync(join(tmp, "link-stub.tsx"), `
    import { createElement } from "react";
    export default function Link(props: any) {
      const { href, children, prefetch, scroll, ...rest } = props;
      return createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children);
    }
    export function useLinkStatus() { return { pending: false }; }
  `);
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import OfficeBranding from "@/components/OfficeBranding";
    import CardMiniBuilder from "@/components/site/CardMiniBuilder";
    import SwiftLinkMiniBuilder from "@/components/site/SwiftLinkMiniBuilder";
    const SCREENS: any = {
      // In its real page frame (app/office/admin/branding): the pinned phone
      // preview pins inside the column.
      branding: (p: any) => h("main", { className: "sc-app max-w-6xl mx-auto px-5 pt-6 pb-28 md:pb-16" }, h(OfficeBranding, p)),
      cardMini: () => h(CardMiniBuilder, { linkedinEnabled: false }),
      linkMini: () => h(SwiftLinkMiniBuilder, { linkedinEnabled: false }),
    };
    (window as any).mount = (screen: string, props: any) => {
      createRoot(document.getElementById("root")!).render(SCREENS[screen](props));
    };
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    loader: { ".css": "empty" },
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env.NEXT_PUBLIC_SUPABASE_URL": '"https://example.supabase.co"',
      "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '"anon"',
      "process.env.NEXT_PUBLIC_APP_URL": '"https://sc.test"',
    },
    alias: {
      "next/navigation": join(tmp, "nav-stub.tsx"),
      "next/link": join(tmp, "link-stub.tsx"),
      "@": resolve("src"),
    },
  });
  bundle = out.outputFiles[0].text;
  if (!bundle || bundle.length < 1000) throw new Error("bundle is empty — the esbuild step failed");
  browsers.Chromium = await chromium.launch();
  browsers.WebKit = await webkit.launch();
}, 240_000);

afterAll(async () => {
  await Promise.all(Object.values(browsers).map((b) => b.close()));
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

async function open(engine: string, width: number, screen: string, props: Record<string, unknown> = {}) {
  const ctx = await browsers[engine].newContext({
    viewport: { width, height: 844 },
    ...(engine === "Chromium" && width < 600 ? { hasTouch: true, isMobile: true } : {}),
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === ORIGIN && url.pathname === "/") {
      return route.fulfill({
        status: 200, contentType: "text/html",
        body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
          <style>${css}</style><style>body{margin:0;background:#0b0f16}</style></head>
          <body class="sc-app"><div id="root"></div><script>window.process={env:{}};</script><script>${bundle}</script></body></html>`,
      });
    }
    // Nothing reaches the internet: images, fonts, APIs answered empty.
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(([s, p]) => (window as unknown as { mount: (s: string, p: unknown) => void }).mount(s as string, p), [screen, props] as const);
  await page.waitForTimeout(800);
  return { page, errors };
}

/** Every Undo control a person could see right now (opacity 0 = holding its space). */
const visibleUndos = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll<HTMLButtonElement>("button")]
    .filter((b) => b.getAttribute("aria-label") === "Undo last design change" || b.textContent?.trim() === "Undo")
    .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && b.offsetParent !== null && getComputedStyle(b).opacity !== "0"; })
    .map((b) => b.getAttribute("aria-label") === "Undo last design change" ? "corner" : "pill"),
);

/** The one Undo showing, as a locator. */
const undoButton = (page: Page) =>
  page.locator('button[aria-label="Undo last design change"]:visible, button:visible:text-is("Undo")').filter({ hasNot: page.locator("[hidden]") });

/**
 * Undo is in a "perfect place": on screen, nothing on top of it, a real tap
 * target, and on top of no other control — except that the corner button sits
 * on the pinned card's own corner, as on Card design, clear of the full-size cue.
 */
async function placementProblems(page: Page) {
  const btn = undoButton(page).first();
  await btn.scrollIntoViewIfNeeded();
  return btn.evaluate((el) => {
    const problems: string[] = [];
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    if (r.left < -0.5 || r.right > vw + 0.5) problems.push(`off screen (${Math.round(r.left)}–${Math.round(r.right)} of ${vw})`);
    if (r.width < 28 || r.height < 28) problems.push(`too small to tap (${Math.round(r.width)}×${Math.round(r.height)})`);
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!top || !(el === top || el.contains(top))) problems.push(`covered by <${top?.tagName.toLowerCase()} class="${(top as HTMLElement | null)?.className ?? ""}">`);
    // The controls Undo lives among: its own preview area (the pinned phone
    // strip, the preview column or header), plus a builder's close X. The
    // controls that scroll UNDER a pinned strip are meant to, and so is the
    // page behind an open builder.
    const area = el.closest(".sc-pinned-preview, aside, [class*='sticky']") ?? document.body;
    const others = new Set([
      ...area.querySelectorAll<HTMLElement>("button, a, input, textarea, select, [role=tab]"),
      ...document.querySelectorAll<HTMLElement>('button[aria-label="Close"]'),
    ]);
    for (const other of others) {
      if (other === el || other.contains(el) || el.contains(other) || other.offsetParent === null) continue;
      if (other.getAttribute("aria-label") === "See your card full size") continue; // the card the corner sits on
      const o = other.getBoundingClientRect();
      const w = Math.min(r.right, o.right) - Math.max(r.left, o.left);
      const h = Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top);
      if (w > 1 && h > 1) problems.push(`overlaps "${other.getAttribute("aria-label") || other.textContent?.trim().slice(0, 30) || other.tagName}"`);
    }
    // The corner button stays clear of the full-size cue on the other corner.
    const cue = el.parentElement?.querySelector('button[aria-label="See your card full size"] span[aria-hidden]');
    if (cue && r.right >= cue.getBoundingClientRect().left) problems.push("touches the full-size cue");
    if (document.documentElement.scrollWidth > vw + 1) problems.push("the page scrolls sideways");
    return problems;
  });
}

/** A colour swatch in a design step, and whether it is the picked one (Card
 *  design marks it aria-pressed; Social design with its thick blue ring). */
const swatch = (page: Page, key: string, i: number) =>
  page.locator(`[data-design-step="${key}"]:visible button[aria-label="Color preset"]`).nth(i);
const picked = (loc: ReturnType<typeof swatch>) =>
  loc.evaluate((b) => b.getAttribute("aria-pressed") === "true" || (b as HTMLElement).style.borderWidth === "2.5px");
const firstColorStep = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll<HTMLElement>("[data-design-step]")]
    .find((li) => li.offsetParent !== null && li.querySelector('button[aria-label="Color preset"]'))?.dataset.designStep ?? null,
);

async function changeUndoAndCheck(page: Page, key: string, expected: "corner" | "pill") {
  expect(await visibleUndos(page), "nothing to undo yet, so no Undo showing").toEqual([]);
  const pick = swatch(page, key, 2);
  await pick.scrollIntoViewIfNeeded();
  expect(await picked(pick)).toBe(false);
  await pick.click();
  await expect.poll(() => picked(pick)).toBe(true);
  await expect.poll(() => visibleUndos(page)).toEqual([expected]);
  expect(await placementProblems(page)).toEqual([]);
  await undoButton(page).first().click();
  await expect.poll(() => picked(pick)).toBe(false);
  await expect.poll(() => visibleUndos(page), "back to how it opened: nothing left to undo").toEqual([]);
}

const RUNS: Array<[string, number]> = [["Chromium", 390], ["Chromium", 1280], ["WebKit", 390], ["WebKit", 1280]];
const OFFICE = {
  name: "Northwind", brand_company: "Northwind", brand_website: "northwind.com", brand_template: "classic-pro",
  brand_phone: "(555) 111-2222", brand_design: {}, brand_links: [{ label: "Book a tour", url: "https://northwind.com/tour" }],
};

for (const [engine, width] of RUNS) {
  const phone = width < 600;
  describe(`Undo everywhere — ${engine} ${width}px`, () => {
    it("Office admin → Branding → Card", async () => {
      const { page, errors } = await open(engine, width, "branding", { office: OFFICE });
      const key = await firstColorStep(page);
      expect(key).not.toBeNull();
      await changeUndoAndCheck(page, key!, phone ? "corner" : "pill");
      expect(errors).toEqual([]);
      await page.context().close();
    }, 90_000);

    it("Office admin → Branding → Links", async () => {
      const { page, errors } = await open(engine, width, "branding", { office: OFFICE });
      await page.getByRole("tab", { name: "Links" }).click();
      await page.waitForTimeout(300);
      await changeUndoAndCheck(page, "colors", "pill");
      expect(errors).toEqual([]);
      await page.context().close();
    }, 90_000);

    it("homepage card builder → Make it yours", async () => {
      const { page, errors } = await open(engine, width, "cardMini");
      await page.click("text=Start from scratch");
      for (let i = 0; i < 6 && !(await page.locator("text=Make it yours").count()); i++) {
        const name = page.getByPlaceholder("Alex Morgan");
        if (await name.count() && !(await name.inputValue())) await name.fill("Alex Morgan");
        await expect.poll(() => visibleUndos(page)).toEqual([]); // only the design step has one
        await page.click("button:has-text('Continue')");
        await page.waitForTimeout(300);
      }
      const key = await firstColorStep(page);
      expect(key).not.toBeNull();
      await changeUndoAndCheck(page, key!, phone ? "corner" : "pill");
      expect(errors).toEqual([]);
      await page.context().close();
    }, 90_000);

    it("homepage Swift Links builder → Style your page", async () => {
      const { page, errors } = await open(engine, width, "linkMini");
      await page.click("text=See how your Swift Links page would look");
      await page.getByPlaceholder("Alex Morgan").fill("Alex Morgan");
      await page.click("button:has-text('Continue')");
      await page.waitForTimeout(300);
      await page.locator("textarea").first().fill("Founder at Morgan & Co.");
      await expect.poll(() => visibleUndos(page)).toEqual([]);
      await page.click("button:has-text('Continue')");
      await page.waitForTimeout(500);
      await changeUndoAndCheck(page, "colors", "pill");
      expect(errors).toEqual([]);
      await page.context().close();
    }, 90_000);
  });
}
