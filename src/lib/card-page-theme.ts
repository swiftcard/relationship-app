// ── The public card page's ambient theme ────────────────────────────────────
//
// The page below the card used to be identical for every user: cream, stock
// blue buttons. The card itself carries a palette (the owner's accent, or the
// template's own default), so the page now borrows it — a soft wash of the
// accent behind the card and every action button in that accent — which is
// what makes the page read as THIS person's page rather than a generic form.
//
// Pure module: the page passes the result down as CSS custom properties
// (--sc-accent / --sc-accent-text), which the action buttons read with a
// stock-blue fallback, so every other surface that renders those buttons is
// unchanged.

import { metaForTemplate } from "@/lib/template-style-presets";

const HEX = /^#[0-9a-f]{6}$/i;

function yiq(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000;
}

/** Mix a hex toward black by `f` (0..1). */
function darken(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(v * (1 - f)).toString(16).padStart(2, "0");
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

/** WCAG contrast of white text on `hex`. */
function contrastWithWhite(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return 1.05 / (l + 0.05);
}

function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export type CardPageTheme = {
  /** The action color — buttons, selected states. Always dark enough for white text. */
  accent: string;
  /** Text on the accent. */
  accentText: string;
  /** The page background: a soft wash of the accent fading into the cream. */
  pageBackground: string;
};

export function cardPageTheme(accentRaw: string | null | undefined, templateId: string): CardPageTheme {
  const fromCard = typeof accentRaw === "string" && HEX.test(accentRaw.trim())
    ? accentRaw.trim().toLowerCase()
    : null;
  const fromTemplate = metaForTemplate(templateId).accent?.fallback;
  let accent = fromCard ?? (fromTemplate && HEX.test(fromTemplate) ? fromTemplate : "#1d4ed8");

  // A BUTTON needs white text; a pastel or white accent can't carry it.
  // Darken toward readable rather than falling back to blue, so a gold card
  // gets deep-gold buttons instead of losing its identity.
  if (yiq(accent) > 160) accent = darken(accent, 0.45);
  if (yiq(accent) > 160) accent = darken(accent, 0.35); // near-white accents need a second step
  // Brightness alone let saturated mid-tones through: mint, teal, sky and
  // coral sit under 160 yet carry white text at under 2:1 (Modern Bold's
  // #34d399 swatch, and the card Looks that use those accents, 2026-10-15).
  // Keep darkening along the same hue until white text clears 3:1 — the floor
  // the templates' own defaults already meet. Anything already there is
  // untouched.
  for (let i = 0; i < 8 && contrastWithWhite(accent) < 3; i++) accent = darken(accent, 0.12);

  return {
    accent,
    accentText: "#ffffff",
    // The wash is the ORIGINAL card color (pre-darkening) so a light-accent
    // card still tints its page with the color it actually shows.
    pageBackground: `linear-gradient(180deg, ${alpha(fromCard ?? accent, 0.10)} 0%, rgba(250,247,242,0) 420px), #FAF7F2`,
  };
}
