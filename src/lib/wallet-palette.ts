// ── One palette for every card the product can produce ──────────────────────
//
// The Wallet pass copies the card. "The card" is not one thing: six preset
// templates with baked-in palettes and textures, any of those with Pro style
// overrides (colours, a finish such as Linen, a photo behind the panel) on
// top, a custom block layout with its own two-tone surface, and a
// design-transfer card that is nothing but an image. This module flattens all
// of them into ONE shape the strip renderer, the pass chrome and the marketing
// preview all read, so there is exactly one place where "what does this card
// look like" is decided.
//
// Owner, 2026-09-18: "The colors should be the exact same on the pass as they
// are on the actual SwiftCard that is selected ... if the background of the
// card is textured, like linen, then you do the same thing to the pass." So
// every value below is read off the template that draws the card — the same
// defaults, the same override rules, the same texture — rather than an
// impression of it. tests/wallet-look-fidelity.test.ts renders the real
// templates and fails if the two ever disagree.
//
// How a card maps onto a pass (layout unchanged — owner likes it):
//
//   band (the strip image)  = the card's BRANDING panel: its exact colour or
//                             gradient, its finish, its panel photo, the
//                             template's own texture, and the name/title/
//                             company in the colours the card sets them in.
//   body (Apple's chrome)   = the card's DETAILS side. A two-tone card
//                             (Classic Pro's navy panel + white details) gets a
//                             two-tone pass — owner's choice, 2026-09-18. A
//                             single-surface card stays one colour, with the
//                             band melting into the body so there is no seam.
//   labels / values         = the card's contact-icon colour and contact text.
//
// What Apple does not allow, and so cannot match: the QR (Wallet draws it
// black on white, there is no colour key — owner chose to keep it at the
// bottom anyway), a texture below the band (the body is one flat colour), and
// the card's typeface (the strip is rendered with a bundled sans).
//
// Pure — no I/O, no React — so the whole matrix is unit-testable in plain node.
// (The one input it cannot derive from data, a design-transfer face image, is
// sampled by the caller and passed in as `sampled`.)

import type { ResolvedCardMeta, ResolvedCustomDesign } from "@/lib/resolve-card";
import { isDarkBg, panelBackground, type TemplateStyle } from "@/lib/template-style";
import { getFinish, PANEL_DIM_DEFAULT } from "@/lib/card-finishes";

type Meta = NonNullable<ResolvedCardMeta>;

/** Which band composition a template WANTS, before content availability. */
export type BandPrefer = "portrait" | "mark" | "type";

/**
 * How the template sets type — the part of a card's character that survives
 * into a 375×144pt band.
 *
 * NOT the typeface. next/og renders with its own bundled font and no card font
 * file is available server-side, so honouring `fontFamily` would silently
 * fall back to the same sans for every card while claiming otherwise. Case,
 * tracking and weight do carry, and they are most of what separates Luxury
 * Minimal from Modern Bold at a glance.
 */
export type Voice = {
  /** The name. Tracking in em. */
  caps: boolean;
  tracking: number;
  weight: 400 | 600 | 700 | 800;
  /** The job title — most templates set it in tracked capitals. */
  titleCaps: boolean;
  titleTracking: number;
  /** The company line. */
  companyCaps: boolean;
  companyTracking: number;
};

/** One texture layer, painted over the band's colour. Design px (see CARD_W). */
export type SurfaceLayer = { image: string; size?: string };

/**
 * Everything painted UNDER the band's content, the way the card paints its
 * panel. Every size is in CARD design px — the 460px-wide card the templates
 * are drawn at — and each renderer scales it to its own width, so a Linen
 * weave has the same pitch on the pass as on the card shown at that width.
 */
export type BandSurface = {
  /** The panel's own colour or gradient. */
  base: string;
  /** A photo behind the panel (the card's panel media), with its scrim. */
  media: { url: string; dim: number } | null;
  /** Finish, then the template's own texture — bottom to top. */
  layers: SurfaceLayer[];
  /** Single-surface cards: the band melts into the pass colour at its foot. */
  fadeTo: string | null;
  /** A soft light off the top-right corner (Modern Bold). */
  glow: { color: string; size: number; top: number; right: number } | null;
  /** The tinted mark column and its hairline (Logo First). */
  leadColumn: { tint: string; rule: string } | null;
  /** A foil strip down the left edge (Luxury Minimal). */
  edge: { background: string; width: number } | null;
  /** The accent bar along the card's foot (Classic Pro, Local Business). */
  bar: { background: string; height: number } | null;
};

/** The short accent rule the template draws beside the name. Design px. */
export type PassRule = { at: "above-name" | "before-title"; color: string; width: number; height: number };

export type PassLead = {
  /** Behind a logo. */
  tile: string;
  /** A lead with no logo: the card's own monogram treatment. */
  monogram: { background: string; color: string };
  /** A hairline round the tile instead of a fill (Logo First). */
  edge: string | null;
};

/** Apple's chrome under the band: backgroundColor, foregroundColor, labelColor. */
export type PassBody = { background: string; value: string; label: string };

export type PassPalette = {
  /** Band colour at its top and bottom edge (first and last stop). */
  top: string;
  bottom: string;
  /** The name — guaranteed to contrast with the band. */
  ink: string;
  /** The company line. */
  inkMuted: string;
  /** The job title. */
  title: string;
  /** Ring round a headshot, rules. Falls back toward ink when it can't be seen. */
  accent: string;
  nameShadow: { y: number; blur: number; color: string } | null;
  rule: PassRule | null;
  lead: PassLead;
  prefer: BandPrefer;
  voice: Voice;
  surface: BandSurface;
  body: PassBody;
  /** Band and body are different surfaces, as on the card. */
  twoTone: boolean;
};

// ── Colour maths ────────────────────────────────────────────────────────────

const HEX = /#([0-9a-f]{6})\b/gi;

/** Every #rrggbb in a colour or gradient string, in source order. */
export function hexStops(css: string | null | undefined): string[] {
  if (!css) return [];
  return (css.match(HEX) ?? []).map((h) => h.toLowerCase());
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");

/** Perceived brightness, 0–255. Same YIQ curve the card renderers use. */
export function yiq(hex: string): number {
  const [r, g, b] = rgb(hex);
  return (r * 299 + g * 587 + b * 114) / 1000;
}

export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return `#${toHex(r1 + (r2 - r1) * t)}${toHex(g1 + (g2 - g1) * t)}${toHex(b1 + (b2 - b1) * t)}`;
}

export function withAlpha(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Apple wants rgb(r, g, b) in pass.json, not #rrggbb. */
export function toAppleRgb(hex: string): string {
  const [r, g, b] = rgb(hex);
  return `rgb(${r}, ${g}, ${b})`;
}

const WHITE = "#ffffff";
const NEAR_BLACK = "#10151f";

/**
 * Text that can actually be read on `surface`.
 *
 * The preferred colour is kept whenever it separates from the ground — which
 * every template default and every editor preset does, so a real card keeps
 * its exact colour. Below that it is replaced outright rather than nudged,
 * because a card whose owner set white text on a white background override
 * (reachable in the editor, and present on real cards) needs a different
 * colour, not a lighter one.
 *
 * Threshold is deliberately higher than the accent's: body text failing is
 * worse than a hairline failing.
 */
export function readableInk(surface: string, preferred?: string): string {
  const ground = yiq(surface);
  if (preferred && hexStops(preferred).length) {
    const p = hexStops(preferred)[0];
    if (Math.abs(yiq(p) - ground) >= 60) return p;
  }
  return ground < 150 ? WHITE : NEAR_BLACK;
}

/** Below this separation from the ground, an accent is effectively invisible. */
const ACCENT_MIN_DELTA = 26;
/** What a lifted accent must reach — comfortably clear, not borderline. */
const ACCENT_LIFT_DELTA = 45;

/**
 * The accent, lifted until it can be seen, keeping its hue.
 *
 * A colour that already separates is returned EXACTLY — this only ever acts
 * on a colour that would otherwise vanish. CustomCard's `ramp()` drops an
 * unreadable accent to the text colour; on the pass the accent draws the
 * field labels, the rule and the headshot ring, so throwing the brand colour
 * away costs more than lifting it.
 *
 * Lifting toward the ground's opposite end preserves the hue (it desaturates
 * rather than replacing) and clears the threshold decisively. Only an accent
 * that cannot be lifted into range at all falls back to the ink.
 */
export function readableAccent(surface: string, ink: string, accent?: string | null): string {
  const stops = hexStops(accent);
  if (!stops.length) return ink;
  const a = stops[0];
  const ground = yiq(surface);
  if (Math.abs(yiq(a) - ground) >= ACCENT_MIN_DELTA) return a;

  const target = ground < 150 ? WHITE : "#000000";
  for (let t = 0.12; t <= 0.96; t += 0.12) {
    const lifted = mix(a, target, t);
    if (Math.abs(yiq(lifted) - ground) >= ACCENT_LIFT_DELTA) return lifted;
  }
  return ink;
}

const firstHex = (css: string | null | undefined): string | undefined => hexStops(css)[0];
const lastHex = (css: string | null | undefined): string | undefined => {
  const s = hexStops(css);
  return s[s.length - 1];
};

/**
 * A gradient's stops, re-laid top to bottom.
 *
 * Only for a SINGLE-surface card, whose band has to end on exactly the colour
 * the pass body is painted: at any angle but 180deg the band's foot is a
 * different mix at each corner and a seam appears where the strip meets
 * Apple's chrome. The colours and their positions are the card's own; only
 * the direction changes. A flat colour comes back untouched.
 */
export function verticalRamp(css: string): string {
  const stops = [...css.matchAll(/#([0-9a-f]{6})\b(\s+-?\d+(?:\.\d+)?%)?/gi)]
    .map((m) => `#${m[1].toLowerCase()}${m[2] ?? ""}`);
  if (stops.length < 2) return firstHex(css) ?? css;
  return `linear-gradient(180deg, ${stops.join(", ")})`;
}

// ── The templates' own textures ─────────────────────────────────────────────
//
// Each is the texture div the template draws over its panel, in the form both
// renderers paint. Satori does not honour px stops inside radial-gradient(),
// so Classic Pro's dot grid is written with the equivalent percentage: in a
// 14px tile the default farthest-corner radius is 7√2 = 9.9px, and its 1px
// dot is 10.1% of that. A browser draws both forms identically.
// tests/wallet-look-fidelity.test.ts pins each one to its template's source.

/** Classic Pro: "Subtle dot texture". */
const DOTS: SurfaceLayer = { image: "radial-gradient(rgba(255,255,255,0.06) 10.1%, transparent 10.1%)", size: "14px 14px" };
/** Modern Bold: "Subtle grid texture" — split into its two directions. */
const GRID: SurfaceLayer[] = [
  { image: "linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px)", size: "24px 24px" },
  { image: "linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)", size: "24px 24px" },
];
/** Local Business: "Subtle diagonal texture". */
const DIAGONAL: SurfaceLayer = {
  image: "repeating-linear-gradient(135deg, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) 1px, transparent 1px, transparent 14px)",
};
/** Photo First: the violet bloom over the photo panel. */
const PHOTO_BLOOM: SurfaceLayer = {
  image: "radial-gradient(ellipse at 60% 20%, rgba(167,139,250,0.35) 0%, transparent 60%)",
};

// ── The per-template look, before contrast is enforced ──────────────────────

type RawLook = {
  /** The band's colour or gradient, before finish and media. */
  band: string;
  /** Set for a two-tone card: the details surface, which becomes the body. */
  details: string | null;
  finish?: string;
  media?: BandSurface["media"];
  layers?: SurfaceLayer[];
  glow?: BandSurface["glow"];
  leadColumn?: BandSurface["leadColumn"];
  edge?: BandSurface["edge"];
  bar?: BandSurface["bar"];
  ink: string;
  nameShadow?: PassPalette["nameShadow"];
  title: string;
  /** Company line colour; with `companyOver`, pulled that far into the band
   *  (how a template's `text-white/80` actually lands on its panel). */
  company: string;
  companyOver?: number;
  accent: string;
  rule?: PassRule | null;
  lead?: Partial<PassLead>;
  /** Contact text on the details surface. */
  value: string;
  /** The contact-icon colour on the details surface. */
  label: string;
  prefer: BandPrefer;
  voice: Voice;
};

const voice = (v: Partial<Voice>): Voice => ({
  caps: false, tracking: 0, weight: 700,
  titleCaps: false, titleTracking: 0, companyCaps: false, companyTracking: 0,
  ...v,
});

/** The panel photo, exactly as composePanelBackground() picks it. */
function mediaOf(style: TemplateStyle): BandSurface["media"] {
  const url = style.panelMediaType === "video" ? style.panelMediaPoster : style.panelMedia;
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const n = typeof style.panelDim === "number" && Number.isFinite(style.panelDim) ? style.panelDim : PANEL_DIM_DEFAULT;
  return { url, dim: Math.min(0.85, Math.max(0, n)) };
}

// ClassicPro.tsx — navy branding panel + white details panel.
function classicPro(style: TemplateStyle): RawLook {
  const accent = firstHex(style.accentColor) ?? "#2563eb";
  const details = style.surfaceColor ?? "#ffffff";
  const darkInfo = isDarkBg(details);
  return {
    band: style.bgColor ?? "linear-gradient(160deg, #0e1b35 0%, #162947 100%)",
    details,
    finish: style.finish, media: mediaOf(style),
    layers: [DOTS],
    bar: { background: `linear-gradient(90deg, ${accent}, #7c3aed)`, height: 4 },
    ink: firstHex(style.textColor) ?? "#ffffff",
    title: "#93c5fd", // text-blue-300
    company: "#ffffff", companyOver: 0.2, // text-white/80
    accent,
    rule: { at: "above-name", color: accent, width: 32, height: 2 },
    lead: { tile: "rgba(255,255,255,0.1)", monogram: { background: accent, color: "#bfdbfe" } },
    value: firstHex(style.infoColor) ?? (darkInfo ? "#ffffff" : "#0e1b35"),
    // Classic Pro draws its contact icons in the row colour, so a label in that
    // colour would be indistinguishable from its value. The card's accent —
    // the blue of its rule and foot bar — is what it uses to set things apart.
    label: accent,
    prefer: "portrait",
    voice: voice({ weight: 800, titleCaps: true, titleTracking: 0.16 }),
  };
}

// ModernBold.tsx — one near-black surface, grid texture, a blue bloom.
function modernBold(style: TemplateStyle): RawLook {
  const accent = firstHex(style.accentColor) ?? "#3b82f6";
  const band = style.bgColor ?? "#070d1c";
  const dark = isDarkBg(band);
  return {
    band, details: null,
    finish: style.finish, media: mediaOf(style),
    layers: GRID,
    glow: { color: "rgba(59,130,246,0.12)", size: 120, top: -30, right: -20 },
    ink: firstHex(style.textColor) ?? "#ffffff",
    title: accent,
    company: firstHex(style.infoColor) ?? (dark ? "#cbd5e1" : "#475569"),
    accent,
    rule: { at: "above-name", color: accent, width: 20, height: 2 },
    value: firstHex(style.infoColor) ?? (dark ? "#f1f5f9" : "#0f172a"),
    label: accent,
    prefer: "portrait",
    voice: voice({ weight: 800, tracking: -0.01, titleCaps: true, titleTracking: 0.18, companyCaps: true, companyTracking: 0.16 }),
  };
}

// PhotoFirst.tsx — violet photo panel + white details panel. NOTE the swap:
// on this template `bgColor` (and so the finish and panel photo) paints the
// DETAILS panel, and `surfaceColor` paints the photo panel.
function photoFirst(style: TemplateStyle): RawLook {
  const accent = firstHex(style.accentColor) ?? "#6d28d9";
  const details = style.bgColor ?? "#ffffff";
  const darkInfo = isDarkBg(details);
  return {
    band: style.surfaceColor ?? "linear-gradient(145deg, #4f46e5 0%, #7c3aed 60%, #6d28d9 100%)",
    details,
    layers: [PHOTO_BLOOM],
    ink: firstHex(style.textColor) ?? "#ffffff",
    nameShadow: { y: 1, blur: 4, color: "rgba(0,0,0,0.4)" },
    title: "#ddd6fe",
    company: "#ffffff", companyOver: 0.2,
    accent,
    lead: { tile: "rgba(255,255,255,0.15)" },
    value: firstHex(style.infoColor) ?? (darkInfo ? "#ffffff" : "#1e1b4b"),
    label: accent,
    prefer: "portrait",
    voice: voice({ weight: 800, titleCaps: true, titleTracking: 0.14 }),
  };
}

// LocalBusiness.tsx — amber header stripe + cream body.
function localBusiness(style: TemplateStyle): RawLook {
  const amber = firstHex(style.accentColor) ?? "#b45309";
  const amber2 = firstHex(style.accentColor) ?? "#d97706";
  const details = style.surfaceColor ?? "#fffbf0";
  const darkBody = isDarkBg(details);
  return {
    band: style.bgColor ?? `linear-gradient(100deg, ${amber} 0%, ${amber2} 60%, #f59e0b 100%)`,
    details,
    finish: style.finish, media: mediaOf(style),
    layers: [DIAGONAL],
    bar: { background: `linear-gradient(90deg, ${amber}, #f59e0b, ${amber2})`, height: 3 },
    ink: firstHex(style.textColor) ?? "#ffffff",
    nameShadow: { y: 1, blur: 4, color: "rgba(0,0,0,0.2)" },
    title: "#fef3c7",
    company: "#ffffff", companyOver: 0.15,
    accent: amber,
    lead: {
      tile: "rgba(255,255,255,0.15)",
      monogram: { background: "rgba(255,255,255,0.92)", color: "#92400e" }, // text-amber-800
    },
    value: firstHex(style.infoColor) ?? (darkBody ? "#ffffff" : "#92400e"),
    label: amber,
    prefer: "mark",
    voice: voice({ weight: 800, titleCaps: true, titleTracking: 0.12 }),
  };
}

// LuxuryMinimal.tsx — ivory, a gold foil strip down the left edge.
function luxuryMinimal(style: TemplateStyle): RawLook {
  const gold = firstHex(style.accentColor) ?? "#b08d57";
  const gold2 = firstHex(style.accentColor) ?? "#c9a96e";
  const band = style.bgColor ?? "#fafaf6";
  const dark = isDarkBg(band);
  return {
    band, details: null,
    finish: style.finish, media: mediaOf(style),
    edge: { background: `linear-gradient(180deg, ${gold2}, ${gold}, #8c6c34)`, width: 5 },
    ink: firstHex(style.textColor) ?? "#1c1612",
    title: gold,
    company: gold,
    accent: gold,
    rule: { at: "before-title", color: gold, width: 20, height: 1 },
    value: firstHex(style.infoColor) ?? (dark ? "#f2ead9" : "#1c1612"),
    label: gold,
    prefer: "type",
    voice: voice({ weight: 400, tracking: 0.01, titleCaps: true, titleTracking: 0.2, companyCaps: true, companyTracking: 0.22 }),
  };
}

/**
 * LogoFirst.tsx's own accent rule, reproduced to the letter — including that
 * it reads the COMPOSED panel background, so a card with a finish (whose
 * background is a layer list, not a hex) takes the fallback. That is what the
 * card shows, so it is what the pass shows.
 */
function logoFirstAccent(accent: string | undefined, bg: string, dark: boolean): string {
  const fallback = dark ? "#ffffff" : "#2c3a52";
  const hex6 = (v: string) => /^#?([0-9a-f]{6})$/i.exec(v)?.[1];
  const b = hex6(bg);
  const a = accent ? hex6(accent) : undefined;
  if (!b || !a) return fallback;
  const bg0 = yiq(`#${b}`);
  let [r, g, bl] = rgb(`#${a}`);
  const target = dark ? 255 : 0;
  for (let i = 0; i < 12; i++) {
    if (Math.abs((r * 299 + g * 587 + bl * 114) / 1000 - bg0) >= 60) break;
    r += (target - r) * 0.16;
    g += (target - g) * 0.16;
    bl += (target - bl) * 0.16;
  }
  const out = `#${toHex(r)}${toHex(g)}${toHex(bl)}`;
  return Math.abs(yiq(out) - bg0) >= 55 ? out : fallback;
}

// LogoFirst.tsx — one navy surface, a tinted mark column and a hairline.
function logoFirst(style: TemplateStyle): RawLook {
  const band = style.bgColor ?? "#2c3a52";
  const composed = panelBackground(style, "#2C3A52");
  const dark = isDarkBg(composed);
  // Against the base colour, as LogoFirst does: `composed` is a gradient once
  // a finish is on, and the accent always fell back to white.
  const accent = logoFirstAccent(style.accentColor, band, dark);
  return {
    band, details: null,
    finish: style.finish, media: mediaOf(style),
    leadColumn: {
      tint: dark ? "rgba(255,255,255,0.045)" : "rgba(20,27,38,0.035)",
      rule: dark ? "rgba(255,255,255,0.20)" : "rgba(20,27,38,0.14)",
    },
    ink: firstHex(style.textColor) ?? (dark ? "#ffffff" : "#141b26"),
    title: accent,
    company: firstHex(style.infoColor) ?? (dark ? "#c2ccdc" : "#3e4c63"),
    accent,
    lead: {
      tile: "transparent",
      monogram: { background: "transparent", color: accent },
      edge: dark ? "rgba(255,255,255,0.16)" : "rgba(20,27,38,0.14)",
    },
    value: firstHex(style.infoColor) ?? (dark ? "#ffffff" : "#141b26"),
    label: accent,
    prefer: "mark",
    // Name as typed, like the card (no forced capitals since 2026-09-29).
    voice: voice({ weight: 600, caps: false, tracking: 0, titleCaps: true, titleTracking: 0.14 }),
  };
}

/** CustomCard.tsx's default layout, for a "custom" card with none saved. */
const DEFAULT_CUSTOM: ResolvedCustomDesign = { background: "#0e1b35", textColor: "#ffffff", fontFamily: "" };

// CustomCard.tsx — a block layout. A coloured side panel makes it two-tone.
function customLook(c: ResolvedCustomDesign): RawLook {
  const panel = c.panelBackground;
  const bandText = panel ? (c.panelTextColor ?? c.textColor) : c.textColor;
  const bandInk = firstHex(bandText) ?? "#ffffff";
  const accent = firstHex(c.accentColor) ?? bandInk;
  return {
    band: panel ?? c.background,
    details: panel ? c.background : null,
    ink: bandInk,
    title: accent,
    company: bandInk, companyOver: 0.28,
    accent,
    value: firstHex(c.textColor) ?? "#ffffff",
    label: firstHex(c.accentColor) ?? firstHex(c.textColor) ?? "#ffffff",
    prefer: "portrait",
    voice: voice({}),
  };
}

// A design-transfer card: the card is a picture, so the only honest source
// for its colour is the picture itself. Structure still comes from the card's
// data, so the band is composed, never a crop of the face (a 1.75:1 card
// cover-cropped into a 3.05:1 band cuts the owner's own information off).
function faceLook(c: ResolvedCustomDesign, sampled: SampledSurface): RawLook {
  const ink = readableInk(sampled.bottom, c.panelTextColor ?? c.textColor);
  const accent = firstHex(c.accentColor) ?? ink;
  return {
    band: `linear-gradient(180deg, ${sampled.top} 0%, ${sampled.bottom} 100%)`,
    details: null,
    ink, title: accent, company: ink, companyOver: 0.28, accent,
    value: ink, label: accent,
    prefer: "portrait",
    voice: voice({}),
  };
}

const TEMPLATES: Record<string, (style: TemplateStyle) => RawLook> = {
  "classic-pro": classicPro,
  "modern-bold": modernBold,
  "photo-first": photoFirst,
  "local-business": localBusiness,
  "luxury-minimal": luxuryMinimal,
  "logo-first": logoFirst,
};

// ── The resolver ────────────────────────────────────────────────────────────

/** A colour sampled from a design-transfer face image, when the caller has one. */
export type SampledSurface = { top: string; bottom: string };

function resolveLook(meta: Meta, sampled?: SampledSurface | null): RawLook {
  if (meta.custom?.faceImage && sampled) return faceLook(meta.custom, sampled);
  if (meta.custom) return customLook(meta.custom);
  if (meta.template === "custom") return customLook(DEFAULT_CUSTOM);
  // The card page renders Classic Pro for a missing or retired template id.
  const build = TEMPLATES[meta.template ?? ""] ?? classicPro;
  return build(meta.style ?? {});
}

const DEFAULT_LEAD: PassLead = { tile: "", monogram: { background: "", color: "" }, edge: null };

export function passPalette(meta: Meta, sampled?: SampledSurface | null): PassPalette {
  const l = resolveLook(meta, sampled);
  const twoTone = !!l.details;

  const stops = hexStops(l.band);
  const top = stops[0] ?? "#16294a";
  const bottom = stops[stops.length - 1] ?? top;

  // Contrast is enforced against the LIGHTER end of the ramp — checking only
  // one end lets a steep gradient pass at the top and fail at the bottom,
  // which is exactly where the name sits. A template default always clears
  // it, so a real card keeps its own colour.
  const worstForInk = yiq(top) < yiq(bottom) ? bottom : top;
  const ink = readableInk(worstForInk, l.ink);
  const midpoint = mix(top, bottom, 0.5);
  const accent = readableAccent(midpoint, ink, l.accent);
  const companyBase = readableAccent(midpoint, ink, l.company);

  // The body: the card's details side on a two-tone card, else the colour the
  // band ends on — which is what makes strip and chrome one surface.
  const bodyBg = twoTone ? (lastHex(l.details) ?? WHITE) : bottom;
  const value = readableInk(bodyBg, l.value);

  const finishLayers = getFinish(l.finish).layers.slice().reverse().map((image) => ({ image }));

  return {
    top,
    bottom,
    ink,
    inkMuted: l.companyOver ? mix(companyBase, midpoint, l.companyOver) : companyBase,
    title: readableAccent(midpoint, ink, l.title),
    accent,
    nameShadow: l.nameShadow ?? null,
    rule: l.rule ? { ...l.rule, color: readableAccent(midpoint, ink, l.rule.color) } : null,
    lead: {
      tile: l.lead?.tile || withAlpha(ink, 0.1),
      monogram: l.lead?.monogram ?? { background: withAlpha(ink, 0.12), color: ink },
      edge: l.lead?.edge ?? DEFAULT_LEAD.edge,
    },
    prefer: l.prefer,
    voice: l.voice,
    surface: {
      base: twoTone ? l.band : verticalRamp(l.band),
      media: l.media ?? null,
      layers: [...finishLayers, ...(l.layers ?? [])],
      fadeTo: twoTone ? null : bottom,
      glow: l.glow ?? null,
      leadColumn: l.leadColumn ?? null,
      edge: l.edge ?? null,
      bar: l.bar ?? null,
    },
    body: {
      background: bodyBg,
      value,
      label: readableAccent(bodyBg, value, l.label),
    },
    twoTone,
  };
}
