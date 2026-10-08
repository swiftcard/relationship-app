// ── Find the card in a photo and lay it flat ────────────────────────────────
//
// "Copy a card or template you like" is mostly used on a photo of the owner's
// OWN paper card — on a desk, a little tilted, with the table around it. Handed
// to the image model like that, the model edits the PHOTO: the tilt, the desk,
// the paper grain and the warm lamp light all survive onto the "copy" (owner,
// 2026-10-06: "it shouldn't copy the actual paper card and just put the details
// on it"). So before anything is redrawn, a vision pass finds the card's four
// corners and we warp it to a straight-on rectangle ourselves. Every engine
// downstream (the redraw, the artwork strip, the layout measure, scan-design)
// then sees the card's design and nothing else — however loosely it was shot.
//
// sharp has no perspective warp, so the homography + bilinear sample live
// here. Pure functions are exported for tests; prepareCardImage is the one
// the routes call, and it never throws — any failure hands back the original.

import { aiVision } from "@/lib/ai";

export type Pt = [number, number];

/** Asked of the vision model. Corners in PERCENT of the image.
 *
 *  Corners are asked for in EVERY case (2026-10-08). A flat design used to pass
 *  through whole, and a template screenshot is rarely just the card: a mockup
 *  on a grey backdrop with a drop shadow, a web page with the card in the
 *  middle, a Pinterest tile with two cards and a caption. All of that was
 *  copied as if it were the card — "it uses the whole picture as the card". */
export const LOCATE_CARD_PROMPT = [
  "Look at this image. Is it a PHOTOGRAPH of a physical business card (paper or",
  "plastic, lying on something, held, at any angle), or is it already a FLAT",
  "digital design (a screenshot, an exported template, a mockup, a scan)?",
  "",
  "Return ONLY valid JSON:",
  '{"kind":"photo_of_physical_card"|"flat_design",',
  ' "corners":[[x,y],[x,y],[x,y],[x,y]]}',
  "",
  "corners = the four corners of ONE business card's face — the card's own outer",
  "edge, where the card ends and whatever is around it begins (a table, a hand,",
  "a mockup backdrop, a drop shadow, a web page, white margin, a caption) — as",
  "PERCENT of the image width (x) and height (y), 0-100, in order: top-left,",
  "top-right, bottom-right, bottom-left. For a rounded corner, give where the two",
  "straight edges would meet. If several cards are visible, use the one that is",
  "largest and most in focus (for a front-and-back pair, the FRONT: the side with",
  "the name). Do NOT trace a panel, a photo or a logo inside the card — only the",
  "card's full face. If the card fills the whole image exactly, return",
  "[[0,0],[100,0],[100,100],[0,100]]. Always give corners.",
].join("\n");

/** A 3×3 projective transform (row-major, h[8] = 1) mapping `from[i]` → `to[i]`. */
export function homography(from: Pt[], to: Pt[]): number[] | null {
  if (from.length !== 4 || to.length !== 4) return null;
  // Eight equations, eight unknowns (h0..h7), solved by Gaussian elimination.
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i];
    const [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-10) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k];
    }
  }
  const h = A.map((row, i) => row[n] / row[i]);
  return [...h, 1];
}

export function applyHomography(h: number[], x: number, y: number): Pt {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * Model reading → four corners in PIXELS, ordered TL, TR, BR, BL — or null
 * when the reading is unusable (not four points, not convex, too small) or
 * there is nothing to crop (a card that already fills a straight frame).
 * Whitelist + reorder: the model's own order is not trusted.
 *
 * Both kinds are cropped now: a photo is warped flat, and a flat design with
 * anything around the card (mockup, margins, a page) is cut to the card.
 */
export function cardQuadFromScan(raw: unknown, imgW: number, imgH: number): Pt[] | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { kind?: unknown; corners?: unknown };
  if (r.kind !== "photo_of_physical_card" && r.kind !== "flat_design") return null;
  return quadFromCorners(r.corners, imgW, imgH);
}

/** Share of the image the quad covers, 0-1 (shoelace). */
export function quadCoverage(q: Pt[], imgW: number, imgH: number): number {
  let area = 0;
  for (let i = 0; i < 4; i++) area += q[i][0] * q[(i + 1) % 4][1] - q[(i + 1) % 4][0] * q[i][1];
  return Math.abs(area) / 2 / (imgW * imgH);
}

/**
 * Four percent corners (any order) → the pixel quad to crop to, or null when
 * the corners are junk, the region is a speck, or it already IS the frame.
 * Shared by the source read above and the output check in lib/design-transfer
 * (a generated card drawn small on a backdrop is cropped the same way).
 */
export function quadFromCorners(corners: unknown, imgW: number, imgH: number): Pt[] | null {
  if (!Array.isArray(corners) || corners.length !== 4) return null;
  const pts: Pt[] = [];
  for (const c of corners) {
    if (!Array.isArray(c) || c.length < 2) return null;
    const [x, y] = c;
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    // A corner may sit a hair outside the frame (a card cut off by the
    // photo's edge); further than that is a misreading.
    if (x < -5 || x > 105 || y < -5 || y > 105) return null;
    pts.push([(Math.min(100, Math.max(0, x)) / 100) * imgW, (Math.min(100, Math.max(0, y)) / 100) * imgH]);
  }
  // Re-order clockwise around the centroid (image y points down), starting
  // from the corner nearest the image's top-left.
  const cx = pts.reduce((s, p) => s + p[0], 0) / 4;
  const cy = pts.reduce((s, p) => s + p[1], 0) / 4;
  pts.sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  let start = 0;
  for (let i = 1; i < 4; i++) if (pts[i][0] + pts[i][1] < pts[start][0] + pts[start][1]) start = i;
  const q = [0, 1, 2, 3].map((i) => pts[(start + i) % 4]);

  // Convex, non-degenerate: every turn the same way.
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-6) return null;
    const s = Math.sign(cross);
    if (sign && s !== sign) return null;
    sign = s;
  }
  // A card that is a speck in the photo is a misreading (or too small to copy
  // from anyway).
  if (quadCoverage(q, imgW, imgH) < 0.12) return null;
  // Already flat and filling the frame (a scan, a camera crop that landed
  // well): nothing to straighten — warping would only soften it.
  const slack = Math.max(imgW, imgH) * 0.025;
  const frame: Pt[] = [[0, 0], [imgW, 0], [imgW, imgH], [0, imgH]];
  if (q.every((p, i) => dist(p, frame[i]) <= slack)) return null;
  return q;
}

/** Output size for a quad: its own measured proportions (clamped to real card
 *  shapes), long side 1400. A vertical card stays vertical. */
export function flatSize(q: Pt[]): { w: number; h: number } {
  const w = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
  const h = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  const portrait = h > w;
  const ratio = Math.min(2, Math.max(1.4, portrait ? h / w : w / h));
  const long = 1400, short = Math.round(long / ratio);
  return portrait ? { w: short, h: long } : { w: long, h: short };
}

/** Inverse-map every output pixel into the source quad, bilinear sampled. */
export function warpQuad(
  src: Uint8Array, srcW: number, srcH: number, channels: number,
  quad: Pt[], outW: number, outH: number,
): Uint8Array | null {
  const h = homography([[0, 0], [outW, 0], [outW, outH], [0, outH]], quad);
  if (!h) return null;
  const out = new Uint8Array(outW * outH * channels);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const [sx, sy] = applyHomography(h, x + 0.5, y + 0.5);
      const fx = Math.min(srcW - 1.001, Math.max(0, sx - 0.5));
      const fy = Math.min(srcH - 1.001, Math.max(0, sy - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const ax = fx - x0, ay = fy - y0;
      const i00 = (y0 * srcW + x0) * channels, i10 = i00 + channels;
      const i01 = i00 + srcW * channels, i11 = i01 + channels;
      const o = (y * outW + x) * channels;
      for (let c = 0; c < channels; c++) {
        const top = src[i00 + c] + (src[i10 + c] - src[i00 + c]) * ax;
        const bot = src[i01 + c] + (src[i11 + c] - src[i01 + c]) * ax;
        out[o + c] = Math.round(top + (bot - top) * ay);
      }
    }
  }
  return out;
}

/**
 * Cut an image to a pixel quad, laid flat at the quad's own proportions
 * (flatSize). Works on any decodable image; alpha is dropped. Returns null when
 * the warp is degenerate. Used on the source upload AND on every generated
 * card, which the image model likes to draw small on a backdrop.
 */
export async function cropToQuad(image: Buffer, quad: Pt[], format: "jpeg" | "png"): Promise<Buffer | null> {
  const sharp = (await import("sharp")).default;
  const raw = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { w, h } = flatSize(quad);
  const flat = warpQuad(raw.data, raw.info.width, raw.info.height, raw.info.channels, quad, w, h);
  if (!flat) return null;
  const out = sharp(Buffer.from(flat), { raw: { width: w, height: h, channels: raw.info.channels as 3 } });
  return format === "png" ? out.png().toBuffer() : out.jpeg({ quality: 90 }).toBuffer();
}

/**
 * The routes' entry point. Returns the card cut out and laid flat as a JPEG
 * whenever the image holds more than the card (a photo of a card on a desk, a
 * mockup, a page with the card in it), otherwise the image unchanged. Never
 * throws.
 */
export async function prepareCardImage(
  imageBase64: string,
  mediaType: string,
): Promise<{ imageBase64: string; mediaType: string; flattened: boolean }> {
  const unchanged = { imageBase64, mediaType, flattened: false };
  try {
    const sharp = (await import("sharp")).default;
    // One upright, EXIF-free copy, so the pixels we warp are exactly the
    // pixels the vision model measured.
    const upright = await sharp(Buffer.from(imageBase64, "base64"))
      .rotate()
      .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .removeAlpha()
      .jpeg({ quality: 90 })
      .toBuffer({ resolveWithObject: true });
    const b64 = upright.data.toString("base64");
    const reading = await aiVision({ imageBase64: b64, mediaType: "image/jpeg", prompt: LOCATE_CARD_PROMPT, json: true, maxTokens: 300 });
    const m = reading?.match(/\{[\s\S]*\}/);
    let quad: Pt[] | null = null;
    try { quad = m ? cardQuadFromScan(JSON.parse(m[0]), upright.info.width, upright.info.height) : null; } catch { quad = null; }
    if (!quad) return unchanged;
    const jpeg = await cropToQuad(upright.data, quad, "jpeg");
    if (!jpeg) return unchanged;
    return { imageBase64: jpeg.toString("base64"), mediaType: "image/jpeg", flattened: true };
  } catch (e) {
    console.error("[card-flatten] failed, using the original image:", e);
    return unchanged;
  }
}
