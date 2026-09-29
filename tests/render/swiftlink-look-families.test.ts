import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Browser } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ComponentProps } from "react";
import { launchBrowser, appCss } from "./harness";

import SwiftLinkProfile from "@/components/SwiftLinkProfile";
import { SwiftLinkStyleControls } from "@/components/SwiftLinkDesign";
import { LOOK_FAMILIES, getLook } from "@/lib/swiftlink-looks";

// ── The three Look families, measured in a real browser ────────────────────
//
// Two claims here that only a browser can settle.
//
// THE GLASS FAMILY IS ACTUALLY GLASS. Its whole reason to exist is a colour
// wash showing through a frosted sheet. Both halves are easy to lose by
// accident: a refactor that treats `sheetBg` as opaque paints over the wash,
// and dropping the backdrop-filter turns the same markup into a flat tint. The
// page still renders either way, and it still passes the contrast tests,
// because the failure is that the design is GONE, not that it is unreadable.
//
// THE PICKER OPENS ON YOUR OWN DESIGN. The grid of every look at once was
// replaced by three dropdowns precisely so the list stops being a wall — which
// only works if the group holding your current look is the one already open.
// An accordion that always opens on the first group would be worse than what it
// replaced, and nothing but layout can tell you which one is open.

type ProfileProps = ComponentProps<typeof SwiftLinkProfile>;
type PickerProps = ComponentProps<typeof SwiftLinkStyleControls>;

const BASE: Omit<ProfileProps, "pageStyle"> = {
  name: "Kelsie Blevins",
  username: "kelsie",
  photoUrl: null,
  logoUrl: null,
  subtitle: "Realtor",
  bio: "Helping buyers and sellers.",
  verified: false,
  socials: [],
  links: [{ emoji: "", label: "My listings", url: "https://example.com/a", size: "compact" }],
  appUrl: "https://swiftcard.me",
  embedded: true,
  paidTiles: true,
};

describe("the Glass family renders as glass", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await launchBrowser(); }, 120_000);
  afterAll(async () => { await browser?.close(); });

  async function probe(pageStyle: ProfileProps["pageStyle"]) {
    const css = await appCss();
    const markup = renderToStaticMarkup(createElement(SwiftLinkProfile, { ...BASE, pageStyle }));
    const page = await browser.newPage();
    try {
      await page.setViewportSize({ width: 430, height: 900 });
      await page.setContent(
        `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
         <style>body{margin:0;background:#555}</style></head>
         <body><div style="width:430px">${markup}</div></body></html>`,
        { waitUntil: "load" },
      );
      await page.waitForTimeout(150);
      return await page.evaluate(() => {
        const sheet = document.querySelector(".sc-sl-sheet") as HTMLElement;
        const name = sheet.querySelector("h1") as HTMLElement;
        const content = name.closest("div[class*='pb-9']") as HTMLElement;
        const cs = getComputedStyle(content);
        // The wash layer is the only full-bleed child carrying a gradient.
        const layers = [...sheet.children].filter((el) => {
          const s = getComputedStyle(el as HTMLElement);
          return s.position === "absolute" && s.backgroundImage.includes("gradient");
        });
        const wash = layers[0] as HTMLElement | undefined;
        const sr = sheet.getBoundingClientRect();
        const wr = wash?.getBoundingClientRect();
        return {
          hasWash: !!wash,
          washCovers: !!wr && Math.abs(wr.width - sr.width) <= 1 && Math.abs(wr.height - sr.height) <= 1,
          washImage: wash ? getComputedStyle(wash).backgroundImage.slice(0, 40) : null,
          sheetBg: cs.backgroundColor,
          // Under a cover/banner hero the glass tint is a 64px ramp rather
          // than a flat fill, so it lives in background-IMAGE and
          // background-color reads transparent. Both shapes are the sheet's
          // tint; a test that only knew one of them would call the ramp a
          // missing surface.
          sheetImage: cs.backgroundImage === "none" ? null : cs.backgroundImage,
          sheetBackdrop: cs.backdropFilter || "none",
          nameColor: getComputedStyle(name).color,
        };
      });
    } finally {
      await page.close();
    }
  }

  /** Every alpha the sheet's tint uses, whichever property carries it. */
  function tintAlphas(r: { sheetBg: string; sheetImage: string | null }): number[] {
    const source = r.sheetImage ?? r.sheetBg;
    return [...source.matchAll(/rgba?\((?:[^)]*?,\s*)([\d.]+)\)/g)].map((m) => Number(m[1]));
  }

  it("paints a full-bleed colour wash behind a translucent, blurred sheet", async () => {
    // Compact circle: no hero above, so the sheet is a flat translucent fill.
    const r = await probe({ look: "aurora", heroStyle: "avatar" });
    expect(r.hasWash).toBe(true);
    expect(r.washCovers).toBe(true);
    expect(r.washImage).toContain("gradient");
    expect(r.sheetImage).toBeNull();
    // TRANSLUCENT: an opaque sheet would hide the wash completely.
    expect(r.sheetBg).toMatch(/^rgba\(/);
    const alpha = tintAlphas(r).at(-1)!;
    expect(alpha).toBeGreaterThan(0.2);
    expect(alpha).toBeLessThan(1);
    // FROSTED: without the blur it is a tinted pane, not glass.
    expect(r.sheetBackdrop).toContain("blur");
  }, 60_000);

  it("ramps that tint in under a hero, instead of starting it at a hard edge", async () => {
    // The other half of the seam fix. A flat fill here is the 24-40 point
    // luminance step the test at the bottom of this file measures.
    const r = await probe({ look: "aurora", heroStyle: "cover" });
    expect(r.sheetImage, "the tint must be a gradient under a hero").toContain("gradient");
    const alphas = tintAlphas(r);
    // Starts fully transparent…
    expect(Math.min(...alphas)).toBe(0);
    // …and lands on the same translucent tint the flat version uses.
    expect(Math.max(...alphas)).toBeGreaterThan(0.2);
    expect(Math.max(...alphas)).toBeLessThan(1);
    expect(r.sheetBackdrop).toContain("blur");
  }, 60_000);

  it("leaves the Solid and Gradient families opaque and unblurred", async () => {
    for (const look of ["paper", "onyx", "dawn", "ink"]) {
      const r = await probe({ look });
      expect(r.hasWash, look).toBe(false);
      expect(r.sheetBackdrop, look).toBe("none");
      // Opaque: rgb(), or an rgba with alpha 1 — and never the glass ramp.
      expect(r.sheetBg, look).not.toMatch(/rgba\([^)]*,\s*0?\.\d+\)/);
      expect(tintAlphas(r).filter((a) => a < 1), look).toHaveLength(0);
    }
  }, 60_000);

  it("a page background photo replaces the wash rather than stacking on it", async () => {
    // Both want the same surface. Two of them at once is a muddied photo.
    const r = await probe({
      look: "aurora",
      heroStyle: "avatar",
      bgMedia: "https://media.test/x.jpg",
      bgMediaType: "image",
    });
    expect(r.sheetBg).toBe("rgba(0, 0, 0, 0)");
    expect(r.nameColor).toBe("rgb(255, 255, 255)");
  }, 60_000);

  it("a custom background colour also replaces the wash", async () => {
    const r = await probe({ look: "frost", bg: "#123456" });
    expect(r.hasWash).toBe(false);
    expect(r.sheetBackdrop).toBe("none");
  }, 60_000);
});

describe("the Look picker's three dropdowns", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await launchBrowser(); }, 120_000);
  afterAll(async () => { await browser?.close(); });

  async function pick(props: PickerProps) {
    const css = await appCss();
    const markup = renderToStaticMarkup(createElement(SwiftLinkStyleControls, props));
    const page = await browser.newPage();
    try {
      await page.setViewportSize({ width: 400, height: 1200 });
      await page.setContent(
        `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
         <style>body{margin:0;padding:12px;background:#0b0f16}</style></head>
         <body class="sc-app"><div style="width:376px">${markup}</div></body></html>`,
        { waitUntil: "load" },
      );
      await page.waitForTimeout(150);
      return await page.evaluate(() => {
        const rows = [...document.querySelectorAll('button[aria-expanded]')] as HTMLElement[];
        return {
          rowCount: rows.length,
          open: rows.filter((r) => r.getAttribute("aria-expanded") === "true").map((r) => r.innerText.split("\n")[0].trim()),
          labels: rows.map((r) => r.innerText.split("\n")[0].trim()),
          rowText: rows.map((r) => r.innerText),
          // Every blurb must be fully readable — no ellipsis on the row that
          // has the most explaining to do.
          clipped: rows.filter((r) => {
            const p = [...r.querySelectorAll("span")].find((s) => (s.textContent || "").length > 25);
            return p ? p.scrollWidth > p.clientWidth + 1 : false;
          }).length,
          swatchCount: document.querySelectorAll('button[aria-pressed]').length,
          rowsInsidePanel: rows.every((r) => r.getBoundingClientRect().right <= 376 + 12 + 1),
        };
      });
    } finally {
      await page.close();
    }
  }

  // Owner, 2026-09-29: Solid opening on its own was unwanted — every group
  // starts CLOSED and the person opens Solid, Gradient or Glass themselves.
  // It used to open the group holding the selection, which for the default
  // look meant Solid, for nearly everyone.
  it("shows exactly one row per family, ALL closed on arrival, whatever look is selected", async () => {
    for (const value of [{}, { linkLook: "aurora" }, { linkLook: "nebula" }, { linkLook: "ink" }]) {
      const r = await pick({ value, onChange: () => {} });
      expect(r.rowCount, JSON.stringify(value)).toBe(LOOK_FAMILIES.length);
      expect(r.open, JSON.stringify(value)).toEqual([]);
      // Closed means closed: no look swatches rendered until a group is opened.
      expect(r.swatchCount, JSON.stringify(value)).toBe(0);
    }
  }, 60_000);

  it("a closed group still names the current look, so nothing is hidden", async () => {
    for (const [value, family] of [[{}, getLook(undefined).family], [{ linkLook: "aurora" }, "glass"], [{ linkLook: "nebula" }, "gradient"]] as const) {
      const r = await pick({ value, onChange: () => {} });
      const look = getLook((value as { linkLook?: string }).linkLook);
      const i = LOOK_FAMILIES.findIndex((f) => f.id === family);
      // Case-insensitive: the name is drawn with CSS `uppercase`, and
      // innerText reports the transformed text.
      const name = look.name.toLowerCase();
      expect(r.rowText[i].toLowerCase(), JSON.stringify(value)).toContain(name);
      // …and only on its own row.
      r.rowText.forEach((t, j) => { if (j !== i) expect(t.toLowerCase(), `row ${j}`).not.toContain(name); });
    }
  }, 60_000);

  it("never truncates a family's description, and stays inside the panel", async () => {
    for (const value of [{}, { linkLook: "aurora" }, { linkLook: "ink" }]) {
      const r = await pick({ value, onChange: () => {} });
      expect(r.clipped, JSON.stringify(value)).toBe(0);
      expect(r.rowsInsidePanel, JSON.stringify(value)).toBe(true);
    }
  }, 60_000);

  it("a Free session starts closed too, and still sees all three groups", async () => {
    const r = await pick({ value: {}, onChange: () => {}, locked: true });
    expect(r.open).toEqual([]);
    expect(r.swatchCount).toBe(0);
    expect(r.rowCount).toBe(LOOK_FAMILIES.length);
  }, 60_000);
});

// ── No line across the page where the hero meets the sheet ──────────────────
//
// A frosted sheet has a hard top edge, and under a cover or banner photo that
// edge is a horizontal line straight across someone's page.
//
// Found by measuring, not by looking: at 390px the sheet starts at y=353 (it
// overlaps the hero's last 40px) and its tint used to appear there all at once
// — a row-to-row luminance step of 24 on Aurora, 33 on Frost and 40 on AURA,
// which had shipped that way since it launched. An opaque look never shows it,
// because its hero fade reaches full sheet colour before the edge; a
// translucent one cannot, because it never reaches full opacity at all.
//
// The fix was two things — dissolving the hero's own alpha into the wash, and
// ramping the sheet's tint in over 64px — and this is what proves they are both
// still there. It measures the SEAM REGION only, and compares every look
// against an opaque one rendered identically, so it cannot be satisfied by
// making the whole page flat.
describe("the hero dissolves into a glass page with no seam", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await launchBrowser(); }, 120_000);
  afterAll(async () => { await browser?.close(); });

  // A local, opaque, high-contrast photo stand-in. Deterministic and offline:
  // a remote image would make this test a network coin-flip, and a photo that
  // happened to be dark at the bottom would hide the very defect it guards.
  const PHOTO = "data:image/svg+xml;utf8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#FFF3C4"/></svg>',
  );

  /** The largest row-to-row luminance step in the page's gutters, and where. */
  async function seam(look: string): Promise<{ step: number; y: number }> {
    const css = await appCss();
    const markup = renderToStaticMarkup(
      createElement(SwiftLinkProfile, { ...BASE, photoUrl: "https://media.test/p", pageStyle: { look, heroStyle: "cover" } }),
    ).replaceAll("https://media.test/p", PHOTO);
    const page = await browser.newPage();
    try {
      await page.setViewportSize({ width: 390, height: 1000 });
      await page.setContent(
        `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
         <style>body{margin:0;background:#000}</style></head>
         <body><div style="width:390px">${markup}</div></body></html>`,
        { waitUntil: "load" },
      );
      await page.waitForTimeout(400);
      // The band around the sheet's top edge, in the gutters where no text sits.
      const buf = await page.screenshot({ clip: { x: 0, y: 280, width: 390, height: 160 } });
      const sharp = (await import("sharp")).default;
      const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
      const xs = [4, 8, 12, 16, 374, 378, 382, 386];
      const rowLum = (y: number) => {
        let t = 0;
        for (const x of xs) {
          const i = (y * info.width + x) * info.channels;
          t += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        }
        return t / xs.length;
      };
      let step = 0, at = 0;
      for (let y = 1; y < info.height; y++) {
        const d = Math.abs(rowLum(y) - rowLum(y - 1));
        if (d > step) { step = d; at = y + 280; }
      }
      return { step, y: at };
    } finally {
      await page.close();
    }
  }

  it("every glass look is as smooth through the seam as an opaque one", async () => {
    // Ink is the control: an ordinary gradient look, same photo, same layout,
    // whose hero fade has always blended correctly. Anything materially worse
    // than it is a seam.
    const control = await seam("ink");
    for (const look of ["aurora", "frost", "mist", "ember", "aura"]) {
      const r = await seam(look);
      expect(
        r.step,
        `${look} steps ${r.step.toFixed(1)} at y=${r.y} vs control ink ${control.step.toFixed(1)}`,
      ).toBeLessThan(control.step + 6);
    }
  }, 120_000);
});
