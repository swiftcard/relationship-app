// Per-template curated "Looks" (one-tap coordinated background + name + font)
// and fine-tune swatch presets. Kept out of the JSX-heavy TemplateStyleControls
// so plain server code (src/lib/plan.ts) can read the same preset data to snap
// a Free account's saved colors to the nearest allowed swatch, without pulling
// a "use client" component into server bundles. Mirrors why template-style.ts
// is its own module.

import { RETIRED } from "./retired-look-values";

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
 *
 * `info` and `accent` are the details ink and the accent (icons, QR, the bars
 * and rules each template draws in it). Owner, 2026-10-15: a Look has to design
 * EVERY part of the card — "Emerald" was a green card with the template's blue
 * icons and a purple bar, and "Indigo" on Photo First left the photo panel
 * violet. Optional like the rest: omitted hands them back to the template.
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
  info?: string;
  accent?: string;
};

export type LookFamily = "solid" | "gradient" | "glass";

/** The Look picker's three rows, in the same order as Social design's. */
export const CARD_LOOK_FAMILIES: { id: LookFamily; name: string; blurb: string }[] = [
  { id: "solid", name: "Solid", blurb: "One clean color." },
  { id: "gradient", name: "Gradient", blurb: "Color that shifts across the card." },
  { id: "glass", name: "Glass", blurb: "Frosted glass over color." },
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
export function freeSafeValues(meta: TemplateMeta, field: LookColourField): string[] {
  const base = field === "surface" ? meta.surface?.presets ?? [] : meta[field].presets;
  const fromLooks = meta.looks
    .map((l) => l[field])
    .filter((v): v is string => typeof v === "string" && !!v);
  // A Look that has since been redesigned was still a value the product
  // offered: a Free card saved with it keeps it (see RETIRED_LOOK_VALUES).
  const template = Object.keys(META).find((k) => META[k] === meta);
  const retired = (template && RETIRED_LOOK_VALUES[template]?.[field]) || [];
  return [...new Set([...base, ...fromLooks, ...retired])];
}

export type LookColourField = "bg" | "surface" | "text" | "title" | "company" | "info" | "accent";

/**
 * Every colour a Look offered before the 2026-10-15 redesign, per template.
 *
 * Owner, 2026-10-15: "make all these examples a little bit cooler" — so the
 * library was redrawn, and many Looks changed value. A Free card keeps its
 * colours only while they are values the product offered (freeSafeValues);
 * without this list a Free card saved yesterday with "Sky" would have its
 * colours quietly snapped to the nearest swatch on its next save. Frozen:
 * append when Looks are redrawn again, never remove.
 */
export const RETIRED_LOOK_VALUES: Record<string, Partial<Record<LookColourField, string[]>>> = RETIRED;

// A broad, tasteful accent palette shared by every template's icon/accent
// control (each template's own default is prepended so it's the first swatch).
export const ACCENT_PRESETS = ["#2563eb", "#6d28d9", "#0f766e", "#b45309", "#be123c", "#111827", "#b08d57", "#059669"];

const SERIF = "Georgia, 'Times New Roman', serif";

// Per-template descriptions, curated looks, and tailored fine-tune palettes.
export const META: Record<string, TemplateMeta> = {
  "classic-pro": {
    name: "Classic Pro",
    blurb: "A two-panel executive card: a colored branding panel on the left, clean white info on the right.",
    // Each Look dresses the WHOLE card: the branding panel and the name, title
    // and company on it, the info panel and the details on it, and the accent —
    // the icons and the bar along the bottom — in one family of colour.
    looks: [
      // Solid
      { name: "Onyx", family: "solid", bg: "#0b0b0d", text: "#ffffff", title: "#a3a3a3", company: "#e5e5e5", surface: "#ffffff", info: "#171717", accent: "#525252" },
      { name: "Admiral", family: "solid", bg: "#0b1f3a", text: "#ffffff", title: "#d4af7a", company: "#f5e6c8", surface: "#fbf8f1", info: "#0b1f3a", accent: "#a07a3c" },
      { name: "Forest", family: "solid", bg: "#0f2e24", text: "#ffffff", title: "#a7d7b8", company: "#e8f3ec", surface: "#f4f8f5", info: "#0f2e24", accent: "#2f7d55" },
      { name: "Burgundy", family: "solid", bg: "#4a1424", text: "#fff5ef", title: "#f2b8a6", company: "#fde8e1", surface: "#fdf7f5", info: "#3b1019", accent: "#9f2a45" },
      { name: "Titanium", family: "solid", bg: "#2a3140", text: "#ffffff", title: "#cbd5e1", company: "#e2e8f0", finish: "brushed", surface: "#f1f5f9", info: "#1e293b", accent: "#64748b" },
      { name: "Espresso", family: "solid", bg: "#1c1612", text: "#f5e6d3", title: "#d4af7a", company: "#f5e6d3", font: SERIF, surface: "#faf6f0", info: "#2b2018", accent: "#8c6c34" },
      { name: "Oxford", family: "solid", bg: "#1e3a5f", text: "#ffffff", title: "#bfdbfe", company: "#e0ecff", surface: "#ffffff", info: "#1e3a5f", accent: "#2563eb" },
      { name: "Plum", family: "solid", bg: "#2e1a47", text: "#ffffff", title: "#d8b4fe", company: "#f3e8ff", surface: "#faf7fd", info: "#2e1a47", accent: "#7c3aed" },
      { name: "Petrol", family: "solid", bg: "#0f3d46", text: "#ffffff", title: "#99f6e4", company: "#e0f7f4", surface: "#f2f8f8", info: "#0f3d46", accent: "#0f766e" },
      // The inverse: a light branding panel beside a deep info panel.
      { name: "Ivory & Ink", family: "solid", bg: "#f5f1e8", text: "#1c1612", title: "#7c5a26", company: "#3f2d1a", font: SERIF, surface: "#1c1612", info: "#f5e6d3", accent: "#d4af7a" },
      // Gradient
      { name: "Executive Navy", family: "gradient", bg: "linear-gradient(160deg, #0e1b35 0%, #1d3461 100%)", text: "#ffffff", title: "#93c5fd", company: "#e2e8f0", surface: "#ffffff", info: "#0e1b35", accent: "#2563eb" },
      { name: "Sky", family: "gradient", bg: "linear-gradient(160deg, #0e1b35 0%, #1d4ed8 100%)", text: "#ffffff", title: "#bfdbfe", company: "#ffffff", surface: "#f5f9ff", info: "#0e1b35", accent: "#2563eb" },
      { name: "Dusk", family: "gradient", bg: "linear-gradient(160deg, #1e1b4b 0%, #6b21a8 60%, #9d174d 100%)", text: "#ffffff", title: "#f5d0fe", company: "#fae8ff", surface: "#fdf8fc", info: "#2e1065", accent: "#a21caf" },
      { name: "Emerald", family: "gradient", bg: "linear-gradient(160deg, #022c22 0%, #047857 100%)", text: "#ffffff", title: "#a7f3d0", company: "#ecfdf5", surface: "#f3faf6", info: "#064e3b", accent: "#059669" },
      { name: "Copper", family: "gradient", bg: "linear-gradient(160deg, #1c1612 0%, #9a3412 100%)", text: "#fff7ed", title: "#fed7aa", company: "#fff7ed", surface: "#fffaf3", info: "#431407", accent: "#c2410c" },
      { name: "Ocean", family: "gradient", bg: "linear-gradient(160deg, #0c1e3a 0%, #0e7490 100%)", text: "#ffffff", title: "#a5f3fc", company: "#ecfeff", surface: "#f2fafc", info: "#083344", accent: "#0e7490" },
      { name: "Steel", family: "gradient", bg: "linear-gradient(160deg, #1f2937 0%, #475569 100%)", text: "#ffffff", title: "#e2e8f0", company: "#ffffff", surface: "#f8fafc", info: "#1f2937", accent: "#64748b" },
      { name: "Champagne", family: "gradient", bg: "linear-gradient(160deg, #1c1612 0%, #3f2d1a 55%, #7a5c2c 100%)", text: "#fdf6e3", title: "#f0e2c4", company: "#fdf6e3", font: SERIF, surface: "#fdfaf3", info: "#2b2018", accent: "#a07a3c" },
      // Glass
      { name: "Sea Glass", family: "glass", bg: "linear-gradient(160deg, #163450 0%, #245d78 100%)", text: "#f2fbff", title: "#e0f2fe", company: "#ffffff", finish: "frosted", surface: "#f3f9fb", info: "#12334d", accent: "#2a6f8c" },
      { name: "Arctic", family: "glass", bg: "linear-gradient(160deg, #0c2d48 0%, #0c4a6e 55%, #075985 100%)", text: "#ffffff", title: "#e0f2fe", company: "#ffffff", finish: "frosted", surface: "#f5fbff", info: "#0c2d48", accent: "#0369a1" },
      { name: "Aurora", family: "glass", bg: "linear-gradient(160deg, #042f2e 0%, #115e59 50%, #4c1d95 100%)", text: "#ffffff", title: "#ccfbf1", company: "#ffffff", finish: "frosted", surface: "#f6f5ff", info: "#1e1b4b", accent: "#0d9488" },
      { name: "Amethyst", family: "glass", bg: "linear-gradient(160deg, #2e1065 0%, #581c87 55%, #6b21a8 100%)", text: "#ffffff", title: "#f3e8ff", company: "#ffffff", finish: "frosted", surface: "#faf5ff", info: "#2e1065", accent: "#7e22ce" },
      { name: "Rose Quartz", family: "glass", bg: "linear-gradient(160deg, #4c0519 0%, #881337 55%, #9f1239 100%)", text: "#ffffff", title: "#ffe4e6", company: "#ffffff", finish: "frosted", surface: "#fff5f6", info: "#4c0519", accent: "#be123c" },
      { name: "Jade", family: "glass", bg: "linear-gradient(160deg, #022c22 0%, #064e3b 55%, #065f46 100%)", text: "#ffffff", title: "#d1fae5", company: "#ffffff", finish: "frosted", surface: "#f2fbf7", info: "#022c22", accent: "#047857" },
      { name: "Smoke", family: "glass", bg: "linear-gradient(160deg, #111827 0%, #1f2937 55%, #374151 100%)", text: "#ffffff", title: "#e5e7eb", company: "#ffffff", finish: "frosted", surface: "#f9fafb", info: "#111827", accent: "#6b7280" },
      { name: "Sunset", family: "glass", bg: "linear-gradient(160deg, #431407 0%, #7c2d12 50%, #9d174d 100%)", text: "#ffffff", title: "#ffedd5", company: "#ffffff", finish: "frosted", surface: "#fff7f3", info: "#431407", accent: "#c2410c" },
    ],
    bg: {
      label: "Branding panel",
      hint: "Behind your logo and name.",
      help: "The colored left panel behind your logo and name. The info panel beside it has its own color below.",
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
      help: "Your phone, email, and address on the white info panel. Dark ink reads best.",
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
    // A dark card lit by ONE neon: the accent paints the icons, the QR, the
    // glow and the title, and the name and details are tinted to match.
    looks: [
      // Solid
      { name: "Electric Dark", family: "solid", bg: "#070d1c", text: "#ffffff", title: "#60a5fa", company: "#cbd5e1", info: "#e2e8f0", accent: "#3b82f6" },
      { name: "Pure Black", family: "solid", bg: "#0a0a0a", text: "#ffffff", title: "#a3a3a3", company: "#d4d4d4", info: "#f5f5f5", accent: "#e5e5e5" },
      { name: "Emerald", family: "solid", bg: "#052e2b", text: "#6ee7b7", title: "#34d399", company: "#a7f3d0", info: "#ecfdf5", accent: "#34d399" },
      { name: "Ember", family: "solid", bg: "#1c1010", text: "#fca5a5", title: "#f87171", company: "#fecaca", info: "#fef2f2", accent: "#f87171" },
      { name: "Carbon", family: "solid", bg: "#0b0f16", text: "#ffffff", title: "#fbbf24", company: "#d1d5db", finish: "carbon", info: "#f3f4f6", accent: "#f59e0b" },
      { name: "Ink", family: "solid", bg: "#0b1120", text: "#e0e7ff", title: "#a5b4fc", company: "#c7d2fe", info: "#eef2ff", accent: "#818cf8" },
      { name: "Oxblood", family: "solid", bg: "#2a0a0f", text: "#fecdd3", title: "#fb7185", company: "#fda4af", info: "#fff1f2", accent: "#fb7185" },
      { name: "Deep Teal", family: "solid", bg: "#042f2e", text: "#5eead4", title: "#2dd4bf", company: "#99f6e4", info: "#f0fdfa", accent: "#2dd4bf" },
      { name: "Aubergine", family: "solid", bg: "#1e0b2e", text: "#e9d5ff", title: "#c084fc", company: "#d8b4fe", info: "#faf5ff", accent: "#c084fc" },
      { name: "Gunmetal", family: "solid", bg: "#1f2933", text: "#ffffff", title: "#67e8f9", company: "#cbd5e1", info: "#f1f5f9", accent: "#22d3ee" },
      // Gradient
      { name: "Violet Night", family: "gradient", bg: "linear-gradient(135deg, #111827 0%, #5b21b6 100%)", text: "#ffffff", title: "#c4b5fd", company: "#ddd6fe", info: "#f5f3ff", accent: "#a78bfa" },
      { name: "Deep Blue", family: "gradient", bg: "linear-gradient(135deg, #0e1b35 0%, #1d4ed8 100%)", text: "#ffffff", title: "#bfdbfe", company: "#dbeafe", info: "#eff6ff", accent: "#93c5fd" },
      { name: "Neon Dusk", family: "gradient", bg: "linear-gradient(135deg, #0f172a 0%, #9d174d 100%)", text: "#ffffff", title: "#fbcfe8", company: "#fce7f3", info: "#fdf2f8", accent: "#f9a8d4" },
      { name: "Cyber", family: "gradient", bg: "linear-gradient(135deg, #0f0c29 0%, #302b63 55%, #24243e 100%)", text: "#67e8f9", title: "#f0abfc", company: "#a5f3fc", info: "#ecfeff", accent: "#22d3ee" },
      { name: "Inferno", family: "gradient", bg: "linear-gradient(135deg, #1c0a00 0%, #9a3412 100%)", text: "#fed7aa", title: "#fdba74", company: "#ffedd5", info: "#fff7ed", accent: "#fb923c" },
      { name: "Lagoon", family: "gradient", bg: "linear-gradient(135deg, #042f2e 0%, #0e7490 100%)", text: "#ffffff", title: "#a5f3fc", company: "#cffafe", info: "#ecfeff", accent: "#67e8f9" },
      { name: "Nebula", family: "gradient", bg: "linear-gradient(135deg, #0b1020 0%, #312e81 50%, #701a75 100%)", text: "#f5d0fe", title: "#f0abfc", company: "#e9d5ff", info: "#faf5ff", accent: "#e879f9" },
      { name: "Matrix", family: "gradient", bg: "linear-gradient(135deg, #020617 0%, #14532d 100%)", text: "#86efac", title: "#4ade80", company: "#bbf7d0", info: "#f0fdf4", accent: "#4ade80" },
      // Glass
      { name: "Frostbite", family: "glass", bg: "linear-gradient(150deg, #0b1d33 0%, #164061 100%)", text: "#eaf7ff", title: "#bae6fd", company: "#e0f2fe", finish: "frosted", info: "#f0f9ff", accent: "#7dd3fc" },
      { name: "Polar", family: "glass", bg: "linear-gradient(135deg, #0c1a2e 0%, #1e3a5f 55%, #1e3a8a 100%)", text: "#ffffff", title: "#bfdbfe", company: "#dbeafe", finish: "frosted", info: "#eff6ff", accent: "#93c5fd" },
      { name: "Ultraviolet", family: "glass", bg: "linear-gradient(135deg, #1e0b3b 0%, #3b0f80 55%, #4c1d95 100%)", text: "#ffffff", title: "#ddd6fe", company: "#ede9fe", finish: "frosted", info: "#f5f3ff", accent: "#c4b5fd" },
      { name: "Magma", family: "glass", bg: "linear-gradient(135deg, #2a0a05 0%, #7f1d1d 55%, #7c2d12 100%)", text: "#ffffff", title: "#fed7aa", company: "#ffedd5", finish: "frosted", info: "#fff7ed", accent: "#fdba74" },
      { name: "Abyss", family: "glass", bg: "linear-gradient(135deg, #020617 0%, #0c4a6e 55%, #134e5e 100%)", text: "#ffffff", title: "#a5f3fc", company: "#cffafe", finish: "frosted", info: "#ecfeff", accent: "#67e8f9" },
      { name: "Toxic", family: "glass", bg: "linear-gradient(135deg, #052e16 0%, #14532d 55%, #365314 100%)", text: "#ecfccb", title: "#d9f99d", company: "#ecfccb", finish: "frosted", info: "#f7fee7", accent: "#bef264" },
      { name: "Smoke", family: "glass", bg: "linear-gradient(135deg, #0a0a0a 0%, #262626 55%, #3f3f46 100%)", text: "#ffffff", title: "#e5e5e5", company: "#f5f5f5", finish: "frosted", info: "#fafafa", accent: "#e5e5e5" },
      { name: "Opal", family: "glass", bg: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 45%, #134e4a 100%)", text: "#ffffff", title: "#99f6e4", company: "#ccfbf1", finish: "frosted", info: "#f0fdfa", accent: "#5eead4" },
    ],
    bg: {
      label: "Card background",
      hint: "The whole card. Built for deep tones.",
      help: "The entire card surface. Modern Bold is built for deep, dark tones. Lighter colors wash out the accents.",
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
      help: "Your job title, under your name. It follows your accent until you pick a color here.",
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
      help: "Your contact details sit on the dark card. Keep them light so they stay legible.",
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
    // Serif on every one, and a metal for the accent strip, the icons and the
    // QR — gold, rose gold, silver or bronze — matched to the ground. The title
    // and company are a deeper shade of that metal so they read on it.
    looks: [
      // Solid
      { name: "Ivory & Gold", family: "solid", bg: "#fafaf6", text: "#1c1612", font: SERIF, title: "#7c5a26", company: "#7c5a26", info: "#1c1612", accent: "#a07a3c" },
      { name: "Warm Cream", family: "solid", bg: "#fffbf0", text: "#3f2d1a", font: SERIF, title: "#854d0e", company: "#854d0e", info: "#3f2d1a", accent: "#a16207" },
      { name: "Pearl & Silver", family: "solid", bg: "#ffffff", text: "#0e1b35", font: SERIF, title: "#475569", company: "#334155", info: "#1e293b", accent: "#64748b" },
      { name: "Sand", family: "solid", bg: "#f5efe3", text: "#1c1612", font: SERIF, title: "#6b4a22", company: "#6b4a22", info: "#2b2018", accent: "#9a6b3f" },
      { name: "Charcoal Luxe", family: "solid", bg: "#1c1612", text: "#d4af7a", font: SERIF, title: "#d4af7a", company: "#c9a96e", info: "#e7dcc8", accent: "#b08d57" },
      { name: "Gilded", family: "solid", bg: "#14110d", text: "#f0e2c4", font: SERIF, finish: "gilt", title: "#d4af7a", company: "#d4af7a", info: "#e7dcc8", accent: "#b08d57" },
      { name: "Blush", family: "solid", bg: "#f8ece8", text: "#3b1f1a", font: SERIF, title: "#8a4b55", company: "#8a4b55", info: "#3b1f1a", accent: "#b76e79" },
      { name: "Sage", family: "solid", bg: "#e8ede4", text: "#1f2a1c", font: SERIF, title: "#4d5e3f", company: "#4d5e3f", info: "#1f2a1c", accent: "#6b7f5a" },
      { name: "Stone", family: "solid", bg: "#e7e5e0", text: "#1c1612", font: SERIF, title: "#57534e", company: "#57534e", info: "#292524", accent: "#78716c" },
      { name: "Navy Couture", family: "solid", bg: "#14203a", text: "#f0e2c4", font: SERIF, title: "#d4af7a", company: "#d4af7a", info: "#e7dcc8", accent: "#b08d57" },
      // Gradient
      { name: "Champagne", family: "gradient", bg: "linear-gradient(160deg, #fbf6ea 0%, #efe2c4 100%)", text: "#1c1612", font: SERIF, title: "#6b5326", company: "#6b5326", info: "#2b2018", accent: "#a07a3c" },
      { name: "Rose Gold", family: "gradient", bg: "linear-gradient(160deg, #fbefe9 0%, #ecc9bb 100%)", text: "#3b1f1a", font: SERIF, title: "#7a3f48", company: "#7a3f48", info: "#3b1f1a", accent: "#a85f6b" },
      { name: "Linen Dawn", family: "gradient", bg: "linear-gradient(160deg, #fffbf0 0%, #f3e6cf 100%)", text: "#3f2d1a", font: SERIF, title: "#7c4a0e", company: "#7c4a0e", info: "#3f2d1a", accent: "#a16207" },
      { name: "Pearl Mist", family: "gradient", bg: "linear-gradient(160deg, #ffffff 0%, #e8edf3 100%)", text: "#0e1b35", font: SERIF, title: "#475569", company: "#334155", info: "#1e293b", accent: "#64748b" },
      { name: "Sandstone", family: "gradient", bg: "linear-gradient(160deg, #f5efe3 0%, #e2d3b8 100%)", text: "#1c1612", font: SERIF, title: "#5e3f1c", company: "#5e3f1c", info: "#2b2018", accent: "#8a5e34" },
      { name: "Silk Grey", family: "gradient", bg: "linear-gradient(160deg, #f8f8f7 0%, #dedcd8 100%)", text: "#1c1612", font: SERIF, title: "#44403c", company: "#44403c", info: "#292524", accent: "#78716c" },
      { name: "Midnight Gold", family: "gradient", bg: "linear-gradient(160deg, #0f0d0a 0%, #2b2218 100%)", text: "#f0e2c4", font: SERIF, title: "#d4af7a", company: "#d4af7a", info: "#e7dcc8", accent: "#b08d57" },
      { name: "Bordeaux", family: "gradient", bg: "linear-gradient(160deg, #2a0f14 0%, #4a1a24 100%)", text: "#f3d9c6", font: SERIF, title: "#e8b4b8", company: "#e8b4b8", info: "#f3d9c6", accent: "#b76e79" },
      // Glass
      { name: "Opaline", family: "glass", bg: "linear-gradient(160deg, #e6ecf2 0%, #cfdbe6 100%)", text: "#1c2733", font: SERIF, finish: "frosted", title: "#3f4f63", company: "#3f4f63", info: "#1c2733", accent: "#5b6b80" },
      { name: "Moonstone", family: "glass", bg: "linear-gradient(160deg, #dfe6ef 0%, #c9d4e3 55%, #b6c4d8 100%)", text: "#1c2733", font: SERIF, finish: "frosted", title: "#3b4a66", company: "#3b4a66", info: "#1c2733", accent: "#5b6b8c" },
      { name: "Rosewater", family: "glass", bg: "linear-gradient(160deg, #f3e1de 0%, #e8cbc6 55%, #ddb6b0 100%)", text: "#3b1f1a", font: SERIF, finish: "frosted", title: "#7a3f48", company: "#7a3f48", info: "#3b1f1a", accent: "#94505c" },
      { name: "Celadon", family: "glass", bg: "linear-gradient(160deg, #dcebe2 0%, #c6ddd0 55%, #b1d0bd 100%)", text: "#1f2a1c", font: SERIF, finish: "frosted", title: "#2f5640", company: "#2f5640", info: "#1f2a1c", accent: "#4f7a60" },
      { name: "Morganite", family: "glass", bg: "linear-gradient(160deg, #f4e3da 0%, #ebcfc0 55%, #e1baa8 100%)", text: "#3f2d1a", font: SERIF, finish: "frosted", title: "#7a4528", company: "#7a4528", info: "#3f2d1a", accent: "#a0603e" },
      { name: "Lavender Haze", family: "glass", bg: "linear-gradient(160deg, #ece8f4 0%, #dcd3ea 55%, #cbbfe0 100%)", text: "#2a1f3d", font: SERIF, finish: "frosted", title: "#5a4580", company: "#5a4580", info: "#2a1f3d", accent: "#6e5c92" },
      { name: "Smoke Quartz", family: "glass", bg: "linear-gradient(160deg, #16130f 0%, #221d18 55%, #2e2822 100%)", text: "#f0e2c4", font: SERIF, finish: "frosted", title: "#e7c98f", company: "#e7c98f", info: "#f0e2c4", accent: "#b08d57" },
      { name: "Onyx Glass", family: "glass", bg: "linear-gradient(160deg, #0a0a0c 0%, #111114 55%, #1c1c22 100%)", text: "#f5f5f4", font: SERIF, finish: "frosted", title: "#d4af7a", company: "#d4af7a", info: "#e7e5e4", accent: "#b08d57" },
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
      help: "Your job title, under your name. Gold like your accent until you pick a color here.",
      presets: ["#b08d57", "#8c6c34", "#1c1612", "#3f2d1a", "#0e1b35", "#d4af7a"],
      fallback: "#b08d57",
    },
    company: {
      label: "Company color",
      help: "Your company name at the top of the card. Gold like your accent until you pick a color here.",
      presets: ["#b08d57", "#8c6c34", "#1c1612", "#3f2d1a", "#0e1b35", "#d4af7a"],
      fallback: "#b08d57",
    },
    info: {
      label: "Details color",
      hint: "Your phone, email and address.",
      help: "Your contact details: deep ink on ivory, or a soft light shade or gold on the charcoal look.",
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
    // The header stripe, the body under it, and the accent (icons, QR, the
    // underline and the bottom bar) are one colour story: a tinted body and a
    // company line and details in a deep shade of the stripe.
    looks: [
      // Solid
      { name: "Forest", family: "solid", bg: "#166534", text: "#ffffff", title: "#dcfce7", surface: "#f3faf5", company: "#14532d", info: "#1a2e22", accent: "#15803d" },
      { name: "Teal", family: "solid", bg: "#0f766e", text: "#ffffff", title: "#ccfbf1", surface: "#f0fbf9", company: "#115e59", info: "#134e4a", accent: "#0f766e" },
      { name: "Midnight", family: "solid", bg: "#0e1b35", text: "#ffffff", title: "#bfdbfe", surface: "#f5f7fb", company: "#0e1b35", info: "#1e293b", accent: "#1d4ed8" },
      { name: "Cherry", family: "solid", bg: "#be123c", text: "#ffffff", title: "#ffe4e6", surface: "#fff5f6", company: "#9f1239", info: "#4c0519", accent: "#be123c" },
      { name: "Slate", family: "solid", bg: "#334155", text: "#ffffff", title: "#e2e8f0", surface: "#f8fafc", company: "#1e293b", info: "#334155", accent: "#475569" },
      { name: "Brick", family: "solid", bg: "#9a3412", text: "#ffffff", title: "#ffedd5", surface: "#fff8f3", company: "#7c2d12", info: "#431407", accent: "#c2410c" },
      { name: "Mustard", family: "solid", bg: "#854d0e", text: "#ffffff", title: "#fef3c7", surface: "#fffbeb", company: "#713f12", info: "#422006", accent: "#a16207" },
      { name: "Olive", family: "solid", bg: "#4d5b1f", text: "#ffffff", title: "#ecfccb", surface: "#f8faf0", company: "#3f4a19", info: "#283012", accent: "#65762a" },
      { name: "Navy", family: "solid", bg: "#1e3a8a", text: "#ffffff", title: "#dbeafe", surface: "#ffffff", company: "#1e3a8a", info: "#172554", accent: "#1d4ed8" },
      { name: "Plum", family: "solid", bg: "#6b21a8", text: "#ffffff", title: "#f3e8ff", surface: "#faf5ff", company: "#581c87", info: "#3b0764", accent: "#7e22ce" },
      // Gradient
      { name: "Warm Amber", family: "gradient", bg: "linear-gradient(100deg, #92400e 0%, #b45309 60%, #c2620a 100%)", text: "#ffffff", title: "#fef3c7", surface: "#fffbf0", company: "#92400e", info: "#7c2d12", accent: "#b45309" },
      { name: "Slate & Linen", family: "gradient", bg: "linear-gradient(100deg, #3b4451 0%, #4b5563 60%, #5b6675 100%)", text: "#ffffff", title: "#e7e5e4", finish: "linen", surface: "#f5f5f4", company: "#3b4451", info: "#292524", accent: "#57534e" },
      { name: "Citrus", family: "gradient", bg: "linear-gradient(100deg, #9a3412 0%, #c2410c 100%)", text: "#ffffff", title: "#ffedd5", surface: "#fff7ed", company: "#9a3412", info: "#431407", accent: "#c2410c" },
      { name: "Harvest", family: "gradient", bg: "linear-gradient(100deg, #78350f 0%, #92400e 60%, #a16207 100%)", text: "#ffffff", title: "#fde68a", surface: "#fefaf2", company: "#78350f", info: "#451a03", accent: "#a16207" },
      { name: "Berry", family: "gradient", bg: "linear-gradient(100deg, #831843 0%, #9d174d 60%, #be185d 100%)", text: "#ffffff", title: "#fce7f3", surface: "#fdf4f8", company: "#831843", info: "#500724", accent: "#be185d" },
      { name: "Ocean", family: "gradient", bg: "linear-gradient(100deg, #0c4a6e 0%, #075985 60%, #0369a1 100%)", text: "#ffffff", title: "#e0f2fe", surface: "#f0f9ff", company: "#0c4a6e", info: "#082f49", accent: "#0369a1" },
      { name: "Sunrise", family: "gradient", bg: "linear-gradient(100deg, #9f1239 0%, #b91c1c 60%, #c2410c 100%)", text: "#ffffff", title: "#ffedd5", surface: "#fff7f0", company: "#9f1239", info: "#431407", accent: "#c2410c" },
      { name: "Pine", family: "gradient", bg: "linear-gradient(100deg, #14532d 0%, #166534 60%, #15803d 100%)", text: "#ffffff", title: "#dcfce7", surface: "#f6faf4", company: "#14532d", info: "#052e16", accent: "#15803d" },
      // Glass
      { name: "Sea Glass", family: "glass", bg: "linear-gradient(100deg, #123f4a 0%, #18535e 60%, #1f616d 100%)", text: "#f4feff", title: "#ffffff", finish: "frosted", surface: "#f3fbfc", company: "#1f5f6b", info: "#12343a", accent: "#1f6672" },
      { name: "Sky Glass", family: "glass", bg: "linear-gradient(100deg, #0c3a5e 0%, #0c4a6e 60%, #075985 100%)", text: "#ffffff", title: "#ffffff", finish: "frosted", surface: "#f5fbff", company: "#0c4a6e", info: "#082f49", accent: "#0369a1" },
      { name: "Mint", family: "glass", bg: "linear-gradient(100deg, #064e3b 0%, #065f46 60%, #047857 100%)", text: "#ffffff", title: "#ffffff", finish: "frosted", surface: "#f2fbf7", company: "#065f46", info: "#022c22", accent: "#047857" },
      { name: "Coral", family: "glass", bg: "linear-gradient(100deg, #7f1d1d 0%, #9f1239 60%, #be123c 100%)", text: "#ffffff", title: "#ffffff", finish: "frosted", surface: "#fff5f5", company: "#9f1239", info: "#4c0519", accent: "#be123c" },
      { name: "Lilac", family: "glass", bg: "linear-gradient(100deg, #3b0764 0%, #581c87 60%, #6b21a8 100%)", text: "#ffffff", title: "#ffffff", finish: "frosted", surface: "#faf5ff", company: "#581c87", info: "#3b0764", accent: "#7e22ce" },
      { name: "Honey", family: "glass", bg: "linear-gradient(100deg, #451a03 0%, #78350f 60%, #92400e 100%)", text: "#ffffff", title: "#ffffff", finish: "frosted", surface: "#fffaf0", company: "#78350f", info: "#451a03", accent: "#a16207" },
      { name: "Ember", family: "glass", bg: "linear-gradient(100deg, #450a0a 0%, #7f1d1d 60%, #9a3412 100%)", text: "#ffffff", title: "#ffffff", finish: "frosted", surface: "#fff7f3", company: "#7f1d1d", info: "#450a0a", accent: "#b91c1c" },
      { name: "Storm", family: "glass", bg: "linear-gradient(100deg, #111827 0%, #1f2937 60%, #334155 100%)", text: "#ffffff", title: "#ffffff", finish: "frosted", surface: "#f8fafc", company: "#1f2937", info: "#111827", accent: "#334155" },
    ],
    bg: {
      label: "Header stripe",
      hint: "The banner across the top.",
      help: "The colored banner across the top. The body below it has its own color, next.",
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
      help: "Your name sits on the header stripe. A light shade reads best on the color.",
      presets: ["#ffffff", "#fffbf0", "#fde68a"],
      fallback: "#ffffff",
    },
    title: {
      label: "Title color",
      help: "Your job title, under your name on the header stripe. A light shade reads best on the color.",
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
      help: "Your contact details on the warm cream body. A rich brown or near-black reads best.",
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
    // and title sit. Every Look colours BOTH, plus the company, the details and
    // the accent (icons, QR, underline), so the two halves read as one design —
    // the photo panel is never left on the template's violet.
    looks: [
      // Solid
      { name: "Clean White", family: "solid", bg: "#ffffff", text: "#ffffff", surface: "#1f2937", title: "#e5e7eb", company: "#111827", info: "#111827", accent: "#374151" },
      { name: "Indigo", family: "solid", bg: "#f5f5ff", text: "#ffffff", surface: "#4338ca", title: "#e0e7ff", company: "#312e81", info: "#1e1b4b", accent: "#4f46e5" },
      { name: "Onyx", family: "solid", bg: "#0a0a0a", text: "#ffffff", surface: "#1c1c1c", title: "#d4d4d4", company: "#ffffff", info: "#f5f5f5", accent: "#d4d4d4" },
      { name: "Graphite", family: "solid", bg: "#111827", text: "#ffffff", finish: "brushed", surface: "#1f2937", title: "#e5e7eb", company: "#ffffff", info: "#f3f4f6", accent: "#9ca3af" },
      { name: "Ivory", family: "solid", bg: "#fafaf6", text: "#ffffff", surface: "#1c1612", title: "#d4af7a", company: "#1c1612", info: "#1c1612", accent: "#8c6c34" },
      { name: "Navy", family: "solid", bg: "#0e1b35", text: "#ffffff", surface: "#1e3a8a", title: "#bfdbfe", company: "#ffffff", info: "#e0e7ff", accent: "#93c5fd" },
      { name: "Forest", family: "solid", bg: "#052e2b", text: "#ffffff", surface: "#065f46", title: "#a7f3d0", company: "#ffffff", info: "#ecfdf5", accent: "#6ee7b7" },
      { name: "Wine", family: "solid", bg: "#fff5f6", text: "#ffffff", surface: "#7f1d3a", title: "#fecdd3", company: "#7f1d3a", info: "#4c0519", accent: "#9f1239" },
      { name: "Slate", family: "solid", bg: "#f1f5f9", text: "#ffffff", surface: "#334155", title: "#e2e8f0", company: "#1e293b", info: "#1e293b", accent: "#475569" },
      { name: "Sand", family: "solid", bg: "#f5efe3", text: "#ffffff", surface: "#7c5a26", title: "#fef3c7", company: "#3f2d1a", info: "#2b2018", accent: "#7c5a26" },
      // Gradient
      { name: "Royal Violet", family: "gradient", bg: "linear-gradient(145deg, #ffffff 0%, #ede9fe 100%)", text: "#ffffff", surface: "linear-gradient(145deg, #4f46e5 0%, #7c3aed 60%, #6d28d9 100%)", title: "#ede9fe", company: "#2e1065", info: "#1e1b4b", accent: "#6d28d9" },
      { name: "Rose", family: "gradient", bg: "linear-gradient(145deg, #fff1f2 0%, #ffe4e6 100%)", text: "#ffffff", surface: "linear-gradient(145deg, #9f1239 0%, #e11d48 100%)", title: "#ffe4e6", company: "#881337", info: "#4c0519", accent: "#be123c" },
      { name: "Emerald", family: "gradient", bg: "linear-gradient(145deg, #022c22 0%, #065f46 100%)", text: "#ffffff", surface: "linear-gradient(145deg, #064e3b 0%, #059669 100%)", title: "#d1fae5", company: "#ffffff", info: "#ecfdf5", accent: "#6ee7b7" },
      { name: "Ocean", family: "gradient", bg: "linear-gradient(145deg, #082f49 0%, #0c4a6e 100%)", text: "#ffffff", surface: "linear-gradient(145deg, #0c4a6e 0%, #0891b2 100%)", title: "#cffafe", company: "#ffffff", info: "#f0f9ff", accent: "#67e8f9" },
      { name: "Sunset", family: "gradient", bg: "linear-gradient(145deg, #fff7ed 0%, #ffe4e6 100%)", text: "#ffffff", surface: "linear-gradient(145deg, #9a3412 0%, #be185d 100%)", title: "#ffedd5", company: "#7c2d12", info: "#431407", accent: "#c2410c" },
      { name: "Midnight", family: "gradient", bg: "linear-gradient(145deg, #020617 0%, #172554 100%)", text: "#ffffff", surface: "linear-gradient(145deg, #0f172a 0%, #1e3a8a 100%)", title: "#bfdbfe", company: "#ffffff", info: "#e0e7ff", accent: "#93c5fd" },
      { name: "Peach", family: "gradient", bg: "linear-gradient(145deg, #fff7ed 0%, #fed7aa 100%)", text: "#ffffff", surface: "linear-gradient(145deg, #9a3412 0%, #ea580c 100%)", title: "#ffedd5", company: "#7c2d12", info: "#431407", accent: "#c2410c" },
      { name: "Steel", family: "gradient", bg: "linear-gradient(145deg, #f8fafc 0%, #cbd5e1 100%)", text: "#ffffff", surface: "linear-gradient(145deg, #1e293b 0%, #475569 100%)", title: "#e2e8f0", company: "#1e293b", info: "#0f172a", accent: "#334155" },
      // Glass
      { name: "Sea Glass", family: "glass", bg: "#ffffff", text: "#ffffff", finish: "frosted", surface: "linear-gradient(145deg, #174a55 0%, #1f6672 60%, #2a7682 100%)", title: "#e0f7fa", company: "#1f5f6b", info: "#12343a", accent: "#2f7f8f" },
      { name: "Aurora", family: "glass", bg: "linear-gradient(145deg, #042f2e 0%, #115e59 50%, #3b1a80 100%)", text: "#ffffff", finish: "frosted", surface: "#134e4a", title: "#ccfbf1", company: "#ffffff", info: "#f0fdfa", accent: "#99f6e4" },
      { name: "Lavender", family: "glass", bg: "linear-gradient(145deg, #2e1065 0%, #4c1d95 55%, #5b21b6 100%)", text: "#ffffff", finish: "frosted", surface: "#4c1d95", title: "#ede9fe", company: "#ffffff", info: "#f5f3ff", accent: "#ddd6fe" },
      { name: "Blush", family: "glass", bg: "linear-gradient(145deg, #4c0519 0%, #881337 55%, #9f1239 100%)", text: "#ffffff", finish: "frosted", surface: "#881337", title: "#ffe4e6", company: "#ffffff", info: "#fff1f2", accent: "#fecdd3" },
      { name: "Jade", family: "glass", bg: "linear-gradient(145deg, #022c22 0%, #064e3b 55%, #065f46 100%)", text: "#ffffff", finish: "frosted", surface: "#064e3b", title: "#d1fae5", company: "#ffffff", info: "#ecfdf5", accent: "#a7f3d0" },
      { name: "Arctic", family: "glass", bg: "linear-gradient(145deg, #0c2d48 0%, #0c4a6e 55%, #075985 100%)", text: "#ffffff", finish: "frosted", surface: "#0c4a6e", title: "#e0f2fe", company: "#ffffff", info: "#f0f9ff", accent: "#bae6fd" },
      { name: "Smoke", family: "glass", bg: "linear-gradient(145deg, #111827 0%, #1f2937 55%, #374151 100%)", text: "#ffffff", finish: "frosted", surface: "#1f2937", title: "#e5e7eb", company: "#ffffff", info: "#f9fafb", accent: "#e5e7eb" },
      { name: "Amber", family: "glass", bg: "linear-gradient(145deg, #451a03 0%, #78350f 55%, #92400e 100%)", text: "#ffffff", finish: "frosted", surface: "#78350f", title: "#fef3c7", company: "#ffffff", info: "#fffbeb", accent: "#fde68a" },
    ],
    bg: {
      label: "Info panel background",
      hint: "Behind your contact details.",
      help: "The panel behind your contact details on the right. A dark shade flips the text to light automatically; the photo panel on the left has its own color below.",
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
      help: "Your name, set over the photo. Keep it light so it stands out over the image.",
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
    // One ground, and an accent that draws the title, the icons and the QR —
    // picked to belong to that ground, with the company and details tinted
    // the same way.
    looks: [
      // Solid
      { name: "Dark Navy", family: "solid", bg: "#2c3a52", text: "#ffffff", title: "#93c5fd", company: "#c2ccdc", info: "#e6ebf3", accent: "#93c5fd" },
      { name: "Midnight Gold", family: "solid", bg: "#141b26", text: "#ffffff", title: "#d4af7a", company: "#c2ccdc", info: "#e6ebf3", accent: "#d4af7a" },
      { name: "Slate", family: "solid", bg: "#1e293b", text: "#ffffff", title: "#7dd3fc", company: "#cbd5e1", info: "#f1f5f9", accent: "#38bdf8" },
      { name: "Forest", family: "solid", bg: "#16352c", text: "#ffffff", title: "#86efac", company: "#bbf7d0", info: "#ecfdf5", accent: "#86efac" },
      { name: "Oxblood", family: "solid", bg: "#3a1d22", text: "#ffffff", title: "#fda4af", company: "#fecdd3", info: "#fff1f2", accent: "#fda4af" },
      { name: "Bone", family: "solid", bg: "#f4f2ed", text: "#141b26", font: SERIF, title: "#7c5a26", company: "#57534e", info: "#292524", accent: "#8c6c34" },
      { name: "Brushed Steel", family: "solid", bg: "#39414f", text: "#ffffff", finish: "brushed", title: "#e5e7eb", company: "#d1d5db", info: "#f3f4f6", accent: "#e5e7eb" },
      { name: "Espresso", family: "solid", bg: "#211a15", text: "#ffffff", title: "#c9a96e", company: "#e7dcc8", info: "#f5ede0", accent: "#c9a96e" },
      { name: "Ivory & Teal", family: "solid", bg: "#fafaf6", text: "#141b26", title: "#0f766e", company: "#44403c", info: "#1c1917", accent: "#0f766e" },
      { name: "Petrol", family: "solid", bg: "#0f3d46", text: "#ffffff", title: "#5eead4", company: "#ccfbf1", info: "#f0fdfa", accent: "#5eead4" },
      // Gradient
      { name: "Navy Dusk", family: "gradient", bg: "linear-gradient(160deg, #141b26 0%, #2c3a52 100%)", text: "#ffffff", title: "#bfdbfe", company: "#c2ccdc", info: "#e6ebf3", accent: "#93c5fd" },
      { name: "Ember", family: "gradient", bg: "linear-gradient(160deg, #2a1414 0%, #7c2d12 100%)", text: "#ffffff", title: "#fdba74", company: "#fed7aa", info: "#fff7ed", accent: "#fdba74" },
      { name: "Evergreen", family: "gradient", bg: "linear-gradient(160deg, #0b231c 0%, #16352c 50%, #1f4d3f 100%)", text: "#ffffff", title: "#a7f3d0", company: "#d1fae5", info: "#ecfdf5", accent: "#6ee7b7" },
      { name: "Plum Night", family: "gradient", bg: "linear-gradient(160deg, #1a1028 0%, #3b1f4f 100%)", text: "#ffffff", title: "#e9d5ff", company: "#e9d5ff", info: "#faf5ff", accent: "#d8b4fe" },
      { name: "Steel Blue", family: "gradient", bg: "linear-gradient(160deg, #1e293b 0%, #3b5574 100%)", text: "#ffffff", title: "#bae6fd", company: "#e0f2fe", info: "#f0f9ff", accent: "#7dd3fc" },
      { name: "Sand Dune", family: "gradient", bg: "linear-gradient(160deg, #f4f2ed 0%, #e4d9c6 100%)", text: "#141b26", font: SERIF, title: "#6b4a22", company: "#57534e", info: "#292524", accent: "#8a5e34" },
      { name: "Charcoal", family: "gradient", bg: "linear-gradient(160deg, #0f1115 0%, #2a2d33 100%)", text: "#ffffff", title: "#fbbf24", company: "#d1d5db", info: "#f3f4f6", accent: "#fbbf24" },
      { name: "Wine", family: "gradient", bg: "linear-gradient(160deg, #2b0f16 0%, #5a1e2b 100%)", text: "#ffffff", title: "#f9a8d4", company: "#fbcfe8", info: "#fdf2f8", accent: "#f9a8d4" },
      // Glass
      { name: "Sea Glass", family: "glass", bg: "linear-gradient(160deg, #173a50 0%, #22556c 100%)", text: "#f2fbff", finish: "frosted", title: "#cffafe", company: "#e0f7fa", info: "#f0fdff", accent: "#a5f3fc" },
      { name: "Arctic", family: "glass", bg: "linear-gradient(160deg, #0c2d48 0%, #0c4a6e 55%, #075985 100%)", text: "#ffffff", finish: "frosted", title: "#e0f2fe", company: "#e0f2fe", info: "#f0f9ff", accent: "#bae6fd" },
      { name: "Aurora", family: "glass", bg: "linear-gradient(160deg, #042f2e 0%, #115e59 50%, #3b1a80 100%)", text: "#ffffff", finish: "frosted", title: "#ccfbf1", company: "#ccfbf1", info: "#f0fdfa", accent: "#99f6e4" },
      { name: "Amethyst", family: "glass", bg: "linear-gradient(160deg, #2e1065 0%, #581c87 55%, #6b21a8 100%)", text: "#ffffff", finish: "frosted", title: "#f3e8ff", company: "#f3e8ff", info: "#faf5ff", accent: "#e9d5ff" },
      { name: "Jade", family: "glass", bg: "linear-gradient(160deg, #022c22 0%, #064e3b 55%, #065f46 100%)", text: "#ffffff", finish: "frosted", title: "#d1fae5", company: "#d1fae5", info: "#ecfdf5", accent: "#a7f3d0" },
      { name: "Rose Quartz", family: "glass", bg: "linear-gradient(160deg, #4c0519 0%, #881337 55%, #9f1239 100%)", text: "#ffffff", finish: "frosted", title: "#ffe4e6", company: "#ffe4e6", info: "#fff1f2", accent: "#fecdd3" },
      { name: "Smoke", family: "glass", bg: "linear-gradient(160deg, #111827 0%, #1f2937 55%, #374151 100%)", text: "#ffffff", finish: "frosted", title: "#e5e7eb", company: "#e5e7eb", info: "#f9fafb", accent: "#e5e7eb" },
      { name: "Sunset", family: "glass", bg: "linear-gradient(160deg, #431407 0%, #7c2d12 50%, #9d174d 100%)", text: "#ffffff", finish: "frosted", title: "#fed7aa", company: "#ffedd5", info: "#fff7ed", accent: "#fdba74" },
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
      help: "Your job title, under your name. It follows your accent until you pick a color here.",
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
      hint: "Icons beside your details, your QR code, and the buttons on your card page. Your title too, until you give it its own color.",
      help: "Draws the contact icons and the QR code, and your job title while \"Title color\" is on \"Default\". A shade too close to your background is brightened or darkened until it reads. You keep the color you picked, in a shade that can be seen. The QR is darkened further, because a pale code is one phones stop scanning.",
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
    help: "The color of your name (headline text).",
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
