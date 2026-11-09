import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Browser } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ComponentProps } from "react";
import { launchBrowser, appCss } from "./harness";

import SwiftLinkProfile from "@/components/SwiftLinkProfile";

// ── The page header: Logo works exactly like "Upload photo or video" ────────
//
// Owner, 2026-11-09. The same square logo, uploaded as the header, filled the
// compact circle and the cover photo and the page took its colour; picked as
// "Logo" it sat shrunk on a white plate / an indigo panel over a plain white
// page. The rule now is literal: a logo header renders EXACTLY like that logo
// uploaded as the header. So this renders both, at every header style, and
// demands the same picture box, the same fit and the same page colour.
//
// And "Initials" — which sat on one fixed indigo gradient on every Look — are
// drawn in the page's own colours, with the initials in the name's colour.

type ProfileProps = ComponentProps<typeof SwiftLinkProfile>;

// The owner's logo, in miniature: a square with its own cream background and a
// dark mark low down (where the cover's fade lands).
const LOGO = "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#EFE6D2"/><rect x="150" y="560" width="500" height="90" fill="#2F4048"/><rect x="250" y="150" width="300" height="300" fill="#D4A72C"/></svg>',
);
// Its colour as Photo match would read it — handed in the way the public page
// hands in its server-side read, so both renders get the same tone and the
// only difference left is how the header treats the picture.
const TONE = "#EFE6D2";

const BASE: Omit<ProfileProps, "pageStyle" | "logoUrl"> = {
  name: "Aaron Lavi",
  username: "aaron",
  photoUrl: null,
  photoTone: TONE,
  subtitle: "Nadlan Homes",
  bio: "Homes in New York.",
  verified: false,
  socials: [],
  links: [{ emoji: "", label: "Listings", url: "https://example.com/a", size: "compact" }],
  appUrl: "https://swiftcard.me",
  embedded: true,
  paidTiles: true,
};

describe("the Swift Links page header — logo and initials", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await launchBrowser(); }, 120_000);
  afterAll(async () => { await browser?.close(); });

  async function probe(props: Partial<ProfileProps>, width = 390) {
    const css = await appCss();
    const markup = renderToStaticMarkup(createElement(SwiftLinkProfile, { ...BASE, ...props } as ProfileProps))
      // resolveHero only takes an https upload; the picture is swapped in
      // after rendering so both renders load the identical image.
      .replaceAll("https://media.test/logo", LOGO);
    const page = await browser.newPage();
    try {
      await page.setViewportSize({ width, height: 1000 });
      await page.setContent(
        `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
         <style>body{margin:0;background:#555}</style></head>
         <body><div style="width:${width}px">${markup}</div></body></html>`,
        { waitUntil: "load" },
      );
      await page.waitForTimeout(150);
      return await page.evaluate(() => {
        const name = document.querySelector("h1") as HTMLElement;
        const content = name.closest("div[class*='pb-9']") as HTMLElement;
        const img = document.querySelector("img[alt='Aaron Lavi']") as HTMLImageElement | null;
        const r = img?.getBoundingClientRect();
        const cs = img ? getComputedStyle(img) : null;
        const tile = document.querySelector("[data-sl-initials]") as HTMLElement | null;
        const initials = tile?.querySelector("span") as HTMLElement | null;
        const sheet = getComputedStyle(content);
        return {
          img: img && r && cs ? {
            loaded: img.complete && img.naturalWidth > 0,
            x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
            fit: cs.objectFit, pos: cs.objectPosition,
            // The frame that clips the picture: the hero, or the circle.
            radius: getComputedStyle(img.parentElement as HTMLElement).borderRadius,
            frame: (() => {
              const f = (img.parentElement as HTMLElement).getBoundingClientRect();
              return { w: Math.round(f.width), h: Math.round(f.height) };
            })(),
          } : null,
          tileBg: tile ? `${getComputedStyle(tile).backgroundColor} ${getComputedStyle(tile).backgroundImage}` : null,
          initialsColor: initials ? getComputedStyle(initials).color : null,
          nameColor: getComputedStyle(name).color,
          sheetColor: sheet.backgroundColor,
          sheetImage: sheet.backgroundImage,
        };
      });
    } finally {
      await page.close();
    }
  }

  for (const heroStyle of ["cover", "banner", "avatar"] as const) {
    it(`${heroStyle}: "Logo" renders exactly like the same logo uploaded as the header`, async () => {
      const upload = await probe({ logoUrl: null, pageStyle: { heroStyle, heroContent: "custom", heroImage: "https://media.test/logo" } });
      const logo = await probe({ logoUrl: "https://media.test/logo", pageStyle: { heroStyle, heroContent: "logo" } });
      // Auto (and Headshot) on a card with no headshot fall back to the logo —
      // which must now be the same as the upload too.
      const auto = await probe({ logoUrl: "https://media.test/logo", pageStyle: { heroStyle } });
      const headshot = await probe({ logoUrl: "https://media.test/logo", pageStyle: { heroStyle, heroContent: "photo" } });

      expect(upload.img?.loaded).toBe(true);
      expect(upload.img?.fit).toBe("cover");
      for (const r of [logo, auto, headshot]) {
        expect(r.img).toEqual(upload.img);
        // Photo match took the page colour from the logo, as it does from the upload.
        expect(r.sheetColor).toBe(upload.sheetColor);
        expect(r.sheetImage).toBe(upload.sheetImage);
        expect(r.tileBg).toBeNull();
      }
      // …and that colour is the logo's, not the plain white Paper fallback.
      expect(`${upload.sheetColor} ${upload.sheetImage}`).not.toContain("rgb(250, 250, 247)");
      // The picture fills its whole frame — the hero edge to edge, or the
      // whole circle — with no plate or padding around it.
      expect(upload.img?.w).toBe(upload.img?.frame.w);
      expect(upload.img?.h).toBe(upload.img?.frame.h);
      if (heroStyle === "avatar") {
        // rounded-full: a radius at least half the side, i.e. a circle.
        expect(parseFloat(upload.img!.radius)).toBeGreaterThanOrEqual(upload.img!.w / 2);
        expect(upload.img?.w).toBe(upload.img?.h);
      } else {
        // Edge to edge across the 390px column (less the phone zoom on the
        // sheet, which the hero does not take — measured, not assumed).
        expect(upload.img?.w).toBeGreaterThan(350);
        if (heroStyle === "cover") expect(upload.img?.h).toBe(upload.img?.w);
        else expect(upload.img?.h).toBeLessThan(upload.img!.w);
      }
    });
  }

  // Initials, in the page's own colours. Paper is what Photo match renders
  // with no picture to read (the default), Onyx the dark stock, Frost a glass
  // Look whose tile is the sheet's frosted tint.
  const INDIGO = ["rgb(24, 21, 56)", "rgb(42, 36, 102)", "rgb(67, 56, 202)"];
  const CASES: { look?: string; tile: string }[] = [
    { look: undefined, tile: "rgb(232, 230, 223)" }, // Paper's tile, #E8E6DF
    { look: "onyx", tile: "rgb(36, 37, 38)" },       // Onyx's tile, #242526
    { look: "frost", tile: "rgba(244, 247, 251" },   // Frost's sheet, frosted
  ];
  for (const heroStyle of ["cover", "banner", "avatar"] as const) {
    for (const c of CASES) {
      it(`${heroStyle} on ${c.look ?? "Photo match"}: the initials tile is in the page's colours`, async () => {
        const r = await probe({ logoUrl: null, pageStyle: { heroStyle, heroContent: "initials", look: c.look } });
        expect(r.img).toBeNull();
        expect(r.tileBg).not.toBeNull();
        for (const ind of INDIGO) expect(r.tileBg).not.toContain(ind);
        // The circle sits on the sheet and takes the Look's tile colour (a
        // neutral well over glass); the cover/banner tile eases into the sheet.
        if (heroStyle === "avatar" && c.look === "frost") expect(r.tileBg).toMatch(/rgba\(17, 24, 39, 0\.07\)/);
        else expect(r.tileBg).toContain(c.tile);
        // The initials read in the name's own colour on that surface.
        expect(r.initialsColor).toBe(r.nameColor);
      });
    }
  }
});
