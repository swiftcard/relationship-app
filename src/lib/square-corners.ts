// ── A stored card screenshot, squared to the card's own edges ───────────────
//
// The link preview is a screenshot of the card. Until capture v9 the
// screenshot kept the card's rounded corners (16px at the card's 460px width),
// so each corner showed the page colour and the card's drop shadow behind it.
// Messages, WhatsApp and Slack round the preview themselves, at their own
// radius, which left light wedges and a grey halo in the corners of every
// texted link (owner, 2026-10-06: "make sure … it fits the corners properly,
// and that it looks very clean").
//
// New screenshots are taken square (components/ShareCardCapture). Every older
// one is squared here when it's served: each pixel outside the rounded corner
// takes the colour of the card just inside the curve, straight in toward the
// corner's centre — the card simply carries on to the edge. A corner that is
// already continuous (a v9 screenshot, or a card the same colour as the page)
// is left exactly as it is.

/** The card's corner radius as a share of its width (rounded-2xl on a 460px card). */
export const CARD_RADIUS_FRAC = 16 / 460;

/**
 * Square the four corners of an RGB/RGBA pixel buffer, in place.
 * Returns how many corners were changed.
 */
export function squareCorners(px: Uint8Array, w: number, h: number, ch: number, r = Math.round(w * CARD_RADIUS_FRAC)): number {
  if (r < 3 || r * 2 > Math.min(w, h)) return 0;
  const at = (x: number, y: number) => (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * ch;
  const corners = [
    { cx: r, cy: r, x0: 0, y0: 0 },
    { cx: w - r, cy: r, x0: w - r, y0: 0 },
    { cx: r, cy: h - r, x0: 0, y0: h - r },
    { cx: w - r, cy: h - r, x0: w - r, y0: h - r },
  ];
  // Sample point just inside the curve, on the line from the corner's centre
  // through pixel (x, y).
  const inside = (cx: number, cy: number, x: number, y: number): number => {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    const d = Math.hypot(dx, dy) || 1;
    const k = (r - 2.5) / d;
    return at(Math.floor(cx + dx * k), Math.floor(cy + dy * k));
  };
  let changed = 0;
  for (const { cx, cy, x0, y0 } of corners) {
    // The pixel deepest in the corner vs the card just inside the curve: if
    // they already match, there is no wedge here.
    const cornerX = x0 === 0 ? 1 : w - 2, cornerY = y0 === 0 ? 1 : h - 2;
    const a = at(cornerX, cornerY), b = inside(cx, cy, cornerX, cornerY);
    let diff = 0;
    for (let c = 0; c < Math.min(3, ch); c++) diff = Math.max(diff, Math.abs(px[a + c] - px[b + c]));
    if (diff < 10) continue;
    for (let y = y0; y < y0 + r; y++) {
      for (let x = x0; x < x0 + r; x++) {
        // Inside the curve (less the anti-aliased rim) is card already.
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r - 1.5) continue;
        const from = inside(cx, cy, x, y), to = at(x, y);
        for (let c = 0; c < ch; c++) px[to + c] = px[from + c];
      }
    }
    changed++;
  }
  return changed;
}
