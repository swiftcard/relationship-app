import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { META, CARD_LOOK_FAMILIES, looksInFamily, freeSafeValues, type Look } from "@/lib/template-style-presets";
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

// Where each template paints the name, title and company, and the template's
// own colour for the two lines a Look can leave unset. Only templates whose
// title/company are FIXED colours are listed for those: Modern Bold and Logo
// First draw the title in the owner's accent and adapt the company to the
// ground on their own.
const PHOTO_PANEL_DEFAULT = META["photo-first"].surface!.fallback;
const GROUND: Record<string, {
  name: "bg" | "surface";
  title?: { fallback: string; on: "bg" | "surface" };
  company?: { fallback: string; on: "bg" | "surface" };
}> = {
  "classic-pro": { name: "bg", title: { fallback: "#93c5fd", on: "bg" }, company: { fallback: "#e2e8f0", on: "bg" } },
  "modern-bold": { name: "bg" },
  "luxury-minimal": { name: "bg", title: { fallback: "#b08d57", on: "bg" }, company: { fallback: "#b08d57", on: "bg" } },
  "local-business": { name: "bg", title: { fallback: "#fef3c7", on: "bg" } },
  "photo-first": { name: "surface", title: { fallback: "#ddd6fe", on: "surface" } },
  "logo-first": { name: "bg" },
};

// Every Look that existed before the three rows, value for value. A saved card
// is matched to its Look by VALUE (looksActive), and a Free card's colours are
// kept only while some Look still offers them (freeSafeValues) — so changing or
// dropping one of these silently un-highlights saved cards, or rewrites a Free
// card's colours on its next save. Add Looks freely; never edit these.
const LEGACY = {
  "classic-pro": [
    {name: "Executive Navy", bg: "linear-gradient(160deg, #0e1b35 0%, #162947 100%)", text: "#ffffff"},
    {name: "Onyx", bg: "#070d1c", text: "#ffffff"},
    {name: "Graphite", bg: "#111827", text: "#e5e7eb"},
    {name: "Forest", bg: "#052e2b", text: "#ffffff"},
    {name: "Burgundy", bg: "#3f1d2e", text: "#f3d9c6"},
    {name: "Sky", bg: "linear-gradient(160deg, #0e1b35 0%, #2563eb 100%)", text: "#ffffff"},
    {name: "Sea Glass", bg: "linear-gradient(160deg, #1c3a5e 0%, #2f6f8f 100%)", text: "#f2fbff", finish: "frosted", surface: "#f8fafc"},
    {name: "Titanium", bg: "#2a3140", text: "#ffffff", finish: "brushed", surface: "#f1f5f9"},
  ],
  "modern-bold": [
    {name: "Electric Dark", bg: "#070d1c", text: "#ffffff"},
    {name: "Pure Black", bg: "#0a0a0a", text: "#ffffff"},
    {name: "Violet Night", bg: "linear-gradient(135deg, #111827 0%, #6d28d9 100%)", text: "#ffffff"},
    {name: "Deep Blue", bg: "linear-gradient(135deg, #0e1b35 0%, #2563eb 100%)", text: "#ffffff"},
    {name: "Emerald", bg: "#052e2b", text: "#6ee7b7"},
    {name: "Ember", bg: "#1c1010", text: "#fca5a5"},
    {name: "Frostbite", bg: "linear-gradient(150deg, #10243f 0%, #1d4e6b 100%)", text: "#eaf7ff", finish: "frosted"},
    {name: "Carbon", bg: "#0b0f16", text: "#ffffff", finish: "carbon"},
  ],
  "luxury-minimal": [
    {name: "Ivory & Gold", bg: "#fafaf6", text: "#1c1612", font: "Georgia, 'Times New Roman', serif"},
    {name: "Warm Cream", bg: "#fffbf0", text: "#3f2d1a", font: "Georgia, 'Times New Roman', serif"},
    {name: "Pearl", bg: "#ffffff", text: "#0e1b35", font: "Georgia, 'Times New Roman', serif"},
    {name: "Sand", bg: "#f5efe3", text: "#1c1612", font: "Georgia, 'Times New Roman', serif"},
    {name: "Charcoal Luxe", bg: "#1c1612", text: "#d4af7a", font: "Georgia, 'Times New Roman', serif"},
    {name: "Opaline", bg: "linear-gradient(160deg, #eef2f6 0%, #dbe6ee 100%)", text: "#1c2733", finish: "frosted"},
    {name: "Gilded", bg: "#14110d", text: "#f0e2c4", finish: "gilt"},
  ],
  "local-business": [
    {name: "Warm Amber", bg: "linear-gradient(100deg, #b45309 0%, #d97706 60%, #f59e0b 100%)", text: "#ffffff"},
    {name: "Forest", bg: "#166534", text: "#ffffff"},
    {name: "Teal", bg: "#0f766e", text: "#ffffff"},
    {name: "Midnight", bg: "#0e1b35", text: "#ffffff"},
    {name: "Cherry", bg: "#be123c", text: "#ffffff"},
    {name: "Slate", bg: "#334155", text: "#ffffff"},
    {name: "Sea Glass", bg: "linear-gradient(100deg, #2f7f8f 0%, #3f9fae 60%, #56b8c4 100%)", text: "#f4feff", finish: "frosted", surface: "#ffffff"},
    {name: "Slate & Linen", bg: "linear-gradient(100deg, #3b4451 0%, #4b5563 60%, #5b6675 100%)", text: "#ffffff", finish: "linen", surface: "#f5f5f4"},
  ],
  "photo-first": [
    {name: "Clean White", bg: "#ffffff", text: "#ffffff"},
    {name: "Royal Violet", bg: "linear-gradient(145deg, #4f46e5 0%, #7c3aed 60%, #6d28d9 100%)", text: "#ffffff"},
    {name: "Indigo", bg: "#4f46e5", text: "#ffffff"},
    {name: "Rose", bg: "linear-gradient(145deg, #be123c 0%, #f43f5e 100%)", text: "#ffffff"},
    {name: "Emerald", bg: "linear-gradient(145deg, #064e3b 0%, #10b981 100%)", text: "#ffffff"},
    {name: "Onyx", bg: "#0a0a0a", text: "#ffffff"},
    {name: "Sea Glass", bg: "#ffffff", text: "#ffffff", finish: "frosted", surface: "linear-gradient(145deg, #2f7f8f 0%, #3f9fae 60%, #56b8c4 100%)"},
    {name: "Graphite", bg: "#111827", text: "#ffffff", finish: "brushed", surface: "#1f2937"},
  ],
  "logo-first": [
    {name: "Dark Navy", bg: "#2c3a52", text: "#ffffff"},
    {name: "Midnight", bg: "#141b26", text: "#ffffff"},
    {name: "Slate", bg: "#1e293b", text: "#ffffff"},
    {name: "Forest", bg: "#16352c", text: "#ffffff"},
    {name: "Oxblood", bg: "#3a1d22", text: "#ffffff"},
    {name: "Bone", bg: "#f4f2ed", text: "#141b26"},
    {name: "Sea Glass", bg: "linear-gradient(160deg, #24506b 0%, #3a7f96 100%)", text: "#f2fbff", finish: "frosted"},
    {name: "Brushed Steel", bg: "#39414f", text: "#ffffff", finish: "brushed"},
  ],
};

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

  it.each(TEMPLATES)("%s: keeps every Look it had, value for value", (t) => {
    const legacy = (LEGACY as Record<string, Omit<Look, "family">[]>)[t];
    expect(legacy.length).toBeGreaterThan(0);
    for (const old of legacy) {
      const now = META[t].looks.find((l) => l.name === old.name);
      expect(now, `${t}/${old.name} was removed`).toBeDefined();
      const { family: _family, ...rest } = now!;
      void _family;
      expect(rest, `${t}/${old.name} changed`).toEqual(old);
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

describe("every NEW Look reads (3:1, the large-text floor)", () => {
  // The Frosted finish lays up to ~30% white over the panel at its brightest
  // band, so a Glass Look is measured against its wash UNDER that sheet.
  const newLooks = TEMPLATES.flatMap((t) => {
    const legacy = new Set(((LEGACY as Record<string, { name: string }[]>)[t]).map((l) => l.name));
    return META[t].looks.filter((l) => !legacy.has(l.name)).map((l) => ({ t, l }));
  });

  function ground(t: string, l: Look, on: "bg" | "surface"): string[] {
    const raw = on === "bg" ? l.bg : (l.surface ?? (t === "photo-first" ? PHOTO_PANEL_DEFAULT : META[t].surface?.fallback ?? "#ffffff"));
    return stops(raw).map((s) => (on === "bg" && l.finish === "frosted" ? underWhite(s, 0.3) : s));
  }
  const worst = (ink: string, g: string[]) => Math.min(...g.map((s) => contrast(ink, s)));

  it("adds a real library — at least 100 new Looks across the six templates", () => {
    expect(newLooks.length).toBeGreaterThanOrEqual(100);
  });

  it("the name", () => {
    for (const { t, l } of newLooks) {
      const c = worst(l.text, ground(t, l, GROUND[t].name));
      expect(c, `${t}/${l.name} name ${l.text} = ${c.toFixed(2)}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("the title, in the Look's own ink or the template's", () => {
    for (const { t, l } of newLooks) {
      const g = GROUND[t].title;
      if (!g) continue;
      const ink = l.title ?? g.fallback;
      const c = worst(ink, ground(t, l, g.on));
      expect(c, `${t}/${l.name} title ${ink} = ${c.toFixed(2)}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("the company, in the Look's own ink or the template's", () => {
    for (const { t, l } of newLooks) {
      const g = GROUND[t].company;
      if (!g) continue;
      const ink = l.company ?? g.fallback;
      const c = worst(ink, ground(t, l, g.on));
      expect(c, `${t}/${l.name} company ${ink} = ${c.toFixed(2)}`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("a Look's own title and company ink survives a Free save", () => {
  it("both are offered values, so Free never snaps them back", () => {
    for (const [t, m] of Object.entries(META)) {
      for (const l of m.looks) {
        if (l.title) expect(freeSafeValues(m, "title"), `${t}/${l.name}`).toContain(l.title);
        if (l.company) expect(freeSafeValues(m, "company"), `${t}/${l.name}`).toContain(l.company);
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
        const out = convertCustomizationToFreeClosest(cust, t).customization;
        expect(out.finish, `${t}/${l.name}`).toBeUndefined();
        expect(out.bgColor, `${t}/${l.name}`).toBe(l.bg);
        expect(out.titleColor, `${t}/${l.name}`).toBe(l.title);
        expect(out.companyColor, `${t}/${l.name}`).toBe(l.company);
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

  it("a Look writes its own title and company ink (or hands both back)", () => {
    expect(controls).toMatch(/titleColor: look\.title,/);
    expect(controls).toMatch(/companyColor: look\.company,/);
  });

  it("opens in place, the same way Social design's does", () => {
    expect(picker).toMatch(/useOpenInPlace<LookFamily>\(open\)/);
    expect(read("src/components/SwiftLinkDesign.tsx")).toMatch(/useOpenInPlace<LookFamily>\(open\)/);
  });

  it("never blurs — a card is also a PNG, a link preview, a Wallet pass and a signature", () => {
    expect(picker).not.toMatch(/backdropFilter|backdrop-filter|filter:\s*["']?blur/);
  });
});
