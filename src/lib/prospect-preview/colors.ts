// ── Card Builder: brand colours read from a logo ────────────────────────────
// Pure: given a logo's pixels, pick the colour the brand is drawn in and a
// second one to use as the accent. Tested without an image library
// (tests/prospect-preview-fields.test.ts); the fetching and decoding live in
// colors-server.ts.
//
// How: pixels are grouped into coarse buckets (16 steps per channel). White and
// see-through pixels are the paper, not the brand, so they are skipped. The
// winner is the bucket that is both common and colourful: a logo that is 70%
// charcoal lettering and 30% a red mark is a red brand. The accent is the next
// bucket that is clearly a different colour; with none, white.

export type BrandColors = { primary: string; secondary: string };

const hex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase();

function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/**
 * @param rgba  raw pixels, 4 bytes each (red, green, blue, alpha)
 * @returns null when the picture has nothing but paper in it
 */
export function pickBrandColors(rgba: Uint8Array | Uint8ClampedArray): BrandColors | null {
  type Bucket = { n: number; r: number; g: number; b: number };
  const buckets = new Map<number, Bucket>();
  let counted = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], a = rgba[i + 3];
    if (a < 128) continue;
    if (r > 235 && g > 235 && b > 235) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const at = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    at.n++; at.r += r; at.g += g; at.b += b;
    buckets.set(key, at);
    counted++;
  }
  if (!counted) return null;

  const ranked = [...buckets.values()]
    .map((k) => ({ n: k.n, r: k.r / k.n, g: k.g / k.n, b: k.b / k.n }))
    .map((k) => ({ ...k, score: k.n * (0.25 + saturation(k.r, k.g, k.b)) }))
    .sort((x, y) => y.score - x.score);
  const first = ranked[0];
  const far = (k: { r: number; g: number; b: number }) => Math.hypot(k.r - first.r, k.g - first.g, k.b - first.b) > 90;
  const second = ranked.find((k) => far(k) && k.n >= counted * 0.03);
  return { primary: hex(first.r, first.g, first.b), secondary: second ? hex(second.r, second.g, second.b) : "#FFFFFF" };
}

/** `<meta name="theme-color" content="#0b3d2e">` in a page's HTML, as #RRGGBB. */
export function themeColorIn(html: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/name\s*=\s*["']?theme-color["']?/i.test(tag)) continue;
    const m = /content\s*=\s*["']?\s*(#[0-9a-f]{3}|#[0-9a-f]{6})\b/i.exec(tag);
    if (!m) continue;
    const v = m[1].length === 4 ? "#" + [...m[1].slice(1)].map((c) => c + c).join("") : m[1];
    if (!/^#f{6}$/i.test(v)) return v.toUpperCase();
  }
  return null;
}

// ── Reading against a ground (2026-11-13) ───────────────────────────────────
// Two things on a preview card sit directly on the prospect's brand colour:
// the small title line (drawn in their second colour) and their logo. Both
// vanished on real cards: teal on CMG's green, and Realty Collective's
// light-blue mark on a light-blue card. These answer "can it be read?" with
// the WCAG contrast ratio, which (unlike a brightness gap) is right for two
// colours of similar lightness and different hue.

const parse = (hexColor: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hexColor.trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
};

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(r: number, g: number, b: number): number {
  const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio of two #RRGGBB colours, 1 (the same) to 21. 1 when either can't be read. */
export function contrast(a: string, b: string): number {
  const x = parse(a), y = parse(b);
  if (!x || !y) return 1;
  const la = luminance(...x), lb = luminance(...y);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Small text needs 4.5:1 (WCAG AA). */
export const TEXT_CONTRAST = 4.5;

/**
 * `color`, made readable on `ground`: kept as it is when it already reads, and
 * otherwise pushed along its own hue toward black or white (whichever the
 * ground allows) until it does. They get their teal, at a teal that can be seen.
 */
export function readableOn(ground: string, color: string, min: number = TEXT_CONTRAST): string {
  const g = parse(ground), c = parse(color);
  if (!g) return color;
  const best = contrast(ground, "#000000") >= contrast(ground, "#FFFFFF") ? 0 : 255;
  if (!c) return best ? "#FFFFFF" : "#000000";
  let [r, gr, b] = c;
  for (let i = 0; i < 24; i++) {
    const now = hex(r, gr, b);
    if (contrast(ground, now) >= min) return now;
    r += (best - r) * 0.14; gr += (best - gr) * 0.14; b += (best - b) * 0.14;
  }
  return best ? "#FFFFFF" : "#000000";
}

/** A logo colour this close to the card's colour can't be told from it. */
export const LOGO_BLEND_CONTRAST = 1.35;
/** How much of a see-through logo may blend into the card before it gets a plate behind it. */
export const LOGO_BLEND_SHARE = 0.4;
const PLATES = ["#FFFFFF", "#141B26"] as const;

/**
 * Does a see-through logo disappear on this card colour, and if so, what
 * should go behind it? Returns the plate's colour, or null when the logo reads
 * as it is.
 *
 * A logo blends when a large share of its visible pixels are within a whisker
 * of the card's colour (their brand colour is, after all, usually read FROM
 * the logo). The plate is white or near-black, whichever leaves the logo's
 * own main colours most readable: the worst-reading one decides.
 *
 * @param rgba  raw pixels, 4 bytes each
 */
export function logoPlate(rgba: Uint8Array | Uint8ClampedArray, ground: string): string | null {
  const g = parse(ground);
  if (!g) return null;
  const lg = luminance(...g);
  const ratio = (la: number, lb: number) => (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  type Bucket = { n: number; r: number; g: number; b: number };
  const buckets = new Map<number, Bucket>();
  let seen = 0, blending = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    const r = rgba[i], gr = rgba[i + 1], b = rgba[i + 2];
    seen++;
    if (ratio(luminance(r, gr, b), lg) < LOGO_BLEND_CONTRAST && Math.hypot(r - g[0], gr - g[1], b - g[2]) < 70) blending++;
    const key = ((r >> 4) << 8) | ((gr >> 4) << 4) | (b >> 4);
    const at = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    at.n++; at.r += r; at.g += gr; at.b += b;
    buckets.set(key, at);
  }
  if (!seen || blending / seen < LOGO_BLEND_SHARE) return null;
  const main = [...buckets.values()].filter((k) => k.n >= seen * 0.08).map((k) => luminance(k.r / k.n, k.g / k.n, k.b / k.n));
  if (!main.length) return null;
  const worst = (plate: string) => { const p = parse(plate)!; const lp = luminance(...p); return Math.min(...main.map((l) => ratio(l, lp))); };
  return [...PLATES].sort((a, b) => worst(b) - worst(a))[0];
}
