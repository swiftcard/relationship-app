// Per-template curated "Looks" (one-tap coordinated background + name + font)
// and fine-tune swatch presets. Kept out of the JSX-heavy TemplateStyleControls
// so plain server code (src/lib/plan.ts) can read the same preset data to snap
// a Free account's saved colors to the nearest allowed swatch, without pulling
// a "use client" component into server bundles. Mirrors why template-style.ts
// is its own module.

/**
 * A curated one-tap look for a template.
 *
 * `bg`/`text`/`font` were the whole of it, which meant a Look could set a
 * colour scheme but never the CARD'S MATERIAL — so the finishes and the second
 * surface, the two things that change a card most, were reachable only by
 * hand. A Look now carries them too, the way a Swift Links Look carries its
 * whole scheme: one tap, a complete card.
 *
 * `finish` and `surface` are optional. A Look that omits `finish` CLEARS it
 * (back to Flat) rather than leaving the last one on — half of the previous
 * look surviving underneath is exactly what makes a preset feel broken. A Look
 * that omits `surface` leaves that template's own default, since three of the
 * six templates have no second surface at all.
 *
 * `family` files it under one of the three rows of the Look picker (owner,
 * 2026-10-14: "the same exact thing" as Social design's Solid / Gradient /
 * Glass). It is decided by what the card is MADE of, the split a
 * non-designer can predict by looking:
 *   • solid    — one flat colour (a material finish over it stays Solid)
 *   • gradient — colour that shifts across the card
 *   • glass    — a deep colour wash under the painted Frosted sheet
 *
 * `title` and `company` are the ink for those two lines. Optional: a Look that
 * omits them hands both lines back to the template's own colour, which is
 * right on the ground the template was drawn for. A Look on a very different
 * ground — an ivory Classic Pro, a frosted glass header — carries its own, or
 * the template's pale blue title would vanish into it.
 */
export type Look = {
  name: string;
  family: LookFamily;
  bg: string;
  text: string;
  font?: string;
  finish?: string;
  surface?: string;
  title?: string;
  company?: string;
};

export type LookFamily = "solid" | "gradient" | "glass";

/** The Look picker's three rows, in the same order as Social design's. */
export const CARD_LOOK_FAMILIES: { id: LookFamily; name: string; blurb: string }[] = [
  { id: "solid", name: "Solid", blurb: "One clean colour." },
  { id: "gradient", name: "Gradient", blurb: "Colour that shifts across the card." },
  { id: "glass", name: "Glass", blurb: "Frosted glass over colour." },
];

export function looksInFamily(meta: TemplateMeta, family: LookFamily): Look[] {
  return meta.looks.filter((l) => l.family === family);
}

export type StyleField = {
  label: string;
  /**
   * One short line shown under the control in the editor. Optional: where the
   * label already says it ("Name color"), nothing is shown. The longer `help`
   * stays as the control's tooltip.
   */
  hint?: string;
  help: string;
  presets: string[];
  fallback: string;
};

export type TemplateMeta = {
  name: string;
  blurb: string;
  looks: Look[];
  bg: StyleField;
  /**
   * The card's SECOND surface, on the templates that have one.
   *
   * `bg` is the brand surface — Classic Pro's left panel, Local Business's
   * header stripe, Photo First's info panel. The rest of those cards was a
   * hard-coded constant: a cream body, a white info panel, a purple photo
   * panel. Owners could restyle half a card and not the other half.
   *
   * OMITTED, deliberately, on Modern Bold, Luxury Minimal and Logo First: `bg`
   * already paints their whole card. Offering a second colour picker there
   * would be a control that changes nothing, which is worse than no control.
   */
  surface?: StyleField;
  text: StyleField;
  /**
   * The job title and the company name, each its own colour (owner,
   * 2026-10-09). `fallback` is what the template paints when unset — before
   * these existed the two lines borrowed the accent or the details colour, or
   * were fixed, so leaving them unset changes nothing on a saved card.
   */
  title: StyleField;
  company: StyleField;
  info: StyleField;
  accent: StyleField;
};

/**
 * The values a FREE account is allowed to keep for one of a template's colour
 * fields.
 *
 * sanitizeCustomizationForPlan snaps anything else to the nearest allowed
 * value, and its stated contract is that "Free accounts can restyle a card
 * using the SAME curated Looks/preset swatches Pro sees" — only a raw custom
 * colour gets pulled back. That was not true: the allowed set was the swatch
 * presets ALONE, while a curated Look sets colours of its own that mostly are
 * not swatches. So a Free user could tap "Sea Glass", save, and get a
 * different card back, with nothing to explain it. Every template had at least
 * two Looks in that state, some of them there long before the Looks grew.
 *
 * A Look on the picker is a value the product is offering, so it is allowed.
 * This is what makes the comment above true.
 */
export function freeSafeValues(meta: TemplateMeta, field: "bg" | "surface" | "text" | "title" | "company"): string[] {
  const base = field === "surface" ? meta.surface?.presets ?? [] : meta[field].presets;
  const fromLooks = meta.looks
    .map((l) => (field === "bg" ? l.bg : field === "text" ? l.text : field === "surface" ? l.surface : field === "title" ? l.title : l.company))
    .filter((v): v is string => typeof v === "string" && !!v);
  return [...new Set([...base, ...fromLooks])];
}

// A broad, tasteful accent palette shared by every template's icon/accent
// control (each template's own default is prepended so it's the first swatch).
export const ACCENT_PRESETS = ["#2563eb", "#6d28d9", "#0f766e", "#b45309", "#be123c", "#111827", "#b08d57", "#059669"];

const SERIF = "Georgia, 'Times New Roman', serif";

// Per-template descriptions, curated looks, and tailored fine-tune palettes.
export const META: Record<string, TemplateMeta> = {
  "classic-pro": {
    name: "Classic Pro",
    blurb: "A two-panel executive card — a colored branding panel on the left, clean white info on the right.",
    looks: [
      // Solid
      { name: "Onyx", family: "solid", bg: "#070d1c", text: "#ffffff" },
      { name: "Graphite", family: "solid", bg: "#111827", text: "#e5e7eb" },
      { name: "Forest", family: "solid", bg: "#052e2b", text: "#ffffff" },
      { name: "Burgundy", family: "solid", bg: "#3f1d2e", text: "#f3d9c6" },
      { name: "Titanium", family: "solid", bg: "#2a3140", text: "#ffffff", finish: "brushed", surface: "#f1f5f9" },
      { name: "Espresso", family: "solid", bg: "#1c1612", text: "#f5e6d3", title: "#d4af7a" },
      { name: "Oxford", family: "solid", bg: "#1e3a5f", text: "#ffffff", title: "#bfdbfe" },
      { name: "Plum", family: "solid", bg: "#2e1a47", text: "#ffffff", title: "#d8b4fe" },
      { name: "Petrol", family: "solid", bg: "#0f3d46", text: "#ffffff", title: "#99f6e4" },
      { name: "Ivory", family: "solid", bg: "#f5f1e8", text: "#1c1612", title: "#8c6c34", company: "#3f2d1a" },
      // Gradient
      { name: "Executive Navy", family: "gradient", bg: "linear-gradient(160deg, #0e1b35 0%, #162947 100%)", text: "#ffffff" },
      { name: "Sky", family: "gradient", bg: "linear-gradient(160deg, #0e1b35 0%, #2563eb 100%)", text: "#ffffff" },
      { name: "Dusk", family: "gradient", bg: "linear-gradient(160deg, #0e1b35 0%, #4c1d95 100%)", text: "#ffffff", title: "#c4b5fd" },
      { name: "Emerald", family: "gradient", bg: "linear-gradient(160deg, #022c22 0%, #047857 100%)", text: "#ffffff", title: "#a7f3d0" },
      { name: "Copper", family: "gradient", bg: "linear-gradient(160deg, #1c1612 0%, #9a3412 100%)", text: "#fff7ed", title: "#fed7aa" },
      { name: "Twilight", family: "gradient", bg: "linear-gradient(160deg, #1e1b4b 0%, #6d28d9 100%)", text: "#ffffff", title: "#ddd6fe" },
      { name: "Steel", family: "gradient", bg: "linear-gradient(160deg, #1f2937 0%, #475569 100%)", text: "#ffffff", title: "#e2e8f0" },
      { name: "Champagne", family: "gradient", bg: "linear-gradient(160deg, #1c1612 0%, #3f2d1a 55%, #8c6c34 100%)", text: "#fdf6e3", title: "#f0e2c4" },
      // Glass
      { name: "Sea Glass", family: "glass", bg: "linear-gradient(160deg, #1c3a5e 0%, #2f6f8f 100%)", text: "#f2fbff", finish: "frosted", surface: "#f8fafc" },
      { name: "Arctic", family: "glass", bg: "linear-gradient(160deg, #0c2d48 0%, #0c4a6e 55%, #075985 100%)", text: "#ffffff", finish: "frosted", title: "#e0f2fe", company: "#ffffff", surface: "#f8fafc" },
      { name: "Aurora", family: "glass", bg: "linear-gradient(160deg, #042f2e 0%, #115e59 50%, #4c1d95 100%)", text: "#ffffff", finish: "frosted", title: "#ccfbf1", company: "#ffffff" },
      { name: "Amethyst", family: "glass", bg: "linear-gradient(160deg, #2e1065 0%, #581c87 55%, #6b21a8 100%)", text: "#ffffff", finish: "frosted", title: "#f3e8ff", company: "#ffffff" },
      { name: "Rose Quartz", family: "glass", bg: "linear-gradient(160deg, #4c0519 0%, #881337 55%, #9f1239 100%)", text: "#ffffff", finish: "frosted", title: "#ffe4e6", company: "#ffffff" },
      { name: "Jade", family: "glass", bg: "linear-gradient(160deg, #022c22 0%, #064e3b 55%, #065f46 100%)", text: "#ffffff", finish: "frosted", title: "#d1fae5", company: "#ffffff" },
      { name: "Smoke", family: "glass", bg: "linear-gradient(160deg, #111827 0%, #1f2937 55%, #374151 100%)", text: "#ffffff", finish: "frosted", title: "#e5e7eb", company: "#ffffff" },
      { name: "Sunset", family: "glass", bg: "linear-gradient(160deg, #431407 0%, #7c2d12 50%, #9d174d 100%)", text: "#ffffff", finish: "frosted", title: "#ffedd5", company: "#ffffff" },
    ],
    bg: {
      label: "Branding panel",
      hint: "Behind your logo and name.",
      help: "The colored left panel behind your logo and name. The info panel beside it has its own colour below.",
      presets: ["#0e1b35", "#070d1c", "#111827", "#1c1612", "#052e2b", "#3f1d2e", "linear-gradient(160deg, #0e1b35 0%, #2563eb 100%)"],
      fallback: "#0e1b35",
    },
    surface: {
      label: "Info panel",
      hint: "Where your phone, email and address sit.",
      help: "The panel your phone, email and address sit on. White by default; a deep shade flips the details to light automatically.",
      presets: ["#ffffff", "#f8fafc", "#f1f5f9", "#0e1b35", "#111827", "#1c1612"],
      fallback: "#ffffff",
    },
    text: {
      label: "Name color",
      help: "Your name on the branding panel. Use a light shade so it reads on the dark panel.",
      presets: ["#ffffff", "#f8fafc", "#d4af7a", "#bfdbfe"],
      fallback: "#ffffff",
    },
    title: {
      label: "Title color",
      help: "Your job title, under your name on the branding panel. A light shade reads best on the dark panel.",
      presets: ["#93c5fd", "#ffffff", "#bfdbfe", "#d4af7a", "#cbd5e1"],
      fallback: "#93c5fd",
    },
    company: {
      label: "Company color",
      help: "Your company name, beside your logo on the branding panel. A light shade reads best on the dark panel.",
      presets: ["#ffffff", "#e2e8f0", "#93c5fd", "#d4af7a"],
      fallback: "#ffffff",
    },
    info: {
      label: "Details color",
      hint: "Your phone, email and address.",
      help: "Your phone, email, and address on the white info panel — a dark ink reads best.",
      presets: ["#0e1b35", "#111827", "#334155", "#1c1612"],
      fallback: "#0e1b35",
    },
    accent: {
      label: "Accent / icons",
      hint: "Icons beside your details, and the buttons on your card page.",
      help: "The color of the phone, email, and address icons next to your details.",
      presets: ACCENT_PRESETS,
      fallback: "#2563eb",
    },
  },
  "modern-bold": {
    name: "Modern Bold",
    blurb: "A full-bleed dark card with an oversized name and electric accents.",
    looks: [
      // Solid
      { name: "Electric Dark", family: "solid", bg: "#070d1c", text: "#ffffff" },
      { name: "Pure Black", family: "solid", bg: "#0a0a0a", text: "#ffffff" },
      { name: "Emerald", family: "solid", bg: "#052e2b", text: "#6ee7b7" },
      { name: "Ember", family: "solid", bg: "#1c1010", text: "#fca5a5" },
      { name: "Carbon", family: "solid", bg: "#0b0f16", text: "#ffffff", finish: "carbon" },
      { name: "Ink", family: "solid", bg: "#0b1120", text: "#e0e7ff" },
      { name: "Oxblood", family: "solid", bg: "#2a0a0f", text: "#fecdd3" },
      { name: "Deep Teal", family: "solid", bg: "#042f2e", text: "#5eead4" },
      { name: "Aubergine", family: "solid", bg: "#1e0b2e", text: "#e9d5ff" },
      { name: "Gunmetal", family: "solid", bg: "#1f2933", text: "#ffffff" },
      // Gradient
      { name: "Violet Night", family: "gradient", bg: "linear-gradient(135deg, #111827 0%, #6d28d9 100%)", text: "#ffffff" },
      { name: "Deep Blue", family: "gradient", bg: "linear-gradient(135deg, #0e1b35 0%, #2563eb 100%)", text: "#ffffff" },
      { name: "Neon Dusk", family: "gradient", bg: "linear-gradient(135deg, #0f172a 0%, #be185d 100%)", text: "#ffffff" },
      { name: "Cyber", family: "gradient", bg: "linear-gradient(135deg, #0f0c29 0%, #302b63 55%, #24243e 100%)", text: "#67e8f9" },
      { name: "Inferno", family: "gradient", bg: "linear-gradient(135deg, #1c0a00 0%, #9a3412 100%)", text: "#fed7aa" },
      { name: "Lagoon", family: "gradient", bg: "linear-gradient(135deg, #042f2e 0%, #0e7490 100%)", text: "#ffffff" },
      { name: "Nebula", family: "gradient", bg: "linear-gradient(135deg, #0b1020 0%, #312e81 50%, #701a75 100%)", text: "#f5d0fe" },
      { name: "Matrix", family: "gradient", bg: "linear-gradient(135deg, #020617 0%, #14532d 100%)", text: "#86efac" },
      // Glass
      { name: "Frostbite", family: "glass", bg: "linear-gradient(150deg, #10243f 0%, #1d4e6b 100%)", text: "#eaf7ff", finish: "frosted" },
      { name: "Polar", family: "glass", bg: "linear-gradient(135deg, #0c1a2e 0%, #1e3a5f 55%, #1e40af 100%)", text: "#ffffff", finish: "frosted" },
      { name: "Ultraviolet", family: "glass", bg: "linear-gradient(135deg, #1e0b3b 0%, #4c1d95 55%, #6d28d9 100%)", text: "#ffffff", finish: "frosted" },
      { name: "Magma", family: "glass", bg: "linear-gradient(135deg, #2a0a05 0%, #7f1d1d 55%, #9a3412 100%)", text: "#ffffff", finish: "frosted" },
      { name: "Abyss", family: "glass", bg: "linear-gradient(135deg, #020617 0%, #0c4a6e 55%, #155e75 100%)", text: "#ffffff", finish: "frosted" },
      { name: "Toxic", family: "glass", bg: "linear-gradient(135deg, #052e16 0%, #14532d 55%, #3f6212 100%)", text: "#ecfccb", finish: "frosted" },
      { name: "Smoke", family: "glass", bg: "linear-gradient(135deg, #0a0a0a 0%, #262626 55%, #404040 100%)", text: "#ffffff", finish: "frosted" },
      { name: "Opal", family: "glass", bg: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 45%, #134e4a 100%)", text: "#ffffff", finish: "frosted" },
    ],
    bg: {
      label: "Card background",
      hint: "The whole card. Built for deep tones.",
      help: "The entire card surface. Modern Bold is built for deep, dark tones — lighter colors will wash out the accents.",
      presets: ["#070d1c", "#0a0a0a", "#111827", "#0e1b35", "linear-gradient(135deg, #111827 0%, #6d28d9 100%)", "linear-gradient(135deg, #0e1b35 0%, #2563eb 100%)"],
      fallback: "#070d1c",
    },
    text: {
      label: "Name color",
      help: "Your oversized hero name. Keep it bright so it pops against the dark card.",
      presets: ["#ffffff", "#f8fafc", "#60a5fa", "#a78bfa"],
      fallback: "#ffffff",
    },
    title: {
      label: "Title color",
      help: "Your job title, under your name. It follows your accent until you pick a colour here.",
      presets: ["#3b82f6", "#60a5fa", "#a78bfa", "#22d3ee", "#fbbf24", "#ffffff"],
      fallback: "#3b82f6",
    },
    company: {
      label: "Company color",
      help: "Your company name at the top of the card. Keep it light on the dark card.",
      presets: ["#cbd5e1", "#ffffff", "#94a3b8", "#60a5fa", "#a78bfa"],
      fallback: "#cbd5e1",
    },
    info: {
      label: "Details color",
      hint: "Your phone, email and address.",
      help: "Your contact details sit on the dark card — keep them light so they stay legible.",
      presets: ["#f1f5f9", "#ffffff", "#cbd5e1", "#94a3b8"],
      fallback: "#f1f5f9",
    },
    accent: {
      label: "Accent / icons",
      hint: "Icons beside your details, and the buttons on your card page.",
      help: "The electric icon color next to your phone, email, and address.",
      presets: ["#3b82f6", "#60a5fa", "#a78bfa", "#22d3ee", "#34d399", "#f472b6", "#fbbf24", "#ffffff"],
      fallback: "#3b82f6",
    },
  },
  "luxury-minimal": {
    name: "Luxury Minimal",
    blurb: "An ivory editorial card with a gold accent strip and a refined serif feel.",
    // The light grounds here carry a deeper gold for the title and company:
    // the template's own gold is drawn for ivory and sits under 3:1 on the
    // darker creams and the frosted washes.
    looks: [
      // Solid
      { name: "Ivory & Gold", family: "solid", bg: "#fafaf6", text: "#1c1612", font: SERIF },
      { name: "Warm Cream", family: "solid", bg: "#fffbf0", text: "#3f2d1a", font: SERIF },
      { name: "Pearl", family: "solid", bg: "#ffffff", text: "#0e1b35", font: SERIF },
      { name: "Sand", family: "solid", bg: "#f5efe3", text: "#1c1612", font: SERIF },
      { name: "Charcoal Luxe", family: "solid", bg: "#1c1612", text: "#d4af7a", font: SERIF },
      { name: "Gilded", family: "solid", bg: "#14110d", text: "#f0e2c4", finish: "gilt" },
      { name: "Blush", family: "solid", bg: "#f8ece8", text: "#3b1f1a", font: SERIF, title: "#8c6c34", company: "#8c6c34" },
      { name: "Sage", family: "solid", bg: "#e8ede4", text: "#1f2a1c", font: SERIF, title: "#6b5326", company: "#6b5326" },
      { name: "Stone", family: "solid", bg: "#e7e5e0", text: "#1c1612", font: SERIF, title: "#6b5326", company: "#6b5326" },
      { name: "Navy Couture", family: "solid", bg: "#14203a", text: "#f0e2c4", font: SERIF, title: "#d4af7a", company: "#d4af7a" },
      // Gradient
      { name: "Champagne", family: "gradient", bg: "linear-gradient(160deg, #fbf6ea 0%, #efe2c4 100%)", text: "#1c1612", font: SERIF, title: "#6b5326", company: "#6b5326" },
      { name: "Rose Gold", family: "gradient", bg: "linear-gradient(160deg, #fbefe9 0%, #ecc9bb 100%)", text: "#3b1f1a", font: SERIF, title: "#6b5326", company: "#6b5326" },
      { name: "Linen Dawn", family: "gradient", bg: "linear-gradient(160deg, #fffbf0 0%, #f3e6cf 100%)", text: "#3f2d1a", font: SERIF, title: "#8c6c34", company: "#8c6c34" },
      { name: "Pearl Mist", family: "gradient", bg: "linear-gradient(160deg, #ffffff 0%, #e8edf3 100%)", text: "#0e1b35", font: SERIF, title: "#8c6c34", company: "#8c6c34" },
      { name: "Sandstone", family: "gradient", bg: "linear-gradient(160deg, #f5efe3 0%, #e2d3b8 100%)", text: "#1c1612", font: SERIF, title: "#6b5326", company: "#6b5326" },
      { name: "Silk Grey", family: "gradient", bg: "linear-gradient(160deg, #f8f8f7 0%, #dedcd8 100%)", text: "#1c1612", font: SERIF, title: "#6b5326", company: "#6b5326" },
      { name: "Midnight Gold", family: "gradient", bg: "linear-gradient(160deg, #0f0d0a 0%, #2b2218 100%)", text: "#f0e2c4", font: SERIF, title: "#d4af7a", company: "#d4af7a" },
      { name: "Bordeaux", family: "gradient", bg: "linear-gradient(160deg, #2a0f14 0%, #4a1a24 100%)", text: "#f3d9c6", font: SERIF, title: "#d4af7a", company: "#d4af7a" },
      // Glass
      { name: "Opaline", family: "glass", bg: "linear-gradient(160deg, #eef2f6 0%, #dbe6ee 100%)", text: "#1c2733", finish: "frosted" },
      { name: "Moonstone", family: "glass", bg: "linear-gradient(160deg, #dfe6ef 0%, #c9d4e3 55%, #b6c4d8 100%)", text: "#1c2733", font: SERIF, finish: "frosted", title: "#5b4520", company: "#5b4520" },
      { name: "Rosewater", family: "glass", bg: "linear-gradient(160deg, #f3e1de 0%, #e8cbc6 55%, #ddb6b0 100%)", text: "#3b1f1a", font: SERIF, finish: "frosted", title: "#5b4520", company: "#5b4520" },
      { name: "Celadon", family: "glass", bg: "linear-gradient(160deg, #dcebe2 0%, #c6ddd0 55%, #b1d0bd 100%)", text: "#1f2a1c", font: SERIF, finish: "frosted", title: "#5b4520", company: "#5b4520" },
      { name: "Morganite", family: "glass", bg: "linear-gradient(160deg, #f4e3da 0%, #ebcfc0 55%, #e1baa8 100%)", text: "#3f2d1a", font: SERIF, finish: "frosted", title: "#5b4520", company: "#5b4520" },
      { name: "Mist", family: "glass", bg: "linear-gradient(160deg, #e9edf2 0%, #d7dee7 55%, #c5cfdb 100%)", text: "#1c2733", font: SERIF, finish: "frosted", title: "#5b4520", company: "#5b4520" },
      { name: "Smoke Quartz", family: "glass", bg: "linear-gradient(160deg, #1c1814 0%, #2a241f 55%, #3a332c 100%)", text: "#f0e2c4", font: SERIF, finish: "frosted", title: "#e7c98f", company: "#e7c98f" },
      { name: "Onyx Glass", family: "glass", bg: "linear-gradient(160deg, #0a0a0c 0%, #111114 55%, #1c1c22 100%)", text: "#f5f5f4", font: SERIF, finish: "frosted", title: "#d4af7a", company: "#d4af7a" },
    ],
    bg: {
      label: "Card background",
      hint: "The whole card. Soft, light tones keep it premium.",
      help: "The ivory canvas of the whole card. Choose a soft, light tone to keep the premium look.",
      presets: ["#fafaf6", "#ffffff", "#fffbf0", "#f5efe3", "#f3f4f6", "#1c1612"],
      fallback: "#fafaf6",
    },
    text: {
      label: "Name color",
      help: "Your name in the serif headline. A deep charcoal, ink, or gold keeps it elegant on ivory.",
      presets: ["#1c1612", "#0e1b35", "#3f2d1a", "#8c6c34"],
      fallback: "#1c1612",
    },
    title: {
      label: "Title color",
      help: "Your job title, under your name. Gold like your accent until you pick a colour here.",
      presets: ["#b08d57", "#8c6c34", "#1c1612", "#3f2d1a", "#0e1b35", "#d4af7a"],
      fallback: "#b08d57",
    },
    company: {
      label: "Company color",
      help: "Your company name at the top of the card. Gold like your accent until you pick a colour here.",
      presets: ["#b08d57", "#8c6c34", "#1c1612", "#3f2d1a", "#0e1b35", "#d4af7a"],
      fallback: "#b08d57",
    },
    info: {
      label: "Details color",
      hint: "Your phone, email and address.",
      help: "Your contact details — deep ink on ivory, or a soft light or gold on the charcoal look.",
      presets: ["#1c1612", "#3f2d1a", "#8c6c34", "#d4af7a", "#e7dcc8"],
      fallback: "#1c1612",
    },
    accent: {
      label: "Accent / icons",
      hint: "Icons beside your details, and the buttons on your card page.",
      help: "The gold accent used for the icons next to your details.",
      presets: ["#b08d57", "#c9a96e", "#8c6c34", "#d4af7a", "#1c1612", "#0e1b35", "#3f2d1a", "#a16207"],
      fallback: "#b08d57",
    },
  },
  "local-business": {
    name: "Local Business",
    blurb: "A warm card with a bold header stripe and the phone number as the hero.",
    looks: [
      // Solid
      { name: "Forest", family: "solid", bg: "#166534", text: "#ffffff" },
      { name: "Teal", family: "solid", bg: "#0f766e", text: "#ffffff" },
      { name: "Midnight", family: "solid", bg: "#0e1b35", text: "#ffffff" },
      { name: "Cherry", family: "solid", bg: "#be123c", text: "#ffffff" },
      { name: "Slate", family: "solid", bg: "#334155", text: "#ffffff" },
      { name: "Brick", family: "solid", bg: "#9a3412", text: "#ffffff" },
      { name: "Mustard", family: "solid", bg: "#854d0e", text: "#ffffff" },
      { name: "Olive", family: "solid", bg: "#4d5b1f", text: "#ffffff" },
      { name: "Navy", family: "solid", bg: "#1e3a8a", text: "#ffffff", surface: "#ffffff" },
      { name: "Plum", family: "solid", bg: "#6b21a8", text: "#ffffff" },
      // Gradient
      { name: "Warm Amber", family: "gradient", bg: "linear-gradient(100deg, #b45309 0%, #d97706 60%, #f59e0b 100%)", text: "#ffffff" },
      { name: "Slate & Linen", family: "gradient", bg: "linear-gradient(100deg, #3b4451 0%, #4b5563 60%, #5b6675 100%)", text: "#ffffff", finish: "linen", surface: "#f5f5f4" },
      { name: "Citrus", family: "gradient", bg: "linear-gradient(100deg, #9a3412 0%, #c2410c 60%, #ea580c 100%)", text: "#ffffff" },
      { name: "Harvest", family: "gradient", bg: "linear-gradient(100deg, #78350f 0%, #92400e 60%, #b45309 100%)", text: "#ffffff" },
      { name: "Berry", family: "gradient", bg: "linear-gradient(100deg, #831843 0%, #9d174d 60%, #be185d 100%)", text: "#ffffff" },
      { name: "Ocean", family: "gradient", bg: "linear-gradient(100deg, #0c4a6e 0%, #075985 60%, #0369a1 100%)", text: "#ffffff" },
      { name: "Sunrise", family: "gradient", bg: "linear-gradient(100deg, #9f1239 0%, #c2410c 60%, #b45309 100%)", text: "#ffffff" },
      { name: "Pine", family: "gradient", bg: "linear-gradient(100deg, #14532d 0%, #166534 60%, #15803d 100%)", text: "#ffffff" },
      // Glass — the title is white on every one: the stripe's own cream
      // title is drawn for the amber stripe and fades into a frosted one.
      { name: "Sea Glass", family: "glass", bg: "linear-gradient(100deg, #2f7f8f 0%, #3f9fae 60%, #56b8c4 100%)", text: "#f4feff", finish: "frosted", surface: "#ffffff" },
      { name: "Sky Glass", family: "glass", bg: "linear-gradient(100deg, #0c3a5e 0%, #0c4a6e 60%, #075985 100%)", text: "#ffffff", finish: "frosted", title: "#ffffff", surface: "#ffffff" },
      { name: "Mint", family: "glass", bg: "linear-gradient(100deg, #064e3b 0%, #065f46 60%, #047857 100%)", text: "#ffffff", finish: "frosted", title: "#ffffff" },
      { name: "Coral", family: "glass", bg: "linear-gradient(100deg, #7f1d1d 0%, #9f1239 60%, #be123c 100%)", text: "#ffffff", finish: "frosted", title: "#ffffff" },
      { name: "Lilac", family: "glass", bg: "linear-gradient(100deg, #3b0764 0%, #581c87 60%, #6b21a8 100%)", text: "#ffffff", finish: "frosted", title: "#ffffff" },
      { name: "Honey", family: "glass", bg: "linear-gradient(100deg, #451a03 0%, #78350f 60%, #92400e 100%)", text: "#ffffff", finish: "frosted", title: "#ffffff" },
      { name: "Ember", family: "glass", bg: "linear-gradient(100deg, #450a0a 0%, #7f1d1d 60%, #9a3412 100%)", text: "#ffffff", finish: "frosted", title: "#ffffff" },
      { name: "Storm", family: "glass", bg: "linear-gradient(100deg, #111827 0%, #1f2937 60%, #334155 100%)", text: "#ffffff", finish: "frosted", title: "#ffffff" },
    ],
    bg: {
      label: "Header stripe",
      hint: "The banner across the top.",
      help: "The colored banner across the top. The body below it has its own colour, next.",
      presets: ["linear-gradient(100deg, #b45309 0%, #d97706 60%, #f59e0b 100%)", "#b45309", "#166534", "#0f766e", "#0e1b35", "#be123c"],
      fallback: "#b45309",
    },
    surface: {
      label: "Card body",
      hint: "Below the stripe, where your details sit.",
      help: "The area below the header stripe, where your details sit. Cream by default.",
      presets: ["#fffbf0", "#ffffff", "#fef3c7", "#f5f5f4", "#1c1612", "#292524"],
      fallback: "#fffbf0",
    },
    text: {
      label: "Name color",
      help: "Your name sits on the header stripe — a light shade reads best on the color.",
      presets: ["#ffffff", "#fffbf0", "#fde68a"],
      fallback: "#ffffff",
    },
    title: {
      label: "Title color",
      help: "Your job title, under your name on the header stripe — a light shade reads best on the color.",
      presets: ["#fef3c7", "#ffffff", "#fde68a", "#1c1612"],
      fallback: "#fef3c7",
    },
    company: {
      label: "Company color",
      help: "Your company name, at the top of the card body under the stripe.",
      presets: ["#92400e", "#7c2d12", "#1c1612", "#b45309", "#166534", "#0e1b35"],
      fallback: "#92400e",
    },
    info: {
      label: "Details color",
      hint: "Your phone, email and address.",
      help: "Your contact details on the warm cream body — a rich brown or near-black reads best.",
      presets: ["#7c2d12", "#78350f", "#92400e", "#1c1612"],
      fallback: "#7c2d12",
    },
    accent: {
      label: "Accent / icons",
      hint: "Icons beside your details, and the buttons on your card page.",
      help: "The color of the icons next to your phone, email, and address.",
      presets: ["#b45309", "#d97706", "#166534", "#0f766e", "#0e1b35", "#be123c", "#7c2d12", "#f59e0b"],
      fallback: "#b45309",
    },
  },
  "photo-first": {
    name: "Photo First",
    blurb: "A full-height photo on the left, and the info panel on the right whose background you set here.",
    // `bg` is the INFO panel here and `surface` the photo panel, where the name
    // and title sit. The newer Looks colour both, so the pair reads as one
    // design; the details on the info panel follow its colour on their own.
    looks: [
      // Solid
      { name: "Clean White", family: "solid", bg: "#ffffff", text: "#ffffff" },
      { name: "Indigo", family: "solid", bg: "#4f46e5", text: "#ffffff" },
      { name: "Onyx", family: "solid", bg: "#0a0a0a", text: "#ffffff" },
      { name: "Graphite", family: "solid", bg: "#111827", text: "#ffffff", finish: "brushed", surface: "#1f2937" },
      { name: "Ivory", family: "solid", bg: "#fafaf6", text: "#ffffff", surface: "#1c1612", title: "#d4af7a" },
      { name: "Navy", family: "solid", bg: "#0e1b35", text: "#ffffff", surface: "#1e3a8a", title: "#bfdbfe" },
      { name: "Forest", family: "solid", bg: "#052e2b", text: "#ffffff", surface: "#065f46", title: "#a7f3d0" },
      { name: "Wine", family: "solid", bg: "#3f1d2e", text: "#ffffff", surface: "#4c0519", title: "#fecdd3" },
      { name: "Slate", family: "solid", bg: "#f1f5f9", text: "#ffffff", surface: "#334155", title: "#e2e8f0" },
      { name: "Sand", family: "solid", bg: "#f5efe3", text: "#ffffff", surface: "#7c5a26", title: "#fef3c7" },
      // Gradient
      { name: "Royal Violet", family: "gradient", bg: "linear-gradient(145deg, #4f46e5 0%, #7c3aed 60%, #6d28d9 100%)", text: "#ffffff" },
      { name: "Rose", family: "gradient", bg: "linear-gradient(145deg, #be123c 0%, #f43f5e 100%)", text: "#ffffff" },
      { name: "Emerald", family: "gradient", bg: "linear-gradient(145deg, #064e3b 0%, #10b981 100%)", text: "#ffffff" },
      { name: "Ocean", family: "gradient", bg: "linear-gradient(145deg, #0c4a6e 0%, #0891b2 100%)", text: "#ffffff", surface: "#0c4a6e", title: "#bae6fd" },
      { name: "Sunset", family: "gradient", bg: "linear-gradient(145deg, #9a3412 0%, #db2777 100%)", text: "#ffffff", surface: "#7c2d12", title: "#fed7aa" },
      { name: "Midnight", family: "gradient", bg: "linear-gradient(145deg, #020617 0%, #1e3a8a 100%)", text: "#ffffff", surface: "#0f172a", title: "#bfdbfe" },
      { name: "Peach", family: "gradient", bg: "linear-gradient(145deg, #fff7ed 0%, #fed7aa 100%)", text: "#ffffff", surface: "#c2410c", title: "#ffedd5" },
      { name: "Steel", family: "gradient", bg: "linear-gradient(145deg, #e2e8f0 0%, #94a3b8 100%)", text: "#ffffff", surface: "#334155", title: "#e2e8f0" },
      // Glass
      { name: "Sea Glass", family: "glass", bg: "#ffffff", text: "#ffffff", finish: "frosted", surface: "linear-gradient(145deg, #2f7f8f 0%, #3f9fae 60%, #56b8c4 100%)" },
      { name: "Aurora", family: "glass", bg: "linear-gradient(145deg, #042f2e 0%, #115e59 50%, #4c1d95 100%)", text: "#ffffff", finish: "frosted", surface: "#134e4a", title: "#ccfbf1" },
      { name: "Lavender", family: "glass", bg: "linear-gradient(145deg, #2e1065 0%, #4c1d95 55%, #6d28d9 100%)", text: "#ffffff", finish: "frosted", surface: "#4c1d95", title: "#ede9fe" },
      { name: "Blush", family: "glass", bg: "linear-gradient(145deg, #4c0519 0%, #881337 55%, #be123c 100%)", text: "#ffffff", finish: "frosted", surface: "#881337", title: "#ffe4e6" },
      { name: "Jade", family: "glass", bg: "linear-gradient(145deg, #022c22 0%, #064e3b 55%, #047857 100%)", text: "#ffffff", finish: "frosted", surface: "#064e3b", title: "#d1fae5" },
      { name: "Arctic", family: "glass", bg: "linear-gradient(145deg, #0c2d48 0%, #0c4a6e 55%, #0369a1 100%)", text: "#ffffff", finish: "frosted", surface: "#0c4a6e", title: "#e0f2fe" },
      { name: "Smoke", family: "glass", bg: "linear-gradient(145deg, #111827 0%, #1f2937 55%, #374151 100%)", text: "#ffffff", finish: "frosted", surface: "#1f2937", title: "#e5e7eb" },
      { name: "Amber", family: "glass", bg: "linear-gradient(145deg, #451a03 0%, #78350f 55%, #b45309 100%)", text: "#ffffff", finish: "frosted", surface: "#78350f", title: "#fef3c7" },
    ],
    bg: {
      label: "Info panel background",
      hint: "Behind your contact details.",
      help: "The panel behind your contact details on the right. A dark shade flips the text to light automatically; the photo panel on the left has its own colour below.",
      presets: ["#ffffff", "linear-gradient(145deg, #4f46e5 0%, #7c3aed 60%, #6d28d9 100%)", "#4f46e5", "linear-gradient(145deg, #be123c 0%, #f43f5e 100%)", "#064e3b", "#0a0a0a"],
      fallback: "#ffffff",
    },
    surface: {
      label: "Photo panel",
      hint: "Behind and around your photo.",
      help: "The colored panel behind your photo. With a Circle photo it shows all around it; with Original it fills the panel until you add a photo.",
      // The two light ones are for a Circle photo: a clean white or soft grey
      // panel, where the name and title turn to ink on their own.
      presets: ["linear-gradient(145deg, #4f46e5 0%, #7c3aed 60%, #6d28d9 100%)", "#4f46e5", "#0e1b35", "#111827", "#052e2b", "#3f1d2e", "#ffffff", "#f1f5f9"],
      fallback: "linear-gradient(145deg, #4f46e5 0%, #7c3aed 60%, #6d28d9 100%)",
    },
    text: {
      label: "Name color",
      help: "Your name overlaid on the photo — keep it light so it stands out over the image.",
      presets: ["#ffffff", "#f8fafc", "#d4af7a"],
      fallback: "#ffffff",
    },
    title: {
      label: "Title color",
      // Light shades for the full-height photo; the dark two for a Circle
      // photo on a light panel colour, where the title turns to ink.
      help: "Your job title, under your name. Light shades read over a full photo; on a circle photo with a light panel, pick a dark one.",
      presets: ["#ddd6fe", "#ffffff", "#e5e7eb", "#d4af7a", "#4b5563", "#111827"],
      fallback: "#ddd6fe",
    },
    company: {
      label: "Company color",
      help: "Your company name, at the top of the info panel beside your logo.",
      presets: ["#111827", "#1e1b4b", "#6d28d9", "#4f46e5", "#ffffff"],
      fallback: "#111827",
    },
    info: {
      label: "Details color",
      hint: "Your phone, email and address.",
      help: "Your contact details on the info panel. They adapt to the panel color, or set your own here.",
      presets: ["#111827", "#1e1b4b", "#ffffff", "#e5e7eb"],
      fallback: "#111827",
    },
    accent: {
      label: "Accent / icons",
      hint: "Icons beside your details, and the buttons on your card page.",
      help: "The color of the icons next to your phone, email, and address.",
      presets: ["#6d28d9", "#7c3aed", "#4f46e5", "#2563eb", "#be123c", "#10b981", "#0a0a0a", "#d4af7a"],
      fallback: "#6d28d9",
    },
  },
  "logo-first": {
    name: "Logo First",
    blurb: "Leads with your logo on a panel of its own, beside your name and details.",
    looks: [
      // Solid
      { name: "Dark Navy", family: "solid", bg: "#2c3a52", text: "#ffffff" },
      { name: "Midnight", family: "solid", bg: "#141b26", text: "#ffffff" },
      { name: "Slate", family: "solid", bg: "#1e293b", text: "#ffffff" },
      { name: "Forest", family: "solid", bg: "#16352c", text: "#ffffff" },
      { name: "Oxblood", family: "solid", bg: "#3a1d22", text: "#ffffff" },
      { name: "Bone", family: "solid", bg: "#f4f2ed", text: "#141b26" },
      { name: "Brushed Steel", family: "solid", bg: "#39414f", text: "#ffffff", finish: "brushed" },
      { name: "Espresso", family: "solid", bg: "#211a15", text: "#ffffff" },
      { name: "Ivory", family: "solid", bg: "#fafaf6", text: "#141b26" },
      { name: "Petrol", family: "solid", bg: "#0f3d46", text: "#ffffff" },
      // Gradient
      { name: "Navy Dusk", family: "gradient", bg: "linear-gradient(160deg, #141b26 0%, #2c3a52 100%)", text: "#ffffff" },
      { name: "Ember", family: "gradient", bg: "linear-gradient(160deg, #2a1414 0%, #7c2d12 100%)", text: "#ffffff" },
      { name: "Evergreen", family: "gradient", bg: "linear-gradient(160deg, #0b231c 0%, #16352c 50%, #1f4d3f 100%)", text: "#ffffff" },
      { name: "Plum Night", family: "gradient", bg: "linear-gradient(160deg, #1a1028 0%, #3b1f4f 100%)", text: "#ffffff" },
      { name: "Steel Blue", family: "gradient", bg: "linear-gradient(160deg, #1e293b 0%, #3b5574 100%)", text: "#ffffff" },
      { name: "Sand Dune", family: "gradient", bg: "linear-gradient(160deg, #f4f2ed 0%, #e4d9c6 100%)", text: "#141b26" },
      { name: "Charcoal", family: "gradient", bg: "linear-gradient(160deg, #0f1115 0%, #2a2d33 100%)", text: "#ffffff" },
      { name: "Wine", family: "gradient", bg: "linear-gradient(160deg, #2b0f16 0%, #5a1e2b 100%)", text: "#ffffff" },
      // Glass
      { name: "Sea Glass", family: "glass", bg: "linear-gradient(160deg, #24506b 0%, #3a7f96 100%)", text: "#f2fbff", finish: "frosted" },
      { name: "Arctic", family: "glass", bg: "linear-gradient(160deg, #0c2d48 0%, #0c4a6e 55%, #075985 100%)", text: "#ffffff", finish: "frosted" },
      { name: "Aurora", family: "glass", bg: "linear-gradient(160deg, #042f2e 0%, #115e59 50%, #4c1d95 100%)", text: "#ffffff", finish: "frosted" },
      { name: "Amethyst", family: "glass", bg: "linear-gradient(160deg, #2e1065 0%, #581c87 55%, #6b21a8 100%)", text: "#ffffff", finish: "frosted" },
      { name: "Jade", family: "glass", bg: "linear-gradient(160deg, #022c22 0%, #064e3b 55%, #065f46 100%)", text: "#ffffff", finish: "frosted" },
      { name: "Rose Quartz", family: "glass", bg: "linear-gradient(160deg, #4c0519 0%, #881337 55%, #9f1239 100%)", text: "#ffffff", finish: "frosted" },
      { name: "Smoke", family: "glass", bg: "linear-gradient(160deg, #111827 0%, #1f2937 55%, #374151 100%)", text: "#ffffff", finish: "frosted" },
      { name: "Sunset", family: "glass", bg: "linear-gradient(160deg, #431407 0%, #7c2d12 50%, #9d174d 100%)", text: "#ffffff", finish: "frosted" },
    ],
    bg: {
      label: "Card background",
      hint: "The whole card, and the panel your logo sits on.",
      help: "The whole card surface, and the panel your logo sits on. Deep tones make a light logo sing; on a light background the details switch to ink automatically.",
      presets: ["#2c3a52", "#141b26", "#1e293b", "#16352c", "#3a1d22", "#0e1b35", "#f4f2ed", "#ffffff"],
      fallback: "#2c3a52",
    },
    text: {
      label: "Name color",
      help: "Your name, set in caps beside the logo. Keep it bright on a dark card.",
      presets: ["#ffffff", "#f4f2ed", "#e6ebf3", "#141b26"],
      fallback: "#ffffff",
    },
    title: {
      label: "Title color",
      help: "Your job title, under your name. It follows your accent until you pick a colour here.",
      presets: ["#ffffff", "#c9d4e8", "#b08d57", "#d4af7a", "#60a5fa", "#141b26"],
      fallback: "#ffffff",
    },
    company: {
      label: "Company color",
      help: "Your company name, under your title.",
      presets: ["#c2ccdc", "#ffffff", "#e6ebf3", "#b08d57", "#5a6b85", "#141b26"],
      fallback: "#c2ccdc",
    },
    info: {
      label: "Details color",
      hint: "Your phone, email and address.",
      help: "Your phone, email, website, and address. They adapt to the card color, or set your own here.",
      presets: ["#e6ebf3", "#ffffff", "#c2ccdc", "#141b26", "#5a6b85"],
      fallback: "#e6ebf3",
    },
    accent: {
      // Same setting as every other template, so the same name (owner rule
      // 2026-09-16: one control, one label everywhere). What it paints on THIS
      // template — the title and the QR too — belongs in the hint, not the label.
      label: "Accent / icons",
      hint: "Icons beside your details, your QR code, and the buttons on your card page. Your title too, until you give it its own colour.",
      help: "Draws the contact icons and the QR code, and your job title while Title color is on Default. A shade too close to your background is brightened or darkened until it reads — you keep the colour you picked, at a version of it that can be seen. The QR is darkened further, because a pale code is one phones stop scanning.",
      presets: ["#ffffff", "#c9d4e8", "#b08d57", "#d4af7a", "#60a5fa", "#0f766e", "#be123c", "#141b26"],
      fallback: "#ffffff",
    },
  },
};

export const FALLBACK_META: TemplateMeta = {
  name: "This template",
  blurb: "Restyle the background, name color, and font to make it yours.",
  looks: [
    { name: "Navy", family: "solid", bg: "#0e1b35", text: "#ffffff" },
    { name: "Onyx", family: "solid", bg: "#070d1c", text: "#ffffff" },
    { name: "Ivory", family: "solid", bg: "#fafaf6", text: "#1c1612" },
  ],
  bg: {
    label: "Background",
    help: "The card's main background surface.",
    presets: ["#0e1b35", "#070d1c", "#111827", "#ffffff", "#fafaf6", "#fffbf0"],
    fallback: "#0e1b35",
  },
  text: {
    label: "Name color",
    help: "The color of your name / headline text.",
    presets: ["#ffffff", "#f8fafc", "#1c1612", "#0e1b35"],
    fallback: "#ffffff",
  },
  title: {
    label: "Title color",
    help: "The color of your job title.",
    presets: ["#93c5fd", "#ffffff", "#1c1612", "#0e1b35"],
    fallback: "#93c5fd",
  },
  company: {
    label: "Company color",
    help: "The color of your company name.",
    presets: ["#ffffff", "#e5e7eb", "#111827", "#334155"],
    fallback: "#ffffff",
  },
  info: {
    label: "Details color",
    help: "The color of your contact details (phone, email, address).",
    presets: ["#111827", "#334155", "#ffffff", "#e5e7eb"],
    fallback: "#111827",
  },
  accent: {
    label: "Accent / icons",
    help: "The color of the icons next to your contact details.",
    presets: ACCENT_PRESETS,
    fallback: "#2563eb",
  },
};

export function metaForTemplate(template?: string): TemplateMeta {
  return (template && META[template]) || FALLBACK_META;
}
