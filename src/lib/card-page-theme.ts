// ── The public card page's ambient theme ────────────────────────────────────
//
// The page below the card used to be identical for every user: cream, stock
// blue buttons. The card itself carries a palette (the owner's accent, or the
// template's own default), so the page now borrows it — a soft wash of the
// accent behind the card and every action button in that accent — which is
// what makes the page read as THIS person's page rather than a generic form.
//
// Pure module: the page passes the result down as CSS custom properties
// (--sc-accent / --sc-accent-text / --sc-accent-ink), which the action buttons
// read with a stock-blue fallback, so every other surface that renders those
// buttons is unchanged.

import { metaForTemplate } from "@/lib/template-style-presets";

const HEX = /^#[0-9a-f]{6}$/i;

/** Dark text for a light accent — the same ink Swift Links puts on one. */
export const ACCENT_DARK_TEXT = "#111827";

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
  /** The action color — buttons, selected states. EXACTLY the card's accent. */
  accent: string;
  /** Text on the accent: white, or dark ink when white would not read. */
  accentText: string;
  /** Accent-coloured TEXT on the page's white sections (an outline button's
      label): the accent when it reads on white, otherwise dark ink. */
  accentInk: string;
  /** The page background: a soft wash of the accent fading into the cream. */
  pageBackground: string;
};

/**
 * The buttons are the card's accent EXACTLY — never a shade of it.
 *
 * Owner, 2026-11-12 (the Glasshouse card, accent #88f9c1): "on the Save
 * Contact button and all those other buttons, it comes up as green… It has to
 * be the exact same color that I choose." This used to DARKEN a light accent
 * until white text read on it, so mint became #4b896a, a sea green. Now the
 * colour stays and the TEXT gives way: white wherever it reaches 3:1 (every
 * accent that already passed keeps exactly what it had), dark ink otherwise.
 */
export function cardPageTheme(accentRaw: string | null | undefined, templateId: string): CardPageTheme {
  const fromCard = typeof accentRaw === "string" && HEX.test(accentRaw.trim())
    ? accentRaw.trim().toLowerCase()
    : null;
  const fromTemplate = metaForTemplate(templateId).accent?.fallback;
  const accent = fromCard ?? (fromTemplate && HEX.test(fromTemplate) ? fromTemplate : "#1d4ed8");
  const whiteReads = contrastWithWhite(accent) >= 3;

  return {
    accent,
    accentText: whiteReads ? "#ffffff" : ACCENT_DARK_TEXT,
    accentInk: whiteReads ? accent : ACCENT_DARK_TEXT,
    pageBackground: `linear-gradient(180deg, ${alpha(accent, 0.10)} 0%, rgba(250,247,242,0) 420px), #FAF7F2`,
  };
}
