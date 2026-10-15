import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { META, CARD_LOOK_FAMILIES, looksInFamily, freeSafeValues, RETIRED_LOOK_VALUES, type Look, type LookColourField } from "@/lib/template-style-presets";
import { convertCustomizationToFreeClosest, proFeaturesInUse } from "@/lib/plan";
import { getFinish, isFreeFinish } from "@/lib/card-finishes";

// ── The card's Look step: Original, then Solid / Gradient / Glass ───────────
//
// Owner, 2026-10-14: make Card design's Look step "the same exact thing" as
// Social design's — three rows that each open to 8–10 designs — "and come up
// with a bunch more design features for all three of them". These pin the
// library that picker shows, and the promises around it.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const TEMPLATES = Object.keys(META);

// ── WCAG relative luminance / contrast ──────────────────────────────────────
function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a: string, b: string): number {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
/** `hex` under a sheet of white at `alpha` — what the Frosted finish does to it. */
function underWhite(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return "#" + [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => Math.round(v * (1 - alpha) + 255 * alpha).toString(16).padStart(2, "0"))
    .join("");
}
const stops = (bg: string) => bg.match(/#[0-9a-f]{6}/gi) ?? [];

// Where each template paints every colour a Look sets — the ground each one
// has to read on. `bg` is the brand surface, `surface` the second one (Classic
// Pro's info panel, Local Business's body, Photo First's photo panel).
type Ground = "bg" | "surface";
const WHERE: Record<string, { name: Ground; title: Ground; company: Ground; info: Ground; accent: Ground }> = {
  "classic-pro": { name: "bg", title: "bg", company: "bg", info: "surface", accent: "surface" },
  "modern-bold": { name: "bg", title: "bg", company: "bg", info: "bg", accent: "bg" },
  "luxury-minimal": { name: "bg", title: "bg", company: "bg", info: "bg", accent: "bg" },
  "local-business": { name: "bg", title: "bg", company: "surface", info: "surface", accent: "surface" },
  "photo-first": { name: "surface", title: "surface", company: "bg", info: "bg", accent: "bg" },
  "logo-first": { name: "bg", title: "bg", company: "bg", info: "bg", accent: "bg" },
};

/** The QR plates whose code is drawn in the accent (fixed light plates). */
const QR_PLATE: Record<string, string> = { "luxury-minimal": "#f5f0e8", "local-business": "#fff8e6" };

describe("the card Look library", () => {
  it.each(TEMPLATES)("%s: 10 Solid, 8 Gradient, 8 Glass — Social design's split", (t) => {
    expect(looksInFamily(META[t], "solid")).toHaveLength(10);
    expect(looksInFamily(META[t], "gradient")).toHaveLength(8);
    expect(looksInFamily(META[t], "glass")).toHaveLength(8);
    // Nothing outside the three rows, where no one could find it.
    expect(META[t].looks).toHaveLength(26);
  });

  it("the rows are Solid, Gradient, Glass — Social design's order", () => {
    expect(CARD_LOOK_FAMILIES.map((f) => f.name)).toEqual(["Solid", "Gradient", "Glass"]);
  });

  it.each(TEMPLATES)("%s: every Look has its own name (the tile's key and its tooltip)", (t) => {
    const names = META[t].looks.map((l) => l.name);
    expect(new Set(names).size).toBe(names.length);
  });

  // Owner, 2026-10-15: a Look has to design "every aspect of the card". One
  // left unset falls back to the template's own colour, which is how a green
  // card ended up with blue icons and a purple bar.
  it.each(TEMPLATES)("%s: every Look sets every colour the card draws", (t) => {
    for (const l of META[t].looks) {
      for (const k of ["title", "company", "info", "accent"] as const) {
        expect(l[k], `${t}/${l.name} leaves ${k} to the template`).toMatch(/^#[0-9a-f]{6}$/i);
      }
      if (META[t].surface) expect(l.surface, `${t}/${l.name} leaves its second surface to the template`).toBeDefined();
    }
  });
});

describe("each Look is filed under what it is made of", () => {
  const all = TEMPLATES.flatMap((t) => META[t].looks.map((l) => ({ t, l })));

  it("Solid is one flat colour", () => {
    for (const { t, l } of all.filter((x) => x.l.family === "solid")) {
      expect(l.bg, `${t}/${l.name}`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(l.finish, `${t}/${l.name} is frosted — that is Glass`).not.toBe("frosted");
    }
  });

  it("Gradient shifts across the card, and is not frosted", () => {
    for (const { t, l } of all.filter((x) => x.l.family === "gradient")) {
      expect(l.bg, `${t}/${l.name}`).toMatch(/gradient\(/);
      expect(l.finish, `${t}/${l.name} is frosted — that is Glass`).not.toBe("frosted");
    }
  });

  it("Glass is the painted Frosted sheet, never a blur", () => {
    for (const { t, l } of all.filter((x) => x.l.family === "glass")) {
      expect(l.finish, `${t}/${l.name}`).toBe("frosted");
      expect(JSON.stringify(l), `${t}/${l.name}`).not.toMatch(/blur|backdrop/i);
    }
  });

  it("every frosted Look sits in Glass, so the row is what it says", () => {
    for (const { t, l } of all.filter((x) => x.l.finish === "frosted")) {
      expect(l.family, `${t}/${l.name}`).toBe("glass");
    }
  });

  it("every finish a Look names is a real one", () => {
    for (const { t, l } of all.filter((x) => x.l.finish)) {
      expect(getFinish(l.finish).id, `${t}/${l.name}`).toBe(l.finish);
    }
  });
});

describe("a redrawn Look never rewrites a Free card", () => {
  // A Free card keeps its colours only while some Look still offers them
  // (freeSafeValues). Redrawing the library on 2026-10-15 changed most Looks'
  // values, so every value any Look offered before stays allowed.
  it("every colour the old library offered is still Free-safe", () => {
    for (const [t, fields] of Object.entries(RETIRED_LOOK_VALUES)) {
      for (const [field, values] of Object.entries(fields)) {
        for (const v of values ?? []) {
          expect(freeSafeValues(META[t], field as LookColourField), `${t} ${field} ${v}`).toContain(v);
        }
      }
    }
  });

  it("covers the Looks the picker shipped with (spot checks)", () => {
    expect(RETIRED_LOOK_VALUES["classic-pro"].bg).toContain("linear-gradient(160deg, #0e1b35 0%, #2563eb 100%)");
    expect(RETIRED_LOOK_VALUES["photo-first"].surface).toContain("linear-gradient(145deg, #2f7f8f 0%, #3f9fae 60%, #56b8c4 100%)");
    expect(RETIRED_LOOK_VALUES["luxury-minimal"].text).toContain("#d4af7a");
  });
});

describe("every Look reads (3:1 for the name lines and icons, 4.5:1 for the details)", () => {
  const all = TEMPLATES.flatMap((t) => META[t].looks.map((l) => ({ t, l })));

  // The Frosted finish lays ~30% white along the top edge, fading to 13% a
  // third of the way down and 7% at the foot (lib/card-finishes). The name
  // lines are measured under the brightest band; the details and their icons,
  // which sit below the top third, under the 13% band.
  function ground(l: Look, on: Ground, frost: number): string[] {
    const raw = on === "bg" ? l.bg : l.surface!;
    return stops(raw).map((s) => (on === "bg" && l.finish === "frosted" ? underWhite(s, frost) : s));
  }
  const worst = (ink: string, g: string[]) => Math.min(...g.map((s) => contrast(ink, s)));

  it.each(["name", "title", "company"] as const)("the %s", (k) => {
    for (const { t, l } of all) {
      const ink = k === "name" ? l.text : l[k]!;
      const c = worst(ink, ground(l, WHERE[t][k], 0.3));
      expect(c, `${t}/${l.name} ${k} ${ink} = ${c.toFixed(2)}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("the details", () => {
    for (const { t, l } of all) {
      const c = worst(l.info!, ground(l, WHERE[t].info, 0.13));
      expect(c, `${t}/${l.name} details ${l.info} = ${c.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("the icons", () => {
    for (const { t, l } of all) {
      const c = worst(l.accent!, ground(l, WHERE[t].accent, 0.13));
      expect(c, `${t}/${l.name} icons ${l.accent} = ${c.toFixed(2)}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("the QR, where the accent draws the code on a fixed light plate", () => {
    // The templates' own gold (#b08d57) on Luxury's plate is 2.7:1; no Look
    // goes below what the template ships with.
    for (const { t, l } of all.filter((x) => QR_PLATE[x.t])) {
      const c = contrast(l.accent!, QR_PLATE[t]);
      expect(c, `${t}/${l.name} QR ${l.accent} = ${c.toFixed(2)}`).toBeGreaterThanOrEqual(2.7);
    }
  });
});

describe("a Look's own colours survive a Free save", () => {
  it("title, company, details and accent are offered values, so Free never snaps them back", () => {
    for (const [t, m] of Object.entries(META)) {
      for (const l of m.looks) {
        if (l.title) expect(freeSafeValues(m, "title"), `${t}/${l.name}`).toContain(l.title);
        if (l.company) expect(freeSafeValues(m, "company"), `${t}/${l.name}`).toContain(l.company);
        if (l.info) expect(freeSafeValues(m, "info"), `${t}/${l.name}`).toContain(l.info);
        if (l.accent) expect(freeSafeValues(m, "accent"), `${t}/${l.name}`).toContain(l.accent);
      }
    }
  });

  it("a Free Look — Solid and Gradient on a free finish — saves untouched and is never called Pro", () => {
    for (const [t, m] of Object.entries(META)) {
      for (const l of m.looks) {
        if (l.finish && !isFreeFinish(l.finish)) continue;
        const cust: Record<string, unknown> = { bgColor: l.bg, textColor: l.text };
        if (l.font) cust.fontFamily = l.font;
        if (l.finish) cust.finish = l.finish;
        if (m.surface && l.surface) cust.surfaceColor = l.surface;
        if (l.title) cust.titleColor = l.title;
        if (l.company) cust.companyColor = l.company;
        if (l.info) cust.infoColor = l.info;
        if (l.accent) cust.accentColor = l.accent;
        const r = convertCustomizationToFreeClosest(cust, t);
        expect(r.changed, `${t}/${l.name} was converted`).toBe(false);
        expect(proFeaturesInUse(cust, t), `${t}/${l.name}`).toEqual([]);
      }
    }
  });

  it("a Glass Look on Free keeps its colours and loses only the frost", () => {
    for (const [t, m] of Object.entries(META)) {
      for (const l of looksInFamily(m, "glass")) {
        const cust: Record<string, unknown> = { bgColor: l.bg, textColor: l.text, finish: l.finish };
        if (l.title) cust.titleColor = l.title;
        if (l.company) cust.companyColor = l.company;
        if (l.info) cust.infoColor = l.info;
        if (l.accent) cust.accentColor = l.accent;
        const out = convertCustomizationToFreeClosest(cust, t).customization;
        expect(out.finish, `${t}/${l.name}`).toBeUndefined();
        expect(out.bgColor, `${t}/${l.name}`).toBe(l.bg);
        expect(out.titleColor, `${t}/${l.name}`).toBe(l.title);
        expect(out.companyColor, `${t}/${l.name}`).toBe(l.company);
        expect(out.infoColor, `${t}/${l.name}`).toBe(l.info);
        expect(out.accentColor, `${t}/${l.name}`).toBe(l.accent);
        expect(proFeaturesInUse(cust, t), `${t}/${l.name}`).toEqual(["Frosted finish"]);
      }
    }
  });
});

describe("the picker", () => {
  const picker = read("src/components/card-templates/CardLookPicker.tsx");
  const controls = read("src/components/card-templates/TemplateStyleControls.tsx");

  it("is the Look step of the card design panel", () => {
    expect(controls).toMatch(/<CardLookPicker\b/);
    expect(controls).not.toMatch(/function LooksGallery/);
  });

  it("a Look writes its own title, company, details and accent (or hands them back)", () => {
    expect(controls).toMatch(/titleColor: look\.title,/);
    expect(controls).toMatch(/companyColor: look\.company,/);
    expect(controls).toMatch(/infoColor: look\.info,/);
    expect(controls).toMatch(/accentColor: look\.accent,/);
    // Original hands every one of them back.
    expect(controls).toMatch(/titleColor: undefined, companyColor: undefined, infoColor: undefined, accentColor: undefined/);
  });

  it("Original's thumbnail is the tile's drawing scaled down, never squeezed (owner, 2026-10-15)", () => {
    expect(picker).toMatch(/<MiniThumb layout=\{layout\} paint=\{original\} widthPx=\{64\} \/>/);
    expect(picker).toMatch(/transform: `scale\(\$\{widthPx \/ THUMB_DRAWN_PX\}\)`/);
  });

  it("opens in place, the same way Social design's does", () => {
    expect(picker).toMatch(/useOpenInPlace<LookFamily>\(open\)/);
    expect(read("src/components/SwiftLinkDesign.tsx")).toMatch(/useOpenInPlace<LookFamily>\(open\)/);
  });

  it("never blurs — a card is also a PNG, a link preview, a Wallet pass and a signature", () => {
    expect(picker).not.toMatch(/backdropFilter|backdrop-filter|filter:\s*["']?blur/);
  });
});
