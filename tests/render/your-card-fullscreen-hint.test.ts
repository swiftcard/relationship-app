import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";

// ─────────────────────────────────────────────────────────────────────────────
// "TAP YOUR CARD TO SHOW IT FULL SCREEN" SITS ACROSS FROM "YOUR CARD".
//
// Owner, 2026-09-29: put the hint above the card, on the right of the "Your
// card" heading, and remove the space at the bottom. It used to sit UNDER the
// card with its own margin — a whole line of empty band at the bottom of the
// box on a phone.
//
// The REAL CardPreviewDownload (real template, real Tailwind) inside the
// dashboard's Your Card box, measured at phone widths and at desktop. The box
// and heading are the dashboard's own markup; the source check below fails if
// the page's classes drift from what is measured here.
// ─────────────────────────────────────────────────────────────────────────────

const PANEL = "bg-gray-900 border border-gray-800/80 rounded-2xl p-5";
const ROW = "flex items-center justify-between gap-3 mb-3 lg:mb-1";
const LABEL = "shrink-0 text-gray-500 text-xs font-semibold uppercase tracking-wide";
const HINT = "lg:hidden flex min-w-0 items-center justify-end gap-1.5 text-right text-balance text-gray-500 text-[0.6875rem] leading-tight";
const CAPTION = "hidden lg:block text-gray-600 text-[0.6875rem] mb-3 leading-relaxed";

const DYNAMIC_STUB = `
  import { lazy, Suspense, createElement } from "react";
  export default function dynamic(loader: () => Promise<any>) {
    const L = lazy(() => loader().then((m: any) => ({ default: m.default ?? m })));
    return (p: any) => createElement(Suspense, { fallback: null }, createElement(L, p));
  }
`;
const ENTRY = `
  import { createRoot } from "react-dom/client";
  import { createElement as h } from "react";
  import CardPreviewDownload from "@/components/CardPreviewDownload";
  import { SAMPLE_DATA } from "@/components/card-templates/types";
  const icon = h("svg", { viewBox: "0 0 20 20", className: "w-3.5 h-3.5 shrink-0", "aria-hidden": "true" });
  createRoot(document.getElementById("root")!).render(
    h("div", { id: "panel", className: ${JSON.stringify(PANEL)} },
      h("div", { id: "row", className: ${JSON.stringify(ROW)} },
        h("p", { id: "label", className: ${JSON.stringify(LABEL)} }, "Your Card"),
        h("p", { id: "hint", className: ${JSON.stringify(HINT)} }, icon, "Tap your card to show it full screen")),
      h("p", { className: ${JSON.stringify(CAPTION)} }, "Exactly what people get when you share."),
      h(CardPreviewDownload, { data: SAMPLE_DATA, template: "classic-pro", username: "alex", previewUrl: "https://swiftcard.me/alex" }),
    ),
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
  tmp = mkdtempSync(join(cache, "your-card-hint-"));
  writeFileSync(join(tmp, "dynamic-stub.ts"), DYNAMIC_STUB);
  writeFileSync(join(tmp, "entry.tsx"), ENTRY);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "@": resolve("src"), "next/dynamic": join(tmp, "dynamic-stub.ts") },
    loader: { ".svg": "text" },
  });
  bundle = out.outputFiles[0].text;
}, 240_000);
afterAll(async () => { await browser?.close(); if (tmp) rmSync(tmp, { recursive: true, force: true }); });

async function open(width: number): Promise<Page> {
  const page = await browser.newPage();
  await page.setViewportSize({ width, height: 900 });
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
     <style>body{margin:0;padding:16px;background:#030712}</style></head>
     <body class="sc-app"><div id="root"></div><script>${bundle}</script></body></html>`,
  );
  // The template is lazy — wait until the card has been measured and scaled in.
  await page.waitForFunction(() => {
    const card = document.querySelector<HTMLElement>("#panel .pointer-events-none");
    return !!card && getComputedStyle(card).opacity === "1" && card.getBoundingClientRect().height > 50;
  }, null, { timeout: 15_000 });
  await page.waitForTimeout(200);
  return page;
}

type Box = { left: number; top: number; right: number; bottom: number; height: number };
function measure(page: Page) {
  return page.evaluate(() => {
    const r = (el: Element | null): Box | null => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) return null; // display:none
      return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, height: b.height };
    };
    const panel = document.getElementById("panel")!;
    const cs = getComputedStyle(panel);
    const card = panel.querySelector(".pointer-events-none")!.parentElement!; // the scaled card's frame
    const lineH = parseFloat(getComputedStyle(document.getElementById("hint")!).lineHeight);
    return {
      panel: r(panel)!, padL: parseFloat(cs.paddingLeft), padR: parseFloat(cs.paddingRight), padB: parseFloat(cs.paddingBottom),
      border: parseFloat(cs.borderBottomWidth),
      row: r(document.getElementById("row")), label: r(document.getElementById("label")), hint: r(document.getElementById("hint")),
      card: r(card), download: r(panel.querySelector("button:not([aria-label])")),
      lineH,
    };
  });
}

describe.each([320, 360, 390, 430])("phone, %ipx", (width) => {
  it("the hint is on the right of 'Your Card', above the card, inside the box", async () => {
    const page = await open(width);
    try {
      await page.screenshot({ path: `node_modules/.cache/your-card-hint-${width}.png` });
      const m = await measure(page);
      expect(m.hint, "hint hidden on a phone").not.toBeNull();
      const hint = m.hint!, label = m.label!, card = m.card!;
      // Right of the heading, never overlapping it.
      expect(hint.left).toBeGreaterThanOrEqual(label.right);
      // Right-aligned to the box's content edge, and never past it.
      expect(Math.abs(hint.right - (m.panel.right - m.border - m.padR))).toBeLessThanOrEqual(1);
      // Above the card.
      expect(hint.bottom).toBeLessThanOrEqual(card.top);
      // At most two lines even on the narrowest phone.
      expect(hint.height).toBeLessThanOrEqual(m.lineH * 2 + 1);
    } finally { await page.close(); }
  });

  it("nothing follows the card: the box ends at the card plus its own padding", async () => {
    const page = await open(width);
    try {
      const m = await measure(page);
      expect(m.download, "the desktop Download button shows on a phone").toBeNull();
      const gap = m.panel.bottom - m.border - m.card!.bottom;
      expect(Math.round(gap), `empty band under the card is ${Math.round(gap)}px`).toBe(Math.round(m.padB));
    } finally { await page.close(); }
  });
});

describe("desktop, 1280px", () => {
  it("no phone hint; the Download button still sits under the card", async () => {
    const page = await open(1280);
    try {
      const m = await measure(page);
      expect(m.hint, "phone-only hint shows on desktop").toBeNull();
      expect(m.download, "desktop Download button missing").not.toBeNull();
      expect(m.download!.top).toBeGreaterThan(m.card!.bottom);
    } finally { await page.close(); }
  });
});

describe("the measured markup is the dashboard's own", () => {
  it("the dashboard's Your Card heading row uses exactly these classes and this text", () => {
    const dash = readFileSync("src/app/dashboard/page.tsx", "utf8");
    for (const cls of [PANEL, ROW, LABEL, HINT, CAPTION]) expect(dash, cls).toContain(`className="${cls}"`);
    expect(dash).toMatch(/Tap your card to show it full screen/);
    // And the hint is gone from under the card.
    expect(readFileSync("src/components/CardPreviewDownload.tsx", "utf8")).not.toMatch(/>\s*Tap your card to show it full screen/);
  });
});
