import type { AiDesignBrief, CustomElement, CustomLayout } from "@/components/card-templates/types";

// ── AI design ────────────────────────────────────────────────────────────────
//
// Owner, 2026-09-23: in Custom design, an "AI design" button — the owner picks
// the colours and a theme for their card, and whether their headshot and logo
// go on it; "then the AI will generate them a cool custom card", which they can
// then fix up themselves (move things, make things bigger, change the font and
// the colours).
//
// HOW THE WORK IS SPLIT, and why. A language model is good at TASTE — which
// composition suits a realtor who picked navy and "Luxury", which typefaces pair,
// how to turn one brand colour into a background, a panel and an accent — and bad
// at GEOMETRY: asked for coordinates it overlaps text, hangs a long email off the
// edge and puts the QR on top of a phone number. So:
//
//   the model  picks a DesignSpec — composition, palette, fonts, type style —
//              from closed lists (designPrompt / parseDesignSpec);
//   this file  turns the spec into positioned elements with arithmetic that
//              cannot overlap: every line is sized to the room it has, stacks
//              are measured, and the QR's corner is kept clear.
//
// The result is an ordinary free design (CustomLayout.elements), rendered by
// FreeCard and edited by FreeCardEditor like any other. Contrast is enforced
// here too, whatever the model returns, so no design is ever unreadable.
//
// Pure — no fetch, no DOM — so every composition is unit-tested.

// ── Catalogue ───────────────────────────────────────────────────────────────

export const AI_THEMES = [
  { key: "modern",   label: "Modern",   blurb: "Clean shapes, confident type" },
  { key: "classic",  label: "Classic",  blurb: "Timeless and trustworthy" },
  { key: "bold",     label: "Bold",     blurb: "Big name, strong color" },
  { key: "minimal",  label: "Minimal",  blurb: "Lots of space, nothing extra" },
  { key: "luxury",   label: "Luxury",   blurb: "Refined serif, fine lines" },
  { key: "creative", label: "Creative", blurb: "Playful shapes and color" },
  { key: "tech",     label: "Tech",     blurb: "Sharp angles, modern mono" },
  { key: "nature",   label: "Natural",  blurb: "Soft, organic and warm" },
] as const;
export type AiTheme = (typeof AI_THEMES)[number]["key"];
export const AI_THEME_KEYS = AI_THEMES.map((t) => t.key) as readonly AiTheme[];

/** The colours offered in the chooser. Any hex is accepted; these are the quick picks. */
export const AI_COLOR_SWATCHES = [
  "#0f172a", "#1e3a8a", "#2563eb", "#0891b2", "#0d9488", "#15803d",
  "#65a30d", "#ca8a04", "#b45309", "#dc2626", "#be185d", "#7c3aed",
  "#4c1d95", "#78716c", "#e7e5e4", "#fafaf9",
];

/** Typefaces a card can use — all loaded site-wide or present on every system. */
export const AI_FONTS = {
  sans: "var(--font-geist-sans), system-ui, sans-serif",
  display: "var(--font-display), var(--font-geist-sans), system-ui, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  elegant: "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif",
  mono: "'Courier New', ui-monospace, monospace",
  rounded: "'Trebuchet MS', system-ui, sans-serif",
} as const;
export type AiFont = keyof typeof AI_FONTS;

export const COMPOSITIONS = [
  "split-panel", "top-band", "orb-corner", "photo-right", "diagonal", "minimal", "bold-type", "centered", "frame",
] as const;
export type Composition = (typeof COMPOSITIONS)[number];

/** Which compositions suit which theme, most characteristic first. */
const THEME_COMPOSITIONS: Record<AiTheme, Composition[]> = {
  modern:   ["split-panel", "top-band", "orb-corner", "photo-right"],
  classic:  ["minimal", "top-band", "split-panel", "frame"],
  bold:     ["bold-type", "top-band", "diagonal", "split-panel"],
  minimal:  ["minimal", "centered", "photo-right"],
  luxury:   ["frame", "centered", "minimal"],
  creative: ["orb-corner", "diagonal", "photo-right", "top-band"],
  tech:     ["diagonal", "split-panel", "minimal", "bold-type"],
  nature:   ["orb-corner", "split-panel", "centered", "photo-right"],
};

/** Type pairings the model may choose from, per theme (display, body). */
const THEME_FONTS: Record<AiTheme, [AiFont, AiFont][]> = {
  modern:   [["display", "sans"], ["sans", "sans"]],
  classic:  [["serif", "sans"], ["elegant", "serif"]],
  bold:     [["display", "sans"], ["sans", "sans"]],
  minimal:  [["sans", "sans"], ["serif", "sans"]],
  luxury:   [["elegant", "elegant"], ["elegant", "sans"], ["serif", "serif"]],
  creative: [["display", "rounded"], ["rounded", "rounded"], ["display", "sans"]],
  tech:     [["mono", "sans"], ["sans", "mono"], ["display", "mono"]],
  nature:   [["serif", "rounded"], ["elegant", "sans"], ["rounded", "rounded"]],
};

/** Palettes used when the owner picks no colour (and when the model is unavailable). */
const THEME_PALETTES: Record<AiTheme, Palette[]> = {
  modern:   [p("#0f172a", "#2563eb", "#ffffff", "#ffffff", "#60a5fa"), p("#f8fafc", "#0f172a", "#0f172a", "#ffffff", "#2563eb")],
  classic:  [p("#faf7f2", "#1f2a44", "#1f2a44", "#faf7f2", "#9a7b4f"), p("#1f2a44", "#faf7f2", "#faf7f2", "#1f2a44", "#c9a96e")],
  bold:     [p("#111827", "#f59e0b", "#ffffff", "#111827", "#f59e0b"), p("#dc2626", "#111827", "#ffffff", "#ffffff", "#fde68a")],
  minimal:  [p("#ffffff", "#f1f5f9", "#111827", "#111827", "#64748b"), p("#18181b", "#27272a", "#fafafa", "#fafafa", "#a1a1aa")],
  luxury:   [p("#0c0a09", "#1c1917", "#f5f0e6", "#f5f0e6", "#c9a96e"), p("#1a1f2e", "#232a3d", "#f3ede2", "#f3ede2", "#d4b483")],
  creative: [p("#fdf2f8", "#7c3aed", "#1e1b4b", "#ffffff", "#ec4899"), p("#1e1b4b", "#f472b6", "#ffffff", "#1e1b4b", "#fbbf24")],
  tech:     [p("#0b1120", "#0e7490", "#e2e8f0", "#ffffff", "#22d3ee"), p("#f8fafc", "#0f172a", "#0f172a", "#e2e8f0", "#0891b2")],
  nature:   [p("#f4f1ea", "#3f5f45", "#23332a", "#f4f1ea", "#8a9a5b"), p("#1f3a2d", "#e9e3d5", "#f4f1ea", "#1f3a2d", "#c8b27a")],
};

// ── Spec: what the model decides ────────────────────────────────────────────

export type Palette = {
  /** The card's ground. */
  background: string;
  /** The second surface: a panel, a band, the big shape. */
  surface: string;
  /** Text on the ground. */
  text: string;
  /** Text on the surface. */
  onSurface: string;
  /** Job title, icons, fine lines. */
  accent: string;
};
function p(background: string, surface: string, text: string, onSurface: string, accent: string): Palette {
  return { background, surface, text, onSurface, accent };
}

export type DesignSpec = {
  composition: Composition;
  palette: Palette;
  display: AiFont;
  body: AiFont;
  /** Name in capitals, or as typed. */
  nameCase: "upper" | "as-typed";
  /** "light" | "regular" | "heavy" name weight. */
  weight: "light" | "regular" | "heavy";
  /** How the job title reads. */
  titleStyle: "caps" | "italic" | "plain";
  /** Background as a soft two-stop gradient rather than flat. */
  gradient: boolean;
};

export type DesignContext = {
  name: string;
  title: string;
  company: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  hasPhoto: boolean;
  hasLogo: boolean;
};

// ── Colour maths ────────────────────────────────────────────────────────────

const HEX = /^#[0-9a-f]{6}$/i;
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function toHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}
const isDark = (hex: string) => luminance(hex) < 0.2;

/** The best readable ink for a ground: its own pick if it reads, else near-white or near-black. */
function readable(ink: string, ground: string, min = 4.5): string {
  if (HEX.test(ink) && contrast(ink, ground) >= min) return ink;
  const light = "#ffffff";
  const dark = "#111827";
  return contrast(light, ground) >= contrast(dark, ground) ? light : dark;
}

/** An accent that separates from its ground: the pick, or the pick pushed lighter/darker, or the ink. */
function visibleAccent(accent: string, ground: string, ink: string): string {
  if (HEX.test(accent) && contrast(accent, ground) >= 2.4) return accent;
  if (HEX.test(accent)) {
    const pushed = mix(accent, isDark(ground) ? "#ffffff" : "#000000", 0.45);
    if (contrast(pushed, ground) >= 2.4) return pushed;
  }
  return ink;
}

/**
 * When no ink reaches the target on a ground (a mid tone, where white and near-
 * black both fall short), move the GROUND away from the ink until it does. The
 * colour keeps its hue; only its depth changes.
 */
function settle(ground: string, ink: string, min = 4.5): string {
  if (contrast(ink, ground) >= min) return ground;
  const away = luminance(ink) > 0.5 ? "#000000" : "#ffffff";
  for (let t = 0.08; t <= 0.8; t += 0.08) {
    const g = mix(ground, away, t);
    if (contrast(ink, g) >= min) return g;
  }
  return mix(ground, away, 0.8);
}

/** Make any palette legible. The model's taste is kept wherever it already works. */
export function enforceContrast(pal: Palette): Palette {
  const bg0 = HEX.test(pal.background) ? pal.background : "#0f172a";
  const sf0 = HEX.test(pal.surface) ? pal.surface : mix(bg0, isDark(bg0) ? "#ffffff" : "#000000", 0.14);
  const text = readable(pal.text, bg0);
  const onSurface = readable(pal.onSurface, sf0);
  const background = settle(bg0, text);
  const surface = settle(sf0, onSurface);
  return { background, surface, text, onSurface, accent: visibleAccent(pal.accent, background, text) };
}

/**
 * The owner's colours turned into a palette without the model. The first
 * colour becomes the ground (dark picks) or the surface (light and bright
 * picks, which make poor grounds for a whole card); a second becomes the accent.
 */
export function paletteFromColors(colors: string[], theme: AiTheme, variant = 0): Palette {
  const picks = colors.filter((c) => HEX.test(c));
  if (!picks.length) {
    const list = THEME_PALETTES[theme];
    return list[variant % list.length];
  }
  const [a, b] = picks;
  const lightTheme = theme === "minimal" || theme === "classic" || theme === "nature" || theme === "creative";
  if (isDark(a)) {
    const accent = b ?? mix(a, "#ffffff", 0.55);
    return enforceContrast({ background: a, surface: mix(a, "#ffffff", 0.1), text: "#ffffff", onSurface: "#ffffff", accent });
  }
  if (luminance(a) > 0.75) {
    // Very light: a light ground, with the second pick (or a deep version of this one) as the surface.
    const surface = b ?? mix(a, "#000000", 0.78);
    return enforceContrast({ background: a, surface, text: "#111827", onSurface: "#ffffff", accent: b ?? mix(a, "#000000", 0.55) });
  }
  // A mid, saturated brand colour is the SURFACE on a quiet ground.
  const ground = lightTheme ? mix(a, "#ffffff", 0.93) : mix(a, "#000000", 0.82);
  return enforceContrast({ background: ground, surface: a, text: lightTheme ? "#111827" : "#ffffff", onSurface: "#ffffff", accent: b ?? a });
}

// ── The model's side ────────────────────────────────────────────────────────

/** The prompt. Only the SHAPE of the owner's details is sent — lengths, what exists — never the values. */
export function designPrompt(brief: AiDesignBrief, ctx: DesignContext, avoid: Composition[]): string {
  const theme = (AI_THEME_KEYS as readonly string[]).includes(brief.theme) ? (brief.theme as AiTheme) : "modern";
  const allowed = THEME_COMPOSITIONS[theme];
  const pairs = THEME_FONTS[theme].map(([d, b]) => `${d}+${b}`).join(", ");
  return [
    "You are an expert graphic designer choosing the look of ONE digital business card (1.75:1).",
    `Theme: ${theme}. Owner's colours: ${brief.colors.length ? brief.colors.join(", ") : "none — choose a palette that suits the theme"}.`,
    `On the card: name (${ctx.name.length} characters), ${ctx.title ? `job title (${ctx.title.length} chars)` : "no job title"}, ${ctx.company ? `company (${ctx.company.length} chars)` : "no company"}, contact lines: ${[ctx.phone && "phone", ctx.email && "email", ctx.website && "website"].filter(Boolean).join(", ") || "none"}.`,
    `Headshot on the card: ${brief.headshot ? "yes" : "no"}. Logo on the card: ${brief.logo ? "yes" : "no"}.`,
    `This is design number ${brief.variant + 1} for this owner — make it clearly different from the previous ones.`,
    "",
    "Reply with ONLY a JSON object with exactly these keys:",
    `  "composition": one of ${allowed.map((c) => `"${c}"`).join(", ")}${avoid.length ? ` — NOT ${avoid.map((c) => `"${c}"`).join(" or ")}` : ""}`,
    '  "palette": { "background", "surface", "text", "onSurface", "accent" } — each a #rrggbb hex.',
    "     background = the card's ground; surface = a second colour for a panel/band/shape; text = ink on the background;",
    "     onSurface = ink on the surface; accent = job title, icons and fine lines. Use the owner's colours as the heart of it,",
    "     keep text clearly readable, and make it look premium — not garish.",
    `  "display" and "body": fonts, as one of these pairs (display+body): ${pairs}.`,
    '  "nameCase": "upper" or "as-typed".',
    '  "weight": "light", "regular" or "heavy" (the name).',
    '  "titleStyle": "caps", "italic" or "plain".',
    '  "gradient": true or false (a soft gradient on the background).',
  ].join("\n");
}

/** Validate the model's answer against the closed lists. Anything wrong falls back field by field. */
export function parseDesignSpec(raw: unknown, brief: AiDesignBrief, avoid: Composition[]): DesignSpec {
  const theme = (AI_THEME_KEYS as readonly string[]).includes(brief.theme) ? (brief.theme as AiTheme) : "modern";
  const fallback = fallbackSpec(brief, avoid);
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;
  const allowed = THEME_COMPOSITIONS[theme];
  const composition = typeof r.composition === "string" && (allowed as string[]).includes(r.composition) && !avoid.includes(r.composition as Composition)
    ? (r.composition as Composition)
    : fallback.composition;
  const pal = (r.palette && typeof r.palette === "object" ? r.palette : {}) as Record<string, unknown>;
  const hex = (v: unknown, f: string) => (typeof v === "string" && HEX.test(v.trim()) ? v.trim().toLowerCase() : f);
  const palette = enforceContrast({
    background: hex(pal.background, fallback.palette.background),
    surface: hex(pal.surface, fallback.palette.surface),
    text: hex(pal.text, fallback.palette.text),
    onSurface: hex(pal.onSurface, fallback.palette.onSurface),
    accent: hex(pal.accent, fallback.palette.accent),
  });
  const pairOk = (d: unknown, b: unknown) => THEME_FONTS[theme].some(([x, y]) => x === d && y === b);
  const [display, body] = pairOk(r.display, r.body)
    ? [r.display as AiFont, r.body as AiFont]
    : [fallback.display, fallback.body];
  return {
    composition,
    palette,
    display,
    body,
    nameCase: r.nameCase === "upper" || r.nameCase === "as-typed" ? r.nameCase : fallback.nameCase,
    weight: r.weight === "light" || r.weight === "regular" || r.weight === "heavy" ? r.weight : fallback.weight,
    titleStyle: r.titleStyle === "caps" || r.titleStyle === "italic" || r.titleStyle === "plain" ? r.titleStyle : fallback.titleStyle,
    gradient: typeof r.gradient === "boolean" ? r.gradient : fallback.gradient,
  };
}

/** A good design with no model at all — the theme's own choices, varied by `variant`. */
export function fallbackSpec(brief: AiDesignBrief, avoid: Composition[] = []): DesignSpec {
  const theme = (AI_THEME_KEYS as readonly string[]).includes(brief.theme) ? (brief.theme as AiTheme) : "modern";
  const v = Math.max(0, Math.floor(brief.variant));
  const comps = THEME_COMPOSITIONS[theme].filter((c) => !avoid.includes(c));
  const list = comps.length ? comps : THEME_COMPOSITIONS[theme];
  const [display, body] = THEME_FONTS[theme][v % THEME_FONTS[theme].length];
  return {
    composition: list[v % list.length],
    palette: enforceContrast(paletteFromColors(brief.colors, theme, v)),
    display,
    body,
    nameCase: theme === "bold" || theme === "tech" || theme === "luxury" ? "upper" : "as-typed",
    weight: theme === "bold" ? "heavy" : theme === "minimal" || theme === "luxury" ? "light" : "regular",
    titleStyle: theme === "classic" || theme === "luxury" ? "italic" : theme === "minimal" ? "plain" : "caps",
    gradient: theme === "modern" || theme === "creative" || theme === "tech",
  };
}

// ── Geometry ────────────────────────────────────────────────────────────────

const CARD_W = 460;
const CARD_H = CARD_W / 1.75;
const pctX = (px: number) => (px / CARD_W) * 100;
const pctY = (px: number) => (px / CARD_H) * 100;
const LINE = 1.2;

/** Same per-character estimate the renderer fits with (CustomCard charEm). */
function charEm(font: string): number {
  const f = font.toLowerCase();
  if (f.includes("courier") || f.includes("mono")) return 0.61;
  if (f.includes("georgia") || f.includes("palatino") || (f.includes("serif") && !f.includes("sans"))) return 0.53;
  if (f.includes("trebuchet")) return 0.55;
  return 0.55;
}

/** The largest size ≤ max that fits `text` into `widthPx`. */
function fitSize(text: string, widthPx: number, max: number, min: number, font: string, upper = false, tracking = 0): number {
  const chars = Math.max(1, text.length);
  const per = charEm(font) * (upper ? 1.12 : 1) + tracking;
  return Math.max(min, Math.min(max, widthPx / (chars * per)));
}

type Ctx = DesignContext & { spec: DesignSpec; headshot: boolean; logo: boolean };

/** A text line of a given role, placed at (x%, y%), sized to fit `widthPx`. Returns its height in px too. */
function line(
  c: Ctx, id: string, field: NonNullable<CustomElement["field"]>, x: number, y: number, widthPx: number,
  opt: {
    max: number; min?: number; ink: string; align?: CustomElement["align"]; role: "name" | "title" | "company" | "contact";
    /** Draw it in capitals / with this letter spacing regardless of role — sized the same way. */
    upper?: boolean; tracking?: number;
  },
): { el: CustomElement; h: number } | null {
  const value = (c as unknown as Record<string, string>)[field] ?? "";
  if (!value.trim()) return null;
  const s = c.spec;
  const f = opt.role === "name" ? AI_FONTS[s.display] : AI_FONTS[s.body];
  const upper = opt.upper ?? (opt.role === "name" ? s.nameCase === "upper" : opt.role === "title" ? s.titleStyle === "caps" : false);
  const tracking = opt.tracking ?? (opt.role === "name" ? (upper ? 0.04 : -0.01) : opt.role === "title" && upper ? 0.14 : 0);
  const text = field === "address" ? value.split("\n").reduce((m, l) => (l.length > m.length ? l : m), "") : value;
  const icon = opt.role === "contact";
  // The floor is a last resort for extreme values (a 60-character email):
  // realistic details land near `max`, and the renderer applies the same fit.
  const size = fitSize(text + (icon ? "xx" : ""), widthPx, opt.max, opt.min ?? 4.5, f, upper, tracking);
  const weight = opt.role === "name" ? (s.weight === "heavy" ? 800 : s.weight === "light" ? 400 : 650)
    : opt.role === "title" ? (upper ? 600 : 500)
    : opt.role === "company" ? 600 : 400;
  const el: CustomElement = {
    id, type: "field", field, x, y,
    fontSize: Math.round(size * 10) / 10,
    color: opt.ink,
    weight,
    ...(f !== AI_FONTS[s.body] || opt.role === "name" ? { font: f } : {}),
    ...(upper ? { upper: true } : {}),
    ...(tracking ? { tracking } : {}),
    ...(opt.role === "title" && s.titleStyle === "italic" ? { italic: true } : {}),
    ...(icon ? { icon: true } : {}),
    ...(opt.align && opt.align !== "left" ? { align: opt.align } : {}),
  };
  const lines = field === "address" ? Math.min(3, value.split("\n").length) : 1;
  return { el, h: size * LINE * lines };
}

/**
 * Stack lines top-down from `topPx`, `gapPx` apart. Each entry is built by a
 * callback so it is sized before it is placed. Returns the elements and where
 * the stack ended, in px.
 */
function stack(
  topPx: number,
  entries: Array<{ gap?: number; make: (yPct: number) => { el: CustomElement; h: number } | null }>,
): { els: CustomElement[]; bottom: number } {
  let y = topPx;
  const els: CustomElement[] = [];
  for (const e of entries) {
    const made = e.make(pctY(y));
    if (!made) continue;
    els.push(made.el);
    y += made.h + (e.gap ?? 4);
  }
  return { els, bottom: y };
}

const QR_PX = 50;
const INSET = 20; // px from the card edge

function qrAt(corner: "right" | "left" = "right", size = QR_PX): CustomElement {
  return corner === "right"
    ? { id: "qr", type: "qr", x: 100 - pctX(INSET), y: 100 - pctY(INSET + size), size, align: "right" }
    : { id: "qr", type: "qr", x: pctX(INSET), y: 100 - pctY(INSET + size), size };
}

function contacts(c: Ctx, x: number, bottomPx: number, widthPx: number, ink: string, align: CustomElement["align"] = "left", max = 10.5): CustomElement[] {
  const fields = (["phone", "email", "website"] as const).filter((f) => c[f].trim());
  const rows = fields.map((f) => line(c, f, f, x, 0, widthPx, { max, min: 4.5, ink, align, role: "contact" })!).filter(Boolean);
  if (!rows.length) return [];
  // One shared size: three lines at three different sizes reads as a mistake.
  const size = Math.min(...rows.map((r) => r.el.fontSize ?? max));
  const lh = size * LINE;
  const gap = Math.max(3, size * 0.45);
  let y = bottomPx - rows.length * lh - (rows.length - 1) * gap;
  return rows.map((r) => {
    const el = { ...r.el, fontSize: size, y: pctY(y) };
    y += lh + gap;
    return el;
  });
}

function background(spec: DesignSpec): string {
  const bg = spec.palette.background;
  if (!spec.gradient) return bg;
  const toward = isDark(bg) ? "#ffffff" : "#000000";
  return `linear-gradient(135deg, ${bg} 0%, ${mix(bg, toward, 0.1)} 100%)`;
}

function imageEl(c: Ctx, kind: "headshot" | "logo", xPct: number, yPct: number, size: number, align: CustomElement["align"] = "left", frame?: CustomElement["frame"]): CustomElement {
  return {
    id: kind === "headshot" ? "photo" : "logo",
    type: kind, x: xPct, y: yPct, size: Math.round(size),
    ...(align !== "left" ? { align } : {}),
    ...(frame ? { frame } : {}),
  };
}

/** A ring behind a round headshot, in the ground colour, so it reads as set INTO a shape. */
function ringFor(centerXPct: number, topPct: number, size: number, color: string): CustomElement {
  const ring = size + 8;
  return {
    id: "photo-ring", type: "shape", shape: "circle",
    x: centerXPct - pctX(ring) / 2, y: topPct - pctY(4), w: pctX(ring), fill: color,
  };
}

// ── Compositions ────────────────────────────────────────────────────────────
// Each returns elements in paint order (shapes first). Coordinates in %, sizes
// in design px, every text line fitted to the room it actually has.

function splitPanel(c: Ctx): CustomElement[] {
  const s = c.spec.palette;
  const panelW = 36;
  const out: CustomElement[] = [
    { id: "panel", type: "shape", shape: "rect", x: 0, y: 0, w: panelW, h: 100, fill: c.spec.gradient ? `linear-gradient(160deg, ${s.surface} 0%, ${mix(s.surface, "#000000", 0.18)} 100%)` : s.surface },
  ];
  const cx = panelW / 2;
  const panelPx = (panelW / 100) * CARD_W;
  if (c.headshot && c.logo) {
    const top = (CARD_H - (88 + 18 + 46)) / 2;
    out.push(imageEl(c, "headshot", cx, pctY(top), 88, "center"));
    out.push(imageEl(c, "logo", cx, pctY(top + 88 + 18), 46, "center", "rounded"));
  } else if (c.headshot) {
    out.push(imageEl(c, "headshot", cx, 50 - pctY(96) / 2, 96, "center"));
  } else if (c.logo) {
    out.push(imageEl(c, "logo", cx, 50 - pctY(80) / 2, 80, "center", "rounded"));
  }
  // The panel carries the company when there is no picture for it — unless the
  // name is too long to read there, when it joins the text column instead.
  let panelCompany = false;
  if (!c.headshot && !c.logo && c.company) {
    // Sized as it is drawn — in capitals, tracked — so it fits the panel it sits in.
    const co = line(c, "company", "company", cx, 0, panelPx - 28, { max: 13, min: 4.5, ink: s.onSurface, align: "center", role: "company", upper: true, tracking: 0.12 });
    if (co && (co.el.fontSize ?? 0) >= 6) {
      out.push({ ...co.el, y: 50 - pctY(co.h) / 2 });
      panelCompany = true;
    }
  }
  const x = panelW + pctX(26);
  const textW = CARD_W * (1 - panelW / 100) - 26 - INSET;
  const head = stack(30, [
    { gap: 5, make: (y) => line(c, "name", "name", x, y, textW, { max: 28, min: 10, ink: s.text, role: "name" }) },
    { gap: 4, make: (y) => line(c, "title", "title", x, y, textW, { max: 11, min: 4.5, ink: s.accent, role: "title" }) },
    { gap: 0, make: (y) => (panelCompany ? null : line(c, "company", "company", x, y, textW, { max: 11, min: 4.5, ink: s.text, role: "company" })) },
  ]);
  out.push(...head.els);
  out.push(accentLine(x, head.bottom + 8, s.accent));
  out.push(...contacts(c, x, CARD_H - INSET, textW - QR_PX - 14, s.text));
  out.push(qrAt("right"));
  return out;
}

function topBand(c: Ctx): CustomElement[] {
  const s = c.spec.palette;
  const bandH = 42;
  const out: CustomElement[] = [
    { id: "band", type: "shape", shape: "rect", x: 0, y: 0, w: 100, h: bandH, fill: c.spec.gradient ? `linear-gradient(100deg, ${s.surface} 0%, ${mix(s.surface, s.accent, 0.35)} 100%)` : s.surface },
  ];
  const photo = c.headshot ? 84 : 0;
  const reserve = photo ? photo + 30 : c.logo ? 70 : 0;
  const x = pctX(INSET + 4);
  const textW = CARD_W - INSET * 2 - 8 - reserve;
  const head = stack(22, [
    { gap: 4, make: (y) => line(c, "name", "name", x, y, textW, { max: 28, min: 10, ink: s.onSurface, role: "name" }) },
    { gap: 0, make: (y) => line(c, "title", "title", x, y, textW, { max: 11, min: 4.5, ink: readable(s.accent, s.surface, 3), role: "title" }) },
  ]);
  out.push(...head.els);
  const bandPx = (bandH / 100) * CARD_H;
  if (c.headshot) {
    // Set into the band's bottom edge, on a ring of the ground colour.
    const cxPct = 100 - pctX(INSET + photo / 2);
    const top = pctY(bandPx - photo / 2);
    out.push(ringFor(cxPct, top, photo, s.background));
    out.push(imageEl(c, "headshot", cxPct, top, photo, "center"));
  } else if (c.logo) {
    out.push(imageEl(c, "logo", 100 - pctX(INSET), pctY(bandPx / 2 - 26), 52, "right", "rounded"));
  }
  const below = stack(bandPx + 16, [
    { gap: 0, make: (y) => line(c, "company", "company", x, y, CARD_W - INSET * 2 - (photo ? photo + 20 : 0), { max: 11, min: 4.5, ink: s.text, role: "company" }) },
  ]);
  out.push(...below.els);
  out.push(...contacts(c, x, CARD_H - INSET, CARD_W - INSET * 2 - 8 - QR_PX - 16, s.text));
  // Both: the logo sits in the band's top-right corner, above the photo.
  if (c.logo && c.headshot) out.push(imageEl(c, "logo", 100 - pctX(INSET), pctY(14), 34, "right", "rounded"));
  out.push(qrAt("right"));
  return out;
}

function orbCorner(c: Ctx): CustomElement[] {
  const s = c.spec.palette;
  const out: CustomElement[] = [
    { id: "orb", type: "shape", shape: "circle", x: 60, y: -38, w: 58, fill: `linear-gradient(200deg, ${s.surface} 0%, ${mix(s.surface, s.accent, 0.5)} 100%)` },
    { id: "orb-small", type: "shape", shape: "circle", x: -9, y: 86, w: 14, fill: s.accent, opacity: 0.28 },
  ];
  const x = pctX(INSET + 4);
  if (c.headshot) {
    const size = 84;
    const cxPct = 100 - pctX(INSET + 18 + size / 2);
    out.push(ringFor(cxPct, pctY(22), size, s.background));
    out.push(imageEl(c, "headshot", cxPct, pctY(22), size, "center"));
  } else if (c.logo) {
    out.push(imageEl(c, "logo", 100 - pctX(INSET + 22), pctY(28), 60, "right", "rounded"));
  }
  const textW = CARD_W * 0.5;
  if (c.logo && c.headshot) out.push(imageEl(c, "logo", x, pctY(INSET), 34, "left", "rounded"));
  const head = stack(c.logo && c.headshot ? 68 : 42, [
    { gap: 5, make: (y) => line(c, "name", "name", x, y, textW, { max: 27, min: 10, ink: s.text, role: "name" }) },
    { gap: 3, make: (y) => line(c, "title", "title", x, y, textW, { max: 11, min: 4.5, ink: s.accent, role: "title" }) },
    { gap: 0, make: (y) => line(c, "company", "company", x, y, textW, { max: 11, min: 4.5, ink: s.text, role: "company" }) },
  ]);
  out.push(...head.els);
  out.push(...contacts(c, x, CARD_H - INSET, CARD_W - INSET * 2 - 8 - QR_PX - 16, s.text));
  out.push(qrAt("right"));
  return out;
}

/** A short accent rule under a heading block — the detail that makes a layout look designed. */
function accentLine(xPct: number, topPx: number, color: string): CustomElement {
  return { id: "accent-line", type: "shape", shape: "rect", x: xPct, y: pctY(topPx), w: pctX(30), h: pctY(2), fill: color, radius: 1 };
}

function photoRight(c: Ctx): CustomElement[] {
  const s = c.spec.palette;
  const out: CustomElement[] = [];
  const size = c.headshot ? 118 : c.logo ? 92 : 0;
  const cxPct = 100 - pctX(INSET + 6 + size / 2);
  const top = pctY(INSET + 6);
  if (size) {
    out.push({ id: "halo", type: "shape", shape: "circle", x: cxPct - pctX(size + 30) / 2, y: top - pctY(15), w: pctX(size + 30), fill: s.surface, opacity: 0.9 });
    out.push(imageEl(c, c.headshot ? "headshot" : "logo", cxPct, top, size, "center", c.headshot ? "circle" : "rounded"));
  }
  const x = pctX(INSET + 4);
  const textW = CARD_W - INSET * 2 - 8 - (size ? size + 44 : 0);
  if (c.headshot && c.logo) out.push(imageEl(c, "logo", x, pctY(INSET), 32, "left", "rounded"));
  const head = stack(c.headshot && c.logo ? 62 : 36, [
    { gap: 5, make: (y) => line(c, "name", "name", x, y, textW, { max: 26, min: 10, ink: s.text, role: "name" }) },
    { gap: 3, make: (y) => line(c, "title", "title", x, y, textW, { max: 11, min: 4.5, ink: s.accent, role: "title" }) },
    { gap: 0, make: (y) => line(c, "company", "company", x, y, textW, { max: 11, min: 4.5, ink: s.text, role: "company" }) },
  ]);
  out.push(...head.els);
  out.push(accentLine(x, head.bottom + 8, s.accent));
  // Clear of the QR in the corner, with or without a photo above it.
  out.push(...contacts(c, x, CARD_H - INSET, Math.min(textW, CARD_W - INSET * 2 - 8 - 44 - 16), s.text));
  out.push(qrAt("right", 44));
  return out;
}

function diagonal(c: Ctx): CustomElement[] {
  const s = c.spec.palette;
  const out: CustomElement[] = [
    { id: "slant", type: "shape", shape: "rect", x: 58, y: -35, w: 70, h: 170, rotate: 16, fill: c.spec.gradient ? `linear-gradient(180deg, ${s.surface} 0%, ${mix(s.surface, "#000000", 0.2)} 100%)` : s.surface },
    { id: "slant-line", type: "shape", shape: "rect", x: 55, y: -35, w: 1.2, h: 170, rotate: 16, fill: s.accent },
  ];
  const x = pctX(INSET + 4);
  const textW = CARD_W * 0.5;
  if (c.headshot) {
    out.push(imageEl(c, "headshot", 100 - pctX(INSET + 52), pctY(26), 80, "center", "circle"));
  } else if (c.logo) {
    out.push(imageEl(c, "logo", 100 - pctX(INSET + 50), pctY(34), 66, "center", "rounded"));
  }
  if (c.headshot && c.logo) out.push(imageEl(c, "logo", x, pctY(INSET), 34, "left", "rounded"));
  const head = stack(c.headshot && c.logo ? 66 : 38, [
    { gap: 5, make: (y) => line(c, "name", "name", x, y, textW, { max: 26, min: 10, ink: s.text, role: "name" }) },
    { gap: 3, make: (y) => line(c, "title", "title", x, y, textW, { max: 11, min: 4.5, ink: s.accent, role: "title" }) },
    { gap: 0, make: (y) => line(c, "company", "company", x, y, textW, { max: 11, min: 4.5, ink: s.text, role: "company" }) },
  ]);
  out.push(...head.els);
  out.push(accentLine(x, head.bottom + 8, s.accent));
  // The slant leans in toward the bottom, so the contact lines get less room than the name.
  out.push(...contacts(c, x, CARD_H - INSET, 190, s.text));
  out.push(qrAt("right"));
  return out;
}

function minimal(c: Ctx): CustomElement[] {
  const s = c.spec.palette;
  const out: CustomElement[] = [];
  const x = pctX(INSET + 6);
  const reserve = (c.headshot ? 78 : 0) + (c.logo ? (c.headshot ? 50 : 62) : 0);
  const textW = CARD_W - INSET * 2 - 12 - reserve;
  const head = stack(INSET + 10, [
    { gap: 5, make: (y) => line(c, "name", "name", x, y, textW, { max: 26, min: 10, ink: s.text, role: "name" }) },
    { gap: 10, make: (y) => line(c, "title", "title", x, y, textW, { max: 10.5, min: 4.5, ink: s.accent, role: "title" }) },
  ]);
  out.push(...head.els);
  out.push({ id: "rule", type: "shape", shape: "rect", x, y: pctY(head.bottom), w: pctX(34), h: pctY(2), fill: s.accent });
  const co = stack(head.bottom + 12, [
    { gap: 0, make: (y) => line(c, "company", "company", x, y, textW, { max: 11, min: 4.5, ink: s.text, role: "company" }) },
  ]);
  out.push(...co.els);
  if (c.headshot) out.push(imageEl(c, "headshot", 100 - pctX(INSET), pctY(INSET), 66, "right", "circle"));
  else if (c.logo) out.push(imageEl(c, "logo", 100 - pctX(INSET), pctY(INSET), 50, "right", "rounded"));
  // Both: the logo to the left of the photo, on the same line.
  if (c.headshot && c.logo) out.push(imageEl(c, "logo", 100 - pctX(INSET + 66 + 10), pctY(INSET + 13), 40, "right", "rounded"));
  out.push(...contacts(c, x, CARD_H - INSET, CARD_W - INSET * 2 - 12 - QR_PX - 18, s.text, "left", 10));
  out.push(qrAt("right", 46));
  return out;
}

function boldType(c: Ctx): CustomElement[] {
  const s = c.spec.palette;
  const out: CustomElement[] = [];
  const x = pctX(INSET + 2);
  const reserve = (c.headshot ? 70 : 0) + (c.logo ? (c.headshot ? 50 : 56) : 0);
  const textW = CARD_W - INSET * 2 - 6 - reserve;
  const name = line(c, "name", "name", x, pctY(INSET + 6), textW, { max: 40, min: 10, ink: s.text, role: "name" });
  let y = INSET + 6;
  if (name) {
    out.push({ ...name.el, weight: Math.max(name.el.weight ?? 800, 800) });
    y += name.h + 6;
  }
  out.push({ id: "bar", type: "shape", shape: "rect", x, y: pctY(y), w: pctX(64), h: pctY(6), fill: s.accent, radius: 3 });
  y += 14;
  const rest = stack(y, [
    { gap: 3, make: (yy) => line(c, "title", "title", x, yy, textW, { max: 11.5, min: 4.5, ink: s.text, role: "title" }) },
    { gap: 0, make: (yy) => line(c, "company", "company", x, yy, textW, { max: 11, min: 4.5, ink: s.text, role: "company" }) },
  ]);
  out.push(...rest.els);
  if (c.headshot) out.push(imageEl(c, "headshot", 100 - pctX(INSET), pctY(INSET), 62, "right", "rounded"));
  else if (c.logo) out.push(imageEl(c, "logo", 100 - pctX(INSET), pctY(INSET), 50, "right", "rounded"));
  if (c.headshot && c.logo) out.push(imageEl(c, "logo", 100 - pctX(INSET + 62 + 10), pctY(INSET + 11), 40, "right", "rounded"));
  out.push(...contacts(c, x, CARD_H - INSET, CARD_W - INSET * 2 - 6 - QR_PX - 18, s.text, "left", 10));
  out.push(qrAt("right", 46));
  return out;
}

function centered(c: Ctx, framed = false): CustomElement[] {
  const s = c.spec.palette;
  const out: CustomElement[] = [];
  if (framed) {
    out.push({ id: "frame", type: "shape", shape: "rect", x: pctX(10), y: pctY(10), w: 100 - pctX(20), h: 100 - pctY(20), fill: "transparent", stroke: s.accent, strokeWidth: 1, radius: 8 });
  }
  const cx = 50;
  const textW = CARD_W - 150;
  let y = framed ? 26 : 20;
  const mark = c.headshot ? "headshot" : c.logo ? "logo" : null;
  if (mark) {
    const size = mark === "headshot" ? 56 : 46;
    out.push(imageEl(c, mark, cx, pctY(y), size, "center", mark === "headshot" ? "circle" : "rounded"));
    y += size + 8;
  }
  const head = stack(y, [
    { gap: 4, make: (yy) => line(c, "name", "name", cx, yy, textW, { max: 24, min: 10, ink: s.text, role: "name", align: "center" }) },
    { gap: 6, make: (yy) => line(c, "title", "title", cx, yy, textW, { max: 10.5, min: 4.5, ink: s.accent, role: "title", align: "center" }) },
  ]);
  out.push(...head.els);
  out.push({ id: "rule", type: "shape", shape: "rect", x: cx - pctX(18), y: pctY(head.bottom), w: pctX(36), h: pctY(1.5), fill: s.accent });
  const rows = (["phone", "email", "website"] as const).filter((f) => c[f].trim());
  // The contact lines stay centred and clear of the QR's corner.
  const cw = CARD_W - 2 * (INSET + QR_PX + 14) - (framed ? 20 : 0);
  const contactEls = contacts(c, cx, CARD_H - (framed ? INSET + 12 : INSET), cw, s.text, "center", 9.5);
  const top = Math.min(...contactEls.map((e) => (e.y / 100) * CARD_H), CARD_H);
  if (rows.length && top < head.bottom + 8) {
    // Not enough room under the rule for every line: drop the website first.
    out.push(...contactEls.filter((e) => e.field !== "website"));
  } else {
    out.push(...contactEls);
  }
  if (c.headshot && c.logo) out.push(imageEl(c, "logo", pctX(framed ? INSET + 16 : INSET), 100 - pctY((framed ? INSET + 16 : INSET) + 30), 30, "left", "rounded"));
  const q = qrAt("right", 40);
  out.push(framed ? { ...q, x: 100 - pctX(INSET + 16), y: 100 - pctY(INSET + 16 + 40) } : q);
  return out;
}

const BUILDERS: Record<Composition, (c: Ctx) => CustomElement[]> = {
  "split-panel": splitPanel,
  "top-band": topBand,
  "orb-corner": orbCorner,
  "photo-right": photoRight,
  diagonal,
  minimal,
  "bold-type": boldType,
  centered: (c) => centered(c, false),
  frame: (c) => centered(c, true),
};

/** Turn a spec into a finished free design. */
export function buildDesign(spec: DesignSpec, ctx: DesignContext, brief: AiDesignBrief): CustomLayout {
  const c: Ctx = {
    ...ctx,
    spec,
    // Only what the owner asked for AND has: a headshot slot with no photo is a hole on the card.
    headshot: brief.headshot && ctx.hasPhoto,
    logo: brief.logo && ctx.hasLogo,
  };
  const elements = BUILDERS[spec.composition](c).map((e) => ({
    ...e,
    x: Math.round(e.x * 100) / 100,
    y: Math.round(e.y * 100) / 100,
    ...(e.w !== undefined ? { w: Math.round(e.w * 100) / 100 } : {}),
    ...(e.h !== undefined ? { h: Math.round(e.h * 100) / 100 } : {}),
  }));
  return {
    background: background(spec),
    textColor: spec.palette.text,
    accentColor: spec.palette.accent,
    fontFamily: AI_FONTS[spec.body],
    elements,
    ai: { theme: brief.theme, colors: brief.colors, headshot: brief.headshot, logo: brief.logo, variant: brief.variant },
  };
}

/** Which composition a free design was built with — so "Try another" can avoid repeating it. */
export function compositionOf(layout: CustomLayout | null | undefined): Composition | null {
  const ids = new Set((layout?.elements ?? []).map((e) => e.id));
  if (ids.has("panel")) return "split-panel";
  if (ids.has("band")) return "top-band";
  if (ids.has("orb")) return "orb-corner";
  if (ids.has("halo")) return "photo-right";
  if (ids.has("slant")) return "diagonal";
  if (ids.has("frame")) return "frame";
  if (ids.has("bar")) return "bold-type";
  if (ids.has("rule")) return (layout?.elements ?? []).some((e) => e.id === "rule" && e.align === undefined && e.x < 30) ? "minimal" : "centered";
  return null;
}

// ── A copied layout, made editable ──────────────────────────────────────────
// "Copy a card or template you like" can copy just the LAYOUT ("Make it
// editable blocks instead", and always for an Office team). That used to land
// in the block editor, which Custom design no longer has — so the copied
// layout is rebuilt here as a free design with the same colours, font, panel
// and marks, which the owner then fine-tunes like any AI design.

const firstHex = (v: string | undefined): string | null => (v ?? "").match(/#[0-9a-f]{6}/i)?.[0]?.toLowerCase() ?? null;

function nearestFont(stack: string | undefined): AiFont {
  const f = (stack ?? "").toLowerCase();
  if (f.includes("courier") || f.includes("mono")) return "mono";
  if (f.includes("palatino")) return "elegant";
  if (f.includes("georgia") || (f.includes("serif") && !f.includes("sans"))) return "serif";
  if (f.includes("trebuchet")) return "rounded";
  if (f.includes("--font-display")) return "display";
  return "sans";
}

export function freeFromBlocks(layout: CustomLayout, ctx: DesignContext): CustomLayout {
  const on = (layout.blocks ?? []).filter((b) => b.on);
  const has = (t: string) => on.some((b) => b.type === t);
  const composition: Composition = layout.skeleton === "stacked"
    ? "top-band"
    : on.some((b) => b.zone === "left") || layout.panelBackground ? "split-panel" : "minimal";
  const bg = firstHex(layout.background) ?? "#0f172a";
  const palette = enforceContrast({
    background: bg,
    surface: firstHex(layout.panelBackground) ?? mix(bg, isDark(bg) ? "#ffffff" : "#000000", 0.1),
    text: firstHex(layout.textColor) ?? "#ffffff",
    onSurface: firstHex(layout.panelTextColor) ?? firstHex(layout.textColor) ?? "#ffffff",
    accent: firstHex(layout.accentColor) ?? firstHex(layout.textColor) ?? "#ffffff",
  });
  const font = nearestFont(layout.fontFamily);
  const spec: DesignSpec = { composition, palette, display: font, body: font, nameCase: "as-typed", weight: "regular", titleStyle: "caps", gradient: false };
  const brief: AiDesignBrief = { theme: "modern", colors: [], headshot: has("headshot"), logo: has("logo"), variant: 0 };
  const built = buildDesign(spec, ctx, brief);
  // Not an AI design: no brief, so "Try another" isn't offered for it.
  const { ai: _ai, ...rest } = built;
  void _ai;
  return { ...rest, background: palette.background };
}
