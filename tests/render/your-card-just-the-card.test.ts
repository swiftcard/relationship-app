import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";

// ─────────────────────────────────────────────────────────────────────────────
// THE DASHBOARD'S CARD BOX IS JUST THE CARD.
//
// Owner, 2026-09-30: remove "Your Card", "Tap your card to show it full
// screen" and the spacing above the card. The box now holds the card and
// nothing else — the same padding on every side, on a phone and on desktop,
// for every account type (the panel is one fragment the dashboard renders for
// Free, Pro, Office owners and members alike).
//
// The REAL CardPreviewDownload (real template, real Tailwind) inside the
// dashboard's box class, measured at phone widths and at desktop. The source
// check at the bottom fails if the page's box drifts from what is measured,
// or if a heading, hint or caption comes back above the card.
// ─────────────────────────────────────────────────────────────────────────────

const PANEL = "bg-gray-900 border border-gray-800/80 rounded-2xl p-5";

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
  createRoot(document.getElementById("root")!).render(
    h("div", { id: "panel", className: ${JSON.stringify(PANEL)} },
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
  tmp = mkdtempSync(join(cache, "your-card-box-"));
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
    return {
      panel: r(panel)!, padT: parseFloat(cs.paddingTop), padB: parseFloat(cs.paddingBottom),
      borderT: parseFloat(cs.borderTopWidth), borderB: parseFloat(cs.borderBottomWidth),
      card: r(card)!, download: r(panel.querySelector("button:not([aria-label])")),
      fullscreen: r(panel.querySelector('button[aria-label="Show your card full screen"]')),
    };
  });
}

describe.each([320, 360, 390, 430])("phone, %ipx", (width) => {
  it("the card starts right at the box's top padding and ends at its bottom padding", async () => {
    const page = await open(width);
    try {
      await page.screenshot({ path: `node_modules/.cache/your-card-box-${width}.png` });
      const m = await measure(page);
      const above = m.card.top - (m.panel.top + m.borderT);
      const below = m.panel.bottom - m.borderB - m.card.bottom;
      expect(Math.round(above), `space above the card is ${Math.round(above)}px`).toBe(Math.round(m.padT));
      expect(Math.round(below), `space under the card is ${Math.round(below)}px`).toBe(Math.round(m.padB));
      expect(m.download, "the desktop Download button shows on a phone").toBeNull();
    } finally { await page.close(); }
  });

  it("tapping the card still opens it full screen", async () => {
    const page = await open(width);
    try {
      const m = await measure(page);
      expect(m.fullscreen, "the card is no longer a button on a phone").not.toBeNull();
      await page.click('#panel button[aria-label="Show your card full screen"]');
      await page.getByRole("dialog").waitFor({ timeout: 5_000 });
    } finally { await page.close(); }
  });
});

describe("desktop, 1280px", () => {
  it("nothing above the card; the Download button still sits under it", async () => {
    const page = await open(1280);
    try {
      await page.screenshot({ path: "node_modules/.cache/your-card-box-1280.png" });
      const m = await measure(page);
      expect(Math.round(m.card.top - (m.panel.top + m.borderT))).toBe(Math.round(m.padT));
      expect(m.fullscreen, "the phone-only tap target shows on desktop").toBeNull();
      expect(m.download, "desktop Download button missing").not.toBeNull();
      expect(m.download!.top).toBeGreaterThan(m.card.bottom);
    } finally { await page.close(); }
  });
});

describe("the measured markup is the dashboard's own", () => {
  const dash = readFileSync("src/app/dashboard/page.tsx", "utf8");
  const box = dash.slice(dash.indexOf('data-tour="your-card"'), dash.indexOf("</div>", dash.indexOf('data-tour="your-card"')));

  it("the box uses exactly this class and holds only the card", () => {
    expect(box, "your-card box missing").not.toBe("");
    expect(box).toContain(`className="${PANEL}"`);
    // Nothing rendered before the card: only comments sit between the box's
    // opening tag and <CardPreviewDownload.
    const head = box.slice(box.indexOf(">") + 1, box.indexOf("<CardPreviewDownload"));
    expect(head.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").trim(), "something renders above the card").toBe("");
  });

  it("no heading, hint or caption anywhere on the dashboard", () => {
    expect(dash).not.toMatch(/>\s*Your Card\s*</);
    expect(dash).not.toMatch(/>\s*Tap your card to show it full screen/);
    expect(dash).not.toMatch(/>\s*Exactly what people get when you share\.\s*</);
    expect(readFileSync("src/components/CardPreviewDownload.tsx", "utf8")).not.toMatch(/>\s*Tap your card to show it full screen/);
  });
});
