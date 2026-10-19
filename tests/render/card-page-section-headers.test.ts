// ── Section headers in the card page's Swift Links box ──────────────────────
//
// Owner, 2026-10-19: section headers set on the Swift Links page must show in
// the card page's additional-links box too, "not take up too much space", and
// "fit the UI cleanly". Measured here, because every one of those is layout:
//   • a header row is a 28px chapter mark, against a link row's 52px;
//   • a long header stays on one line (truncates) instead of growing the box;
//   • the cream band sits INSIDE the box's 1px border — the border is an inset
//     shadow, which a filled child paints over unless it is inset by 1px.

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { chromium, webkit, type Browser, type BrowserType } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import sharp from "sharp";
import { appCss } from "./harness";
import CardActionLinks from "@/components/CardActionLinks";

const LINKS = [
  { label: "On the market", url: "", kind: "header" as const },
  { label: "123 Main Street", url: "https://good.test/a" },
  { label: "Open house Sunday", url: "https://good.test/b" },
  { label: "Work with me — buying, selling, renting and everything in between", url: "", kind: "header" as const },
  { label: "Book a call", url: "https://good.test/c" },
];

const browsers: Browser[] = [];
afterAll(async () => { await Promise.all(browsers.map((b) => b.close())); });

let css: string;
beforeAll(async () => { css = await appCss(); }, 120_000);

async function measure(type: BrowserType) {
  let browser: Browser;
  try { browser = await type.launch(); } catch { return null; } // engine not installed here
  browsers.push(browser);
  const page = await browser.newPage({ viewport: { width: 390, height: 700 }, deviceScaleFactor: 1 });
  // The real box on the card page: max-w-sm, p-5, white, inside px-4.
  const markup = renderToStaticMarkup(
    h("div", { style: { padding: "0 16px" } },
      h("div", { id: "box", className: "w-full max-w-sm rounded-2xl p-5", style: { background: "#fff" } },
        h(CardActionLinks, { links: LINKS }))),
  );
  await page.route("**/api/link-icon**", (r) => r.fulfill({ status: 404, body: "" }));
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<style>${css}</style></head><body style="margin:0;padding:40px 0;background:#f4f1ec">${markup}</body></html>`,
    { waitUntil: "load" },
  );
  const m = await page.evaluate(() => {
    const box = document.querySelector("#box > div") as HTMLElement;
    const r = (e: Element) => e.getBoundingClientRect();
    const heads = Array.from(box.querySelectorAll("h3")) as HTMLElement[];
    const rows = Array.from(box.querySelectorAll("a")) as HTMLElement[];
    return {
      boxLeft: r(box).left, boxWidth: r(box).width,
      heads: heads.map((e) => ({ top: r(e).top, left: r(e).left, height: r(e).height, width: r(e).width, overflows: e.scrollWidth > e.clientWidth })),
      rows: rows.map((e) => r(e).height),
      order: Array.from(box.children).map((c) => c.tagName),
    };
  });
  const png = await page.screenshot();
  await page.close();
  return { m, png };
}

async function pixel(png: Buffer, x: number, y: number) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const i = (Math.round(y) * info.width + Math.round(x)) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
}

describe.each([["chromium", chromium], ["webkit", webkit]] as const)("%s", (_name, type) => {
  it("headers sit in order, slim, on one line, inside the box's border", async () => {
    const r = await measure(type);
    if (!r) return;
    const { m, png } = r;
    expect(m.order).toEqual(["H3", "A", "A", "H3", "A"]);
    for (const hd of m.heads) {
      expect(Math.round(hd.height)).toBe(28);
      expect(Math.round(hd.width)).toBe(Math.round(m.boxWidth) - 2);
      expect(Math.round(hd.left)).toBe(Math.round(m.boxLeft) + 1);
    }
    expect(m.heads[1].overflows).toBe(true); // truncated, not wrapped
    for (const row of m.rows) expect(row).toBeGreaterThanOrEqual(52);
    // The box's left border is still painted beside each header band (#E7E0D7,
    // not the band's #FAF7F2).
    for (const hd of m.heads) {
      const [r0, g0, b0] = await pixel(png, m.boxLeft, hd.top + hd.height / 2);
      expect(r0 + g0 + b0).toBeLessThan(0xfa + 0xf7 + 0xf2 - 20);
    }
  }, 120_000);
});
