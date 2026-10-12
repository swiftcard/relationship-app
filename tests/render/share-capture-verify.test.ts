import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser, BrowserType, Page } from "playwright";
import { chromium, webkit } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { appCss } from "./harness";
import { SCENARIOS } from "./card-fixtures";
import { mustPaint, pixelsOf, paintedIn, overlaps, capturePainted } from "@/lib/capture-verify";

import ClassicPro from "@/components/card-templates/ClassicPro";
import ModernBold from "@/components/card-templates/ModernBold";
import PhotoFirst from "@/components/card-templates/PhotoFirst";
import LocalBusiness from "@/components/card-templates/LocalBusiness";
import LuxuryMinimal from "@/components/card-templates/LuxuryMinimal";
import LogoFirst from "@/components/card-templates/LogoFirst";
import { withoutSocials, type CardData } from "@/components/card-templates/types";

// ─────────────────────────────────────────────────────────────────────────────
// THE SHARE PREVIEW MUST NEVER MISS THE NAME OR THE LOGO.
//
// Owner, 2026-10-06: "sometimes it'll miss my name, sometimes it'll miss my
// logo. It cannot miss anything. Any time a card link is sent it has to show
// the correct preview of the card."
//
// ShareCardCapture now refuses a capture whose pixels lack the name, logo or
// photo (lib/capture-verify). That check has two ways to fail, and both are
// pinned here with the real html-to-image in the real engines — Chromium, and
// WebKit, which is the iPhone app:
//   1. a complete capture must PASS — a false reject would leave a card on the
//      rendered stand-in forever;
//   2. a capture with the name, the logo or the photo missing must FAIL —
//      the way WebKit actually drops a picture: the image paints nothing while
//      its box still draws. A circle logo's ring and plate and a circle
//      headshot's ring are part of that box, and once let an empty capture
//      through (nightly QA, 2026-10-11), so those run too.
// ─────────────────────────────────────────────────────────────────────────────

const TEMPLATES: Array<[string, React.ComponentType<{ data: CardData }>]> = [
  ["classic-pro", ClassicPro],
  ["modern-bold", ModernBold],
  ["photo-first", PhotoFirst],
  ["local-business", LocalBusiness],
  ["luxury-minimal", LuxuryMinimal],
  ["logo-first", LogoFirst],
];

const PICK = ["name only", "typical + address + logo + photo", "typical + banner logo", "everything at the limits"];
const CASES = SCENARIOS.filter(([n]) => PICK.includes(n));
const NEGATIVE = "typical + address + logo + photo";

const WIDTH = 460; // ShareCardCapture NATURAL
const HTML_TO_IMAGE = readFileSync(resolve("node_modules/html-to-image/dist/html-to-image.js"), "utf8");
// The exact functions ShareCardCapture runs, handed to the page. __name is the
// helper esbuild's keepNames wraps functions in.
const VERIFY = `window.__name = window.__name || ((f) => f);
const mustPaint = ${mustPaint.toString()};
const pixelsOf = ${pixelsOf.toString()};
const paintedIn = ${paintedIn.toString()};
const overlaps = ${overlaps.toString()};
window.capturePainted = ${capturePainted.toString()};`;

type Verdict = { found: number; complete: boolean; noName: boolean; noLogo: boolean | null; noPhoto: boolean | null };

async function verdict(page: Page, css: string, Template: React.ComponentType<{ data: CardData }>, data: CardData, negatives: boolean): Promise<Verdict> {
  const markup = renderToStaticMarkup(createElement(Template, { data: withoutSocials(data) }));
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
     <style>body{margin:0;background:#FAF7F2}#h{width:${WIDTH}px;background:#FAF7F2}</style></head>
     <body class="sc-app"><div id="h">${markup}</div></body></html>`,
    { waitUntil: "load" },
  );
  await page.addScriptTag({ content: HTML_TO_IMAGE });
  await page.addScriptTag({ content: VERIFY });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return page.evaluate(async ({ name, negatives }) => {
    const w = window as unknown as {
      htmlToImage: { toPng: (el: HTMLElement, o: object) => Promise<string> };
      capturePainted: (el: HTMLElement, name: string, dataUrl: string, w: number, raster: () => Promise<string | null>) => Promise<boolean>;
    };
    const el = document.getElementById("h") as HTMLElement;
    const width = el.offsetWidth, height = el.offsetHeight, SCALE = 4;
    const raster = () => w.htmlToImage.toPng(el, {
      width: width * SCALE, height: height * SCALE, pixelRatio: 1, cacheBust: false, backgroundColor: "#FAF7F2",
      style: { transform: `scale(${SCALE})`, transformOrigin: "top left" },
    });
    // How many must-paint things the check found: the name at least.
    const words = name.split(/\s+/).filter((x: string) => x.length >= 2);
    let found = 0;
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) if (words.some((x: string) => (n!.textContent ?? "").includes(x))) found++;

    const complete = await w.capturePainted(el, name, await raster(), width, raster);
    if (!negatives) return { found, complete, noName: false, noLogo: null, noPhoto: null };

    // Simulate WebKit's failure: the name's glyphs didn't paint.
    const nameNodes: HTMLElement[] = [];
    const walk2 = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walk2.nextNode(); n; n = walk2.nextNode()) {
      if (n.parentElement && words.some((x: string) => (n!.textContent ?? "").includes(x))) nameNodes.push(n.parentElement);
    }
    // Glyphs AND their shadow (Photo First and Local Business shadow the name).
    nameNodes.forEach((n) => { n.style.color = "transparent"; n.style.webkitTextFillColor = "transparent"; n.style.textShadow = "none"; });
    const blankName = await raster();
    nameNodes.forEach((n) => { n.style.color = ""; n.style.webkitTextFillColor = ""; n.style.textShadow = ""; });
    const noName = !(await w.capturePainted(el, name, blankName, width, raster));

    // …and a picture didn't: its image painted nothing, its box (ring, plate,
    // border) still drew — so the source is swapped for a blank, not hidden.
    const BLANK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const blankOf = async (img: HTMLImageElement) => {
      // Size held where it is: an undecoded picture keeps its laid-out box
      // (html-to-image copies the computed size), while a 1×1 blank would
      // shrink an auto-width logo and move everything beside it.
      const r = img.getBoundingClientRect();
      const was = { src: img.src, width: img.style.width, height: img.style.height };
      img.style.width = `${r.width}px`;
      img.style.height = `${r.height}px`;
      img.src = BLANK;
      await img.decode().catch(() => {});
      const shot = await raster();
      img.src = was.src;
      img.style.width = was.width;
      img.style.height = was.height;
      await img.decode().catch(() => {});
      return shot;
    };
    const logo = el.querySelector('img[alt="logo"]') as HTMLImageElement | null;
    let noLogo: boolean | null = null;
    if (logo) noLogo = !(await w.capturePainted(el, name, await blankOf(logo), width, raster));
    const photo = [...el.querySelectorAll("img")].find((i) => i.alt !== "logo") as HTMLImageElement | undefined;
    let noPhoto: boolean | null = null;
    if (photo) noPhoto = !(await w.capturePainted(el, name, await blankOf(photo), width, raster));
    return { found, complete, noName, noLogo, noPhoto };
  }, { name: data.name, negatives });
}

const ENGINES: Array<[string, BrowserType]> = [["chromium", chromium], ["webkit", webkit]];

for (const [engine, type] of ENGINES) {
  describe(`share capture verification — ${engine}`, () => {
    let browser: Browser;
    let page: Page;
    let css: string;

    beforeAll(async () => {
      css = await appCss();
      browser = await type.launch();
      page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    });
    afterAll(async () => { await browser?.close(); });

    // Every content shape, plus the negative card again with the circle logo
    // and (Photo First) the circle headshot, whose rings are part of the box.
    const CIRCLES: Array<[string, CardData]> = CASES.filter(([n]) => n === NEGATIVE).map(([n, d]) =>
      [`${n} · circle logo + circle photo`, { ...d, customization: { ...(d.customization ?? {}), logoShape: "circle", photoShape: "circle" } }]);
    for (const [tname, Template] of TEMPLATES) {
      for (const [sname, data] of [...CASES, ...CIRCLES]) {
        const negatives = sname.startsWith(NEGATIVE);
        it(`${tname} · ${sname}`, async () => {
          const v = await verdict(page, css, Template, data, negatives);
          expect(v.found, "the name must be on the card for the check to find").toBeGreaterThan(0);
          expect(v.complete, "a complete capture was rejected — this card would never get its real preview").toBe(true);
          if (negatives) {
            expect(v.noName, "a capture with no name was accepted").toBe(true);
            expect(v.noLogo, "a capture with no logo was accepted").toBe(true);
            if (v.noPhoto !== null) expect(v.noPhoto, "a capture with no photo was accepted").toBe(true);
          }
        }, 120_000);
      }
    }
  });
}
