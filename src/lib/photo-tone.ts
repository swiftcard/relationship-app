// ── Photo match — a page colour read off the owner's own header photo ────────
//
// Owner request 2026-10-15, after link.me: the page's background should be the
// colour of the photo above it, so the photo dissolves into the page instead of
// meeting a colour it has nothing to do with. "Photo match" is the default Look
// for every page with no stored choice; the owner can pick any other Look, or a
// custom background colour, and that wins.
//
// This file is the PURE half and runs on both sides: the public page samples
// the photo on the server (photo-tone-server, sharp) and the editor's live
// preview samples it in the browser (canvas). Both hand the same tiny RGBA
// grid to `toneFromPixels`, so the preview shows the colour the page will get.
//
// The derived scheme must be as readable as the hand-made Looks — they are all
// tested to WCAG AA, and a colour taken from an arbitrary selfie is the one
// input nobody designed. So the photo's colour is only the STARTING point: its
// lightness is nudged (as little as possible) until the text on it clears
// TEXT_TARGET, comfortably above AA because the bio renders at 75% opacity.

import type { SwiftLinkLook } from "@/lib/swiftlink-looks";

/** The grid both samplers draw the photo into: a centre square, cover-cropped
 *  exactly like the cover hero crops it, shrunk to SAMPLE × SAMPLE pixels. */
export const PHOTO_TONE_SAMPLE = 24;

/** The bottom share of the photo that is averaged — the part the page's fade
 *  dissolves, so the part the page colour has to continue. */
const BAND = 0.4;

/** Body-text contrast the derived sheet must reach. AA is 4.5; the bio sits at
 *  75% opacity, so the full-strength text needs real headroom over that. */
export const TEXT_TARGET = 7;

/** Saturation ceiling. A vivid shirt should tint the page, not paint it. */
const MAX_SAT = 0.5;

const HEX = /^#[0-9a-fA-F]{6}$/;

export function isHex(v: unknown): v is string {
  return typeof v === "string" && HEX.test(v);
}

/**
 * The average colour of the bottom band of an RGBA grid (row-major, 4 bytes a
 * pixel), as #rrggbb — or null when there is nothing to read (an empty or
 * mostly transparent image). Transparent pixels are weighted out, so a cut-out
 * PNG is judged by the person, not by the empty canvas around them.
 */
export function toneFromPixels(data: ArrayLike<number>, width: number, height: number): string | null {
  if (!width || !height || data.length < width * height * 4) return null;
  const startRow = Math.min(height - 1, Math.floor(height * (1 - BAND)));
  let r = 0, g = 0, b = 0, w = 0;
  for (let y = startRow; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = data[i + 3] / 255;
      if (a <= 0) continue;
      r += data[i] * a; g += data[i + 1] * a; b += data[i + 2] * a; w += a;
    }
  }
  const pixels = (height - startRow) * width;
  // Under a quarter of the band actually painted: there is no colour to match.
  if (w < pixels * 0.25) return null;
  return toHex(r / w, g / w, b / w);
}

// ── colour arithmetic ────────────────────────────────────────────────────────

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance. */
export function relLum(hex: string): number {
  return rgbOf(hex)
    .map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    })
    .reduce((acc, c, i) => acc + c * [0.2126, 0.7152, 0.0722][i], 0);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function hslOf(hex: string): [number, number, number] {
  const [r, g, b] = rgbOf(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hsl(h: number, s: number, l: number): string {
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) return toHex(l * 255, l * 255, l * 255);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return toHex(hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255);
}

function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgbOf(a), [br, bg, bb] = rgbOf(b);
  return toHex(br + (ar - br) * t, bg + (ag - bg) * t, bb + (ab - bb) * t);
}

/**
 * Walk the lightness from `l` toward `dir` (+1 lighter, -1 darker) until the
 * text clears TEXT_TARGET. Returns the sheet and how far it had to move.
 */
function settle(h: number, s: number, l: number, text: string, dir: 1 | -1): { sheet: string; moved: number } {
  let cur = l;
  let sheet = hsl(h, s, cur);
  for (let i = 0; i < 200 && contrastRatio(text, sheet) < TEXT_TARGET; i++) {
    cur = Math.max(0, Math.min(1, cur + dir * 0.005));
    sheet = hsl(h, s, cur);
    if (cur === 0 || cur === 1) break;
  }
  return { sheet, moved: Math.abs(cur - l) };
}

/**
 * The whole Look, derived from one photo colour.
 *
 * Which way the page goes — light with dark text, or dark with white text — is
 * whichever needs the SMALLER change to the photo's colour to be readable, so a
 * pale photo gets a pale page and a dark photo a dark one, and a mid-tone photo
 * goes wherever it is closest to.
 *
 * Everything else follows the shape of the hand-made solid Looks: a deep shade
 * of the same hue as the Connect button on a light page (a near-white one on a
 * dark page), a tile surface a step off the sheet, and a darker desktop
 * backdrop. `base` supplies id/name/family so the result is still that Look.
 */
export function lookFromTone(tone: string, base: SwiftLinkLook): SwiftLinkLook {
  const [h, rawS, l] = hslOf(tone);
  const s = Math.min(rawS, MAX_SAT);

  const darkText = hsl(h, Math.min(s, 0.35), 0.12);
  const lightText = "#FFFFFF";
  const asLight = settle(h, s, l, darkText, 1);
  const asDark = settle(h, s, l, lightText, -1);
  const light = asLight.moved <= asDark.moved;
  const sheet = light ? asLight.sheet : asDark.sheet;
  const text = light ? darkText : lightText;

  const accent = light ? hsl(h, Math.max(0, Math.min(s * 1.2, 0.55)), 0.2) : hsl(h, Math.min(s, 0.25), 0.95);
  const accentText = light ? "#FFFFFF" : hsl(h, Math.min(s, 0.4), 0.12);

  return {
    ...base,
    mode: light ? "light" : "dark",
    sheet,
    page: mix("#000000", sheet, light ? 0.08 : 0.35),
    text,
    accent,
    accentText,
    tile: mix(text, sheet, 0.08),
    sheetTo: undefined,
    aura: undefined,
    wash: undefined,
    frost: undefined,
  };
}
