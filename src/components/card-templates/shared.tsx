// Shared design tokens, icons, and utilities for all card templates

import type { CardData } from "./types";
import { MAX_CARD_PHONES, clampField } from "@/lib/card-limits";

// Preset-template style overrides (accent/background/text/typography). The pure
// logic lives in src/lib/template-style.ts so it's node-testable; re-exported
// here so templates keep importing it from "./shared".
export { templateStyle, panelBackground, CARD_FONT_OPTIONS, CARD_BASE_FONT, isDarkBg, infoPaletteFrom } from "@/lib/template-style";
export type { TemplateStyle } from "@/lib/template-style";

export function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === "1") return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return raw;
}

export type ShownPhone = { number: string; label: string };

// Phone numbers to display on the card: the ones flagged showOnCard, falling
// back to the legacy single `phone` field for cards saved before multi-phone.
//
// At most MAX_CARD_PHONES (lib/card-limits): more can be saved, but the card
// is measured to fit exactly that many, so that is how many it prints.
export function cardPhones(data: CardData): ShownPhone[] {
  const phones = data.customization?.phones;
  if (Array.isArray(phones) && phones.length) {
    return phones
      .filter((p) => p?.showOnCard && p.number?.trim())
      .slice(0, MAX_CARD_PHONES)
      .map((p) => ({ number: clampField("phone", p.number), label: p.label || "" }));
  }
  return data.phone ? [{ number: clampField("phone", data.phone), label: "" }] : [];
}

// Fax number (card-only).
export function cardFax(data: CardData): string {
  return clampField("fax", data.customization?.fax);
}

// Absolute URL for the card's website value (handles bare domains like "swiftcard.me").
export function webHref(site: string): string {
  const s = (site || "").trim();
  return /^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/+/, "")}`;
}

// ─── Auto-fit system ─────────────────────────────────────────────────────────
// Cards hold a variable amount of info (multiple phones, fax, address lines…).
// All templates size their contact block from ONE density factor so everything
// always fits — more rows → slightly smaller text and tighter rows — without
// ever cutting off the QR code or any wording. Pure functions of the card data,
// so templates stay server-renderable (no hooks — see card page requirement).

// Weighted count of contact rows on the card.
/**
 * Job titles up to this length cost nothing in layout budget.
 *
 * Deliberately generous — "Chief Marketing Officer" is 23, "Senior Vice
 * President" is 21 — so no card that renders correctly today shifts by a pixel.
 * Only titles beyond it, the ones that were being clipped, buy extra room.
 */
const TITLE_COMFY = 28;

export function titleLoad(data: CardData): number {
  const len = (data.title ?? "").trim().length;
  if (len <= TITLE_COMFY) return 0;
  // Caps at 0.8 of a row: a very long title should make the card breathe, not
  // shrink everything else into illegibility.
  // A long title now WRAPS to a readable second line (fitTitle) instead of
  // shrinking, so it reserves up to a full row for that line.
  return Math.min(1.1, ((len - TITLE_COMFY) / TITLE_COMFY) * 1.1);
}

export function contactRowCount(data: CardData): number {
  // Counted the way ContactRows LAYS THEM OUT (detailLineBudget): a long
  // address line wraps onto a second row there, so it is two rows here too.
  // Counting it once let a card with every field at the limits stay too short,
  // and on Photo First and Luxury Minimal the address ran onto the QR
  // (card-every-template.test.ts, 2026-10-02).
  const addrLines = (data.address ?? "").split("\n").map((l) => l.trim()).filter(Boolean)
    .reduce((n, l) => n + Math.max(1, Math.ceil(l.length / ADDR_LINE_CHARS)), 0);
  return (
    cardPhones(data).length +
    (data.email ? 1 : 0) +
    // A long email now WRAPS onto a second line at a readable size (see fluid in
    // ContactRows) instead of shrinking to a smudge, so it has to pay for that
    // line here or the card doesn't grow for it and the QR is pushed off.
    ((data.email ?? "").trim().length > 32 ? 0.8 : 0) +
    (data.website ? 0.9 : 0) +
    // …and so does a website long enough to wrap (WEB_WRAP_CHARS).
    ((data.website ?? "").trim().length > WEB_WRAP_CHARS ? 0.7 : 0) +
    (cardFax(data) ? 0.9 : 0) +
    addrLines * 0.7 +
    // A long title is real content and has to be paid for. It was invisible to
    // this count, so a 70-character title neither shrank the layout nor made the
    // card taller — it just wrapped and got clipped by the card's fixed aspect
    // ratio. That was the whole mechanism behind titles being cut off.
    titleLoad(data)
  );
}

// Density factor — the card always uses its FULL space:
//   sparse card (≤2 rows)  → up to 1.18: text, logo and QR grow into the room
//   normal (4 rows)        → 1
//   packed                 → eases down to 0.7 so nothing is ever cut off
export function fitFactor(data: CardData): number {
  const rows = contactRowCount(data);
  if (rows <= 4) return Math.min(1.18, 1 + (4 - rows) * 0.09);
  return Math.max(0.7, 1 - (rows - 4) * 0.075);
}

// Cap used for HERO text (names/companies) — they grow with sparseness but a
// touch less than rows so the layout stays balanced.
/**
 * How much of a text element's allowed GROWTH the card can actually afford,
 * from the same density factor everything else reads (0 on a busy card, 1 on a
 * sparse one). A bigger title and company name add height, and on a packed card
 * that height pushed the QR off the edge — caught by card-detail-fit on Logo
 * First with a long unbroken address. Growth is a reward for spare room.
 */
export function roomGrow(f: number): number {
  return Math.min(1, Math.max(0, (f - 0.92) / 0.22));
}

export function heroGrow(f: number): number {
  return Math.min(f, 1.14);
}

// Logo sizing that adapts to the logo's OWN shape without any JS measurement:
// height is fixed (scaled by density), width is auto — so a square logo renders
// height×height while a banner/wordmark logo naturally takes more width.
// object-contain guarantees nothing is ever cropped.
//
// CRITICAL: when the logo shares its row with the company name, maxWidth must
// be a PERCENTAGE of the row — a px cap ≥ the row width would squeeze the text
// to zero and wrap it letter-by-letter down past the card's bottom edge.
export function logoStyle(f: number, base: number, extra?: React.CSSProperties): React.CSSProperties {
  const h = Math.round(base * Math.min(Math.max(f, 0.85), 1.3));
  return {
    height: h,
    width: "auto",
    // Default assumes a text sibling: banner logos get at most half the row.
    maxWidth: "48%",
    objectFit: "contain",
    flexShrink: 0,
    ...extra,
  };
}

/** The owner-chosen logo display shape ("circle") vs the classic adaptive
 *  rendering ("auto" — square/wide/banner all emerge from the mark itself). */
export function cardLogoShape(data: CardData): "auto" | "circle" {
  return data.customization?.logoShape === "circle" ? "circle" : "auto";
}

/**
 * Circle badge rendering for the logo — the "Circle" option in the editor.
 *
 * A straight circular crop would cut the corners off every square or wide
 * mark, which is exactly what the owner ruled out. So the circle is a PLATE:
 * a solid disc (white by default, ring so it can't dissolve into a light
 * card) with the entire mark object-contained inside it.
 *
 * Geometry, not taste: with padding p on a disc of diameter d, a contained
 * square mark's corners sit at radius (d/2 − p)·√2 from center, so they stay
 * inside the circle only when p ≥ d/2·(1 − 1/√2) ≈ 0.146·d. Padding is 0.17·d
 * — safely past the bound, and wide marks (which contain to a short strip)
 * clear it trivially.
 *
 * Diameter is base·1.24 (density-clamped like logoStyle) so the inner mark
 * lands close to the height the "auto" logo would have had; fixed width ==
 * height means a circle can never squeeze a company name the way a banner
 * can, so the row math only gets safer.
 */
export function logoCircleStyle(f: number, base: number, extra?: React.CSSProperties): React.CSSProperties {
  const d = Math.round(base * 1.24 * Math.min(Math.max(f, 0.85), 1.3));
  const pad = Math.round(d * 0.17);
  return {
    height: d,
    width: d,
    borderRadius: "50%",
    padding: pad,
    background: "#ffffff",
    // The hairline ring as a BORDER, not an inset shadow: the iPhone's
    // screenshot engine (the texted-link preview, components/ShareCardCapture)
    // doesn't paint an inset shadow on an <img>, so the preview showed the logo
    // with no circle at all (2026-10-06). border-box sizing keeps it identical.
    border: "1px solid rgba(15,23,42,0.12)",
    objectFit: "contain",
    flexShrink: 0,
    ...extra,
  };
}

// Shrink one long value (a long email, name, or company) to fit its line.
// Exact-fit curve: beyond the comfy length, font size scales inversely with
// length, so rendered width stays constant — a 40-char email occupies the same
// line width a 24-char one does, just smaller.
//
// THE FLOOR IS A HARD LIMIT, NOT A FORMALITY. Below FIT_FLOOR the curve stops and
// rendered width starts growing linearly again, so the constant-width property
// only holds up to comfy / FIT_FLOOR characters — about 58 for a comfy of 22.
// Past that this function CANNOT make the text fit, and the caller must be able
// to wrap. This is why the email and website rows below no longer set nowrap:
// they used to, on the strength of a guarantee this function does not actually
// make, so a 67-char address rendered 37% wider than its box and simply hung off
// the side of the card. Measured by tests/render/card-overflow.test.ts.
const FIT_FLOOR = 0.38;

/** Company names and job titles wrap onto a second line rather than shrink
 *  past this share of their design size (~8px on every template). */
const COMPANY_FLOOR = 0.62;
/** How much bigger than its design size a SHORT company name may grow to use
 *  the width beside the logo. Kept modest so it never rivals the name. */
const COMPANY_GROW = 1.3;
const TITLE_FLOOR = 0.78;

// ── Company names must not break mid-word ───────────────────────────────────
//
// fitPx below sizes text by its TOTAL length, which is the right rule for a
// line that may wrap: a longer string gets smaller so more of it fits. But it
// says nothing about the LONGEST WORD, and a word wider than its column is
// broken in the middle — "COASTLIN / E REALTY". A company name is a proper
// noun; splitting it is worse than any amount of shrinking.
//
// This only bites when a logo sits beside the name and takes half the row.
// Measured before the fix: 7 mid-word splits across the templates, every one of
// them with a wide banner logo present, none without.
//
// Things that do NOT solve it, each ruled out by measurement rather than taste:
//   • hyphens:auto — verified inert in this engine. A control div with
//     hyphens:auto and one without rendered IDENTICALLY (both overflowing on a
//     single line), so there is no hyphenation dictionary to lean on. Shipping
//     it would have looked like a fix and changed nothing.
//   • overflow-wrap:break-word instead of anywhere — both break a word that
//     cannot fit; they differ only in intrinsic sizing, and every one of these
//     elements also carries min-w-0, which lets flex shrink it past min-content
//     regardless.
//   • letting the logo shrink so the name keeps its width — a long enough word
//     still overflows once the logo hits zero, which trades a broken word for
//     clipped text. Strictly worse.
//
// So the name is shrunk until its longest word fits, spending the cheapest
// thing first: tracking, then size. Tracking goes first because these labels
// carry 0.16–0.22em of it for style, which is ~20% of the rendered width and
// the least missed when it goes.
// Per-character advance widths in em, MEASURED from the rendered card font
// rather than assumed. An average-width-per-character estimate was tried first
// and is not good enough: it sized "COASTLINE" correctly and still split
// "BARTHOLOMEW", because M and W are nearly twice the width of I. The spread is
// 0.24em to 0.94em, so any single average is wrong for half the alphabet.
//
// To re-measure: render a span at font-size 100px in the card font, set
// textContent to one character repeated 10x, and divide its width by 1000.
const W_UPPER: Record<string, number> = {
  I: 0.278, "'": 0.238, "-": 0.333, ".": 0.278, ",": 0.278, "1": 0.506,
  F: 0.611, L: 0.611, T: 0.611, Z: 0.611, J: 0.556,
  E: 0.667, P: 0.667, S: 0.667, V: 0.667, X: 0.667, Y: 0.667,
  A: 0.722, B: 0.722, C: 0.722, D: 0.722, H: 0.722, K: 0.722, N: 0.722, R: 0.722, U: 0.722, "&": 0.722,
  G: 0.778, O: 0.778, Q: 0.778, M: 0.833, W: 0.944,
};
const W_MIXED: Record<string, number> = {
  i: 0.333, j: 0.333, l: 0.333, I: 0.389, f: 0.412, t: 0.444, r: 0.482,
  s: 0.611, v: 0.611, y: 0.611, z: 0.556, "'": 0.278, "-": 0.333, ".": 0.333, ",": 0.333,
  a: 0.667, c: 0.667, e: 0.667, h: 0.667, k: 0.667, n: 0.667, o: 0.667, p: 0.667, q: 0.667, u: 0.667, x: 0.667,
  b: 0.676, d: 0.676, g: 0.676, w: 0.944, m: 1,
  F: 0.667, J: 0.667, L: 0.667, E: 0.722, S: 0.722, T: 0.722, Z: 0.722, P: 0.722,
  A: 0.778, B: 0.778, C: 0.778, D: 0.778, R: 0.778, V: 0.778, X: 0.778, Y: 0.778,
  G: 0.833, H: 0.833, K: 0.833, N: 0.833, O: 0.833, Q: 0.833, U: 0.833,
  M: 0.944, W: 1, "&": 0.889,
};
const DEFAULT_UPPER = 0.722;
const DEFAULT_MIXED = 0.667;

// Production renders in Geist, the harness in whatever the headless engine
// resolves — close, but not identical. 8% covers that drift, and erring toward
// slightly smaller text is the right direction: too small is legible, split is
// not.
const SAFETY = 1.08;

// The row widths passed in are design px at the 460 layout CardScaler always
// uses. One renderer genuinely differs — HeroPhone lays PhotoFirst out at 390 —
// and 390/460 = 0.848, so a size computed against the wider figure would be too
// big there and split the word after all. Budgeting the narrower width
// everywhere costs a fraction of a point on the rare names that shrink at all,
// and makes the result independent of which renderer is drawing the card.
const NARROW = 0.85;

/** Width of one word in em, from the measured table. */
function wordEm(word: string, uppercase: boolean): number {
  const table = uppercase ? W_UPPER : W_MIXED;
  const fallback = uppercase ? DEFAULT_UPPER : DEFAULT_MIXED;
  let sum = 0;
  for (const raw of word) {
    const ch = uppercase ? raw.toUpperCase() : raw;
    sum += table[ch] ?? fallback;
  }
  return sum;
}

/** Longest whitespace-delimited run — the piece that has to survive whole. */
function longestWord(text: string): string {
  return text.trim().split(/\s+/).reduce((a, b) => (b.length > a.length ? b : a), "");
}

/**
 * Split a logo/company row between the two, giving the NAME what it needs and
 * the logo the rest.
 *
 * Shrinking the name alone is not enough on its own. Held to the logo's fixed
 * half of the row, "Konstantinopoulos" came out whole but at 5.9px — legible
 * only in the sense that no letters were missing. Whole-and-unreadable is not
 * an improvement on split-and-readable; both are the name failing to be a name.
 *
 * So the logo yields, and only as far as it must: it keeps its full width for
 * ordinary names (the common case, and the one that was asked to get bigger),
 * gives ground as the longest word grows, and stops at `minLogo` so it can
 * never dwindle to a smudge. Past that the name shrinks again — by then the
 * word is genuinely enormous and something has to give.
 *
 * The logo is the right thing to spend: it is a mark that is still recognisable
 * a few pixels smaller, whereas a company name is either readable or it isn't.
 */
export function splitLogoRow(opts: {
  /** Content width of the row, in design px. */
  row: number;
  /** gap-* between logo and name, in px. */
  gap: number;
  hasLogo: boolean;
  /** Logo's share when the name doesn't need anything extra (0–1). */
  defaultLogoFrac: number;
  /** Never shrink the logo narrower than this, in px. */
  minLogo: number;
  company: string | null | undefined;
  /** Size the longest word should ideally reach — the readability target. */
  targetPx: number;
  trackingEm: number;
  uppercase: boolean;
  /** How much wider this card's face runs than the Arial tables these figures
   *  come from — see textWidthFactor. Defaults to 1, so a caller that has not
   *  been updated renders exactly as it did. */
  widthFactor?: number;
}): { logoMaxPct: string; companyPx: number } {
  const { row, gap, hasLogo, defaultLogoFrac, minLogo, company, targetPx, trackingEm, uppercase } = opts;
  const wf = opts.widthFactor ?? 1;
  const pct = (px: number) => `${Number(((px / row) * 100).toFixed(2))}%`;
  if (!hasLogo) return { logoMaxPct: "0%", companyPx: row * NARROW };

  const defaultLogo = row * defaultLogoFrac;
  const s = (company ?? "").trim();
  if (!s) return { logoMaxPct: pct(defaultLogo), companyPx: 0 };

  const word = longestWord(s);
  const needed = (wordEm(word, uppercase) * wf + word.length * trackingEm) * targetPx * SAFETY;

  // What the name gets: never less than the old fixed share, never so much that
  // the logo drops under its floor.
  const companyPx = Math.min(Math.max(row - defaultLogo - gap, needed), row - minLogo - gap);
  // A PERCENTAGE, not the px value. The cap was originally a percentage and had
  // to stay one: these constants are design px at the 460 layout, and a fixed px
  // cap applied at any other width stops scaling with the row — which showed up
  // immediately as luxury-minimal's logo overrunning its panel at 390px.
  // Expressing the computed split as a fraction keeps it responsive while still
  // being derived from the name.
  return { logoMaxPct: pct(row - companyPx - gap), companyPx: companyPx * NARROW };
}

/**
 * Size a company name so its longest word fits `availPx` without splitting.
 *
 * Returns tracking too, because tightening it is the first and least visible
 * lever. Falls back to the same FIT_FLOOR fitPx uses: past that the word is
 * genuinely wider than the space it has, and a break is unavoidable rather than
 * careless — at which point breaking is the correct behaviour, not a bug.
 */
export function fitCompany(
  base: number,
  text: string | null | undefined,
  comfy: number,
  availPx: number,
  trackingEm = 0,
  uppercase = false,
  /** Density (fitFactor): a short name only grows where there is room. */
  f = 1,
  /** How much wider this card's face runs than the Arial tables these figures
   *  come from — see textWidthFactor. Defaults to 1, so a caller that has not
   *  been updated renders exactly as it did. */
  widthFactor = 1,
): { fontSize: number; letterSpacing: string } {
  const s = (text ?? "").trim();
  // Start from the existing length-based size so short names are untouched and
  // this can only ever make text smaller, never larger.
  // Two lines, not one (owner, 2026-09-17 sheet review): a long company name
  // was shrunk as if it had to sit on a single line and came out around 5px,
  // e.g. "Northwind Commercial Real Estate Advisors". It wraps between words
  // instead, so it is sized for two lines and kept readable.
  let size = Math.max(base * COMPANY_FLOOR, fitPx(base, s, comfy * 2));
  if (!s || availPx <= 0) return { fontSize: size, letterSpacing: `${trackingEm}em` };

  const word = longestWord(s);
  const glyphs = wordEm(word, uppercase) * widthFactor; // em of glyph advance, measured
  const n = word.length;                  // tracking is applied per character
  const widthAt = (fs: number, tr: number) => (glyphs + n * tr) * fs * SAFETY;

  let tracking = trackingEm;
  if (widthAt(size, tracking) > availPx) {
    // 1. Tracking first — it is decoration, and on these labels it is up to a
    //    fifth of the rendered width.  Down to 40% of the design value.
    const needed = (availPx / (size * SAFETY) - glyphs) / n;
    tracking = Math.max(trackingEm * 0.4, Math.min(trackingEm, needed));
  }
  if (widthAt(size, tracking) > availPx) {
    // 2. Then size, never below the shared floor. Past the floor the word is
    //    genuinely wider than the space it has and breaking is correct.
    size = Math.max(base * COMPANY_FLOOR, availPx / ((glyphs + n * tracking) * SAFETY));
  }

  // GROW A SHORT NAME INTO THE SPACE IT HAS (owner, 2026-09-17: name, title and
  // company should all use the room on the card). "Remax" beside a logo sat at
  // its design size with half the column empty. The WHOLE string has to fit on
  // ONE line at the grown size — a name that would wrap is left where it is,
  // because two bigger lines is not an improvement — and the cap keeps the
  // company subordinate to the name above it.
  const lineEm = wordEm(s, uppercase) * widthFactor;
  const oneLineMax = availPx / ((lineEm + s.length * tracking) * SAFETY);
  const grow = 1 + (COMPANY_GROW - 1) * roomGrow(f);
  if (oneLineMax > size) size = Math.max(size, Math.min(base * grow, oneLineMax));

  return { fontSize: size, letterSpacing: `${Number(tracking.toFixed(3))}em` };
}

export function fitPx(base: number, text: string | null | undefined, comfy: number): number {
  const len = (text ?? "").trim().length;
  if (len <= comfy) return base;
  return Math.max(base * FIT_FLOOR, (base * comfy) / len);
}

// ── Phone rows are sized by the PANEL, in the card's own typeface ────────────
//
// Owner, 2026-09-20: "it has my phone number on it and then it says 'mobile'
// next to it. It's cutting off of the card so it only says a few of the
// letters."
//
// Two separate mistakes made that inevitable, and a character count could not
// see either one:
//
// 1. THE LABEL WAS NEVER IN THE BUDGET. The row was sized `fitPx(14.5·s,
//    formatPhone(number), 16)` — the NUMBER's length against a 16-character
//    comfy — while "MOBILE" rendered beside it at a flat 9·s px with a flat 5px
//    margin. "(415) 555-0188" is 14 characters, so it never shrank at all, and
//    the whole span carried `white-space: nowrap`, so the label could neither
//    shrink nor wrap. It simply hung off the card.
//
// 2. A CHARACTER COUNT IS NOT A WIDTH. `comfy: 16` is a budget with no units.
//    On a card carrying one phone the block grows to 14.5 × 1.18 × 1.35 ≈ 23px
//    (fitFactor × contactScale), and MEASURED at 460px the row then wants 221px
//    in Luxury Minimal's 218px panel — over the edge before the label is drawn.
//
// So the row is now sized the way the email and website rows already are: a CSS
// container query against the panel's real width, with an em budget that
// includes the label, the gap and the icon. Below the floor the label wraps
// under the number rather than being cut — the number itself never breaks,
// because splitting a phone number mid-digit leaves a string that looks like a
// phone number and isn't one.

export type CardFontClass = "sans" | "serif" | "mono";

/**
 * Which of the three metric families this card's typeface belongs to.
 *
 * The picker offers four faces plus the unset default, but they differ in only
 * three ways that matter to a width budget, so three tables cover all of them.
 */
export function cardFontClass(data: Pick<CardData, "customization">): CardFontClass {
  const f = String((data.customization as { fontFamily?: string } | undefined)?.fontFamily ?? "").toLowerCase();
  if (f.includes("mono") || f.includes("courier")) return "mono";
  if (f.includes("georgia") || f.includes("times")) return "serif";
  if (f.includes("serif") && !f.includes("sans-serif")) return "serif";
  return "sans";
}

/**
 * Advance widths in em for every character `formatPhone` can emit, MEASURED at
 * weight 700 by the method documented above W_UPPER (render one character ten
 * times at font-size 100, divide by 1000).
 *
 * The spread is the whole point: "+1 (512) 555-0147 ext. 8891" is 11.40em in
 * Segoe UI and 16.20em in Courier New — 42% — so a number sized for Arial is a
 * third of the way off the card in Mono. Every fit constant in this file was
 * calibrated in Arial, and nothing had ever rendered the other four.
 *
 * `sans` holds the WIDEST of Arial, Segoe UI and Trebuchet MS per character, so
 * it stays a safe bound whichever face a given renderer resolves `system-ui`
 * and `var(--font-geist-sans)` to — those differ between production, the OG
 * image generator and the render harness, and a budget that only holds on one
 * of them is not a budget. `serif` is Georgia and `mono` is Courier New, both
 * metric-stable everywhere.
 *
 * To re-measure: scripts/measure-card-fonts.mjs.
 */
const PHONE_W: Record<CardFontClass, Record<string, number>> = {
  sans: {
    "0": 0.586, "1": 0.586, "2": 0.586, "3": 0.586, "4": 0.586, "5": 0.586,
    "6": 0.586, "7": 0.586, "8": 0.586, "9": 0.586,
    "(": 0.368, ")": 0.368, "+": 0.586, "-": 0.368, ".": 0.368, ",": 0.368,
    " ": 0.302, e: 0.575, x: 0.556, t: 0.397,
  },
  serif: {
    "0": 0.702, "1": 0.490, "2": 0.627, "3": 0.625, "4": 0.650, "5": 0.600,
    "6": 0.648, "7": 0.555, "8": 0.677, "9": 0.648,
    "(": 0.447, ")": 0.447, "+": 0.704, "-": 0.379, ".": 0.329, ",": 0.329,
    " ": 0.254, e: 0.572, x: 0.588, t: 0.398,
  },
  // Courier New is uniform — every glyph, including the space, is 0.6.
  mono: {},
};
/** What an unlisted character costs: the widest in its family. */
const PHONE_W_FALLBACK: Record<CardFontClass, number> = { sans: 0.586, serif: 0.704, mono: 0.601 };

/** Width of a formatted phone number, in em of its own font size. */
export function phoneEm(text: string, cls: CardFontClass): number {
  const table = PHONE_W[cls];
  const fallback = PHONE_W_FALLBACK[cls];
  let sum = 0;
  for (const ch of text) sum += table[ch] ?? fallback;
  return sum;
}

/**
 * Width of an uppercase phone label ("MOBILE", "OFFICE") in em of ITS OWN size,
 * including the letter-spacing, which is a real part of the rendered width.
 *
 * Uppercase varies far less between these faces than digits do — MOBILE is
 * 3.57em in Trebuchet, 4.08em in Arial and 4.27em in Georgia — so the measured
 * Arial table (W_UPPER) plus one factor per family covers the spread rather
 * than three more tables. Courier is uniform and so is computed directly.
 */
export function phoneLabelEm(text: string, cls: CardFontClass, trackingEm: number): number {
  const n = text.length;
  if (cls === "mono") return n * (0.601 + trackingEm);
  return wordEm(text, true) * (cls === "serif" ? 1.15 : 1.12) + n * trackingEm;
}

/**
 * How much wider than the Arial figures in W_UPPER/W_MIXED a given face runs.
 *
 * MEASURED (scripts/measure-card-fonts.mjs), relative to Arial:
 *
 *                       sans   serif    mono   rounded
 *   mixed case         0.934   1.022   1.240    1.005
 *   UPPERCASE          0.989   1.016   0.901    0.874
 *
 * Courier New is the reason this exists: it is uniform at 0.6em, which is 24%
 * wider than Arial's lower-case average and 10% NARROWER than its capitals —
 * so one number cannot serve both, and SAFETY's 8% covers neither. That gap is
 * what let "Northwind Commercial Real Estate Advisors" render 51px wider than
 * its column in Mono, where Logo First's `truncate` then cut it off.
 *
 * Each figure is the widest face in its family, rounded up.
 */
export function textWidthFactor(cls: CardFontClass, uppercase: boolean): number {
  if (cls === "mono") return uppercase ? 1.0 : 1.25;
  if (cls === "serif") return 1.03;
  return 1.01;
}

/** The label's size as a share of the number's, so the two always scale together. */
const PHONE_LABEL_RATIO = 0.62;
/** Space between number and label — was a flat 5px beside a 14.5px number. */
const PHONE_LABEL_GAP_EM = 0.36;
/** Below this the label wraps under the number instead of shrinking further. */
const PHONE_FLOOR_PX = 9.5;
/**
 * What the icon and its gap take out of the panel before any text is laid out:
 * `w-3` (12px) plus `gap-2` (8px), and a pixel either side for rounding.
 */
const ROW_CHROME_PX = 23;

/**
 * The class for a template's NAME element: `text-white` only while the owner
 * has not chosen a Name color.
 *
 * The name always carried `text-white` AND an inline `color: style.textColor`.
 * Normally the inline colour wins. But the app's light theme restores card
 * whites with `.sc-card .text-white { color: #fff !important }` (globals.css),
 * and !important beats an inline style — so on the cream theme every Name color
 * pick was ignored in the editor preview, and in the share image captured from
 * that page. With a colour chosen the class is simply absent and the inline
 * colour applies everywhere; without one the markup is exactly what it was.
 */
export function nameClass(style: { textColor?: string }): string {
  return style.textColor ? "" : "text-white";
}

/**
 * fitPx for a row that GROWS on a sparse card (contactScale), without letting
 * the growth widen the line past what the un-grown fit was calibrated to hold.
 *
 * fitPx's `comfy` is a character budget measured at the BASE size: "22
 * characters fit at 13px". Passing it a grown base (13 × 1.4 on a card with no
 * phone or address) kept the same 22-character budget at ~18px, so an email
 * that sits on one line on a normal card — "aaron@malvecapital.com" — was
 * broken mid-domain on a sparse one (".c / om"). Measured across all six
 * templates: dense cards 0 wraps in 30 cases, sparse cards 8.
 *
 * So the grown size is capped at the size that spends exactly the base width
 * budget (base × comfy / len), and never goes below what the same text gets on
 * a normal card. Short values still grow exactly as before; a value long enough
 * to hit the budget stays at the width the dense card has always proven fits.
 * grow ≤ 1 (a packed card) is the untouched original call.
 */
export function fitGrownPx(base: number, grow: number, text: string | null | undefined, comfy: number): number {
  const grown = fitPx(base * grow, text, comfy);
  const len = (text ?? "").trim().length;
  if (grow <= 1 || !len) return grown;
  return Math.max(fitPx(base, text, comfy), Math.min(grown, (base * comfy) / len));
}

/**
 * Longest length this curve can still hold on one line at the given comfy.
 * Exported so tests can assert the boundary rather than rediscovering it.
 */
export function fitOneLineLimit(comfy: number): number {
  return Math.floor(comfy / FIT_FLOOR);
}

// Auto-fit specifically for the NAME (hero text). fitPx alone keys off the WHOLE
// string, so it catches a long full name — but a single long WORD (a 10+ letter
// FIRST name) can't wrap at a space, so it pokes off the side of the card while
// the total length still looks "comfy". This also shrinks by the LONGEST word:
// once any word passes NAME_WORD_COMFY (9) letters, every extra letter scales
// the size down inversely so the rendered word width stays put — "slightly
// minimize with every letter after the 9th". Returns the SMALLER of the two
// fits, floored so a pathological name stays legible. A normal name (≤9-letter
// words) is never touched, so templates that never needed it are unaffected.
const NAME_WORD_COMFY = 9;
export function fitName(base: number, name: string | null | undefined, comfyTotal: number): number {
  const s = (name ?? "").trim();
  if (!s) return base;
  const byTotal = fitPx(base, s, comfyTotal);
  const longestWord = s.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 0);
  const byWord = longestWord <= NAME_WORD_COMFY
    ? base
    : Math.max(base * 0.5, (base * NAME_WORD_COMFY) / longestWord);
  return Math.min(byTotal, byWord);
}

/**
 * Auto-fit for the JOB TITLE.
 *
 * Titles were the one text field with no fitting at all. Most templates set them
 * uppercase with wide letter-spacing, which renders far wider per character than
 * the raw length suggests, so they overflowed sooner than anything else while
 * looking harmless in the source. Shares TITLE_COMFY with the density
 * calculation so the two can't drift apart.
 */
/**
 * THE JOB TITLE, SIZED BY THE COLUMN IT SITS IN — not by a fixed number.
 *
 * fitTitle below only ever SHRINKS, so every title rendered at its template's
 * base size (8–9.5px on a 460px card). A short one like "CEO" therefore sat at
 * 9px in a column with room for three times that — too small to read (owner,
 * 2026-09-17). This is the mechanism the contact rows already use: a CSS
 * container query measures the column, so the title is as large as fits on one
 * line, capped so it stays subordinate to the name, and floored at exactly the
 * old fitted size so a long title still wraps onto the line titleLoad reserves.
 *
 * The PARENT must set containerType: "inline-size" — `titleBox` below.
 *
 * `tracking` is the letter-spacing in em. Uppercase titles carry 0.12–0.2em,
 * which is a fifth of the width again; ignoring it is what made titles overflow
 * while looking harmless in the source.
 */
export function fitTitleFluid(
  base: number,
  title: string | null | undefined,
  opts: { tracking?: number; grow?: number; pad?: number; uppercase?: boolean; min?: number; f?: number } = {},
): React.CSSProperties {
  const s = (title ?? "").trim();
  if (!s) return { fontSize: base };
  const tracking = opts.tracking ?? 0;
  // Scaled by the room the card has (roomGrow): a packed card keeps today's size.
  const grow = 1 + ((opts.grow ?? 1.7) - 1) * (opts.f === undefined ? 1 : roomGrow(opts.f));
  const pad = opts.pad ?? 4;
  // Uppercase semibold sans runs ~0.62em per glyph; sentence case is narrower.
  const perChar = (opts.uppercase === false ? 0.52 : 0.62) + tracking;
  const max = base * grow;
  // `min` lets a template keep its own floor (Logo First clamps unbroken
  // titles harder than fitTitle does).
  const min = Math.min(opts.min ?? fitTitle(base, s), max);
  const budget = (s.length * perChar).toFixed(2);
  // HEIGHT-NEUTRAL: the line box stays the size the old fixed title had, so a
  // grown title cannot push anything below it — Logo First stacks its QR under
  // this text in normal flow, and three extra pixels put the QR off the card
  // (caught by card-detail-fit). Uppercase titles have no descenders, so larger
  // glyphs sit comfortably in the same box.
  return {
    fontSize: `clamp(${min.toFixed(2)}px, calc((100cqw - ${pad}px) / ${budget}), ${max.toFixed(2)}px)`,
    lineHeight: `${(min * 1.3).toFixed(2)}px`,
  };
}

/** The wrapper a fluid title (or company name) measures itself against. */
export const titleBox: React.CSSProperties = { containerType: "inline-size" };

export function fitTitle(base: number, title: string | null | undefined): number {
  // Two lines allowed (titleLoad already reserves the room), with a readable
  // floor: "SENIOR VICE PRESIDENT, COMMERCIAL LEASING" rendered at ~5px.
  return Math.max(base * TITLE_FLOOR, fitPx(base, title, TITLE_COMFY * 2));
}

// QR stays on the card at every density — it grows on sparse cards (more
// scannable from further away) and gives up a little room when packed.
export function qrSize(f: number): number {
  return f >= 1.12 ? 74 : f >= 1 ? 66 : f >= 0.85 ? 60 : 54;
}

// Last-resort safety valve: past the point where shrinking text can absorb the
// info, the card itself gets slightly taller (smaller width:height ratio) so
// nothing is EVER cut off — not the QR, not a single row. Stacked layouts
// (header on top, e.g. LocalBusiness) have less vertical room for contacts,
// so they pass a lower threshold to start growing earlier.
export function cardAspect(data: CardData, threshold = 7): string {
  const rows = contactRowCount(data);
  if (rows <= threshold) return "1.75 / 1";
  // 0.10 per row past the threshold, floored at 1.25.
  //
  // RE-CALIBRATED 2026-09-20, because the old 0.06/1.35 had never been measured
  // against a card that was actually full. The fullest card the product allows
  // — four labelled phones, a fax, a four-line address, an email long enough to
  // wrap and a 70-character title, about 11.5 rows — came out at 1.48, and the
  // QR then sat 40px BELOW the bottom edge on Photo First and Logo First while
  // the address ran 2–3px past it on Local Business. The floor was part of it:
  // that card needs roughly 1.31, which the old 1.35 forbade outright.
  //
  // This is the valve of last resort, and it only opens past `threshold` rows,
  // so no card that fits today changes shape by a pixel.
  const ratio = Math.max(1.25, 1.75 - (rows - threshold) * 0.1);
  return `${ratio.toFixed(3)} / 1`;
}

// ─── Shared contact block ────────────────────────────────────────────────────
// One renderer for the contact rows on EVERY template, so the type hierarchy is
// identical and even across designs: phone (largest, bold) → email → website →
// fax → address (smallest). Templates keep their character via the palette.

// ── Details start at the top and fill downward ───────────────────────────────
//
// Owner, 2026-09-18: "I only put my phone number on it. For some reason my
// phone number is on the bottom of the card... It should normally start filling
// from the top and then go down as you go."
//
// Four templates laid their details column out as `justify-between` over
// [header, details, QR], so the details block sat wherever the spare height put
// it: mid-column on Photo First, Luxury Minimal and Logo First, and at the very
// BOTTOM on Local Business (two children, so "between" means "last"). A full
// card hid it, because a full card has no spare height to distribute.
//
// The rule now, on every template: the details block follows the header after
// DetailsGap (the QR sits in the details block's own corner — ContactRows,
// 2026-10-05). The gap is a flex item with an enormous shrink factor and no
// content, so on a packed card it collapses to nothing BEFORE anything else is
// squeezed — it can never be
// the reason a detail row is cut off, which the old zero-when-full spacing
// guaranteed and this must keep guaranteeing (card-detail-fit.test.ts).
export function DetailsGap({ f }: { f: number }) {
  return <div aria-hidden style={{ flex: `0 1000 ${Math.round(9 * Math.min(f, 1.15))}px`, minHeight: 0 }} />;
}

export type RowPalette = {
  accent?: string;      // icon color; omit to have icons inherit each row's text color
  strong: string;       // phone numbers
  mid: string;          // email
  soft: string;         // website + fax
  muted: string;        // address
  phoneWeight?: number; // default 700; refined templates can use 600
};

// ── The details block fills the space it is given ────────────────────────────
//
// Owner, 2026-09-22: "card detail information … has to fit the space and
// maximize it as much as it could without cutting anything out … utilize all
// the space without words shifting, anything being cut off the card, anything
// overlapping anything else, or anything cut off by the QR."
//
// The block used to size itself from a guess: a row COUNT fed a growth curve
// (contactScale) that had to be safe for the tightest template and the busiest
// header, so it stopped growing at 4.5 rows. Measured on a fresh card — phone,
// email, website and an address — the phone was 14.5px on every template while
// 18–25px fitted; the real ceiling at a given row count varied 2x with the mix
// of rows and what sat above them, which no single curve can know.
//
// Now each template hands the block the space it actually has (a flex item
// that takes whatever the header and the QR leave), and the block is a CSS size
// container. Every row is sized in CSS as the smallest of three things:
//
//   1. its share of the block's HEIGHT (100cqh ÷ the rows' line budget, below)
//   2. what fits its own line across the block's WIDTH (100cqw ÷ measured ems)
//   3. the design ceiling, DETAIL_MAX_PX, so a lone phone is not a billboard
//
// Resolved by the browser at layout time — no measuring script, so nothing
// jumps after load, and it is exact for every template, typeface and content
// mix instead of calibrated for the worst one. Each row is also capped just
// under the row above it (phone ≥ email > website/address), which is how the
// hierarchy holds when one row is held back by its width.
// tests/render/card-fit-sweep.test.ts proves nothing clips or overlaps, and
// tests/render/card-detail-fill.test.ts proves the block actually fills.

/** The phone number on the roomiest card. Name-sized, not headline-sized. */
const DETAIL_MAX_PX = 24;
/** Line height every row is laid out at, so the height budget is exact. */
const ROW_LH = 1.25;
const ADDR_LH = 1.3;
/** Space between rows, as a share of the phone size. */
const ROW_GAP_U = 0.3;
/** Each row's size relative to the phone's — the block's type hierarchy. */
const REL = { email: 0.86, web: 0.74, fax: 0.76, addr: 0.72 } as const;
/** Past these lengths a value is expected to wrap onto a second line. */
const EMAIL_WRAP_CHARS = 32;
const WEB_WRAP_CHARS = 36;
const ADDR_LINE_CHARS = 38;

/**
 * Each present row's size relative to the LEADING row on this card.
 *
 * The shares in REL order rows against each other; they are not a ceiling on a
 * row that has nothing above it. A card carrying only a website would otherwise
 * stop at 0.74 of the phone size it does not have — the same "looks small" with
 * most of the panel empty.
 */
export function detailShares(data: CardData) {
  const phones = cardPhones(data).length;
  const email = !!(data.email ?? "").trim();
  const web = !!(data.website ?? "").trim();
  const fax = !!cardFax(data);
  const addr = !!(data.address ?? "").trim();
  const lead = phones ? 1 : Math.max(email ? REL.email : 0, web ? REL.web : 0, fax ? REL.fax : 0, addr ? REL.addr : 0, 0.01);
  const k = 1 / lead;
  return { email: REL.email * k, web: REL.web * k, fax: REL.fax * k, addr: REL.addr * k };
}

/**
 * The block's height in LEAD-ROW units: the sum of every row's line box at its
 * share of the leading row's size, plus the gaps between rows. 100cqh divided
 * by this is the largest lead size at which the whole block still fits.
 */
export function detailLineBudget(data: CardData): number {
  const phones = cardPhones(data).length;
  const email = (data.email ?? "").trim();
  const web = (data.website ?? "").trim();
  const fax = cardFax(data);
  const addrLines = (data.address ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const addrRows = addrLines.reduce((n, l) => n + Math.max(1, Math.ceil(l.length / ADDR_LINE_CHARS)), 0);
  const rows = phones + (email ? 1 : 0) + (web ? 1 : 0) + (fax ? 1 : 0) + (addrLines.length ? 1 : 0);
  if (!rows) return 1;
  const rel = detailShares(data);
  return (
    phones * ROW_LH +
    (email ? rel.email * ROW_LH * (email.length > EMAIL_WRAP_CHARS ? 2 : 1) : 0) +
    (web ? rel.web * ROW_LH * (web.length > WEB_WRAP_CHARS ? 2 : 1) : 0) +
    (fax ? rel.fax * ROW_LH : 0) +
    rel.addr * ADDR_LH * addrRows +
    (rows - 1) * ROW_GAP_U
  );
}

/**
 * The QR as the details block's bottom-right corner (owner, 2026-10-02: "use
 * the space beside the QR"). Passed by templates whose QR used to sit on a row
 * of its own under the details, which left the whole width beside it empty.
 * The block now runs to the bottom of the column, the QR is floated into its
 * corner, and rows flow down the full height — a row that reaches the corner
 * is narrowed to pass beside it (a flex row is its own formatting context, so
 * it never runs underneath a float). The QR's position and size are unchanged.
 */
export type DetailsQR = { node: React.ReactNode; size: number };
/** Clear space kept between the QR and any row beside or above it. */
const QR_CLEAR_PX = 8;

export function ContactRows({ data, palette, qr }: { data: CardData; palette: RowPalette; qr?: DetailsQR }) {
  const ic = (rowColor: string) => ({ color: palette.accent ?? rowColor });
  const phones = cardPhones(data);
  const fax = cardFax(data);
  const fontClass = cardFontClass(data);
  // Average advance per character for the email/website/address rows: serif and
  // monospace faces run wider than the default sans, and under-estimating them
  // wrapped short emails mid-address.
  const perChar = fontClass === "mono" ? 0.68 : fontClass === "serif" ? 0.63 : 0.58;

  // The phone size the block's HEIGHT allows (1 above), capped by design (3).
  // `--sc-u` is resolved where it is USED, so 100cqh is always this block's
  // height: the root below is the nearest size container for every row.
  //
  // With the QR in the block's corner, rows are still SIZED for the height
  // above it — exactly as when the QR had a row of its own, so a card that fit
  // before looks the same. The space beside the QR is the room a packed card
  // flows into when its rows reach their floor sizes, instead of running onto
  // the QR (Photo First, every field at the limits — card-every-template).
  // Sizing them for the full height failed the other way: rows narrowed beside
  // the QR wrapped onto lines the budget never paid for and left the card.
  const qrCorner = qr ? qr.size + QR_CLEAR_PX : 0;
  const unit = `min(${DETAIL_MAX_PX}px, calc((100cqh - ${2 + qrCorner}px) / ${detailLineBudget(data).toFixed(3)}))`;
  const rel = detailShares(data);
  const u = (k: number) => `calc(${k} * var(--sc-u))`;
  /** What fits one line across the block (2): chrome px, then ems of text. */
  const across = (chromePx: number, ems: number) => `calc((100cqw - ${chromePx}px) / ${Math.max(0.1, ems).toFixed(2)})`;

  // Em budget for one phone row: the number, plus the label at its fixed share
  // of the number's size, plus the gap between them. See PHONE_W above for why
  // this is measured per typeface rather than counted in characters.
  const phoneBudget = (p: ShownPhone) =>
    phoneEm(formatPhone(p.number), fontClass)
    + (p.label ? phoneLabelEm(p.label, fontClass, 0.05) * PHONE_LABEL_RATIO + PHONE_LABEL_GAP_EM : 0);
  // Below the floor the LABEL wraps under the number rather than being cut.
  const phoneSize = (p: ShownPhone) =>
    `max(${PHONE_FLOOR_PX}px, min(var(--sc-u), ${across(ROW_CHROME_PX, phoneBudget(p))}))`;
  // Each row is capped just under the one above it, in CSS, because the row
  // above resolves at paint time and may be held back by its own width.
  const under = (v: string) => `calc(0.92 * var(${v}))`;
  const email = (data.email ?? "").trim();
  const web = (data.website ?? "").trim();
  const emailSize = `max(10px, min(${u(rel.email)}, ${across(24, Math.min(email.length, 60) * perChar)}${phones.length ? ", var(--sc-p)" : ""}))`;
  const webSize = `max(9.5px, min(${u(rel.web)}, ${across(24, Math.min(web.length, 60) * perChar * 0.96)}${
    email ? `, ${under("--sc-e")}` : phones.length ? `, ${under("--sc-p")}` : ""}))`;
  const faxSize = `max(8.5px, min(${u(rel.fax)}, ${across(ROW_CHROME_PX, phoneEm(formatPhone(fax), fontClass) + 2.2)}${
    phones.length ? `, ${under("--sc-p")}` : ""}))`;
  const addrLongest = Math.min(ADDR_LINE_CHARS,
    Math.max(1, ...(data.address ?? "").split("\n").map((l) => l.trim().length)));
  const addrSize = `max(8.5px, min(${u(rel.addr)}, ${across(22, addrLongest * perChar * 0.95)}${
    email ? `, ${under("--sc-e")}` : ""}${phones.length ? `, ${under("--sc-p")}` : ""}))`;

  // Every row is a flex child, so it needs min-w-0 to be allowed to shrink below
  // its content width. Without it a flex item's automatic minimum size is its
  // content, and a long value pushes the row wider than the card instead of
  // being contained — the mechanism behind the phone and email overhangs.
  const row = "flex items-center gap-2 min-w-0";

  // Long values wrap rather than overhang. `anywhere` (not `break-word`) is what
  // lets an unbroken 67-character email split at all — it has no spaces, so
  // normal wrapping has nowhere to break and the text just leaves the card.
  const wrapLong: React.CSSProperties = { overflowWrap: "anywhere", minWidth: 0 };

  // With the QR in the corner the rows are blocks beside a float, not flex
  // items (a float cannot sit in a flex column), so the gap becomes a margin.
  let rowIndex = 0;
  const rowGap = (): React.CSSProperties => (qr && rowIndex++ > 0 ? { marginTop: u(ROW_GAP_U) } : {});
  const corner = qrCorner;

  const vars = {
    "--sc-u": unit,
    ...(phones.length ? { "--sc-p": phoneSize(phones[0]) } : {}),
    ...(email ? { "--sc-e": emailSize } : {}),
  } as React.CSSProperties;

  return (
    // The size container: it takes the height its template leaves it (flex
    // 1 1 0 — never its content's height, which size containment ignores) and
    // the column's width. 100cqh / 100cqw inside are exactly that box.
    <div data-contact-block style={{ flex: "1 1 0", minHeight: 0, minWidth: 0, alignSelf: "stretch", containerType: "size" }}>
      <div className={qr ? undefined : "flex flex-col"} style={{ ...vars, ...(qr ? { height: "100cqh" } : { gap: u(ROW_GAP_U) }), lineHeight: ROW_LH }}>
        {qr && (
          <>
            {/* A zero-width float as tall as the block less the corner pushes
                the QR's float down into the bottom-right corner. */}
            {/* 100cqh, NOT 100%: a percentage height inside this flex item
                does not resolve in WebKit (the iPhone app and Safari), so the
                spacer collapsed to nothing, the QR floated to the TOP, and
                every row was squeezed beside it — "MOBILE" dropped under the
                number and the email wrapped (owner, 2026-10-05, Photo First).
                The block is a size container, so 100cqh is its height in
                every engine — the same unit the rows are sized with. */}
            <div aria-hidden style={{ float: "right", width: 0, height: `calc(100cqh - ${corner}px)` }} />
            <div style={{ float: "right", clear: "right", width: corner, height: corner, display: "flex", alignItems: "flex-end", justifyContent: "flex-end" }}>
              {qr.node}
            </div>
          </>
        )}
        {phones.map((p, i) => (
          <a key={`ph${i}`} href={`tel:${p.number.replace(/[^\d+]/g, "")}`} className={row} style={{ color: palette.strong, textDecoration: "none", ...rowGap() }}>
            <span className="shrink-0" style={ic(palette.strong)}><IcoPhone /></span>
            {/* The number and its label are budgeted TOGETHER against the panel's
                real width (phoneBudget above). Sizing the number alone by a
                character count is what put "MOBILE" off the edge of the card. */}
            <span
              style={{
                fontSize: i === 0 ? "var(--sc-p)" : phoneSize(p),
                fontWeight: palette.phoneWeight ?? 700,
                // Wrapping is the safety valve, not the normal case: past the
                // floor the LABEL drops under the number rather than being cut.
                display: "flex", flexWrap: "wrap", alignItems: "baseline",
                columnGap: `${PHONE_LABEL_GAP_EM}em`, minWidth: 0,
              }}
            >
              <span style={{ whiteSpace: "nowrap" }}>{formatPhone(p.number)}</span>
              {p.label && (
                // `em`, so the label tracks the number instead of sitting at a
                // fixed size while the number changed underneath it.
                <span style={{ fontWeight: 400, opacity: 0.5, fontSize: `${PHONE_LABEL_RATIO}em`, textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{p.label}</span>
              )}
            </span>
          </a>
        ))}
        {/* Email + website: sized so they normally sit on one line, and allowed
            to wrap when they're past what the floor can hold. */}
        {email && (
          <a href={`mailto:${data.email}`} className={row} style={{ color: palette.mid, textDecoration: "none", ...rowGap() }}>
            <span className="shrink-0" style={ic(palette.mid)}><IcoMail /></span>
            <span style={{ fontSize: "var(--sc-e)", fontWeight: 600, ...wrapLong }}>{data.email}</span>
          </a>
        )}
        {web && (
          <a href={webHref(data.website ?? "")} target="_blank" rel="noopener noreferrer" className={row} style={{ color: palette.soft, textDecoration: "none", ...rowGap() }}>
            <span className="shrink-0" style={ic(palette.soft)}><IcoGlobe /></span>
            <span style={{ fontSize: webSize, fontWeight: 500, ...wrapLong }}>{data.website}</span>
          </a>
        )}
        {fax && (
          <div className="flex items-center gap-2 min-w-0" style={{ color: palette.soft, ...rowGap() }}>
            <span className="shrink-0" style={ic(palette.soft)}><IcoPhone /></span>
            <span style={{ fontSize: faxSize, fontWeight: 500, whiteSpace: "nowrap" }}>
              {formatPhone(fax)}
              <span style={{ opacity: 0.6, marginLeft: "0.45em", fontSize: "0.77em", textTransform: "uppercase", letterSpacing: "0.05em" }}>Fax</span>
            </span>
          </div>
        )}
        {data.address && (
          <div className="flex items-start gap-2 min-w-0" style={{ color: palette.muted, ...rowGap() }}>
            <span className="shrink-0" style={{ ...ic(palette.muted), marginTop: 1 }}><IcoPin /></span>
            <span style={{ fontSize: addrSize, lineHeight: ADDR_LH, whiteSpace: "pre-line", ...wrapLong }}>{data.address}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Contact Icons (stroke style) ────────────────────────────────────────────

export const IcoPhone = () => (
  <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
  </svg>
);

export const IcoMail = () => (
  <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25H4.5a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5H4.5a2.25 2.25 0 00-2.25 2.25m19.5 0l-9.75 6.75L2.25 6.75" />
  </svg>
);

export const IcoGlobe = () => (
  <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582" />
  </svg>
);

export const IcoPin = () => (
  <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
  </svg>
);

// ─── Social Icons (fill style) ────────────────────────────────────────────────

export const IcoLinkedIn = () => (
  <svg className="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 24 24">
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
  </svg>
);

export const IcoInsta = () => (
  <svg className="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 24 24">
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
  </svg>
);

export const IcoX = () => (
  <svg className="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 24 24">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.742l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

export const IcoTikTok = () => (
  <svg className="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 24 24">
    <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.76a8.16 8.16 0 004.77 1.52V6.83a4.85 4.85 0 01-1-.14z" />
  </svg>
);
