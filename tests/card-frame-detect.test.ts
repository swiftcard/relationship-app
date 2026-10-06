import { describe, it, expect } from "vitest";
import {
  ANALYSIS_W, ANALYSIS_H, ANALYSIS_GUIDE_W, ANALYSIS_GUIDE_H, ANALYSIS_MARGIN,
  analyzeFrame, isFit, frameState, guideRect, coverMap, analysisRect, toGray, CARD_ASPECT,
} from "@/lib/card-frame-detect";

// The scanner camera's "is the card in the frame?" check, on synthetic frames
// built the way a phone sees them: a pale card with dark text on a darker,
// noisy table, slightly tilted, slightly soft. Owner, 2026-10-06: a far-away
// card must not go green; a card that fills the frame — or "fits it enough" —
// must.

/** Deterministic noise, so a failure reproduces. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

type Scene = {
  /** Card size relative to the on-screen frame (1 = exactly the frame). */
  scale?: number;
  rotate?: number;
  dx?: number; dy?: number;
  card?: number; table?: number; noise?: number;
  text?: boolean;
  seed?: number;
  /** No card at all. */
  empty?: boolean;
};

function frame(s: Scene = {}): Uint8Array {
  const { scale = 1, rotate = 0, dx = 0, dy = 0, card = 225, table = 70, noise = 8, text = true, seed = 1, empty = false } = s;
  const r = rng(seed);
  const W = ANALYSIS_W, H = ANALYSIS_H;
  const cw = ANALYSIS_GUIDE_W * scale, ch = ANALYSIS_GUIDE_H * scale;
  const cx = W / 2 + dx, cy = H / 2 + dy;
  const cos = Math.cos((rotate * Math.PI) / 180), sin = Math.sin((rotate * Math.PI) / 180);
  // Text lines: dark bars at fixed spots in card space, with letter gaps.
  const bars: { u0: number; u1: number; v0: number; v1: number }[] = [];
  if (text) {
    const lines = [[0.08, 0.6, 0.18, 0.28], [0.08, 0.45, 0.33, 0.39], [0.08, 0.5, 0.62, 0.67], [0.08, 0.55, 0.72, 0.77], [0.08, 0.4, 0.82, 0.87]];
    for (const [u0, u1, v0, v1] of lines) {
      for (let u = u0; u < u1; u += 0.035) bars.push({ u0: u, u1: u + 0.024, v0, v1 });
    }
  }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // 2×2 supersample for soft, anti-aliased edges.
      let acc = 0;
      for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const px = x + ox - cx, py = y + oy - cy;
        const u = (px * cos + py * sin) / cw + 0.5;
        const v = (-px * sin + py * cos) / ch + 0.5;
        let g = table;
        if (!empty && u >= 0 && u <= 1 && v >= 0 && v <= 1) {
          g = card;
          if (bars.some((b) => u >= b.u0 && u <= b.u1 && v >= b.v0 && v <= b.v1)) g = 40;
        }
        acc += g;
      }
      out[y * W + x] = acc / 4 + (r() - 0.5) * 2 * noise;
    }
  }
  // A touch of lens softness.
  const soft = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0, n = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const xx = x + i, yy = y + j;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H) { sum += out[yy * W + xx]; n++; }
      }
      soft[y * W + x] = Math.max(0, Math.min(255, Math.round(sum / n)));
    }
  }
  return soft;
}

/** Run a few frames through the same hysteresis the camera uses. */
function settle(f: Uint8Array, frames = 3) {
  let fit = false;
  let a = analyzeFrame(f);
  for (let i = 0; i < frames; i++) { a = analyzeFrame(f); fit = isFit(a.sides, fit); }
  return { a, fit, state: frameState(a, fit) };
}

describe("card fills the frame → green", () => {
  it.each([
    ["exactly", {}],
    ["a little bigger", { scale: 1.08 }],
    ["a little smaller", { scale: 0.93 }],
    ["tilted 4°", { rotate: 4 }],
    ["tilted −5°", { rotate: -5 }],
    ["slightly off-centre", { dx: 6, dy: -5 }],
    ["low contrast (white card, light-grey table)", { card: 235, table: 185 }],
    ["dark card on a pale table", { card: 50, table: 200 }],
    ["noisy, dim room", { noise: 18, card: 170, table: 60 }],
  ] as [string, Scene][])("%s", (_, scene) => {
    const { fit, state, a } = settle(frame(scene));
    expect(fit, JSON.stringify(a.sides)).toBe(true);
    expect(state).toBe("fit");
  });
});

describe("card too far away → not green, and says move closer", () => {
  it.each([0.5, 0.6, 0.7])("card at %f of the frame", (scale) => {
    const { fit, state, a } = settle(frame({ scale }));
    expect(fit, JSON.stringify(a.sides)).toBe(false);
    expect(state, JSON.stringify(a.inside)).toBe("closer");
  });
});

describe("no card → nothing", () => {
  it("an empty, noisy table is not a card", () => {
    const { fit, state } = settle(frame({ empty: true, noise: 20 }));
    expect(fit).toBe(false);
    expect(state).toBe("none");
  });

  it("a card far off to one side is not a fit", () => {
    const { fit } = settle(frame({ dx: 70 }));
    expect(fit).toBe(false);
  });

  it("much too close (card edges past the frame) is not a fit", () => {
    const { fit } = settle(frame({ scale: 1.5 }));
    expect(fit).toBe(false);
  });
});

describe("hysteresis: no flicker at the edge of 'fits'", () => {
  it("harder to turn green than to stay green", () => {
    const borderline = [0.2, 0.5, 0.7, 0.8];
    expect(isFit(borderline, false)).toBe(false);
    expect(isFit(borderline, true)).toBe(true);
    expect(isFit([0.05, 0.3, 0.7, 0.8], true)).toBe(false);
  });
});

describe("motion", () => {
  it("is ~0 for the same frame and large when the card moves", () => {
    const f = frame({});
    expect(analyzeFrame(f, f).motion).toBe(0);
    expect(analyzeFrame(f).motion).toBe(Infinity);
    expect(analyzeFrame(frame({ dx: 8, seed: 1 }), f).motion).toBeGreaterThan(7);
  });
});

describe("geometry", () => {
  it("the frame is card-shaped, centred, and never wider than the screen at any size", () => {
    for (const [w, h] of [[320, 568], [390, 844], [430, 932], [844, 390], [1280, 800], [1920, 1080]]) {
      const g = guideRect(w, h);
      expect(g.w / g.h).toBeCloseTo(CARD_ASPECT, 5);
      expect(g.x).toBeGreaterThan(0);
      expect(g.x + g.w).toBeLessThan(w);
      expect(g.y).toBeGreaterThanOrEqual(72);
      expect(g.y + g.h).toBeLessThanOrEqual(h - 168);
      expect(Math.abs(g.x + g.w / 2 - w / 2)).toBeLessThan(0.01);
    }
    // Wide enough on a phone to read a card.
    expect(guideRect(390, 844).w).toBeGreaterThan(300);
  });

  it("analysis region = frame + margin, at the analysis canvas's proportions", () => {
    const g = guideRect(390, 844);
    const r = analysisRect(g);
    expect(r.w / r.h).toBeCloseTo(ANALYSIS_W / ANALYSIS_H, 1);
    expect((g.x - r.x) / g.w).toBeCloseTo(ANALYSIS_MARGIN / ANALYSIS_GUIDE_W, 5);
  });

  it("maps a screen rect to camera pixels under object-fit: cover", () => {
    // Portrait phone 390×844 showing a 1080×1920 camera: scale = 844/1920,
    // the camera is cropped left and right.
    const m = coverMap({ x: 0, y: 0, w: 390, h: 844 }, 390, 844, 1080, 1920, 390, 844)!;
    expect(m.sy).toBeCloseTo(0, 5);
    expect(m.sh).toBeCloseTo(1920, 5);
    expect(m.sw).toBeCloseTo(390 / (844 / 1920), 3);
    expect(m.sx).toBeCloseTo((1080 - m.sw) / 2, 3);
  });

  it("clamps a rect that runs off the camera image (Safari draws nothing otherwise)", () => {
    // A desktop webcam (1280×720) in a tall window: top/bottom are off-image.
    const m = coverMap({ x: -50, y: -50, w: 500, h: 300 }, 400, 800, 1280, 720, 100, 60)!;
    expect(m.sx).toBeGreaterThanOrEqual(0);
    expect(m.sy).toBeGreaterThanOrEqual(0);
    expect(m.sx + m.sw).toBeLessThanOrEqual(1280);
    expect(m.sy + m.sh).toBeLessThanOrEqual(720);
    expect(m.dy).toBeGreaterThan(0);
  });

  it("mirrors for a front camera without moving a centred frame", () => {
    const g = guideRect(1280, 800);
    const a = coverMap(g, 1280, 800, 1280, 720, 200, 114)!;
    const b = coverMap(g, 1280, 800, 1280, 720, 200, 114, true)!;
    expect(b.sx).toBeCloseTo(a.sx, 5);
    const off = coverMap({ ...g, x: g.x + 100 }, 1280, 800, 1280, 720, 200, 114, true)!;
    expect(off.sx).toBeLessThan(a.sx);
  });
});

describe("toGray", () => {
  it("weights green most, like the eye", () => {
    const g = toGray(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]), 4, 1);
    expect(g[1]).toBeGreaterThan(g[0]);
    expect(g[0]).toBeGreaterThan(g[2]);
    expect(g[3]).toBeGreaterThanOrEqual(254);
  });
});
