// ── The upgrade sheet, measured on a phone ──────────────────────────────────
//
// This is the one dialog in the product whose whole job is to make someone want
// to upgrade, and it appears at the exact moment they are most likely to. If it
// overflows a small phone, hides its own buttons behind the home indicator, or
// pushes the page sideways, it does the opposite of its job. So it gets
// measured rather than eyeballed — including with four Pro features listed,
// which is the tallest it can ever be.

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { chromium, type Browser } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { appCss } from "./harness";

vi.mock("@/lib/platform", () => ({ useIsNativeApp: () => false, useIsAndroidApp: () => false }));
const { default: ProRequiredDialog } = await import("@/components/ProRequiredDialog");

const WIDTHS = [
  { name: "iPhone SE (small)", width: 320, height: 568 },
  { name: "iPhone 13 Mini", width: 375, height: 629 },
  { name: "iPhone 13", width: 390, height: 664 },
  { name: "Pixel 5", width: 393, height: 700 },
  { name: "desktop", width: 1280, height: 900 },
];

// The worst case: everything a card can have that needs Pro.
const FEATURES = ["Your own custom design", "Gilt edge finish", "Background video", "Your own colors"];

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });

async function probe(width: number, height: number) {
  const css = await appCss();
  const html = renderToStaticMarkup(
    createElement(ProRequiredDialog, {
      features: FEATURES,
      onSaveWithoutPro: () => {},
      onCancel: () => {},
    }),
  );
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 500, isMobile: width < 500 });
  try {
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8">` +
        `<meta name="viewport" content="width=device-width, initial-scale=1">` +
        `<style>${css}</style></head><body class="sc-app" style="margin:0">` +
        `<div style="height:2000px"></div>${html}</body></html>`,
      { waitUntil: "load" },
    );
    return await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]')!;
      const sheet = dialog.querySelector(":scope > div")!;
      const r = (e: Element) => e.getBoundingClientRect();
      const sr = r(sheet);
      const actions = Array.from(sheet.querySelectorAll("a, button"));
      return {
        sheet: { t: sr.top, b: sr.bottom, l: sr.left, rr: sr.right, h: sr.height, w: sr.width },
        vw: innerWidth,
        vh: innerHeight,
        docOverflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        // Every action must be inside the viewport and big enough to hit.
        actions: actions.map((a) => {
          const b = r(a);
          return {
            label: (a.textContent ?? "").trim().slice(0, 22),
            h: Math.round(b.height),
            inView: b.top >= -0.5 && b.bottom <= innerHeight + 0.5,
            insideSheet: b.left >= sr.left - 0.5 && b.right <= sr.right + 0.5,
          };
        }),
        // Nothing may be cut off horizontally inside the sheet.
        clipped: Array.from(sheet.querySelectorAll("*")).filter((e) => {
          const b = r(e);
          return b.width > 0 && (b.left < sr.left - 0.5 || b.right > sr.right + 0.5);
        }).length,
        scrollsInsideItself: sheet.scrollHeight > sheet.clientHeight + 1,
        maxH: getComputedStyle(sheet).maxHeight,
      };
    });
  } finally {
    await page.close();
  }
}

describe.each(WIDTHS)("$name", ({ width, height }) => {
  let p: Awaited<ReturnType<typeof probe>>;
  beforeAll(async () => { p = await probe(width, height); }, 90_000);

  it("never pushes the page sideways", () => {
    expect(p.docOverflowX).toBe(0);
  });

  it("sits inside the screen on every edge", () => {
    expect(p.sheet.l).toBeGreaterThanOrEqual(-0.5);
    expect(p.sheet.rr).toBeLessThanOrEqual(p.vw + 0.5);
    expect(p.sheet.b).toBeLessThanOrEqual(p.vh + 0.5);
    expect(p.sheet.t).toBeGreaterThanOrEqual(-0.5);
  });

  it("shows every action, in the viewport", () => {
    expect(p.actions.length).toBeGreaterThanOrEqual(3);
    expect(p.actions.filter((a) => !a.inView)).toEqual([]);
  });

  it("keeps every action inside the sheet", () => {
    expect(p.actions.filter((a) => !a.insideSheet)).toEqual([]);
  });

  it("gives every action a real tap target", () => {
    // 40px is the floor a thumb can hit reliably; the tertiary link is smaller
    // on purpose but still has to clear 30.
    expect(p.actions.filter((a) => a.h < 30)).toEqual([]);
    expect(p.actions.filter((a) => a.label.includes("Upgrade") && a.h < 40)).toEqual([]);
  });

  it("cuts nothing off horizontally", () => {
    expect(p.clipped).toBe(0);
  });

  // The tallest possible sheet on the shortest phone must scroll INSIDE itself
  // rather than run off the bottom taking the buttons with it.
  it("is capped so it can never outgrow the screen", () => {
    expect(p.maxH).not.toBe("none");
    expect(p.sheet.h).toBeLessThanOrEqual(p.vh + 0.5);
  });
});

// ── The light theme nearly made this dialog invisible ───────────────────────
//
// globals.css remaps .text-white to near-black under [data-sc-theme="light"],
// so headings read on the app's cream surface. This sheet is dark ON PURPOSE,
// and it lives inside the editor, which is light. Its heading and its $4.99
// both came out near-black on near-black — unreadable, in the one dialog whose
// whole job is to sell.
//
// The tests above could not see it because they rendered the component on its
// own. These mount it the way the app does: inside .sc-app with the light theme
// set, then measure the actual painted pixel behind each piece of text.
describe("readable inside the light-themed app", () => {
  const lum = (r: number, g: number, b: number) =>
    [r, g, b].map((v) => { const s2 = v / 255; return s2 <= 0.03928 ? s2 / 12.92 : Math.pow((s2 + 0.055) / 1.055, 2.4); })
      .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a: number, b: number) => { const [x, y] = [a, b].sort((p2, q) => q - p2); return (x + 0.05) / (y + 0.05); };

  it("every line of text clears AA against what is actually behind it", async () => {
    const css = await appCss();
    const html = renderToStaticMarkup(
      createElement(ProRequiredDialog, { features: FEATURES, onSaveWithoutPro: () => {}, onCancel: () => {} }),
    );
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await page.setContent(
        `<!doctype html><html data-sc-theme="light"><head><meta charset="utf-8">` +
          `<style>${css}</style></head><body class="sc-app" style="margin:0;background:#FAF7F2">${html}</body></html>`,
        { waitUntil: "load" },
      );
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
      expect(spots.length).toBeGreaterThan(5);

      // Hide the text and photograph the surface it sat on.
      //
      // `visibility`, not `color: transparent`. The exemption this test exists
      // to protect sets its colours with !important, which beats an inline
      // style — so colouring the text away left it fully painted and the probe
      // sampled the glyphs instead of the background. It reported ~1:1 on white
      // text and read as a contrast failure when nothing was wrong.
      await page.evaluate(() => {
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(".sc-dark-sheet *"))) {
          if (!el.children.length) el.style.visibility = "hidden";
        }
      });
      const buf = await page.screenshot();
      const sharp = (await import("sharp")).default;
      const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

      const bad: { text: string; c: number }[] = [];
      for (const s2 of spots) {
        const i = (s2.y * info.width + s2.x) * info.channels;
        const m = s2.color.match(/\d+/g)!.map(Number);
        const c = contrast(lum(m[0], m[1], m[2]), lum(data[i], data[i + 1], data[i + 2]));
        if (c < 4.5) bad.push({ text: s2.text, c: +c.toFixed(2) });
      }
      expect(bad).toEqual([]);
    } finally {
      await page.close();
    }
  }, 90_000);
});

// The native variant, in the light theme, is its own surface.
//
// The contrast test above renders the WEB branch, and a bug it could not see
// once shipped on the native one: a shared panel that was bg-gray-900 +
// text-white came out white-on-white inside this deliberately-dark sheet,
// because the light theme flips bg-gray-900 to white for app panels. The two
// branches render the same markup now, but they are still two renders, so the
// native one is measured too.
describe("the native sheet is readable inside the light-themed app", () => {
  const lum = (r: number, g: number, b: number) =>
    [r, g, b].map((v) => { const s2 = v / 255; return s2 <= 0.03928 ? s2 / 12.92 : Math.pow((s2 + 0.055) / 1.055, 2.4); })
      .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a: number, b: number) => { const [x, y] = [a, b].sort((p2, q) => q - p2); return (x + 0.05) / (y + 0.05); };

  it("every line clears AA against what is actually behind it", async () => {
    vi.resetModules();
    vi.doMock("@/lib/platform", () => ({ useIsNativeApp: () => true, useIsAndroidApp: () => false, detectNativeApp: () => true, isNativeApp: true }));
    const { default: NativeDialog } = await import("@/components/ProRequiredDialog");
    const css = await appCss();
    const html = renderToStaticMarkup(
      createElement(NativeDialog, { features: FEATURES, trialEligible: true, onSaveWithoutPro: () => {}, onCancel: () => {} }),
    );
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await page.setContent(
        `<!doctype html><html data-sc-theme="light"><head><meta charset="utf-8">` +
          `<style>${css}</style></head><body class="sc-app" style="margin:0;background:#FAF7F2">${html}</body></html>`,
        { waitUntil: "load" },
      );
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
      expect(spots.length).toBeGreaterThan(5);
      // The offer has to actually be there, or this proves nothing.
      expect(spots.some((s2) => /14-day free trial/i.test(s2.text))).toBe(true);

      await page.evaluate(() => {
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(".sc-dark-sheet *"))) {
          if (!el.children.length) el.style.visibility = "hidden";
        }
      });
      const buf = await page.screenshot();
      const sharp = (await import("sharp")).default;
      const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const bad: { text: string; c: number }[] = [];
      for (const s2 of spots) {
        const i = (s2.y * info.width + s2.x) * info.channels;
        const m = s2.color.match(/\d+/g)!.map(Number);
        const c = contrast(lum(m[0], m[1], m[2]), lum(data[i], data[i + 1], data[i + 2]));
        if (c < 4.5) bad.push({ text: s2.text, c: +c.toFixed(2) });
      }
      expect(bad).toEqual([]);
    } finally {
      await page.close();
    }
  }, 90_000);
});

describe("the native shell gets no price and no CTA", () => {
  it("renders neither the price block nor the upgrade link", async () => {
    vi.resetModules();
    vi.doMock("@/lib/platform", () => ({ useIsNativeApp: () => true, useIsAndroidApp: () => false }));
    const { default: NativeDialog } = await import("@/components/ProRequiredDialog");
    const html = renderToStaticMarkup(
      createElement(NativeDialog, { features: FEATURES, onSaveWithoutPro: () => {}, onCancel: () => {} }),
    );
    expect(html).not.toContain("/upgrade");
    expect(html).not.toContain("Upgrade to Pro");
    expect(html).not.toMatch(/\$\d/);
    expect(html).not.toMatch(/month/i);
    // It still explains itself and still offers the way forward.
    expect(html).toContain("Save without them");
    expect(html).toContain("Background video");
  });
});
