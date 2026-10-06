// Live "is the business card in the frame?" check for the scanner camera
// (components/CardScanCamera). Pure — no DOM — so it is unit-tested on
// synthetic frames (tests/card-frame-detect.test.ts).
//
// Why it exists: the scanner used to hand off to the phone's own camera, which
// we cannot draw on. People shot the card from across the table, the card was a
// sliver of a 4000px photo, and the read was slow and wrong. Now the camera is
// ours: a card-shaped frame on screen, "Move closer" when the card is small in
// it, and the frame turns green — and snaps on its own once steady — when the
// card fills it (owner, 2026-10-06).
//
// How: every ~100ms the camera draws the frame area (plus a margin) into a small
// ANALYSIS_W × ANALYSIS_H canvas. A card's edge is a long straight line of
// contrast. For each side of the frame we walk along it and, at every step,
// find the strongest edge across a band around where that side is. A real card
// edge is CONTINUOUS — neighbouring steps find it at almost the same depth with
// the same light/dark direction. Text, a logo or wood grain inside the band
// gives hits that jump around and flip direction, so it scores low. The share of
// continuous steps is that side's coverage, 0–1.

/** Standard card proportions (US 3.5×2in, EU 85×55mm sit either side). */
export const CARD_ASPECT = 1.75;

/** The frame, as drawn into the analysis canvas. */
export const ANALYSIS_GUIDE_W = 200;
export const ANALYSIS_GUIDE_H = Math.round(ANALYSIS_GUIDE_W / CARD_ASPECT); // 114
/** Room around the frame, so an edge just outside it is still seen. */
export const ANALYSIS_MARGIN = 22;
export const ANALYSIS_W = ANALYSIS_GUIDE_W + ANALYSIS_MARGIN * 2; // 244
export const ANALYSIS_H = ANALYSIS_GUIDE_H + ANALYSIS_MARGIN * 2; // 158

/** How far (px, analysis scale) a card edge may sit from the frame line and still "fit". ±11% of the frame height. */
const BAND = 13;
/** Sobel response that counts as an edge — a step of ~10 grey levels. */
const EDGE_MIN = 40;
/** Ignore the ends of each side: corners are where rounded cards and fingers are. */
const SIDE_INSET = 0.15;
/** How deep inside the frame to look for a card that is too far away. */
const INSIDE_DEPTH = 0.42;

/** Mean grey-level change per pixel between frames below which the phone counts as held still. */
export const STEADY_MOTION = 7;
/** Green + still for this many checks in a row (~100ms apart) → take the photo. */
export const STEADY_FRAMES = 5;

export type FrameAnalysis = {
  /** Coverage of the frame's top, right, bottom, left edges (0–1). */
  sides: [number, number, number, number];
  /** The same measure for a card edge found well INSIDE the frame — a card that is too far away. */
  inside: [number, number, number, number];
  /** Mean absolute grey-level change from the previous frame (Infinity with none). */
  motion: number;
};

export type FrameState = "none" | "closer" | "fit";

/** RGBA (canvas ImageData) → one grey byte per pixel. */
export function toGray(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    // Integer Rec.601 luma.
    out[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  }
  return out;
}

/**
 * Score one analysis frame. `gray` is ANALYSIS_W × ANALYSIS_H unless w/h say
 * otherwise; the frame sits ANALYSIS_MARGIN in from every side.
 */
export function analyzeFrame(
  gray: ArrayLike<number>,
  prev?: ArrayLike<number> | null,
  w = ANALYSIS_W,
  h = ANALYSIS_H,
): FrameAnalysis {
  const x0 = ANALYSIS_MARGIN, y0 = ANALYSIS_MARGIN;
  const x1 = w - ANALYSIS_MARGIN, y1 = h - ANALYSIS_MARGIN;
  const gw = x1 - x0, gh = y1 - y0;

  // Sobel, signed, both directions.
  const gx = new Int16Array(w * h);
  const gy = new Int16Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = gray[i - w - 1], t = gray[i - w], tr = gray[i - w + 1];
      const l = gray[i - 1], r = gray[i + 1];
      const bl = gray[i + w - 1], b = gray[i + w], br = gray[i + w + 1];
      gx[i] = tr + 2 * r + br - tl - 2 * l - bl;
      gy[i] = bl + 2 * b + br - tl - 2 * t - tr;
    }
  }

  // Walk along a side; at each step take the strongest edge between depth
  // `from` and `to` (inclusive, perpendicular to the side), then score how
  // much of the walk is one continuous line.
  const scan = (horizontal: boolean, line: number[], from: number, to: number): number => {
    const lo = Math.max(1, Math.min(from, to));
    const hi = Math.min((horizontal ? h : w) - 2, Math.max(from, to));
    let good = 0;
    let lastPos = -1, lastSign = 0;
    for (const s of line) {
      let best = 0, pos = -1, sign = 0;
      for (let d = lo; d <= hi; d++) {
        const v = horizontal ? gy[d * w + s] : gx[s * w + d];
        const m = v < 0 ? -v : v;
        if (m > best) { best = m; pos = d; sign = v < 0 ? -1 : 1; }
      }
      const hit = best >= EDGE_MIN;
      // A step continues the line when it finds an edge at nearly the same
      // depth, with the same dark→light direction, as the step before it.
      if (hit && lastPos >= 0 && Math.abs(pos - lastPos) <= 2 && sign === lastSign) good++;
      lastPos = hit ? pos : -1;
      lastSign = hit ? sign : 0;
    }
    return line.length > 1 ? good / (line.length - 1) : 0;
  };

  const cols: number[] = [];
  for (let x = Math.round(x0 + gw * SIDE_INSET); x <= Math.round(x1 - gw * SIDE_INSET); x += 2) cols.push(x);
  const rows: number[] = [];
  for (let y = Math.round(y0 + gh * SIDE_INSET); y <= Math.round(y1 - gh * SIDE_INSET); y += 1) rows.push(y);

  const sides: [number, number, number, number] = [
    scan(true, cols, y0 - BAND, y0 + BAND),
    scan(false, rows, x1 - BAND, x1 + BAND),
    scan(true, cols, y1 - BAND, y1 + BAND),
    scan(false, rows, x0 - BAND, x0 + BAND),
  ];
  const inside: [number, number, number, number] = [
    scan(true, cols, y0 + BAND + 1, Math.round(y0 + gh * INSIDE_DEPTH)),
    scan(false, rows, Math.round(x1 - gw * INSIDE_DEPTH), x1 - BAND - 1),
    scan(true, cols, Math.round(y1 - gh * INSIDE_DEPTH), y1 - BAND - 1),
    scan(false, rows, x0 + BAND + 1, Math.round(x0 + gw * INSIDE_DEPTH)),
  ];

  let motion = Infinity;
  if (prev && prev.length === gray.length) {
    let sum = 0, n = 0;
    for (let y = y0; y < y1; y += 2) {
      for (let x = x0; x < x1; x += 2) {
        const i = y * w + x;
        sum += Math.abs(gray[i] - prev[i]);
        n++;
      }
    }
    motion = n ? sum / n : 0;
  }

  return { sides, inside, motion };
}

/**
 * Does the card fill the frame? Hysteresis on purpose: the bar to turn green is
 * higher than the bar to stay green, so a hand's tremor cannot make the frame
 * flicker. "Fits enough" (owner): three sides clearly found and the fourth at
 * least partly — a shadow or a matching table colour on one edge is normal.
 */
export function isFit(sides: readonly number[], wasFit: boolean): boolean {
  const [weakest, second] = [...sides].sort((a, b) => a - b);
  return wasFit
    ? weakest >= 0.15 && second >= 0.4
    : weakest >= 0.3 && second >= 0.55;
}

/** What to tell the person holding the phone. */
export function frameState(a: FrameAnalysis, fit: boolean): FrameState {
  if (fit) return "fit";
  // The card's own edges show up inside the frame on two or more sides →
  // it's there, just too far away.
  const insideSides = a.inside.filter((c, i) => c >= 0.4 && a.sides[i] < 0.3).length;
  return insideSides >= 2 ? "closer" : "none";
}

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Where the card frame sits on a screen of `w × h` CSS px. The camera controls
 * take the bottom ~150px and the title the top ~70px; the frame is centred a
 * little above the middle of what is left, as wide as comfortably fits.
 */
export function guideRect(w: number, h: number): Rect {
  const top = 72, bottom = 168;
  const room = Math.max(0, h - top - bottom);
  const gw = Math.max(0, Math.min(w * 0.84, 520, room * 0.8 * CARD_ASPECT));
  const gh = gw / CARD_ASPECT;
  return { x: (w - gw) / 2, y: top + (room - gh) * 0.42, w: gw, h: gh };
}

/**
 * Map a rectangle on screen to the camera's own pixels, for a <video> that
 * fills a `viewW × viewH` box with object-fit: cover. `mirrored` = the preview
 * is flipped (a front/desk camera), so screen-left is video-right.
 *
 * Returns a source rect CLAMPED to the video, plus where that clamped part
 * lands in a `dstW × dstH` destination — Safari draws nothing at all for a
 * drawImage() source rect that runs off the image, rather than clipping it.
 */
export function coverMap(
  rect: Rect,
  viewW: number, viewH: number,
  videoW: number, videoH: number,
  dstW: number, dstH: number,
  mirrored = false,
): { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number } | null {
  if (!viewW || !viewH || !videoW || !videoH || rect.w <= 0 || rect.h <= 0) return null;
  const scale = Math.max(viewW / videoW, viewH / videoH);
  const offX = (viewW - videoW * scale) / 2;
  const offY = (viewH - videoH * scale) / 2;
  let rx = (rect.x - offX) / scale;
  const ry = (rect.y - offY) / scale;
  const rw = rect.w / scale, rh = rect.h / scale;
  if (mirrored) rx = videoW - (rx + rw);

  const sx = Math.max(0, rx), sy = Math.max(0, ry);
  const ex = Math.min(videoW, rx + rw), ey = Math.min(videoH, ry + rh);
  if (ex <= sx || ey <= sy) return null;
  const kx = dstW / rw, ky = dstH / rh;
  return {
    sx, sy, sw: ex - sx, sh: ey - sy,
    dx: (sx - rx) * kx, dy: (sy - ry) * ky, dw: (ex - sx) * kx, dh: (ey - sy) * ky,
  };
}

/** The analysis region on screen: the frame plus the analysis margin, at the same proportions. */
export function analysisRect(guide: Rect): Rect {
  const mx = guide.w * (ANALYSIS_MARGIN / ANALYSIS_GUIDE_W);
  const my = guide.h * (ANALYSIS_MARGIN / ANALYSIS_GUIDE_H);
  return { x: guide.x - mx, y: guide.y - my, w: guide.w + mx * 2, h: guide.h + my * 2 };
}
