// ── Render harness: measure real layout in a real browser ────────────────────
//
// The gap this fills: 26 of our test files are source scanners, and not one of
// them can see a word being cut off. Text overflow is a function of string
// length x font metrics x container width — none of which exist until something
// is actually laid out. So this renders each card template to HTML, loads it in
// headless Chromium with the app's REAL compiled Tailwind CSS, and measures.
//
// Deliberately no dev server, no database, no auth: the templates are pure
// server-rendered components (see AGENTS.md — they must stay hook-free), so
// renderToStaticMarkup is a faithful reproduction of what /card ships.
//
// ON FONT FIDELITY — the reason this is CI-safe:
// The templates use SYSTEM font stacks (Georgia, Times New Roman, system-ui), so
// exact glyph widths differ between a Windows dev box and a Linux runner. That
// makes BOUNDARY assertions ("does a 22-char company fit exactly?") inherently
// flaky. So we never test boundaries. Fixtures are PATHOLOGICAL — values long
// enough to overflow in any font, or to fit in any font once auto-fitting is
// applied. A 3x-too-long title clips in Georgia and in Liberation Serif alike.
// That keeps the signal robust to metric variance instead of pretending it away.

import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium, type Browser } from "playwright";
import { createElement, type ComponentType } from "react";
import type { CardData } from "@/components/card-templates/types";

/** Tailwind's @source wants forward slashes even on Windows. */
const toPosix = (p: string) => p.split(sep).join("/");

let cssPromise: Promise<string> | null = null;

/**
 * Compile the app's real globals.css, widened to scan the whole src tree.
 *
 * Tailwind 4 bases automatic source detection on the CSS file's own directory,
 * which is src/app — so utilities used only in src/components (min-w-0,
 * font-extrabold, the ones the card templates lean on for layout) are never
 * emitted. Without the explicit @source the harness would measure cards with
 * half their layout rules missing and report confident nonsense.
 */
export function appCss(): Promise<string> {
  if (cssPromise) return cssPromise;
  cssPromise = (async () => {
    const cssPath = "src/app/globals.css";
    const original = readFileSync(cssPath, "utf8");
    const srcDir = toPosix(resolve("src"));
    const widened = original.replace(
      '@import "tailwindcss";',
      `@import "tailwindcss";\n@source "${srcDir}";`,
    );
    const result = await postcss([tailwind()]).process(widened, { from: cssPath });
    return result.css;
  })();
  return cssPromise;
}

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch();
}

/** One text node that doesn't fit where it was put. */
export type Offender = {
  /** The visible text, so a failure names the field without us guessing at it. */
  text: string;
  /** px the element extends past the card's bottom edge (clipped by overflow-hidden). */
  overBottom: number;
  /** px past the card's right edge. */
  overRight: number;
  /** px of the element's own content clipped horizontally inside itself. */
  selfClipX: number;
};

export type Measurement = {
  cardWidth: number;
  cardHeight: number;
  /** Content taller than the card = something IS being cut off. The headline signal. */
  overflowY: number;
  overflowX: number;
  offenders: Offender[];
};

/**
 * Render one template at one width and measure what escapes the card.
 *
 * The card root sets `aspectRatio` and `overflow-hidden`, so its height is
 * locked to its width and anything taller is silently clipped — which is exactly
 * how "words cut off" reaches production without anyone seeing an error.
 * overflow:hidden clips PAINTING, not layout, so getBoundingClientRect still
 * reports the true unclipped geometry. That's what makes this measurable at all.
 */
export async function measureCard(
  browser: Browser,
  Template: ComponentType<{ data: CardData }>,
  data: CardData,
  cardWidth: number,
): Promise<Measurement> {
  const css = await appCss();
  const markup = renderToStaticMarkup(createElement(Template, { data }));

  const page = await browser.newPage({ viewport: { width: Math.max(cardWidth + 80, 800), height: 900 } });
  try {
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
       <style>body{margin:0;padding:20px;background:#fff}#holder{width:${cardWidth}px}</style>
       </head><body class="sc-app"><div id="holder">${markup}</div></body></html>`,
      { waitUntil: "load" },
    );

    return await page.evaluate(() => {
      const card = document.querySelector(".sc-card") as HTMLElement | null;
      if (!card) throw new Error("no .sc-card in rendered output");
      const cardRect = card.getBoundingClientRect();

      // Sub-pixel rounding and antialiasing routinely produce ~0.5px of slop.
      // Anything under a pixel is not a visible defect; treating it as one would
      // make every run a coin flip.
      const TOL = 1;

      const offenders: Offender[] = [];
      for (const el of Array.from(card.querySelectorAll<HTMLElement>("*"))) {
        // Leaf text only. A wrapper "overflows" merely because its child does,
        // and reporting both buries the actual field in duplicates.
        if (el.children.length > 0) continue;
        const text = (el.textContent || "").trim();
        if (!text) continue;

        const r = el.getBoundingClientRect();
        const overBottom = r.bottom - cardRect.bottom;
        const overRight = r.right - cardRect.right;
        const selfClipX = el.scrollWidth - el.clientWidth;

        if (overBottom > TOL || overRight > TOL || selfClipX > TOL) {
          offenders.push({
            text: text.slice(0, 60),
            overBottom: Math.round(Math.max(0, overBottom)),
            overRight: Math.round(Math.max(0, overRight)),
            selfClipX: Math.round(Math.max(0, selfClipX)),
          });
        }
      }

      return {
        cardWidth: Math.round(cardRect.width),
        cardHeight: Math.round(cardRect.height),
        overflowY: Math.max(0, card.scrollHeight - card.clientHeight),
        overflowX: Math.max(0, card.scrollWidth - card.clientWidth),
        offenders,
      };
    });
  } finally {
    await page.close();
  }
}
