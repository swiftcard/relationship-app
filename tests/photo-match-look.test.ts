import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  toneFromPixels, lookFromTone, contrastRatio, relLum, TEXT_TARGET, PHOTO_TONE_SAMPLE,
} from "@/lib/photo-tone";
import {
  getLook, resolveLook, resolveHero, DEFAULT_SWIFTLINK_LOOK, FREE_SWIFTLINK_LOOKS, freeSafeLook, isFreeLook,
} from "@/lib/swiftlink-looks";

// "Photo match" (owner, 2026-10-15): the default Swift Links Look takes the
// page colour from the owner's header photo. The colour comes from an
// arbitrary selfie, so the guarantees the hand-made Looks get from their fixed
// values have to hold for EVERY colour a photo can produce.

const hex2 = (n: number) => n.toString(16).padStart(2, "0");
// A coarse sweep of the whole RGB cube, greys and near-blacks/whites included.
const STEPS = [0, 24, 48, 80, 112, 144, 176, 208, 232, 255];
const CUBE: string[] = [];
for (const r of STEPS) for (const g of STEPS) for (const b of STEPS) CUBE.push(`#${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase());

function grid(fill: (x: number, y: number) => [number, number, number, number]) {
  const S = PHOTO_TONE_SAMPLE;
  const data = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) data.set(fill(x, y), (y * S + x) * 4);
  return data;
}

describe("toneFromPixels", () => {
  it("averages the BOTTOM of the photo — the part the page fade continues", () => {
    const S = PHOTO_TONE_SAMPLE;
    // Sky-blue top, brown bottom: the page must continue the brown.
    const data = grid((_x, y) => (y < Math.floor(S * 0.6) ? [120, 180, 240, 255] : [110, 70, 40, 255]));
    expect(toneFromPixels(data, S, S)).toBe("#6E4628");
  });
  it("weights transparent pixels out (a cut-out PNG is judged by the person)", () => {
    const S = PHOTO_TONE_SAMPLE;
    const data = grid((x) => (x % 2 ? [200, 30, 30, 255] : [0, 0, 0, 0]));
    expect(toneFromPixels(data, S, S)).toBe("#C81E1E");
  });
  it("returns null when there is nothing to read", () => {
    const S = PHOTO_TONE_SAMPLE;
    expect(toneFromPixels(grid(() => [0, 0, 0, 0]), S, S)).toBeNull();
    expect(toneFromPixels(new Uint8ClampedArray(0), 0, 0)).toBeNull();
    expect(toneFromPixels(new Uint8ClampedArray(8), S, S)).toBeNull();
  });
});

describe("lookFromTone — readable for every colour a photo can produce", () => {
  const base = getLook("match");
  it.each(CUBE)("%s", (tone) => {
    const l = lookFromTone(tone, base);
    for (const v of [l.sheet, l.page, l.text, l.accent, l.accentText, l.tile]) expect(v).toMatch(/^#[0-9A-F]{6}$/);
    // Body text clears the target (well above AA: the bio renders at 75%).
    expect(contrastRatio(l.text, l.sheet)).toBeGreaterThanOrEqual(TEXT_TARGET);
    // The Connect button's label is AA on the button…
    expect(contrastRatio(l.accentText, l.accent)).toBeGreaterThanOrEqual(4.5);
    // …and the button stands out from the page it sits on.
    expect(contrastRatio(l.accent, l.sheet)).toBeGreaterThanOrEqual(3);
    // Neutral chrome (rings, hovers) follows `mode`: it must match the text.
    expect(l.mode).toBe(relLum(l.text) < 0.2 ? "light" : "dark");
    // A solid look: nothing else from another family leaks through.
    expect(l.sheetTo).toBeUndefined();
    expect(l.wash).toBeUndefined();
    expect(l.aura).toBeUndefined();
    expect(l.id).toBe("match");
  });

  it("keeps the photo's colour where it is already readable", () => {
    // Link.me's own example: a mid-grey photo becomes a grey page, not white.
    const l = lookFromTone("#B1B1B1", base);
    expect(l.sheet).toBe("#B1B1B1");
    expect(l.mode).toBe("light");
    const dark = lookFromTone("#1E2A3A", base);
    expect(dark.sheet).toBe("#1E2A3A");
    expect(dark.mode).toBe("dark");
  });
});

describe("resolveLook / the default", () => {
  it("Photo match is the default and is free", () => {
    expect(DEFAULT_SWIFTLINK_LOOK).toBe("match");
    expect(isFreeLook("match")).toBe(true);
    expect((FREE_SWIFTLINK_LOOKS as readonly string[]).includes("match")).toBe(true);
    expect(freeSafeLook(undefined)).toBe("match");
  });
  it("with no photo to read it renders exactly as Paper did", () => {
    const paper = getLook("paper"), match = resolveLook("match", null);
    for (const k of ["sheet", "page", "text", "accent", "accentText", "tile", "mode"] as const) expect(match[k]).toBe(paper[k]);
    expect(resolveLook(undefined, "not-a-colour").sheet).toBe(paper.sheet);
  });
  it("only Photo match listens to the photo — every other Look keeps its colours", () => {
    expect(resolveLook("onyx", "#AA3311")).toEqual(getLook("onyx"));
    expect(resolveLook("paper", "#AA3311")).toEqual(getLook("paper"));
    expect(resolveLook(undefined, "#AA3311").sheet).not.toBe(getLook("paper").sheet);
  });
});

describe("resolveHero — the server and the page agree on the picture", () => {
  it("follows the owner's pick, then headshot → logo → initials", () => {
    expect(resolveHero(undefined, "https://p", "https://l")).toEqual({ kind: "photo", url: "https://p" });
    expect(resolveHero(undefined, null, "https://l")).toEqual({ kind: "logo", url: "https://l" });
    expect(resolveHero(undefined, null, null)).toEqual({ kind: "initials", url: null });
    expect(resolveHero({ heroContent: "logo" }, "https://p", "https://l")).toEqual({ kind: "logo", url: "https://l" });
    expect(resolveHero({ heroContent: "initials" }, "https://p", null)).toEqual({ kind: "initials", url: null });
    expect(resolveHero({ heroContent: "custom", heroImage: "https://c" }, "https://p", null)).toEqual({ kind: "photo", url: "https://c" });
    expect(resolveHero({ heroContent: "custom", heroImage: "https://v", heroMediaType: "video" }, null, null)).toEqual({ kind: "video", url: "https://v" });
    // A non-https custom header never renders — it falls down the chain.
    expect(resolveHero({ heroContent: "custom", heroImage: "javascript:x" }, "https://p", null)).toEqual({ kind: "photo", url: "https://p" });
  });
});

describe("the public page reads the colour on the server", () => {
  const page = readFileSync(join(__dirname, "../src/app/links/[username]/page.tsx"), "utf8");
  it("passes photoTone, so a visitor never sees the fallback colour first", () => {
    expect(page).toMatch(/getPhotoTone\(/);
    expect(page).toMatch(/photoTone=\{photoTone\}/);
  });
});
