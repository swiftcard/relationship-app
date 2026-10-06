import { describe, expect, it } from "vitest";
import { applyHomography, cardQuadFromScan, flatSize, homography, warpQuad, type Pt } from "@/lib/card-flatten";

// A photo of a paper card is found and laid flat before anything is redrawn
// (owner, 2026-10-06: a loosely shot card should still copy its design, not
// the desk and the tilt). sharp has no perspective warp, so the maths lives in
// lib/card-flatten and is pinned here.

describe("homography", () => {
  it("maps each corner exactly onto its target", () => {
    const from: Pt[] = [[0, 0], [1400, 0], [1400, 800], [0, 800]];
    const to: Pt[] = [[120, 80], [1300, 140], [1250, 900], [90, 820]];
    const h = homography(from, to)!;
    expect(h).not.toBeNull();
    from.forEach((p, i) => {
      const [x, y] = applyHomography(h, p[0], p[1]);
      expect(x).toBeCloseTo(to[i][0], 6);
      expect(y).toBeCloseTo(to[i][1], 6);
    });
  });
  it("refuses a degenerate quad", () => {
    expect(homography([[0, 0], [1, 0], [2, 0], [3, 0]], [[0, 0], [1, 0], [1, 1], [0, 1]])).toBeNull();
  });
});

describe("cardQuadFromScan", () => {
  const W = 1000, H = 800;
  const photo = (corners: unknown) => ({ kind: "photo_of_physical_card", corners });

  it("reorders any corner order to TL, TR, BR, BL in pixels", () => {
    const q = cardQuadFromScan(photo([[80, 75], [20, 25], [15, 70], [85, 20]]), W, H)!;
    expect(q).toEqual([[200, 200], [850, 160], [800, 600], [150, 560]]);
  });
  it("nothing to flatten: a flat design, or a card already filling the frame", () => {
    expect(cardQuadFromScan({ kind: "flat_design" }, W, H)).toBeNull();
    expect(cardQuadFromScan(photo([[0, 0], [100, 0], [100, 100], [0, 100]]), W, H)).toBeNull();
  });
  it("rejects junk: wrong count, non-numbers, wild values, specks, collapsed corners", () => {
    expect(cardQuadFromScan(photo([[10, 10], [90, 10], [90, 90]]), W, H)).toBeNull();
    expect(cardQuadFromScan(photo([[10, 10], ["a", 10], [90, 90], [10, 90]]), W, H)).toBeNull();
    expect(cardQuadFromScan(photo([[10, 10], [400, 10], [90, 90], [10, 90]]), W, H)).toBeNull();
    expect(cardQuadFromScan(photo([[40, 40], [45, 40], [45, 44], [40, 44]]), W, H)).toBeNull();
    expect(cardQuadFromScan(photo([[10, 10], [10, 10], [90, 90], [10, 90]]), W, H)).toBeNull();
    expect(cardQuadFromScan(null, W, H)).toBeNull();
  });
});

describe("flatSize", () => {
  it("keeps the card's own proportions, long side 1400, vertical stays vertical", () => {
    expect(flatSize([[0, 0], [700, 0], [700, 400], [0, 400]])).toEqual({ w: 1400, h: 800 });
    expect(flatSize([[0, 0], [400, 0], [400, 700], [0, 700]])).toEqual({ w: 800, h: 1400 });
    // A wildly long reading is clamped to a real card shape.
    expect(flatSize([[0, 0], [1000, 0], [1000, 100], [0, 100]])).toEqual({ w: 1400, h: 700 });
  });
});

describe("warpQuad", () => {
  it("lays a tilted card flat: the card fills the output, the desk is gone", () => {
    // A 200×160 grey "desk" with a white quadrilateral "card" on it.
    const W = 200, H = 160;
    const quad: Pt[] = [[40, 30], [170, 45], [160, 130], [30, 115]];
    const inside = (x: number, y: number) => {
      let s = 0;
      for (let i = 0; i < 4; i++) {
        const a = quad[i], b = quad[(i + 1) % 4];
        const c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
        if (c === 0) continue;
        if (s === 0) s = Math.sign(c);
        else if (Math.sign(c) !== s) return false;
      }
      return true;
    };
    const src = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) src[y * W + x] = inside(x + 0.5, y + 0.5) ? 255 : 60;
    const out = warpQuad(src, W, H, 1, quad, 140, 80)!;
    // Away from the very edge (bilinear blends a pixel of desk there), every
    // output pixel is card.
    let desk = 0;
    for (let y = 3; y < 77; y++) for (let x = 3; x < 137; x++) if (out[y * 140 + x] < 200) desk++;
    expect(desk).toBe(0);
  });
});
