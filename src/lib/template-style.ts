// Pure normalization for the preset-template style overrides (accent color,
// background surface, hero text color, typography). Kept out of the JSX-heavy
// card-templates module so it can be unit-tested in a plain node env and reused
// by both the templates (via shared.tsx re-export) and the editor forms.
//
// Every field is OPTIONAL. A card with none set — which is every card saved
// before this feature — normalizes to all-undefined, so each template falls
// back to its own baked-in design and nothing about existing cards changes.

import type { CardData } from "@/components/card-templates/types";
import { composePanelBackground } from "@/lib/card-finishes";
import { safeCssValue, safeFontValue } from "@/lib/custom-layout";

export type TemplateStyle = {
  accentColor?: string;
  bgColor?: string;
  textColor?: string;
  infoColor?: string; // color of the contact/details text (phone, email, address…)
  /**
   * The job title and the company name, each on its own.
   *
   * Owner, 2026-10-09: "there isn't a place for me to change the color of my
   * title or my company name… it shouldn't be that the color you choose
   * changes both of them." Each template had borrowed some other control for
   * these lines — the accent on Modern Bold and Logo First, Details color for
   * the company on three templates, nothing at all on Classic Pro — and on
   * Luxury Minimal ONE accent painted both. Unset keeps each template's own
   * choice exactly, so no saved card changes.
   */
  titleColor?: string;
  companyColor?: string;
  fontFamily?: string;
  /**
   * The card's SECOND surface, where a template has one.
   *
   * `bgColor` paints whatever each template calls its brand surface — Classic
   * Pro's left panel, Local Business's header stripe, Photo First's info panel.
   * The other half of those cards was a hard-coded constant nobody could
   * change: Local Business's cream body, Classic Pro's white info panel, Photo
   * First's photo panel. Owner, 2026-09-10: "for local business, it's only
   * letting them choose the color of the header stripe, but not the color of
   * the bottom part of the card."
   *
   * Absent on the three single-surface templates (Modern Bold, Luxury Minimal,
   * Logo First), which is why META carries `surface` only where one exists —
   * a control for a surface the template does not have is worse than none.
   */
  surfaceColor?: string;
  /** Material laid over the panel colour — see lib/card-finishes.ts. */
  finish?: string;
  /** A photo behind the panel. Public URL from /api/upload (field "cardbg"). */
  panelMedia?: string;
  /** "image" | "video". A video also stores a poster, which is what every
   *  non-browser surface paints — CSS cannot play one. */
  panelMediaType?: string;
  /** First frame of a panel video, used wherever the video cannot run. */
  panelMediaPoster?: string;
  /** Scrim over the media, 0–0.85, so a name stays readable on a busy photo. */
  panelDim?: number;
  /**
   * Photo First only: "circle" sits the headshot in a circle ON the photo
   * panel, with the panel colour (surfaceColor) all round it. Absent is the
   * full-height photo. Not a Pro key: it is a layout choice, like logoShape.
   */
  photoShape?: "circle";
};

// Shades of one chosen info color for ContactRows' four levels (phone → address).
export function infoPaletteFrom(color: string): { strong: string; mid: string; soft: string; muted: string } {
  return { strong: color, mid: withAlpha(color, 0.92), soft: withAlpha(color, 0.75), muted: withAlpha(color, 0.62) };
}

// #rrggbb → rgba(...) with the given alpha. Non-hex input is returned as-is.
export function withAlpha(color: string, alpha: number): string {
  const m = color.match(/^#([0-9a-f]{6})$/i);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * `a` moved `t` (0–1) of the way to `b`, both #rrggbb. Anything else returns
 * `a` untouched.
 *
 * For the second colour a template draws next to its accent — the far end of
 * a bar, a rule's fade. Those were fixed (Classic Pro's bar always ended in
 * violet, Photo First's rule in lilac), so a Look's green accent finished in
 * purple. With an accent set they are now a shade of it; unset, each template
 * keeps its own exactly.
 */
export function mixHex(a: string, b: string, t: number): string {
  const ma = a.match(/^#([0-9a-f]{6})$/i);
  const mb = b.match(/^#([0-9a-f]{6})$/i);
  if (!ma || !mb) return a;
  const na = parseInt(ma[1], 16), nb = parseInt(mb[1], 16);
  return "#" + [16, 8, 0]
    .map((s) => Math.round(((na >> s) & 255) * (1 - t) + ((nb >> s) & 255) * t).toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The colour a template draws BESIDE its accent: `fallback` (the template's
 * own, e.g. Classic Pro's violet bar end) while no accent is set, a shade of
 * the accent once one is. One rule for the cards and the Wallet pass, which
 * copies these bars and must never drift from them.
 */
export function accentShade(accentSet: string | undefined, accent: string, toward: string, t: number, fallback: string): string {
  return accentSet ? mixHex(accent, toward, t) : fallback;
}

/** Modern Bold's bloom: the template's blue until an accent is set, then that accent. */
export function accentGlow(accentSet: string | undefined, accent: string): string {
  // Only a #rrggbb can be made translucent; anything else keeps the default
  // bloom rather than painting a full-strength blob.
  return accentSet && /^#[0-9a-f]{6}$/i.test(accent) ? withAlpha(accent, 0.12) : "rgba(59,130,246,0.12)";
}

/**
 * The accent, made safe to print a QR code in — so the "Accent / icons" picker
 * colours the code too, on every template (it reached only Logo First's; the
 * others pinned theirs to a template constant, owner report 2026-10-20).
 *
 * A QR is the only thing on the card with a job beyond looking right, so this
 * is deliberately strict: scanners need a wide luminance gap between the dark
 * modules and the quiet zone, and a pale accent on a pale square is a code
 * phones stop reading. The colour is DARKENED along its own hue until it clears
 * the QR's background by 130 (out of 255) — a teal accent gives a deep-teal
 * code rather than being thrown away — and only if darkening cannot get there
 * does it fall back to `fallback`, which is also what a colour it can't read
 * (a name, rgb()) gets, since its contrast can't be checked.
 */
export function qrInk(accent: string, qrBg: string, fallback: string): string {
  const bg = hex6(qrBg);
  const fg = hex6(accent);
  if (!bg || !fg) return fallback;
  const bgY = brightness(bg);
  const n = parseInt(fg.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  for (let i = 0; i < 14; i++) {
    if (Math.abs((r * 299 + g * 587 + b * 114) / 1000 - bgY) >= 130) break;
    r *= 0.82; g *= 0.82; b *= 0.82;
  }
  const out = "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  return Math.abs(brightness(out) - bgY) >= 125 ? out : fallback;
}

/** "#rrggbb" for a #rrggbb or #rgb colour (the accent field takes either); null otherwise. */
function hex6(color: string): string | null {
  const m = color.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return `#${h.toLowerCase()}`;
}

// Treat only non-empty strings as a real override. `null`, `undefined`, and
// `""` (a value the editor may send when a field is cleared) all resolve to
// undefined → the template default.
function pick(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

/**
 * The typeface a card uses when its owner has not chosen one.
 *
 * Pinned, and deliberately NOT inherited from the page. Two reasons:
 *
 * 1. The auto-fit logic in card-templates/shared.tsx sizes a company name from
 *    a MEASURED per-character width table (W_UPPER/W_MIXED), and those numbers
 *    are Helvetica/Arial advance widths. Let the card inherit some other face
 *    and the table silently under-measures, so `fitCompany` returns a size that
 *    does not actually fit and `overflowWrap: anywhere` breaks the name
 *    mid-word — "Coastline Realty" rendering as "Coas tlin / e Re alty". That
 *    is exactly what happened when body switched from Arial to Geist.
 * 2. A card is a shared, printed, screenshotted artifact, and it renders in
 *    places the app's webfont does not exist: the render-test harness (no
 *    next/font, so `var(--font-geist-sans)` is undefined) and the OG image
 *    generator. Pinning keeps a card identical everywhere instead of silently
 *    reflowing based on which renderer drew it.
 *
 * This is the exact stack cards already rendered in — body's old value — so
 * fixing the app's font changes no existing card. Owners who pick "Sans" from
 * CARD_FONT_OPTIONS still get Geist; this is only the default.
 *
 * Applied at the point of render (`style.fontFamily ?? CARD_BASE_FONT` on each
 * template root), NOT inside templateStyle(). That function's contract is
 * normalization — undefined means "no override present" — and the editor's
 * swatch selection depends on being able to tell "unset" from "explicitly set
 * to the default".
 */
export const CARD_BASE_FONT = "Arial, Helvetica, sans-serif";

export function templateStyle(data: Pick<CardData, "customization">): TemplateStyle {
  const c = (data.customization ?? {}) as Record<string, unknown>;
  const dim = typeof c.panelDim === "number" ? c.panelDim : undefined;
  return {
    // Colours and the font land in style objects on the PUBLIC card, so they
    // pass the custom-layout CSS guards (no declarations, no url()).
    accentColor: safeCssValue(c.accentColor),
    bgColor: safeCssValue(c.bgColor),
    surfaceColor: safeCssValue(c.surfaceColor),
    textColor: safeCssValue(c.textColor),
    infoColor: safeCssValue(c.infoColor),
    titleColor: safeCssValue(c.titleColor),
    companyColor: safeCssValue(c.companyColor),
    fontFamily: safeFontValue(c.fontFamily),
    finish: pick(c.finish),
    panelMedia: pick(c.panelMedia),
    panelMediaType: pick(c.panelMediaType),
    panelMediaPoster: pick(c.panelMediaPoster),
    ...(dim === undefined ? {} : { panelDim: dim }),
    ...(c.photoShape === "circle" ? { photoShape: "circle" as const } : {}),
  };
}

/**
 * The finished `background` for a template's branding panel.
 *
 * Every template used to write `style.bgColor ?? <its own default>` inline, and
 * that is exactly why this exists: a finish or a photo has to apply whether or
 * not the owner also picked a colour. Passing the template's own default in as
 * `fallback` keeps that decision where it belongs — each template still owns
 * the look it ships with — while the finish composes over whichever one wins.
 *
 * A card with no finish and no media gets its base back untouched, so every
 * card saved before any of this existed renders exactly as it did.
 */
export function panelBackground(style: TemplateStyle, fallback: string): string {
  return composePanelBackground(style.bgColor ?? fallback, style.finish, {
    // A video paints its poster here. CSS cannot play one, and the live card
    // page layers the real <video> over this same surface.
    url: style.panelMediaType === "video" ? undefined : style.panelMedia,
    poster: style.panelMediaType === "video" ? style.panelMediaPoster : undefined,
    dim: style.panelDim,
  });
}

/** Perceived brightness (YIQ, 0–255) of the first #rrggbb in a colour; 255 when there is none. */
export function brightness(color: string): number {
  const m = color.match(/#([0-9a-f]{6})/i);
  if (!m) return 255;
  const n = parseInt(m[1], 16);
  return (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000;
}

// Is a background color/gradient dark enough to need light text on top? Reads
// the first #rrggbb in the string (works for solid colors and gradients) and
// compares its perceived brightness. Unknown/absent color → treated as light.
export function isDarkBg(bg?: string): boolean {
  if (!bg) return false;
  const m = bg.match(/#([0-9a-f]{6})/i);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  // Perceived brightness (YIQ). < 150 reads as dark.
  return (r * 299 + g * 587 + b * 114) / 1000 < 150;
}

// Typography choices offered in the editor. One shared list for the control and
// any tests.
//
// "Sans", NOT "Sans (default)". Both consumers (TemplateStyleControls' FontPills
// and SwiftLinkDesign) prepend their own "Default" entry meaning "no override —
// inherit the page", and the page inherits Arial, while this option resolves to
// Geist. So the two really are different typefaces, and calling this one "the
// default" sat next to an actual Default pill claiming the same thing. The
// separate list in CustomCardDesigner keeps its "(default)" suffix: that canvas
// has no Default pill and genuinely does start on this stack (CustomCard.tsx).
export const CARD_FONT_OPTIONS: { label: string; value: string }[] = [
  { label: "Sans", value: "var(--font-geist-sans), system-ui, sans-serif" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Mono", value: "'Courier New', ui-monospace, monospace" },
  { label: "Rounded", value: "'Trebuchet MS', system-ui, sans-serif" },
];
