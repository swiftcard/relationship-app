import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CARD_RADIUS_FRAC, squareCorners } from "@/lib/square-corners";
import { logoCircleStyle } from "@/components/card-templates/shared";

// The texted-link preview is a screenshot of the card, and it has to look
// exactly like the card, edge to edge (owner, 2026-10-06: "make sure … it fits
// the corners properly, and that it looks very clean"). Rounded corners left
// the page colour and the drop shadow showing as wedges inside the messenger's
// own rounding.

const W = 460, H = 263, CH = 3;
const CREAM = [250, 247, 242], CARD = [62, 28, 52];

/** A card-coloured rounded rectangle on the page colour, like a v8 screenshot. */
function roundedCard(): Uint8Array {
  const px = new Uint8Array(W * H * CH);
  const r = Math.round(W * CARD_RADIUS_FRAC);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const cx = Math.min(Math.max(x + 0.5, r), W - r), cy = Math.min(Math.max(y + 0.5, r), H - r);
    const out = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r;
    px.set(out ? CREAM : CARD, (y * W + x) * CH);
  }
  return px;
}
const colourAt = (px: Uint8Array, x: number, y: number) => Array.from(px.slice((y * W + x) * CH, (y * W + x) * CH + 3));

describe("squareCorners", () => {
  it("fills every rounded corner with the card, so no page colour is left", () => {
    const px = roundedCard();
    expect(colourAt(px, 0, 0)).toEqual(CREAM);
    expect(squareCorners(px, W, H, CH)).toBe(4);
    for (const [x, y] of [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1], [3, 1], [W - 2, H - 4]]) {
      expect(colourAt(px, x, y), `${x},${y}`).toEqual(CARD);
    }
  });

  it("leaves an already-square screenshot exactly as it is", () => {
    const plain = new Uint8Array(W * H * CH).fill(120);
    expect(squareCorners(plain, W, H, CH)).toBe(0);
    expect(plain.every((v) => v === 120)).toBe(true);
  });

  it("refuses a radius that can't be a card's", () => {
    const px = new Uint8Array(10 * 10 * CH);
    expect(squareCorners(px, 10, 10, CH, 8)).toBe(0);
  });
});

describe("the preview is the card, edge to edge", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("new screenshots are taken with square corners and no shadow", () => {
    const cap = read("src/components/ShareCardCapture.tsx");
    expect(cap).toContain(".sc-share-capture > *, .sc-share-capture .sc-card { border-radius: 0 !important; box-shadow: none !important; }");
    expect(cap).toContain('className="sc-share-capture"');
  });

  it("older screenshots are squared when served", () => {
    const og = read("src/app/card/[username]/opengraph-image.tsx");
    expect(og).toMatch(/squareCorners\(raw\.data, raw\.info\.width, raw\.info\.height, raw\.info\.channels\);/);
  });

  it("the logo's circle ring is a border — the iPhone screenshot drops an inset shadow", () => {
    const s = logoCircleStyle(1, 40);
    expect(s.border).toBe("1px solid rgba(15,23,42,0.12)");
    expect(String(s.boxShadow ?? "")).not.toMatch(/inset/);
  });
});
