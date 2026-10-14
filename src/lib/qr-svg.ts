import QRCode from "qrcode";

// ── The one QR SwiftCard draws, as path data ─────────────────────────────────
//
// Pure (no React, no DOM), so the same drawing serves two consumers:
//   - card-templates/MiniQR.tsx renders it inline on every card template, in
//     the Show QR popup and in the "Download QR (PNG)" picture;
//   - app/api/qr/route.ts serves it as a cacheable SVG file for the marketing
//     pages, where a card is a picture of the product and not a code anyone
//     scans off the server's HTML.
//
// The look (owner, 2026-09-30: "modern and amazing"): the three finder eyes
// are drawn as soft rounded rings with a rounded pupil, and every data module
// is a rounded square at 88% of its cell, so the pattern reads as a texture
// rather than a barcode. Scannability rules the drawing, not the other way
// round: modules never shrink below 0.88, corners stay modest (radius 0.28 of
// a cell), the eyes keep their exact 7×7 proportions, and the quiet zone is
// the tile's own padding. Error correction stays at M, the level every test
// and the wallet pass assume. OfflineOwnerSnapshot draws the same constants
// by hand (tests/offline-web.test.ts pins them to this file).
//
// All modules go into ONE <path>: a 33×33 code is ~500 dark cells, and a rect
// element per cell made the card preview visibly heavier on phones. Each cell
// is "M<x>,<y>" plus one shared relative outline, with every number rounded
// to two decimals: the first version wrote each corner in absolute
// coordinates and let 0.88 − 0.56 print as 0.32000000000000006, which made a
// single code 60–73 KB of HTML (SEO audit, 2026-10-14). The geometry is
// unchanged; only the digits are.

export const MODULE = 0.88;
export const CORNER = 0.28;
export const EYE = 7;

/** A number as short path text: 2 decimals, no trailing zeros. */
const f = (n: number): string => String(Math.round(n * 100) / 100);

/** A rounded rectangle as path data (absolute, arc corners). */
export function rr(x: number, y: number, w: number, h: number, r: number): string {
  const R = Math.min(r, w / 2, h / 2);
  return (
    `M${f(x + R)},${f(y)}h${f(w - 2 * R)}a${f(R)},${f(R)} 0 0 1 ${f(R)},${f(R)}v${f(h - 2 * R)}a${f(R)},${f(R)} 0 0 1 -${f(R)},${f(R)}` +
    `h-${f(w - 2 * R)}a${f(R)},${f(R)} 0 0 1 -${f(R)},-${f(R)}v-${f(h - 2 * R)}a${f(R)},${f(R)} 0 0 1 ${f(R)},-${f(R)}z`
  );
}

// One data module's outline, relative to its "M" start (the top edge, just
// after the top-left corner) — identical to rr(x, y, MODULE, MODULE, CORNER)
// without the absolute start.
const MODULE_OUTLINE = rr(0, 0, MODULE, MODULE, CORNER).replace(/^M[^hv]+/, "");
const MODULE_START_X = (1 - MODULE) / 2 + Math.min(CORNER, MODULE / 2);
const MODULE_START_Y = (1 - MODULE) / 2;

function inEye(r: number, c: number, count: number): boolean {
  const tl = r < EYE && c < EYE;
  const tr = r < EYE && c >= count - EYE;
  const bl = r >= count - EYE && c < EYE;
  return tl || tr || bl;
}

/** What a MiniQR encodes: a payload exactly as given, else the URL made absolute, else the homepage. */
export function qrTarget(url?: string, payload?: string): string {
  if (payload) return payload;
  const raw = (url ?? "").trim();
  return raw ? (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`) : "https://swiftcard.me";
}

export type QrDrawing = {
  /** Modules per side; the SVG viewBox is `0 0 count count`. */
  count: number;
  /** Every data module, one path. */
  modules: string;
  /** The three finder eyes: a 7×7 ring (even-odd fill) and a 3×3 pupil each. */
  eyes: Array<{ key: string; ring: string; pupil: string }>;
};

/** The drawing for one target, or null when the text cannot be encoded. */
export function drawQr(target: string): QrDrawing | null {
  let count = 0;
  let cells: Uint8Array;
  try {
    const qr = QRCode.create(target, { errorCorrectionLevel: "M" });
    count = qr.modules.size;
    cells = qr.modules.data as Uint8Array; // 1 = dark module
  } catch {
    return null;
  }
  if (!count) return null;
  const parts: string[] = [];
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (!cells[r * count + c] || inEye(r, c, count)) continue;
      parts.push(`M${f(c + MODULE_START_X)},${f(r + MODULE_START_Y)}${MODULE_OUTLINE}`);
    }
  }
  const eyes = [[0, 0], [count - EYE, 0], [0, count - EYE]].map(([x, y]) => ({
    key: `${x}-${y}`,
    ring: rr(x, y, EYE, EYE, 2.2) + rr(x + 1, y + 1, EYE - 2, EYE - 2, 1.4),
    pupil: rr(x + 2, y + 2, EYE - 4, EYE - 4, 0.9),
  }));
  return { count, modules: parts.join(""), eyes };
}

/** A solid colour MiniQR can hand to the image route: #RGB or #RRGGBB. */
export const isHexColor = (s: string): boolean => /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(s);

/** The URL of the same code as a cached SVG file (app/api/qr). */
export function qrImageUrl(target: string, fg: string): string {
  return `/api/qr?u=${encodeURIComponent(target)}&fg=${encodeURIComponent(fg)}`;
}

/** The complete standalone SVG document for one code, as the image route serves it. */
export function qrSvgMarkup(target: string, fg: string): string | null {
  const d = drawQr(target);
  if (!d) return null;
  const eyes = d.eyes
    .map((e) => `<path fill-rule="evenodd" d="${e.ring}" fill="${fg}"/><path d="${e.pupil}" fill="${fg}"/>`)
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${d.count} ${d.count}" shape-rendering="geometricPrecision">` +
    `${eyes}<path d="${d.modules}" fill="${fg}"/></svg>`
  );
}
