import QRCode from "qrcode";

// Split out of types.tsx: that module is value-imported (withoutSocials,
// SAMPLE_DATA) by ~30 files including several client homepage components, so
// co-locating the `qrcode` encoder there risked dragging it into bundles that
// never render a QR code at all (performance audit).
//
// The one QR SwiftCard draws — on every card template, in the Show QR popup,
// in "Other ways to share", in the downloadable PNG and in the desktop "Scan
// QR code" popup — so a person's code looks the same everywhere they meet it.
//
// The look (owner, 2026-09-30: "modern and amazing"): the three finder eyes
// are drawn as soft rounded rings with a rounded pupil, and every data module
// is a rounded square at 88% of its cell, so the pattern reads as a texture
// rather than a barcode. Scannability rules the drawing, not the other way
// round: modules never shrink below 0.88, corners stay modest (radius 0.28 of
// a cell), the eyes keep their exact 7×7 proportions, and the quiet zone is
// the tile's own padding. Error correction stays at M, the level every test
// and the wallet pass assume.
//
// All modules go into ONE <path>: a 33×33 code is ~500 dark cells, and a rect
// element per cell made the card preview visibly heavier on phones.

const MODULE = 0.88;
const CORNER = 0.28;
const EYE = 7;

/** A rounded rectangle as path data (absolute, arc corners). */
function rr(x: number, y: number, w: number, h: number, r: number): string {
  const R = Math.min(r, w / 2, h / 2);
  return (
    `M${x + R},${y}h${w - 2 * R}a${R},${R} 0 0 1 ${R},${R}v${h - 2 * R}a${R},${R} 0 0 1 -${R},${R}` +
    `h-${w - 2 * R}a${R},${R} 0 0 1 -${R},-${R}v-${h - 2 * R}a${R},${R} 0 0 1 ${R},-${R}z`
  );
}

function inEye(r: number, c: number, count: number): boolean {
  const tl = r < EYE && c < EYE;
  const tr = r < EYE && c >= count - EYE;
  const bl = r >= count - EYE && c < EYE;
  return tl || tr || bl;
}

export function MiniQR({ size = 52, bg = "#ffffff", fg = "#111827", url }: { size?: number; bg?: string; fg?: string; url?: string }) {
  const p = size * 0.055;
  const raw = (url ?? "").trim();
  const target = raw ? (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`) : "https://swiftcard.me";

  let count = 0;
  let modules = "";
  try {
    const qr = QRCode.create(target, { errorCorrectionLevel: "M" });
    count = qr.modules.size;
    const cells = qr.modules.data; // Uint8Array, 1 = dark module
    const inset = (1 - MODULE) / 2;
    const parts: string[] = [];
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (!cells[r * count + c] || inEye(r, c, count)) continue;
        parts.push(rr(c + inset, r + inset, MODULE, MODULE, CORNER));
      }
    }
    modules = parts.join("");
  } catch {
    count = 0;
  }

  // The three eyes: a 7×7 ring (outer rounded square minus a 5×5 rounded
  // hole, via even-odd fill) and a 3×3 rounded pupil.
  const eyes = count > 0
    ? [[0, 0], [count - EYE, 0], [0, count - EYE]].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <path fillRule="evenodd" d={rr(x, y, 7, 7, 2.2) + rr(x + 1, y + 1, 5, 5, 1.4)} fill={fg} />
          <path d={rr(x + 2, y + 2, 3, 3, 0.9)} fill={fg} />
        </g>
      ))
    : null;

  return (
    <div
      data-qr="1"
      data-qr-bg={bg}
      data-qr-fg={fg}
      style={{ width: size, height: size, background: bg, padding: p, borderRadius: size * 0.1, flexShrink: 0 }}
    >
      {count > 0 && (
        <svg viewBox={`0 0 ${count} ${count}`} style={{ width: "100%", height: "100%", display: "block" }} aria-hidden="true">
          {eyes}
          <path d={modules} fill={fg} />
        </svg>
      )}
    </div>
  );
}
