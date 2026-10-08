import { describe, expect, it } from "vitest";
import { applyHomography, cardKindFromScan, cardQuadFromScan, flatSize, gridOverlay, homography, maskRegions, quadCoverage, warpQuad, LOCATE_CARD_PROMPT, type Pt } from "@/lib/card-flatten";

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
  it("nothing to cut: no corners, or a card already filling the frame", () => {
    expect(cardQuadFromScan({ kind: "flat_design" }, W, H)).toBeNull();
    expect(cardQuadFromScan(photo([[0, 0], [100, 0], [100, 100], [0, 100]]), W, H)).toBeNull();
    expect(cardQuadFromScan({ kind: "flat_design", corners: [[0, 0], [100, 0], [100, 100], [0, 100]] }, W, H)).toBeNull();
  });
  it("a flat design with anything around the card is cut to the card too (2026-10-08)", () => {
    // A template mockup: the card on a backdrop with margins. It used to pass
    // through whole, and the whole picture became "the card".
    const q = cardQuadFromScan({ kind: "flat_design", corners: [[15, 20], [85, 20], [85, 80], [15, 80]] }, W, H);
    expect(q).toEqual([[150, 160], [850, 160], [850, 640], [150, 640]]);
    expect(quadCoverage(q!, W, H)).toBeCloseTo(0.42, 2);
    // Any other kind is a misreading.
    expect(cardQuadFromScan({ kind: "painting", corners: [[15, 20], [85, 20], [85, 80], [15, 80]] }, W, H)).toBeNull();
    // The prompt always asks for corners, and names what counts as "around".
    expect(LOCATE_CARD_PROMPT).toMatch(/Always give corners/);
    expect(LOCATE_CARD_PROMPT).toMatch(/mockup backdrop, a drop shadow, a web page/);
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

describe("maskRegions", () => {
  it("fills each box with the colour around it, so the content is gone and the surface continues", async () => {
    const sharp = (await import("sharp")).default;
    // A navy left panel, a cream field, black "text" on the field and a white
    // "logo" on the panel.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">
      <rect width="400" height="200" fill="#f5f0e6"/><rect width="120" height="200" fill="#1b2a4a"/>
      <rect x="160" y="60" width="200" height="30" fill="#000000"/><rect x="30" y="60" width="60" height="60" fill="#ffffff"/></svg>`;
    const src = await sharp(Buffer.from(svg)).png().toBuffer();
    const out = await maskRegions(src, [{ x: 40, y: 30, w: 50, h: 15 }, { x: 7.5, y: 30, w: 15, h: 30 }]);
    const raw = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => { const i = (y * raw.info.width + x) * raw.info.channels; return [raw.data[i], raw.data[i + 1], raw.data[i + 2]]; };
    // Where the text was: cream. Where the logo was: navy. Elsewhere untouched.
    expect(px(260, 75)[0]).toBeGreaterThan(230);
    expect(px(260, 75)[2]).toBeGreaterThan(200);
    expect(px(60, 90)[2]).toBeGreaterThan(px(60, 90)[0] + 20);
    expect(px(60, 90)[0]).toBeLessThan(60);
    expect(px(380, 180)[0]).toBeGreaterThan(230);
    expect(px(10, 10)[0]).toBeLessThan(60);
    // No boxes → the image passes through (re-encoded).
    expect((await maskRegions(src, [])).length).toBeGreaterThan(100);
  });
  it("the finder reads coordinates off a drawn grid, and the crop uses the clean pixels", async () => {
    const sharp = (await import("sharp")).default;
    const plain = await sharp({ create: { width: 400, height: 200, channels: 3, background: "#808080" } }).png().toBuffer();
    const gridded = await gridOverlay(plain, 400, 200);
    const raw = await sharp(gridded).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => { const i = (y * raw.info.width + x) * raw.info.channels; return [raw.data[i], raw.data[i + 1], raw.data[i + 2]]; };
    // A magenta line at 50% width; plain grey between lines.
    expect(px(200, 150)[0]).toBeGreaterThan(px(200, 150)[1] + 40); expect(px(200, 150)[1]).toBeLessThan(110);
    expect(Math.abs(px(190, 150)[0] - 128)).toBeLessThan(8);
    expect(LOCATE_CARD_PROMPT).toMatch(/magenta grid/);
    const flatten = (await import("node:fs")).readFileSync("src/lib/card-flatten.ts", "utf8");
    expect(flatten).toMatch(/gridOverlay\(upright\.data/);
    expect(flatten).toMatch(/cropToQuad\(upright\.data, quad, "jpeg"\)/);
  });
  it("the card finder makes the model commit to fillsFrame, and the kind is reported", () => {
    expect(LOCATE_CARD_PROMPT).toMatch(/fillsFrame = true ONLY when/);
    expect(cardKindFromScan({ kind: "photo_of_physical_card" })).toBe("photo");
    expect(cardKindFromScan({ kind: "flat_design" })).toBe("flat");
    expect(cardKindFromScan(null)).toBe("unknown");
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
