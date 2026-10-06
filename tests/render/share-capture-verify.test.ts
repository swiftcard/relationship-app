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
//   2. a capture with the name or the logo missing must FAIL.
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

type Verdict = { found: number; complete: boolean; noName: boolean; noLogo: boolean | null };

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
    if (!negatives) return { found, complete, noName: false, noLogo: null };

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

    // …and the logo didn't.
    const logo = el.querySelector('img[alt="logo"]') as HTMLImageElement | null;
    let noLogo: boolean | null = null;
    if (logo) {
      logo.style.opacity = "0";
      const blankLogo = await raster();
      logo.style.opacity = "";
      noLogo = !(await w.capturePainted(el, name, blankLogo, width, raster));
    }
    return { found, complete, noName, noLogo };
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

    for (const [tname, Template] of TEMPLATES) {
      for (const [sname, data] of CASES) {
        const negatives = sname === NEGATIVE;
        it(`${tname} · ${sname}`, async () => {
          const v = await verdict(page, css, Template, data, negatives);
          expect(v.found, "the name must be on the card for the check to find").toBeGreaterThan(0);
          expect(v.complete, "a complete capture was rejected — this card would never get its real preview").toBe(true);
          if (negatives) {
            expect(v.noName, "a capture with no name was accepted").toBe(true);
            expect(v.noLogo, "a capture with no logo was accepted").toBe(true);
          }
        }, 120_000);
      }
    }
  });
}
