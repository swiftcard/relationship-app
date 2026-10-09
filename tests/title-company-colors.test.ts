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
import { META, FALLBACK_META } from "@/lib/template-style-presets";
import { PRO_CUSTOMIZATION_KEYS, convertCustomizationToFreeClosest, proFeaturesInUse } from "@/lib/plan";
import { PREFILL_STYLE_KEYS } from "@/lib/prefill";
import { passPalette } from "@/lib/wallet-palette";
import { templateStyle } from "@/lib/template-style";

// ── Title color and Company color, each on its own ──────────────────────────
//
// Owner, 2026-10-09: "there isn't a place for me to change the color of my
// title or my company name… it shouldn't be that the color you choose changes
// both of them." Every template borrowed some other control for these two
// lines — the accent, the details colour, or nothing — and on Luxury Minimal
// one accent painted both. Now each has its own step, and picking one never
// moves the other.

const TEMPLATES: [string, ComponentType<{ data: CardData }>][] = [
  ["classic-pro", ClassicPro],
  ["modern-bold", ModernBold],
  ["photo-first", PhotoFirst],
  ["local-business", LocalBusiness],
  ["luxury-minimal", LuxuryMinimal],
  ["logo-first", LogoFirst],
];

const TITLE = "#e11d48";
const COMPANY = "#16a34a";

function render(Comp: ComponentType<{ data: CardData }>, customization: Record<string, unknown>) {
  return renderToStaticMarkup(h(Comp, { data: { ...SAMPLE_DATA, customization } }));
}

/** The opening tag of the element whose whole text is `text`. */
function tagAround(html: string, text: string): string {
  const at = html.indexOf(`>${text}</`);
  if (at < 0) throw new Error(`"${text}" is not on the card`);
  return html.slice(html.lastIndexOf("<", at), at + 1);
}

// The `color` declaration itself, never the tail of `background-color`.
const colorOf = (tag: string) => /[";]\s*color:\s*([^;"]+)/.exec(tag)?.[1].trim() ?? null;
const titleTag = (html: string) => tagAround(html, SAMPLE_DATA.title!);
const companyTag = (html: string) => tagAround(html, SAMPLE_DATA.company!);

describe("every template paints the title and the company in their own colours", () => {
  for (const [id, Comp] of TEMPLATES) {
    it(`${id}: the picked colours land on exactly those two lines`, () => {
      const html = render(Comp, { titleColor: TITLE, companyColor: COMPANY });
      expect(colorOf(titleTag(html))).toBe(TITLE);
      expect(colorOf(companyTag(html))).toBe(COMPANY);
      // A picked colour drops the Tailwind colour class, which the light theme
      // forces with !important (globals.css) and would otherwise win.
      expect(titleTag(html)).not.toMatch(/text-(white|blue)/);
      expect(companyTag(html)).not.toMatch(/text-(white|blue)/);
    });

    it(`${id}: the title colour leaves the company alone, and the other way round`, () => {
      const base = render(Comp, {});
      const titleOnly = render(Comp, { titleColor: TITLE });
      const companyOnly = render(Comp, { companyColor: COMPANY });
      expect(companyTag(titleOnly)).toBe(companyTag(base));
      expect(titleTag(companyOnly)).toBe(titleTag(base));
      expect(colorOf(titleTag(titleOnly))).toBe(TITLE);
      expect(colorOf(companyTag(companyOnly))).toBe(COMPANY);
    });

    it(`${id}: the accent and Details color no longer move a line that has its own colour`, () => {
      const html = render(Comp, { titleColor: TITLE, companyColor: COMPANY, accentColor: "#0f766e", infoColor: "#334155" });
      expect(colorOf(titleTag(html))).toBe(TITLE);
      expect(colorOf(companyTag(html))).toBe(COMPANY);
    });

    it(`${id}: a card that never picked either renders exactly as before`, () => {
      // Unset = the template's own choice. Nothing on a saved card changes.
      expect(render(Comp, { titleColor: "", companyColor: null })).toBe(render(Comp, {}));
    });
  }
});

describe("the editor offers both on every template", () => {
  const all = { ...META, fallback: FALLBACK_META };
  for (const [id, m] of Object.entries(all)) {
    it(`${id} has a Title color and a Company color step with swatches`, () => {
      expect(m.title.label).toBe("Title color");
      expect(m.company.label).toBe("Company color");
      expect(m.title.presets.length).toBeGreaterThan(2);
      expect(m.company.presets.length).toBeGreaterThan(2);
      // The template's own colour is the first swatch, so "back to how it was"
      // is one tap even without Default.
      expect(m.title.presets[0]).toBe(m.title.fallback);
      expect(m.company.presets[0]).toBe(m.company.fallback);
    });
  }

  it("the panel shows them right after Name color, each writing its own key", () => {
    const src = readFileSync(join(process.cwd(), "src/components/card-templates/TemplateStyleControls.tsx"), "utf8");
    const text = src.indexOf('key: "text"');
    const title = src.indexOf('key: "title"');
    const company = src.indexOf('key: "company"');
    const accent = src.indexOf('key: "accent"');
    expect(text).toBeGreaterThan(-1);
    expect(text).toBeLessThan(title);
    expect(title).toBeLessThan(company);
    expect(company).toBeLessThan(accent);
    expect(src).toContain('swatches(meta.title, value.titleColor, "titleColor")');
    expect(src).toContain('swatches(meta.company, value.companyColor, "companyColor")');
  });
});

describe("they save, convert and travel like every other card colour", () => {
  it("are Pro design keys, so Office Branding and the draft restore carry them", () => {
    expect(PRO_CUSTOMIZATION_KEYS).toContain("titleColor");
    expect(PRO_CUSTOMIZATION_KEYS).toContain("companyColor");
  });

  it("survive the homepage builders' hand-off into the real builder", () => {
    expect(PREFILL_STYLE_KEYS).toContain("titleColor");
    expect(PREFILL_STYLE_KEYS).toContain("companyColor");
    const sketch = readFileSync(join(process.cwd(), "src/components/site/useProductSketch.ts"), "utf8");
    expect(sketch).toContain("titleColor: p.titleColor");
    expect(sketch).toContain("companyColor: p.companyColor");
  });

  it("Free keeps a swatch and snaps a free-hand colour to the nearest swatch", () => {
    for (const [id, m] of Object.entries(META)) {
      const kept = convertCustomizationToFreeClosest({ titleColor: m.title.presets[1], companyColor: m.company.presets[1] }, id);
      expect(kept.changed, id).toBe(false);
      expect(kept.customization.titleColor).toBe(m.title.presets[1]);
      expect(kept.customization.companyColor).toBe(m.company.presets[1]);

      const snapped = convertCustomizationToFreeClosest({ titleColor: "#123457", companyColor: "#fedcbb" }, id).customization;
      expect(m.title.presets, id).toContain(snapped.titleColor);
      expect(m.company.presets, id).toContain(snapped.companyColor);
    }
  });

  it("a free-hand title or company colour is named at Save on Free", () => {
    expect(proFeaturesInUse({ titleColor: "#123457" }, "classic-pro")).toContain("Your own colors");
    expect(proFeaturesInUse({ companyColor: "#fedcbb" }, "luxury-minimal")).toContain("Your own colors");
    expect(proFeaturesInUse({ titleColor: META["classic-pro"].title.presets[2] }, "classic-pro")).toEqual([]);
  });

  it("a Custom card going Free drops them with the other colours", () => {
    const out = convertCustomizationToFreeClosest({ titleColor: TITLE, companyColor: COMPANY }, "custom").customization;
    expect(out.titleColor).toBeUndefined();
    expect(out.companyColor).toBeUndefined();
  });

  it("Edit card reads, converts and saves both", () => {
    const src = readFileSync(join(process.cwd(), "src/app/cards/[id]/edit/CardEditForm.tsx"), "utf8");
    expect(src).toContain("titleColor: card.customization?.titleColor ?? undefined");
    expect(src).toContain("companyColor: card.customization?.companyColor ?? undefined");
    expect(src).toContain("titleColor: c.titleColor as string | undefined");
    expect(src).toContain("companyColor: c.companyColor as string | undefined");
    expect(src).toContain("titleColor: templateStyleState.titleColor ?? null");
    expect(src).toContain("companyColor: templateStyleState.companyColor ?? null");
  });

  it("the builder's Free conversion keeps both (both copies of the state)", () => {
    const src = readFileSync(join(process.cwd(), "src/app/cards/new/NewCardWizard.tsx"), "utf8");
    expect(src.split("titleColor: result.customization.titleColor as string | undefined").length - 1).toBe(2);
    expect(src.split("companyColor: result.customization.companyColor as string | undefined").length - 1).toBe(2);
  });

  it("Office Branding reads both back from the saved team look", () => {
    const src = readFileSync(join(process.cwd(), "src/components/OfficeBranding.tsx"), "utf8");
    expect(src).toContain('titleColor: pick("titleColor")');
    expect(src).toContain('companyColor: pick("companyColor")');
  });
});

describe("the Apple Wallet pass follows them", () => {
  const meta = (template: string, customization: Record<string, unknown>) => ({
    name: SAMPLE_DATA.name, title: SAMPLE_DATA.title ?? null, company: SAMPLE_DATA.company ?? null,
    photoUrl: null, logoUrl: null, phone: null, email: null, website: null, address: null,
    accentColor: null, template, style: templateStyle({ customization }), custom: null,
  });

  for (const [id] of TEMPLATES) {
    it(`${id}: the pass title and company take the picked colours`, () => {
      const p = passPalette(meta(id, { titleColor: TITLE, companyColor: COMPANY }));
      const base = passPalette(meta(id, {}));
      expect(p.title).not.toBe(base.title);
      expect(p.inkMuted).not.toBe(base.inkMuted);
      // Only the two lines move — the name and the details stay put.
      expect(p.ink).toBe(base.ink);
      expect(p.body).toEqual(base.body);
    });
  }
});
