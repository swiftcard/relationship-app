import { describe, it, expect } from "vitest";
import { createElement as h, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ClassicPro from "@/components/card-templates/ClassicPro";
import ModernBold from "@/components/card-templates/ModernBold";
import PhotoFirst from "@/components/card-templates/PhotoFirst";
import LocalBusiness from "@/components/card-templates/LocalBusiness";
import LuxuryMinimal from "@/components/card-templates/LuxuryMinimal";
import LogoFirst from "@/components/card-templates/LogoFirst";
import { SAMPLE_DATA, type CardData } from "@/components/card-templates/types";
import { templateStyle } from "@/lib/template-style";
import { passPalette, hexStops, readableAccent } from "@/lib/wallet-palette";
import type { ResolvedCardMeta } from "@/lib/resolve-card";

// ─────────────────────────────────────────────────────────────────────────────
// THE PASS IS THE CARD.
//
// Owner, 2026-09-18: "The colors should be the exact same on the pass as they
// are on the actual SwiftCard that is selected." wallet-palette reproduces each
// template's colour rules so a server route can build a pass without rendering
// React — which means there are two copies of "what colour is this card", and
// two copies drift. This file is the tripwire: it renders the REAL templates
// and checks the pass against what they actually drew. If a template changes
// a colour, a default or a texture, this fails and names wallet-palette as the
// other place to change.
// ─────────────────────────────────────────────────────────────────────────────

type Meta = NonNullable<ResolvedCardMeta>;

const TEMPLATES: [string, ComponentType<{ data: CardData }>][] = [
  ["classic-pro", ClassicPro],
  ["modern-bold", ModernBold],
  ["photo-first", PhotoFirst],
  ["local-business", LocalBusiness],
  ["luxury-minimal", LuxuryMinimal],
  ["logo-first", LogoFirst],
];

// Real editor combinations: defaults, a pink accent, a dark details surface,
// a detail-text colour, a light panel, and a finish (with and without an
// accent — Logo First reads its accent differently once a finish is on).
const STYLES: Record<string, Record<string, unknown>> = {
  default: {},
  pink: { accentColor: "#ec4899" },
  darkDetails: { surfaceColor: "#0e1b35" },
  infoColor: { infoColor: "#94a3b8" },
  lightPanel: { bgColor: "#f8fafc", textColor: "#0f172a" },
  linen: { finish: "linen" },
  linenTeal: { finish: "linen", accentColor: "#14b8a6" },
  gradient: { bgColor: "linear-gradient(135deg, #111827 0%, #6d28d9 100%)" },
  // Title color and Company color (2026-10-09): a rose and a green that read
  // on every default ground, so the title check below sees them exactly.
  ownTitleCompany: { titleColor: "#e11d48", companyColor: "#16a34a" },
};

/** #abc → #aabbcc, lower-case, everywhere in a string. */
const norm = (s: string) =>
  s.toLowerCase().replace(/#([0-9a-f])([0-9a-f])([0-9a-f])(?![0-9a-f])/g, "#$1$1$2$2$3$3");

function render(Comp: ComponentType<{ data: CardData }>, customization: Record<string, unknown>) {
  return norm(renderToStaticMarkup(h(Comp, { data: { ...SAMPLE_DATA, customization } })));
}

function metaFor(template: string, customization: Record<string, unknown>): Meta {
  return {
    name: SAMPLE_DATA.name, title: SAMPLE_DATA.title ?? null, company: SAMPLE_DATA.company ?? null,
    photoUrl: null, logoUrl: null, phone: SAMPLE_DATA.phone ?? null, email: SAMPLE_DATA.email ?? null,
    website: null, address: null, accentColor: null, template,
    style: templateStyle({ customization }), custom: null,
  };
}

/** The first phone row ContactRows draws: its text colour and its icon's. */
function phoneRow(html: string): { value: string; icon: string } {
  const m = /<a href="tel:[^"]*"[^>]*?style="color:([^;"]+)[^"]*"><span[^>]*?style="color:([^;"]+)/.exec(html);
  if (!m) throw new Error("no phone row in the rendered card");
  return { value: m[1].trim(), icon: m[2].trim() };
}

const backgrounds = (html: string) =>
  [...html.matchAll(/background:([^;"]+)/g)].map((m) => m[1].replace(/&quot;/g, '"').trim());

describe("the pass takes its colours from the card as rendered", () => {
  for (const [template, Comp] of TEMPLATES) {
    for (const [styleName, customization] of Object.entries(STYLES)) {
      it(`${template} / ${styleName}`, () => {
        const html = render(Comp, customization);
        const p = passPalette(metaFor(template, customization));
        const row = phoneRow(html);

        // The phone and email: the card's contact text colour, exactly.
        expect(p.body.value, "pass values = the card's contact text").toBe(row.value);

        // The labels: the card's contact-icon colour. Classic Pro draws its
        // icons in the row colour, so there the labels take its accent. The one
        // permitted difference is the readability lift, and only for a colour
        // that would vanish on the flat body (a violet icon on a panel whose
        // gradient ENDS in that violet) — anything readable stays exact.
        if (row.icon !== row.value) {
          expect(p.body.label, "pass labels = the card's icon colour")
            .toBe(readableAccent(p.body.background, p.body.value, row.icon));
          if (styleName === "default" || styleName === "pink") expect(p.body.label).toBe(row.icon);
        } else {
          expect(p.body.label).toBe(p.accent);
        }

        // The body is a surface the card actually paints.
        const grounds = backgrounds(html);
        expect(
          grounds.some((b) => hexStops(b).includes(p.body.background)),
          `pass body ${p.body.background} is not a surface of the card: ${grounds.join(" | ")}`,
        ).toBe(true);

        // The band is the card's panel: its exact CSS on a two-tone card (the
        // card composes a finish in front of it), its stops on a one-colour
        // card (re-laid top to bottom so the band ends on the body colour).
        if (p.twoTone) {
          expect(grounds.some((b) => b === p.surface.base || b.endsWith(`, ${p.surface.base}`)),
            `band ${p.surface.base} is not a panel of the card`).toBe(true);
        } else {
          for (const stop of hexStops(p.surface.base)) {
            expect(grounds.some((b) => hexStops(b).includes(stop)), `band stop ${stop}`).toBe(true);
          }
        }

        // Where the template colours its job title inline, the pass title is
        // that colour.
        if (template === "modern-bold" || template === "logo-first" || template === "luxury-minimal") {
          expect(html, `title colour ${p.title}`).toContain(`color:${p.title}`);
        }
      });
    }
  }
});

describe("the textures the pass copies are still the textures the cards draw", () => {
  // Pinned to source, because a texture is a string that means nothing to a
  // type checker: if a template's texture changes, the pass keeps drawing the
  // old one until someone updates wallet-palette to match.
  const src = (f: string) => readFileSync(join(process.cwd(), "src/components/card-templates", f), "utf8");
  const palette = readFileSync(join(process.cwd(), "src/lib/wallet-palette.ts"), "utf8");

  it("Classic Pro — dot grid and the blue→violet foot bar", () => {
    const s = src("ClassicPro.tsx");
    expect(s).toContain('backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)"');
    expect(s).toContain('backgroundSize: "14px 14px"');
    expect(s).toContain("background: `linear-gradient(90deg, ${BLUE}, #7c3aed)`");
    expect(palette).toContain('image: "radial-gradient(rgba(255,255,255,0.06) 10.1%, transparent 10.1%)", size: "14px 14px"');
  });

  it("Modern Bold — the 24px grid and the blue bloom", () => {
    const s = src("ModernBold.tsx");
    expect(s).toContain('"linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)"');
    expect(s).toContain('backgroundSize: "24px 24px"');
    expect(s).toContain('"radial-gradient(circle, rgba(59,130,246,0.12) 0%, transparent 70%)"');
    expect(s).toMatch(/width: 120, height: 120,\s+top: -30, right: -20/);
  });

  it("Local Business — the diagonal and the amber foot bar", () => {
    const s = src("LocalBusiness.tsx");
    expect(s).toContain('"repeating-linear-gradient(135deg, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) 1px, transparent 1px, transparent 14px)"');
    expect(s).toContain("background: `linear-gradient(90deg, ${AMBER}, #f59e0b, ${AMBER2})`");
  });

  it("Photo First — the violet bloom over the photo panel", () => {
    expect(src("PhotoFirst.tsx")).toContain('"radial-gradient(ellipse at 60% 20%, rgba(167,139,250,0.35) 0%, transparent 60%)"');
  });

  it("Luxury Minimal — the gold foil edge", () => {
    const s = src("LuxuryMinimal.tsx");
    expect(s).toContain("background: `linear-gradient(to bottom, ${GOLD2}, ${GOLD}, #8c6c34)`");
    expect(s).toMatch(/width: 5,/);
  });

  it("Logo First — the tinted mark column and its hairline", () => {
    const s = src("LogoFirst.tsx");
    expect(s).toContain('background: dark ? "rgba(255,255,255,0.045)" : "rgba(20,27,38,0.035)"');
    expect(s).toContain('const ruleColor = dark ? "rgba(255,255,255,0.20)" : "rgba(20,27,38,0.14)"');
  });
});

describe("the pass follows the card's plan", () => {
  it("reads the style through the same render-time plan filter as the card page", () => {
    // A downgraded Pro can still have a finish or Pro colours SAVED; the card
    // page hides them, and the pass copying the card must too.
    const s = readFileSync(join(process.cwd(), "src/lib/resolve-card.ts"), "utf8");
    // (computed once as `style`, then returned — and the accent comes from it)
    expect(s).toMatch(/const style = templateStyle\(\{\s*customization: sanitizeCustomizationForPlan\(/);
    expect(s).toMatch(/^\s*style,$/m);
    expect(s).toContain("accentColor: str(style.accentColor),");
  });
});
