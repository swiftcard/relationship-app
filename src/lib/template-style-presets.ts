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
 */
export type Look = { name: string; bg: string; text: string; font?: string; finish?: string; surface?: string };

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
export function freeSafeValues(meta: TemplateMeta, field: "bg" | "surface" | "text"): string[] {
  const base = field === "surface" ? meta.surface?.presets ?? [] : meta[field].presets;
  const fromLooks = meta.looks
    .map((l) => (field === "bg" ? l.bg : field === "text" ? l.text : l.surface))
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
      { name: "Executive Navy", bg: "linear-gradient(160deg, #0e1b35 0%, #162947 100%)", text: "#ffffff" },
      { name: "Onyx", bg: "#070d1c", text: "#ffffff" },
      { name: "Graphite", bg: "#111827", text: "#e5e7eb" },
      { name: "Forest", bg: "#052e2b", text: "#ffffff" },
      { name: "Burgundy", bg: "#3f1d2e", text: "#f3d9c6" },
      { name: "Sky", bg: "linear-gradient(160deg, #0e1b35 0%, #2563eb 100%)", text: "#ffffff" },
      { name: "Sea Glass", bg: "linear-gradient(160deg, #1c3a5e 0%, #2f6f8f 100%)", text: "#f2fbff", finish: "frosted", surface: "#f8fafc" },
      { name: "Titanium", bg: "#2a3140", text: "#ffffff", finish: "brushed", surface: "#f1f5f9" },
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
      { name: "Electric Dark", bg: "#070d1c", text: "#ffffff" },
      { name: "Pure Black", bg: "#0a0a0a", text: "#ffffff" },
      { name: "Violet Night", bg: "linear-gradient(135deg, #111827 0%, #6d28d9 100%)", text: "#ffffff" },
      { name: "Deep Blue", bg: "linear-gradient(135deg, #0e1b35 0%, #2563eb 100%)", text: "#ffffff" },
      { name: "Emerald", bg: "#052e2b", text: "#6ee7b7" },
      { name: "Ember", bg: "#1c1010", text: "#fca5a5" },
      { name: "Frostbite", bg: "linear-gradient(150deg, #10243f 0%, #1d4e6b 100%)", text: "#eaf7ff", finish: "frosted" },
      { name: "Carbon", bg: "#0b0f16", text: "#ffffff", finish: "carbon" },
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
    looks: [
      { name: "Ivory & Gold", bg: "#fafaf6", text: "#1c1612", font: SERIF },
      { name: "Warm Cream", bg: "#fffbf0", text: "#3f2d1a", font: SERIF },
      { name: "Pearl", bg: "#ffffff", text: "#0e1b35", font: SERIF },
      { name: "Sand", bg: "#f5efe3", text: "#1c1612", font: SERIF },
      { name: "Charcoal Luxe", bg: "#1c1612", text: "#d4af7a", font: SERIF },
      { name: "Opaline", bg: "linear-gradient(160deg, #eef2f6 0%, #dbe6ee 100%)", text: "#1c2733", finish: "frosted" },
      { name: "Gilded", bg: "#14110d", text: "#f0e2c4", finish: "gilt" },
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
      { name: "Warm Amber", bg: "linear-gradient(100deg, #b45309 0%, #d97706 60%, #f59e0b 100%)", text: "#ffffff" },
      { name: "Forest", bg: "#166534", text: "#ffffff" },
      { name: "Teal", bg: "#0f766e", text: "#ffffff" },
      { name: "Midnight", bg: "#0e1b35", text: "#ffffff" },
      { name: "Cherry", bg: "#be123c", text: "#ffffff" },
      { name: "Slate", bg: "#334155", text: "#ffffff" },
      { name: "Sea Glass", bg: "linear-gradient(100deg, #2f7f8f 0%, #3f9fae 60%, #56b8c4 100%)", text: "#f4feff", finish: "frosted", surface: "#ffffff" },
      { name: "Slate & Linen", bg: "linear-gradient(100deg, #3b4451 0%, #4b5563 60%, #5b6675 100%)", text: "#ffffff", finish: "linen", surface: "#f5f5f4" },
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
    looks: [
      { name: "Clean White", bg: "#ffffff", text: "#ffffff" },
      { name: "Royal Violet", bg: "linear-gradient(145deg, #4f46e5 0%, #7c3aed 60%, #6d28d9 100%)", text: "#ffffff" },
      { name: "Indigo", bg: "#4f46e5", text: "#ffffff" },
      { name: "Rose", bg: "linear-gradient(145deg, #be123c 0%, #f43f5e 100%)", text: "#ffffff" },
      { name: "Emerald", bg: "linear-gradient(145deg, #064e3b 0%, #10b981 100%)", text: "#ffffff" },
      { name: "Onyx", bg: "#0a0a0a", text: "#ffffff" },
      { name: "Sea Glass", bg: "#ffffff", text: "#ffffff", finish: "frosted", surface: "linear-gradient(145deg, #2f7f8f 0%, #3f9fae 60%, #56b8c4 100%)" },
      { name: "Graphite", bg: "#111827", text: "#ffffff", finish: "brushed", surface: "#1f2937" },
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
      help: "The colored panel behind your photo — it shows through around the edges, and fills the panel when there's no photo yet.",
      presets: ["linear-gradient(145deg, #4f46e5 0%, #7c3aed 60%, #6d28d9 100%)", "#4f46e5", "#0e1b35", "#111827", "#052e2b", "#3f1d2e"],
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
      { name: "Dark Navy", bg: "#2c3a52", text: "#ffffff" },
      { name: "Midnight", bg: "#141b26", text: "#ffffff" },
      { name: "Slate", bg: "#1e293b", text: "#ffffff" },
      { name: "Forest", bg: "#16352c", text: "#ffffff" },
      { name: "Oxblood", bg: "#3a1d22", text: "#ffffff" },
      { name: "Bone", bg: "#f4f2ed", text: "#141b26" },
      { name: "Sea Glass", bg: "linear-gradient(160deg, #24506b 0%, #3a7f96 100%)", text: "#f2fbff", finish: "frosted" },
      { name: "Brushed Steel", bg: "#39414f", text: "#ffffff", finish: "brushed" },
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
    { name: "Navy", bg: "#0e1b35", text: "#ffffff" },
    { name: "Onyx", bg: "#070d1c", text: "#ffffff" },
    { name: "Ivory", bg: "#fafaf6", text: "#1c1612" },
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
