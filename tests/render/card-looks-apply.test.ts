import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Browser, Page } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { appCss, launchBrowser } from "./harness";
import { BASE, LOGOS, HEADSHOT } from "./card-fixtures";
import ClassicPro from "@/components/card-templates/ClassicPro";
import ModernBold from "@/components/card-templates/ModernBold";
import PhotoFirst from "@/components/card-templates/PhotoFirst";
import LocalBusiness from "@/components/card-templates/LocalBusiness";
import LuxuryMinimal from "@/components/card-templates/LuxuryMinimal";
import LogoFirst from "@/components/card-templates/LogoFirst";
import type { CardData } from "@/components/card-templates/types";
import { META, type Look } from "@/lib/template-style-presets";

// ─────────────────────────────────────────────────────────────────────────────
// A LOOK PAINTS THE WHOLE CARD.
//
// Owner, 2026-10-15: pressing a Look has to actually give you "the color that
// the text says it's going to be, the background, all that", and the looks
// must be "clean" — not some parts changed and the rest left in the template's
// colours. Before this, "Emerald" was a green Classic Pro with blue icons and
// a violet bar, and Photo First's "Indigo" kept a purple photo panel.
//
// This renders the REAL template with each of the 156 Looks in headless
// Chromium and reads the computed colours off the card: the name, title,
// company, details ink and the accent must each be painted somewhere on it,
// and the accent's neighbours (Classic Pro's bar end, Photo First's rule…)
// must no longer be the template's own fixed colour.
// ─────────────────────────────────────────────────────────────────────────────

const TEMPLATES: Record<string, React.ComponentType<{ data: CardData }>> = {
  "classic-pro": ClassicPro, "modern-bold": ModernBold, "photo-first": PhotoFirst,
  "local-business": LocalBusiness, "luxury-minimal": LuxuryMinimal, "logo-first": LogoFirst,
};

/** The template's fixed companions of its default accent — none may survive a Look. */
const DEFAULT_COMPANIONS: Record<string, string[]> = {
  "classic-pro": ["rgb(124, 58, 237)"], // #7c3aed bar end
  "photo-first": ["rgb(167, 139, 250)"], // #a78bfa rule end
  "local-business": ["rgb(251, 191, 36)", "rgb(245, 158, 11)"], // rule + bar
  "modern-bold": ["rgba(59, 130, 246, 0.12)"], // bloom
  "luxury-minimal": ["rgb(140, 108, 52)"], // strip end
  "logo-first": [],
};

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

let browser: Browser;
let page: Page;
let css: string;

beforeAll(async () => {
  css = await appCss();
  browser = await launchBrowser();
  page = await browser.newPage();
}, 120_000);

afterAll(async () => { await browser?.close(); });

function cardFor(template: string, look: Look): string {
  const data: CardData = {
    ...BASE,
    phone: "(415) 555-0188", email: "alex@coastlinerealty.com", website: "coastlinehomes.com",
    address: "1200 Ocean Ave\nSan Francisco, CA", logoUrl: LOGOS.square,
    // Photo First's photo panel colour shows round a Circle photo.
    photoUrl: HEADSHOT,
    customization: {
      bgColor: look.bg, textColor: look.text, fontFamily: look.font, finish: look.finish,
      surfaceColor: look.surface, titleColor: look.title, companyColor: look.company,
      infoColor: look.info, accentColor: look.accent,
      ...(template === "photo-first" ? { photoShape: "circle" } : {}),
    },
  };
  return renderToStaticMarkup(createElement(TEMPLATES[template], { data }));
}

for (const template of Object.keys(TEMPLATES)) {
  describe(`${template}: every Look shows on the card`, () => {
    it("name, title, company, details, accent — and the second surface — are all painted", async () => {
      const problems: string[] = [];
      for (const look of META[template].looks) {
        await page.setContent(
          `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head>
           <body class="sc-app" style="margin:0;padding:10px"><div style="width:420px">${cardFor(template, look)}</div></body></html>`,
        );
        const seen = await page.evaluate(() => {
          const colors = new Set<string>();
          const card = document.querySelector(".sc-card") ?? document.body;
          for (const el of [card, ...card.querySelectorAll<HTMLElement | SVGElement>("*")]) {
            const cs = getComputedStyle(el);
            colors.add(cs.color);
            colors.add(cs.backgroundColor);
            colors.add(cs.fill);
            colors.add(cs.stroke);
            colors.add(cs.borderTopColor);
            const bi = cs.backgroundImage;
            if (bi && bi !== "none") for (const m of bi.match(/rgba?\([^)]+\)/g) ?? []) colors.add(m);
          }
          return [...colors];
        });
        const has = (hex: string) => seen.includes(rgb(hex));
        const want: Record<string, string> = { name: look.text, title: look.title!, company: look.company!, details: look.info!, accent: look.accent! };
        for (const [what, hex] of Object.entries(want)) {
          // Logo First brightens an accent that is too close to its ground;
          // every Look's accent is chosen to read, so it is drawn as given.
          if (!has(hex)) problems.push(`${look.name}: ${what} ${hex} not on the card`);
        }
        if (look.surface && !look.surface.includes("gradient") && !has(look.surface)) {
          problems.push(`${look.name}: second surface ${look.surface} not on the card`);
        }
        for (const c of DEFAULT_COMPANIONS[template]) {
          // A Look whose accent IS that colour (Plum's violet, Electric
          // Dark's blue) draws it by choice, as its own shade.
          const [ar, ag, ab] = rgb(look.accent!).match(/\d+/g)!;
          if (c.startsWith(`rgb(${ar}, ${ag}, ${ab})`) || c.startsWith(`rgba(${ar}, ${ag}, ${ab},`)) continue;
          if (seen.includes(c)) problems.push(`${look.name}: still draws the template's own ${c} beside its accent`);
        }
      }
      expect(problems).toEqual([]);
    }, 240_000);
  });
}
