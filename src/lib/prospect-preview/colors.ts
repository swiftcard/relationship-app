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
