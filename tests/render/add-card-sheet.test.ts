// ── The "Add card" offer, measured ──────────────────────────────────────────
//
// A Free account now sees the same Add card button Pro does, and pressing it
// opens this sheet. It replaced a dashed box that sat under My Cards on every
// dashboard visit, so this is the whole pitch now — and it has to survive the
// two things that broke its sibling (ProRequiredDialog):
//
//   • a small phone, where the tallest version must not push its own buttons
//     below the fold;
//   • the LIGHT theme, which remaps .text-white to near-black and .bg-gray-900
//     to white. This sheet is dark on purpose and opens inside the light-themed
//     dashboard, so both remaps have to be held off — including on the NATIVE
//     branch, where the shared PlanNotice (bg-gray-900 + text-white) renders.
//     That exact combination shipped white-on-white once already.

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { chromium, type Browser } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import sharp from "sharp";
import { appCss } from "./harness";

const WIDTHS = [
  { name: "iPhone SE", width: 320, height: 568 },
  { name: "iPhone 13 Mini", width: 375, height: 629 },
  { name: "iPhone 13", width: 390, height: 664 },
  { name: "desktop", width: 1280, height: 900 },
];

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });

async function render(native: boolean, width: number, height: number) {
  vi.resetModules();
  vi.doMock("@/lib/platform", () => ({ useIsNativeApp: () => native, useIsAndroidApp: () => false, detectNativeApp: () => native, isNativeApp: native }));
  const { SecondCardSheet } = await import("@/components/AddCardButton");
  const css = await appCss();
  const html = renderToStaticMarkup(createElement(SecondCardSheet, { trialEligible: true, onClose: () => {} }));
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 500, isMobile: width < 500 });
  await page.setContent(
    `<!doctype html><html data-sc-theme="light"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head>` +
      `<body class="sc-app" style="margin:0;background:#FAF7F2"><div style="height:1200px"></div>${html}</body></html>`,
    { waitUntil: "load" },
  );
  return page;
}

const probe = () => ({
  sheet: (() => {
    const s = document.querySelector(".sc-dark-sheet")!;
    const r = s.getBoundingClientRect();
    return { t: r.top, b: r.bottom, l: r.left, rr: r.right, h: r.height };
  })(),
  vw: innerWidth,
  vh: innerHeight,
  docOverflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
  actions: Array.from(document.querySelectorAll<HTMLElement>(".sc-dark-sheet a, .sc-dark-sheet button")).map((a) => {
    const b = a.getBoundingClientRect();
    return { label: (a.textContent ?? "").trim(), h: Math.round(b.height),
      inView: b.top >= -0.5 && b.bottom <= innerHeight + 0.5 };
  }),
  clipped: Array.from(document.querySelectorAll(".sc-dark-sheet *")).filter((e) => {
    const s = document.querySelector(".sc-dark-sheet")!.getBoundingClientRect();
    const b = e.getBoundingClientRect();
    return b.width > 0 && (b.left < s.left - 0.5 || b.right > s.right + 0.5);
  }).length,
  maxH: getComputedStyle(document.querySelector(".sc-dark-sheet")!).maxHeight,
});

describe.each(WIDTHS)("$name", ({ width, height }) => {
  it("sits inside the screen and never scrolls the page sideways", async () => {
    const page = await render(false, width, height);
    try {
      const p = await page.evaluate(probe);
      expect(p.docOverflowX).toBe(0);
      expect(p.sheet.l).toBeGreaterThanOrEqual(-0.5);
      expect(p.sheet.rr).toBeLessThanOrEqual(p.vw + 0.5);
      expect(p.sheet.b).toBeLessThanOrEqual(p.vh + 0.5);
      expect(p.sheet.t).toBeGreaterThanOrEqual(-0.5);
      expect(p.maxH).not.toBe("none");
    } finally { await page.close(); }
  }, 60_000);

  it("shows every action, in view, with a real tap target", async () => {
    const page = await render(false, width, height);
    try {
      const p = await page.evaluate(probe);
      // Two INSIDE the sheet: "Start my 14 days free" and "Not now". The
      // close-overlay button is a sibling of the sheet, not a child, so it is
      // deliberately not counted here.
      expect(p.actions.map((a) => a.label)).toEqual(["Start my 14-day free trial", "Not now"]);
      expect(p.actions.filter((a) => !a.inView)).toEqual([]);
      expect(p.actions.filter((a) => a.label.length > 0 && a.h < 30)).toEqual([]);
    } finally { await page.close(); }
  }, 60_000);

  it("cuts nothing off horizontally", async () => {
    const page = await render(false, width, height);
    try {
      expect((await page.evaluate(probe)).clipped).toBe(0);
    } finally { await page.close(); }
  }, 60_000);
});

describe("the iOS shell is not sold to (App Store 3.1.1)", () => {
  it("renders no price, no checkout link and no 'upgrade' verb", async () => {
    vi.resetModules();
    vi.doMock("@/lib/platform", () => ({ useIsNativeApp: () => true, useIsAndroidApp: () => false, detectNativeApp: () => true, isNativeApp: true }));
    const { SecondCardSheet } = await import("@/components/AddCardButton");
    const html = renderToStaticMarkup(createElement(SecondCardSheet, { trialEligible: true, onClose: () => {} }));
    expect(html).not.toMatch(/\$\d/);
    expect(html).not.toContain("/checkout");
    // The primary button is IapSubscribeButton on native; it resolves StoreKit
    // in an effect, which renderToStaticMarkup never runs, so it is absent here
    // and asserted from the source in tests/render/pro-offer-parity.test.ts.

    // It still explains itself and still offers the way out.
    expect(html).toContain("More than one card is part of Pro");
    expect(html).toContain("Not now");
    // It still offers the trial in the same words the web does — the trial is
    // Apple's too, so naming it is accurate and allowed. What may never appear
    // is a hardcoded figure (3.1.2) or a website purchase (3.1.3(b)), both
    // asserted above.
    expect(html).toContain("14-day free trial");
  });
});

describe.each([["web", false], ["native", true]] as const)("readable in the light theme (%s)", (_n, native) => {
  const lum = (r: number, g: number, b: number) =>
    [r, g, b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); })
      .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a: number, b: number) => { const [x, y] = [a, b].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

  it("every line clears AA against the pixel actually behind it", async () => {
    const page = await render(native, 390, 844);
    try {
      const spots = await page.evaluate(() => {
        const sheet = document.querySelector(".sc-dark-sheet")!;
        const out: { text: string; color: string; x: number; y: number }[] = [];
        for (const el of Array.from(sheet.querySelectorAll("*"))) {
          if (el.children.length) continue;
          const t = (el.textContent ?? "").trim();
          if (t.length < 2) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;
          out.push({ text: t.slice(0, 26), color: getComputedStyle(el).color, x: Math.round(r.left + 2), y: Math.round(r.top + r.height / 2) });
        }
        return out;
      });
      expect(spots.length).toBeGreaterThan(4);

      // `visibility`, not colour: the exemption paints with !important, so
      // colouring the text away leaves it painted and the probe samples glyphs.
      await page.evaluate(() => {
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(".sc-dark-sheet *"))) {
          if (!el.children.length) el.style.visibility = "hidden";
        }
      });
      const buf = await page.screenshot();
      const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const bad: { text: string; c: number }[] = [];
      for (const s of spots) {
        const i = (s.y * info.width + s.x) * info.channels;
        const m = s.color.match(/\d+/g)!.map(Number);
        const c = contrast(lum(m[0], m[1], m[2]), lum(data[i], data[i + 1], data[i + 2]));
        if (c < 4.5) bad.push({ text: s.text, c: +c.toFixed(2) });
      }
      expect(bad).toEqual([]);
    } finally { await page.close(); }
  }, 90_000);
});
