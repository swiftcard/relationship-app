import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Browser, Page } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { chromium, webkit } from "playwright";
import { appCss } from "./harness";
import { SCENARIOS, HEADSHOT, withFont } from "./card-fixtures";
import PhotoFirst from "@/components/card-templates/PhotoFirst";
import { withoutSocials, type CardData } from "@/components/card-templates/types";

// ─────────────────────────────────────────────────────────────────────────────
// PHOTO FIRST, PHOTO SHAPE "CIRCLE".
//
// Owner, 2026-10-09: "If a user selects the photo-first template, they should
// also have an option to make the photo circle or keep it as its original. A
// circle will just put their photo in a circle in the photo panel on the left
// side. … if a user selects the circle, then they can also change the photo
// panel background color behind it."
//
// Drawn the way the public page draws it, from one field to every field at the
// limits, on the template's own violet, a dark colour and a light one:
//   1. the photo is a true circle, whole, inside the photo panel;
//   2. the name and title sit under it, inside the panel, touching nothing;
//   3. the panel is exactly the colour picked — no scrim, no tint over it;
//   4. on a light colour the name turns to ink instead of vanishing;
//   5. "Original" is the full-height photo it always was.
// ─────────────────────────────────────────────────────────────────────────────

const WIDTH = 460;
const PANELS: Array<[string, string | undefined]> = [
  ["template violet", undefined],
  ["dark green", "#052e2b"],
  ["white", "#ffffff"],
];

type Report = {
  problems: string[];
  panelBg: string;
  nameColor: string;
  scrim: boolean;
};

async function measure(page: Page, css: string, data: CardData): Promise<Report> {
  const markup = renderToStaticMarkup(createElement(PhotoFirst, { data: withoutSocials(data) }));
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
     <style>body{margin:0;padding:20px;background:#fff}#h{width:${WIDTH}px}</style></head>
     <body class="sc-app"><div id="h">${markup}</div></body></html>`,
    { waitUntil: "load" },
  );
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return page.evaluate(() => {
    const TOL = 1;
    const card = document.querySelector(".sc-card") as HTMLElement;
    const panel = card.firstElementChild as HTMLElement;
    const pr = panel.getBoundingClientRect();
    const problems: string[] = [];
    const inside = (r: DOMRect) =>
      r.left >= pr.left - TOL && r.right <= pr.right + TOL && r.top >= pr.top - TOL && r.bottom <= pr.bottom + TOL;
    const hit = (a: DOMRect, b: DOMRect) =>
      a.left < b.right - TOL && b.left < a.right - TOL && a.top < b.bottom - TOL && b.top < a.bottom - TOL;

    const photo = panel.querySelector("img, .rounded-full") as HTMLElement | null;
    if (!photo) problems.push("no photo or initials circle in the photo panel");
    const ph = photo?.getBoundingClientRect();
    if (photo && ph) {
      if (Math.abs(ph.width - ph.height) > TOL) problems.push(`photo is ${Math.round(ph.width)}×${Math.round(ph.height)}, not round`);
      const radius = parseFloat(getComputedStyle(photo).borderTopLeftRadius);
      if (!(radius >= ph.width / 2 - TOL)) problems.push(`photo corner radius ${radius}px on a ${Math.round(ph.width)}px photo — not a circle`);
      if (!inside(ph)) problems.push("photo leaves the photo panel");
      if (ph.width < pr.width * 0.45) problems.push(`photo only ${Math.round(ph.width)}px wide in a ${Math.round(pr.width)}px panel`);
    }

    const name = panel.querySelector("h2") as HTMLElement;
    const title = panel.querySelector("h2 + p") as HTMLElement | null;
    for (const [label, el] of [["name", name], ["title", title]] as const) {
      if (!el || !el.textContent?.trim()) continue;
      const r = el.getBoundingClientRect();
      if (!inside(r)) problems.push(`${label} is cut off by the photo panel`);
      if (ph && hit(r, ph)) problems.push(`${label} runs into the photo`);
      if (ph && r.top < ph.bottom - TOL) problems.push(`${label} is not under the photo`);
      if (el.scrollWidth > el.clientWidth + TOL) problems.push(`${label} overflows its line`);
    }

    // The dark scrim the full-height photo needs has no place on a colour.
    const scrim = [...panel.querySelectorAll<HTMLElement>("div")].some((d) => /rgba\(0,\s*0,\s*0,\s*0\.72\)/.test(d.style.background));
    const cs = getComputedStyle(panel);
    return { problems, panelBg: `${cs.backgroundColor} ${cs.backgroundImage}`, nameColor: getComputedStyle(name).color, scrim };
  });
}

/** Relative luminance of a computed rgb() colour, 0 (black) – 1 (white). */
function luminance(rgb: string): number {
  const [r, g, b] = (rgb.match(/[\d.]+/g) ?? ["0", "0", "0"]).slice(0, 3).map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const ENGINES = [
  { engine: "Chromium", launch: () => chromium.launch(), fonts: [["default", undefined], ["serif", "Georgia, 'Times New Roman', serif"], ["mono", "'Courier New', ui-monospace, monospace"]] as Array<[string, string | undefined]> },
  // The iPhone app and Safari are WebKit, and so is the engine that takes the
  // texted-link preview picture.
  { engine: "WebKit", launch: () => webkit.launch(), fonts: [["default", undefined]] as Array<[string, string | undefined]> },
] as const;

for (const { engine, launch, fonts } of ENGINES) {
  describe(`${engine}: Photo First with a circle photo`, () => {
    let browser: Browser;
    let page: Page;
    let css: string;
    beforeAll(async () => {
      browser = await launch();
      css = await appCss();
      page = await browser.newPage({ viewport: { width: WIDTH + 80, height: 900 } });
    }, 180_000);
    afterAll(async () => { await browser?.close(); });

    it("a round photo with the name under it, on exactly the colour picked, from one field to every field", async () => {
      const failures: string[] = [];
      for (const [fname, fontFamily] of fonts) {
        for (const [sname, base] of SCENARIOS) {
          for (const withPhoto of [true, false]) {
            for (const [pname, surfaceColor] of PANELS) {
              const data = withFont({
                ...base,
                photoUrl: withPhoto ? HEADSHOT : null,
                customization: { ...(base.customization ?? {}), photoShape: "circle", ...(surfaceColor ? { surfaceColor } : {}) },
              }, fontFamily);
              const r = await measure(page, css, data);
              const tag = `[${fname}, ${withPhoto ? "photo" : "initials"}, ${pname}] ${sname}`;
              for (const p of r.problems) failures.push(`${tag}: ${p}`);
              if (r.scrim) failures.push(`${tag}: the dark photo scrim is drawn over the panel colour`);
              if (surfaceColor === "#052e2b" && !r.panelBg.includes("rgb(5, 46, 43)")) failures.push(`${tag}: panel is ${r.panelBg}, not the colour picked`);
              if (surfaceColor && /radial-gradient/.test(r.panelBg)) failures.push(`${tag}: a tint is laid over the colour picked`);
              if (surfaceColor === "#ffffff" && luminance(r.nameColor) > 0.3) failures.push(`${tag}: name is ${r.nameColor} on a white panel`);
              if (surfaceColor !== "#ffffff" && luminance(r.nameColor) < 0.6) failures.push(`${tag}: name is ${r.nameColor} on a dark panel`);
            }
          }
        }
      }
      expect(failures, `${failures.length} problem(s)\n  ${failures.join("\n  ")}`).toEqual([]);
    }, 600_000);

    it("a Name color the owner picked still wins on a light panel", async () => {
      const r = await measure(page, css, {
        ...SCENARIOS[0][1], photoUrl: HEADSHOT,
        customization: { photoShape: "circle", surfaceColor: "#ffffff", textColor: "#0e1b35" },
      });
      expect(r.nameColor).toBe("rgb(14, 27, 53)");
    });

    it("Original is the full-height photo it always was", async () => {
      const markup = renderToStaticMarkup(createElement(PhotoFirst, { data: withoutSocials({ ...SCENARIOS[0][1], photoUrl: HEADSHOT }) }));
      expect(markup).not.toContain("rounded-full object-cover");
      expect(markup).toContain("absolute inset-0 w-full h-full object-cover");
      expect(markup).toContain("rgba(0,0,0,0.72)");
      const full = await measure(page, css, { ...SCENARIOS[0][1], photoUrl: HEADSHOT, customization: { surfaceColor: "#052e2b" } });
      // The panel's own img fills it top to bottom.
      const fills = await page.evaluate(() => {
        const panel = document.querySelector(".sc-card")!.firstElementChild as HTMLElement;
        const img = panel.querySelector("img")!.getBoundingClientRect();
        const pr = panel.getBoundingClientRect();
        return Math.abs(img.height - pr.height) <= 1 && Math.abs(img.width - pr.width) <= 1;
      });
      expect(fills).toBe(true);
      expect(full.scrim).toBe(true);
    });
  });
}
