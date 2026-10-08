// ── Copy a card: an uploaded design, re-issued to the owner as an EDITABLE card ──
//
// The owner uploads a picture of a card design they like (their old printed
// card, a template screenshot, someone else's card). What comes back is a FREE
// design (components/card-templates FreeCard): the design's ARTWORK — colours,
// panels, shapes, borders, with every letter, logo and face left out — as an
// image under the card, and the owner's own details on top as real elements,
// placed where the original's text sat. The owner then edits it like any AI
// design: drag anything, resize it, restyle it (components/FreeCardEditor).
//
// Why the labour is divided this way (owner, 2026-10-08, after two months of
// a model-drawn "exact copy"): the image model is pixel-faithful at artwork
// and unreliable at everything else — it misspells names, keeps the original
// owner's email, keeps the Starbucks siren where the owner's logo should be,
// and copies the whole photo or mockup as if it were the card. So:
//   • the card is FOUND and cut out of whatever surrounds it, in the source
//     and again in every generated image (lib/card-flatten);
//   • the model draws ONLY artwork, and a vision check rejects artwork that
//     still carries text, a logo or a face, naming what it kept;
//   • the owner's details are never model-drawn — they are our elements, so a
//     phone number cannot come back misspelled and a logo is always theirs.
//
// This file is pure: prompts, parsers and the layout maths. No fetch, so tests
// pin what the model is asked and what its answers can become.

import type { CustomElement, CustomLayout } from "@/components/card-templates/types";
import { AI_FONTS, type AiFont } from "@/lib/ai-card-design";
import { quadCoverage, quadFromCorners, type Pt } from "@/lib/card-flatten";

export type TransferIdentity = {
  name: string;
  title?: string | null;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  address?: string | null;
  /** Whether the owner has a headshot / logo to place. */
  hasHeadshot?: boolean;
  hasLogo?: boolean;
};

// ── A REDRAW, not an edit (owner, 2026-10-06) ───────────────────────────────
//
// Most uploads are a photo of the owner's own paper card. Asked to "edit" that
// image, the model kept the photo — paper grain, lamp light, shadows, the tilt.
// So the artwork prompt asks for a NEW, clean, digital drawing of the design,
// the design is read first into a written spec (true colours, corrected for
// the room's light), and the output check rejects anything that still looks
// like a photograph.

/** What the redraw must never carry over from a photo. One list, used by the
 *  artwork prompt and named in the output check, so the two can't drift. */
const PHOTO_TRAITS =
  "no paper texture or grain, no lighting, glare, shine or vignette, no shadows, no creases or curl, no perspective or tilt, no blur, no rounded photo corners, nothing around the card";

/** Asked of the vision model before any drawing: the design, in words. */
export const DESIGN_SPEC_PROMPT = [
  "This image shows a business card design (it may be a photo of a printed card).",
  "Describe the DESIGN precisely enough for a graphic designer to redraw it as a",
  "clean digital file. Plain text, at most 170 words, in this order:",
  "1. Base colour of the card as #rrggbb — the colour it was PRINTED in. Correct for",
  "   the room's lighting and white balance: cream or white paper under warm light",
  "   is still cream or white, not yellow; a shadow does not darken the colour.",
  "2. Every other colour (bands, panels, shapes, text) as #rrggbb and what it is used for.",
  "3. Graphic elements — shapes, stripes, borders, patterns, illustrations —",
  "   with their position (e.g. 'left third', 'top-right corner') and size.",
  "4. Layout: where the name, title, contact lines, logo and any photo sit, and",
  "   their alignment.",
  "5. Typography: serif or sans-serif, weight, ALL CAPS or not, letter-spacing.",
  "6. Special finishes as their flat look (gold foil = flat gold #c9a24a, embossing =",
  "   ignore, spot gloss = ignore).",
  "Do NOT transcribe any of the card's text, names, numbers or addresses.",
  "Do NOT describe the logo's subject — say only where it sits and how big it is.",
  "Do NOT mention the photo, the table, the hand or the lighting.",
].join("\n");

/** Model text → a prompt-safe spec block, or "" when it is unusable. */
export function cleanDesignSpec(raw: string | null | undefined): string {
  if (!raw) return "";
  const t = raw.replace(/```[a-z]*|```/gi, "").replace(/\r/g, "").trim();
  if (t.length < 40) return "";
  return t.slice(0, 1400);
}

const specLines = (spec?: string): string[] =>
  spec ? ["", "THE DESIGN, as read from the reference (colours are the true printed colours — use these exact values):", spec, ""] : [""];

// ── What the ORIGINAL card says — so the gate can recognise it ──────────────
//
// The leak gate used to know only the OWNER's details: anything else on the
// output was a leak. That catches a foreign email but not a foreign NAME, a
// company, a website or the original's logo — the model can't be caught
// keeping "Starbucks" if nothing knows the source said Starbucks. So the
// source card is read once, into facts, and every generated image is checked
// against them. The facts never reach a prompt that draws; they are only
// compared.

export const SOURCE_FACTS_PROMPT = [
  "Read this business card. Transcribe what is printed on it so a later check",
  "can recognise any of it on a different image. Return ONLY valid JSON:",
  '{"names":["person names"],"companies":["company or organisation names in text"],',
  ' "brands":["the brand each logo or emblem belongs to, e.g. Starbucks; or a 2-4 word',
  '  description of the mark if unknown, e.g. green siren in a circle"],',
  ' "emails":[],"phones":[],"websites":[],"addresses":[],"taglines":["slogans or quotes"]}',
  "Empty arrays if none. Do not include anything else.",
].join("\n");

export type SourceFacts = {
  names: string[]; companies: string[]; brands: string[];
  emails: string[]; phones: string[]; websites: string[]; addresses: string[]; taglines: string[];
};

const strs = (v: unknown, max = 12): string[] =>
  (Array.isArray(v) ? v : []).filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim().slice(0, 120)).slice(0, max);

/** Scan JSON → facts. Junk reads as no facts (the gate then falls back to the owner-only rules). */
export function sourceFacts(raw: unknown): SourceFacts {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    names: strs(r.names), companies: strs(r.companies), brands: strs(r.brands),
    emails: strs(r.emails), phones: strs(r.phones), websites: strs(r.websites),
    addresses: strs(r.addresses), taglines: strs(r.taglines),
  };
}

export const EMPTY_FACTS: SourceFacts = { names: [], companies: [], brands: [], emails: [], phones: [], websites: [], addresses: [], taglines: [] };

// ── The artwork pass ─────────────────────────────────────────────────────────
//
// The model reproduces ONLY the artwork. The owner's details, headshot and logo
// go on as our own elements, so nothing here may keep a letter, a logo or a
// face: where the original had one, the background continues underneath.
export function stripArtworkPrompt(spec?: string): string {
  return [
    "The image is a REFERENCE: a business card design, often a photo of a printed",
    "paper card. Redraw its ARTWORK as a brand-new, clean, flat DIGITAL graphic —",
    "same background colour, same colours, gradients, panels, shapes, borders and",
    "decorative artwork, at the same positions and sizes — as crisp vector-style",
    `art, straight-on. Never reproduce the photograph: ${PHOTO_TRAITS}.`,
    ...specLines(spec),
    "LEAVE OUT COMPLETELY, with no trace: all text and lettering of every kind",
    "(names, titles, numbers, addresses, slogans, initials, monograms), every logo,",
    "emblem, brand mark, icon and wordmark, every QR code and barcode, and every",
    "photograph of a person. Where something was left out, continue the",
    "underlying background or panel seamlessly, as if it had never been there.",
    "Do NOT add anything new — no text, no logo, no placeholder, no sample name.",
    "",
    "FRAMING: your output is the card's face and nothing else. It fills the",
    "ENTIRE canvas edge to edge — no margin, no backdrop, no mockup, no drop",
    "shadow, no table, no second card, no rounded card corners on a background.",
    "Output only the clean artwork.",
  ].join("\n");
}

// ── Measuring the design: where everything sits ─────────────────────────────
//
// A vision model MEASURES the uploaded design — surfaces, positions, colours,
// sizes, type — and the owner's details are placed at those measurements as
// free elements. It never transcribes content: only the owner's own values
// are ever printed.

export type FaceElementKind =
  | "name" | "title" | "company" | "phone" | "email" | "website" | "address"
  | "headshot" | "logo";

export type FaceFont = "sans" | "serif" | "display" | "elegant" | "mono" | "rounded";

export type FaceElement = {
  kind: FaceElementKind;
  /** Percent of the card, 0–100; (x,y) is the element's top-left. */
  x: number; y: number; w: number; h: number;
  align: "left" | "center" | "right";
  color: string;
  weight: "normal" | "bold";
  size: "xs" | "sm" | "md" | "lg" | "xl";
  caps?: boolean;
  /** Circular crop (headshots / logos). */
  round?: boolean;
  /** A small icon precedes this contact line. */
  icon?: boolean;
};

export type FaceLayout = {
  background: string;
  panels: { x: number; y: number; w: number; h: number; color: string }[];
  serif?: boolean;
  font?: FaceFont;
  elements: FaceElement[];
};

/** What the vision model is asked for. Measurements only — it never invents
 *  content, because the renderer only prints the owner's own values. */
export const PRECISE_SCAN_PROMPT = [
  "You are measuring a business card design so it can be rebuilt exactly.",
  "Report the design's GEOMETRY, COLOURS AND TYPE. Do NOT transcribe any text values.",
  "",
  "Return ONLY valid JSON:",
  '{"background":"#rrggbb","font":"sans"|"serif"|"display"|"elegant"|"mono"|"rounded",',
  ' "panels":[{"x":0,"y":0,"w":35,"h":100,"color":"#rrggbb"}],',
  ' "elements":[{"kind":"name","x":40,"y":18,"w":50,"h":10,"align":"left",',
  '   "color":"#rrggbb","weight":"bold","size":"xl","caps":false,"round":false,"icon":false}]}',
  "",
  "All x,y,w,h are PERCENT of the card (0-100), x,y = top-left corner of the",
  "element's own box (the text's ink, the photo's frame).",
  "background = the card's base surface. panels = every OTHER solid surface:",
  "  colored bands, side panels, footer bars, accent stripes (thin bars are",
  "  panels with small h or w).",
  "font = the main typeface's family: sans (plain sans-serif), serif (with",
  "  serifs), display (heavy geometric/condensed headline sans), elegant",
  "  (light refined serif), mono (typewriter), rounded (soft rounded sans).",
  'elements: one entry per piece of content, kinds only from this list:',
  '  "name","title","company","phone","email","website","address" (text),',
  '  "headshot","logo" (images). Skip QR codes entirely.',
  'size = relative text prominence: "xl" the largest text, "xs" the smallest;',
  '  h = the height of that text line, so size can be checked against it.',
  '"caps": true when the text is in ALL CAPS. "icon": true when a small symbol',
  '  (phone, envelope, globe, pin) sits just before a contact line.',
  '"round": true when the photo/logo is displayed in a circle.',
  "Measure carefully — where things sit is the whole job. Omit what is not there.",
].join("\n");

const clamp = (v: unknown, lo: number, hi: number, fb: number): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fb;
  return Math.min(hi, Math.max(lo, n));
};
const hex = (v: unknown, fb: string): string =>
  typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : fb;

const KINDS = new Set<FaceElementKind>(["name", "title", "company", "phone", "email", "website", "address", "headshot", "logo"]);
const FONTS = new Set<FaceFont>(["sans", "serif", "display", "elegant", "mono", "rounded"]);

// Design px on the 1400×800 canvas, by prominence tier. Measured against
// printed-card conventions (name ≈ 2-3× body size). Declared before
// faceLayoutFromScan because the bounds pass needs real glyph heights.
const FACE_PX: Record<FaceElement["size"], number> = { xs: 26, sm: 32, md: 42, lg: 58, xl: 84 };

/** Model output → a measured layout. Whitelist + clamp everything; a hostile
 *  or confused reading can only produce a plain card, never bad values. */
export function faceLayoutFromScan(raw: unknown): FaceLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const panels = (Array.isArray(r.panels) ? r.panels : []).slice(0, 8).flatMap((p) => {
    if (!p || typeof p !== "object") return [];
    const q = p as Record<string, unknown>;
    return [{
      x: clamp(q.x, 0, 100, 0), y: clamp(q.y, 0, 100, 0),
      w: clamp(q.w, 0.5, 100, 10), h: clamp(q.h, 0.5, 100, 10),
      color: hex(q.color, "#e5e7eb"),
    }];
  });
  const seen = new Set<string>();
  const elements = (Array.isArray(r.elements) ? r.elements : []).slice(0, 16).flatMap((e) => {
    if (!e || typeof e !== "object") return [];
    const q = e as Record<string, unknown>;
    const kind = typeof q.kind === "string" ? (q.kind.toLowerCase() as FaceElementKind) : null;
    if (!kind || !KINDS.has(kind) || seen.has(kind)) return [];
    seen.add(kind);
    return [{
      kind,
      x: clamp(q.x, 0, 96, 5), y: clamp(q.y, 0, 96, 5),
      w: clamp(q.w, 2, 100, 40), h: clamp(q.h, 2, 100, 10),
      align: (q.align === "center" || q.align === "right" ? q.align : "left") as FaceElement["align"],
      color: hex(q.color, "#111827"),
      weight: q.weight === "normal" ? "normal" as const : "bold" as const,
      size: (["xs", "sm", "md", "lg", "xl"] as const).includes(q.size as never) ? (q.size as FaceElement["size"]) : "md",
      caps: q.caps === true,
      round: q.round === true,
      icon: q.icon === true,
    }];
  });
  const background = hex(r.background, "#ffffff");

  // ── Rescue passes over the measured elements ──────────────────────────────
  // The model's measurements are kept wherever they're usable, but two classes
  // of reading produced visibly broken cards in production (2026-08-18 probe):
  // an element COLORED for one surface but POSITIONED on another (white name
  // on a white panel), and an element measured so low/right that its glyphs
  // rendered half off the canvas. Both are fixed here, in the pure validator,
  // so they're testable without a model.
  const yiqOf = (h: string): number | null => {
    const m = /^#([0-9a-f]{6})$/i.exec(h);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000;
  };
  // The surface actually under a point: the LAST matching panel wins, matching
  // paint order in the renderer (later panels draw on top).
  const surfaceAt = (x: number, y: number): string => {
    let c = background;
    for (const p of panels) {
      if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) c = p.color;
    }
    return c;
  };
  for (const e of elements) {
    if (e.kind === "headshot" || e.kind === "logo") {
      // Images: slide fully onto the canvas.
      if (e.x + e.w > 100) e.x = Math.max(0, 100 - e.w);
      if (e.y + e.h > 100) e.y = Math.max(0, 100 - e.h);
      continue;
    }
    // Text: the box must hold the GLYPHS, not just the measured h — an "xl"
    // line is ~11% of the card tall regardless of what the model said.
    const glyphH = ((FACE_PX[e.size] * 1.3) / 800) * 100;
    const needH = Math.max(e.h, glyphH);
    if (e.y + needH > 98) e.y = Math.max(0, 98 - needH);
    if (e.x + e.w > 100) e.x = Math.max(0, 100 - e.w);
    // Unreadable ink for the surface it actually sits on → flip to whichever
    // pole contrasts. A readable measured color (accents included) is kept.
    const sy = yiqOf(surfaceAt(e.x + e.w / 2, e.y + needH / 2));
    const ty = yiqOf(e.color);
    if (sy !== null && ty !== null && Math.abs(sy - ty) < 70) {
      e.color = sy < 140 ? "#ffffff" : "#141b26";
    }
  }

  // Thin accent bars (underlines, rules) measured at the original text's
  // position land mid-glyph once OUR value renders taller or lower than the
  // original — a line through the owner's name (seen in the 2026-08-18 sweep).
  // A bar that crosses a text element's glyph box slides to just below it,
  // which is where an underline was always meant to sit.
  for (const p of panels) {
    if (p.h > 3) continue; // only rules/underlines, never real surfaces
    for (const e of elements) {
      if (e.kind === "headshot" || e.kind === "logo") continue;
      const glyphH = ((FACE_PX[e.size] * 1.3) / 800) * 100;
      const top = e.y, bottom = e.y + Math.max(e.h, glyphH);
      const overlapsX = p.x < e.x + e.w && p.x + p.w > e.x;
      const crossesText = p.y + p.h > top + 1 && p.y < bottom - 1;
      if (overlapsX && crossesText) p.y = Math.min(100 - p.h, bottom + 0.5);
    }
  }

  if (!elements.some((e) => e.kind === "name")) {
    // A reading without a name slot was REJECTED at first — and that killed
    // real, otherwise-good readings in production (the model sometimes labels
    // the big text something else, or the elements list truncates). The name
    // is the one thing we can always place sensibly ourselves: right of the
    // widest full-height side panel, dark-on-light or light-on-dark.
    const side = panels
      .filter((p) => p.x <= 2 && p.h >= 80 && p.w < 60)
      .reduce((m, p) => Math.max(m, p.x + p.w), 0);
    const n = parseInt(background.slice(1), 16);
    const lum = (((n >> 16) & 255) * 299 + (((n >> 8) & 255) * 587) + ((n & 255) * 114)) / 1000;
    elements.unshift({
      kind: "name", x: Math.min(side + 5, 60), y: 14, w: Math.max(30, 90 - side), h: 12,
      align: "left", color: lum < 128 ? "#ffffff" : "#111827", weight: "bold", size: "xl",
      caps: false, round: false, icon: false,
    });
  }
  const font = typeof r.font === "string" && FONTS.has(r.font as FaceFont) ? (r.font as FaceFont) : r.serif === true ? "serif" : undefined;
  return { background, panels, serif: font === "serif" || font === "elegant", font, elements };
}

// ── The measured layout → a free design the owner can edit ──────────────────
//
// Positions are % of the card and sizes are design px at the 460-wide card,
// exactly what FreeCard draws and FreeCardEditor moves (CustomCard.tsx). Only
// what the owner HAS goes on: a slot with nothing to show would render as a
// placeholder in the editor and as nothing on the published card.

/** The card's design size (FREE_CARD_W in CustomCard.tsx, 1.75:1). */
const CARD_W = 460;
const CARD_H = CARD_W / 1.75;
/** FACE_PX tiers on the 1400 canvas → design px on the 460 card. */
const TIER_PX: Record<FaceElement["size"], number> = { xs: 8.5, sm: 10.5, md: 14, lg: 19, xl: 27.5 };
const TEXT_KINDS = ["name", "title", "company", "phone", "email", "website", "address"] as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

const fontStack = (f?: FaceFont): string => AI_FONTS[(f && f in AI_FONTS ? f : "sans") as AiFont];

export function freeLayoutFromFace(
  face: FaceLayout,
  id: TransferIdentity,
  opts: { bgImage?: string | null },
): CustomLayout {
  const value = (k: FaceElementKind): string => {
    switch (k) {
      case "name": return id.name || "";
      case "title": return id.title?.trim() || "";
      case "company": return id.company?.trim() || "";
      case "phone": return id.phone?.trim() || "";
      case "email": return id.email?.trim() || "";
      case "website": return id.website?.trim() || "";
      case "address": return id.address?.trim() || "";
      default: return "";
    }
  };
  const measured = new Map(face.elements.map((e) => [e.kind, e] as const));
  const nameEl = measured.get("name");
  const textColor = nameEl?.color ?? "#111827";
  const accent = face.panels.find((p) => p.color !== face.background && p.h > 3)?.color
    ?? measured.get("title")?.color ?? textColor;

  const elements: CustomElement[] = [];

  // No artwork image (the strip pass failed): the measured surfaces become
  // editable shapes, so the colours and panels still come through.
  if (!opts.bgImage) {
    face.panels.forEach((p, i) => {
      elements.push({ id: `panel-${i + 1}`, type: "shape", shape: "rect", x: round2(p.x), y: round2(p.y), w: round2(p.w), h: round2(p.h), fill: p.color });
    });
  }

  // Pictures first, so text paints over them.
  for (const kind of ["headshot", "logo"] as const) {
    const e = measured.get(kind);
    const has = kind === "headshot" ? id.hasHeadshot : id.hasLogo;
    if (!e || !has) continue;
    const size = Math.round(Math.min(220, Math.max(24, Math.min((e.w / 100) * CARD_W, (e.h / 100) * CARD_H))));
    elements.push({
      id: kind, type: kind, x: round2(e.x), y: round2(e.y), size,
      frame: e.round ? "circle" : kind === "logo" ? "square" : "rounded",
    });
  }
  // A logo the owner has but the scan found no slot for: top-right, unless
  // something measured already lives there. The owner can drag it anywhere.
  if (id.hasLogo && !elements.some((e) => e.type === "logo")) {
    const busy = face.elements.some((e) => e.x + e.w > 70 && e.y < 30);
    if (!busy) elements.push({ id: "logo", type: "logo", x: 95.5, y: 8, size: 44, align: "right", frame: "square" });
  }

  // Text, at the measured positions.
  const placed: { el: CustomElement; bottom: number; fontSize: number }[] = [];
  for (const kind of TEXT_KINDS) {
    const e = measured.get(kind);
    const text = value(kind);
    if (!e || !text) continue;
    const tier = TIER_PX[e.size];
    // The measured line height is the better size when it is plausible for
    // the tier; a wild h (the model boxed the whole paragraph) falls back.
    const byH = ((e.h / 100) * CARD_H) / 1.3;
    const fontSize = round2(Math.min(44, Math.max(7, byH >= tier * 0.6 && byH <= tier * 1.5 ? (byH + tier) / 2 : tier)));
    const x = e.align === "center" ? e.x + e.w / 2 : e.align === "right" ? e.x + e.w : e.x;
    const el: CustomElement = {
      id: kind, type: "field", field: kind, x: round2(x), y: round2(e.y), fontSize,
      color: e.color, weight: e.weight === "bold" ? 700 : 400,
      ...(e.align !== "left" ? { align: e.align } : {}),
      ...(e.caps ? { upper: true, tracking: 0.08 } : {}),
      ...(e.icon && kind !== "name" && kind !== "title" && kind !== "company" ? { icon: true } : {}),
    };
    elements.push(el);
    placed.push({ el, bottom: e.y + ((fontSize * 1.2) / CARD_H) * 100, fontSize });
  }

  // Details the owner has that the original had no slot for: stacked under the
  // lowest contact line, in its style (or under the name when there is none).
  const anchor = [...placed].sort((a, b) => b.bottom - a.bottom)[0];
  if (anchor) {
    let y = anchor.bottom;
    for (const kind of TEXT_KINDS) {
      const text = value(kind);
      if (!text || measured.get(kind)) continue;
      const contactLike = anchor.el.field !== "name" && anchor.el.field !== "title";
      const fontSize = contactLike ? anchor.fontSize : 10.5;
      y += contactLike ? 0.6 : 2;
      if (y > 90) break;
      elements.push({
        id: kind, type: "field", field: kind, x: anchor.el.x, y: round2(y), fontSize,
        color: contactLike ? anchor.el.color : textColor, weight: 400,
        ...(anchor.el.align ? { align: anchor.el.align } : {}),
        ...(anchor.el.upper ? { upper: true, tracking: 0.08 } : {}),
        ...(kind !== "company" ? { icon: !!anchor.el.icon } : {}),
      });
      y += ((fontSize * 1.2) / CARD_H) * 100;
    }
  }

  // The live QR, bottom-right where every design puts it — bottom-left when
  // the original keeps that corner busy (something's CENTRE sits there; a
  // contact line merely reaching into it is the owner's to nudge).
  const QR = 50, INSET = 20;
  const bottomRightBusy = face.elements.some((e) => e.x + e.w / 2 > 80 && e.y + e.h / 2 > 68);
  elements.push(
    bottomRightBusy
      ? { id: "qr", type: "qr", x: round2((INSET / CARD_W) * 100), y: round2(100 - ((INSET + QR) / CARD_H) * 100), size: QR }
      : { id: "qr", type: "qr", x: round2(100 - (INSET / CARD_W) * 100), y: round2(100 - ((INSET + QR) / CARD_H) * 100), size: QR, align: "right" },
  );

  return {
    background: face.background,
    textColor,
    accentColor: accent,
    fontFamily: fontStack(face.font),
    elements,
    ...(opts.bgImage ? { bgImage: opts.bgImage } : {}),
  };
}

/** What the approval UI asks the owner to eyeball. The text is ours now, so
 *  the list is about the artwork and the arrangement, not spelling. */
export function transferChecklist(id: TransferIdentity): string[] {
  const items = ["Nothing from the original card — its logo, name or any lettering — is still in the artwork"];
  items.push(id.hasLogo ? "Your logo sits where theirs was" : "The original logo is gone (add yours in Card details to place it)");
  items.push("Your details sit where you want them — drag anything to move it, drag the corner dot to resize");
  return items;
}

// ── The output check ─────────────────────────────────────────────────────────
//
// The model was ORDERED to leave text, logos and faces out, and orders aren't
// guarantees: in live tests it kept an email beside the design (2026-08-19),
// a street address (2026-08-26), the paper look (2026-10-06) and the original
// brand's logo (2026-10-08). One vision pass reads the generated image back:
// everything printed on it, whether it looks like a photo, and where the card
// sits in the frame (the model likes to draw it small on a backdrop).

export const OUTPUT_CHECK_PROMPT = [
  "Inspect this image of a business card design and report, as JSON:",
  "- emails, phones, addresses, websites: every one printed on it.",
  "- names: every person's name printed on it.",
  "- companies: every company, organisation or brand NAME printed as text.",
  "- logos: every logo, emblem, brand mark or wordmark drawn on it — name the",
  "  brand (e.g. Starbucks) or describe the mark in 2-4 words. Plain decorative",
  "  shapes, stripes and borders are NOT logos.",
  "- looksLikePhoto: true when it looks like a PHOTOGRAPH of a physical card rather",
  "  than a clean flat digital graphic — visible paper surface or grain, uneven",
  "  lighting, glare or vignette, cast shadows, perspective or tilt, curled or",
  "  physical edges. A flat digital design that intentionally uses a texture or a",
  "  photo is still false.",
  "- cardCorners: the four corners of the card's face within THIS image, as",
  "  PERCENT of the image width and height, in order top-left, top-right,",
  "  bottom-right, bottom-left. If the card fills the whole image edge to edge,",
  "  [[0,0],[100,0],[100,100],[0,100]]. If it is drawn smaller — on a backdrop,",
  "  with a margin, with a drop shadow, as a mockup — give the card's own edge.",
  "Return ONLY valid JSON:",
  '{"emails":[],"phones":[],"addresses":[],"websites":[],"names":[],"companies":[],',
  ' "logos":[],"looksLikePhoto":false,"cardCorners":[[0,0],[100,0],[100,100],[0,100]]}',
  "Empty arrays if none. Do not include anything else.",
].join("\n");

export type OutputProblems = {
  /** Text or marks on the output that must not be there, as read. */
  leaks: string[];
  /** Still looks like a photograph of paper. */
  photo: boolean;
  /** The card was drawn small, in a scene or mockup — too little of the frame is card. */
  scene: boolean;
};

export const hasProblems = (p: OutputProblems): boolean => p.leaks.length > 0 || p.photo || p.scene;

/** The frame share below which a generated card is a scene, not a card. Above
 *  it, the card is simply cut out (lib/card-flatten cropToQuad). */
export const MIN_CARD_COVERAGE = 0.45;

/**
 * Scan JSON → what is wrong with a generated image, plus the quad to cut the
 * card out with when it doesn't fill the frame. `artwork` mode is the strip
 * pass: NOTHING readable may be on it, so every transcription is a leak.
 * Junk reads as clean.
 */
export function outputProblems(
  scan: unknown,
  id: TransferIdentity,
  source: SourceFacts = EMPTY_FACTS,
  opts: { artwork?: boolean; width?: number; height?: number } = {},
): OutputProblems & { quad: Pt[] | null } {
  const r = (scan && typeof scan === "object" ? scan : {}) as Record<string, unknown>;
  const photo = r.looksLikePhoto === true;
  const leaks = opts.artwork ? artworkLeaks(scan) : findLeaks(scan, id, source);
  let quad: Pt[] | null = null;
  let scene = false;
  const W = opts.width ?? 100, H = opts.height ?? 100;
  const q = quadFromCorners(r.cardCorners, W, H);
  if (q) {
    if (quadCoverage(q, W, H) < MIN_CARD_COVERAGE) scene = true;
    else quad = q;
  }
  return { leaks, photo, scene, quad };
}

/** The corrective lines for a retry, naming every problem the check found. */
export function retrySuffix(p: OutputProblems): string {
  return [
    ...(p.leaks.length ? [leakRetrySuffix(p.leaks)] : []),
    ...(p.photo
      ? [
          "",
          "YOUR PREVIOUS ATTEMPT looked like a photograph of a paper card. Redraw it",
          `as a clean, flat DIGITAL graphic: ${PHOTO_TRAITS}. Even, solid colours.`,
        ]
      : []),
    ...(p.scene
      ? [
          "",
          "YOUR PREVIOUS ATTEMPT drew the card small, with a backdrop, margin or scene",
          "around it. The card's face must fill the ENTIRE canvas edge to edge —",
          "no margin, no background, no shadow, no mockup, nothing around it.",
        ]
      : []),
  ].join("\n");
}

const digits = (s: string) => s.replace(/\D/g, "");
/** Lowercase letters+digits, single-spaced — the shape two readings of the same text share. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** Same text, allowing for OCR noise and partial reads: equal, or one inside the other. */
const same = (a: string, b: string): boolean => {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x));
};
const host = (u: string) => u.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

/**
 * What on the generated card is NOT the owner's. Emails, phones, addresses
 * and websites: anything that isn't the owner's own. Names, companies and
 * logos: anything that is the SOURCE card's (and not also the owner's) — a
 * stray word can't be judged without knowing what the original said.
 */
export function findLeaks(scan: unknown, id: TransferIdentity, source: SourceFacts = EMPTY_FACTS): string[] {
  if (!scan || typeof scan !== "object") return [];
  const r = scan as Record<string, unknown>;
  const leaks: string[] = [];
  const okEmail = (id.email ?? "").trim().toLowerCase();
  for (const e of strs(r.emails, 20)) {
    if (e.toLowerCase() !== okEmail) leaks.push(e);
  }
  const okPhone = digits(id.phone ?? "");
  for (const p of strs(r.phones, 20)) {
    const d = digits(p);
    // Same last-10 rule the SMS suppression uses; short fragments are noise.
    if (d.length >= 7 && d.slice(-10) !== okPhone.slice(-10)) leaks.push(p);
  }
  // A street address that isn't the owner's is the same failure as a foreign
  // email (live case 2026-08-26: identity had no address, and the source
  // card's survived). Compared on digits+first-word so OCR punctuation/casing
  // noise can't make the owner's own address read as a leak.
  const okAddr = norm(id.address ?? "");
  for (const a of strs(r.addresses, 20)) {
    const n = norm(a);
    if (n.length < 6) continue; // fragments are noise
    if (!okAddr || !okAddr.includes(n.split(" ").slice(0, 2).join(" "))) leaks.push(a);
  }
  const okHost = host(id.website ?? "");
  for (const w of strs(r.websites, 20)) {
    const h = host(w);
    if (h.length >= 4 && h.includes(".") && h !== okHost) leaks.push(w);
  }
  // The source's own words. The owner's name/company are allowed even when
  // they happen to match (someone copying their own old card).
  const ownerWords = [id.name, id.company ?? ""].filter(Boolean) as string[];
  const isOwner = (s: string) => ownerWords.some((o) => same(o, s));
  const sourceNames = [...source.names];
  const sourceBrands = [...source.companies, ...source.brands, ...source.taglines];
  for (const n of strs(r.names, 20)) {
    if (!isOwner(n) && sourceNames.some((s) => same(s, n))) leaks.push(n);
  }
  for (const c of strs(r.companies, 20)) {
    if (!isOwner(c) && sourceBrands.some((s) => same(s, c))) leaks.push(c);
  }
  // A logo is a leak when it is the source's mark, or when the owner has no
  // logo at all and one is drawn anyway (nothing should be there).
  for (const l of strs(r.logos, 20)) {
    if (isOwner(l)) continue;
    if (sourceBrands.some((s) => same(s, l)) || !id.hasLogo) leaks.push(l);
  }
  return leaks;
}

/** The artwork pass may carry NOTHING readable: every transcription is a leak. */
export function artworkLeaks(scan: unknown): string[] {
  if (!scan || typeof scan !== "object") return [];
  const r = scan as Record<string, unknown>;
  return (["emails", "phones", "addresses", "websites", "names", "companies", "logos"] as const)
    .flatMap((k) => strs(r[k], 20))
    .filter((s) => norm(s).length >= 2);
}

/** One corrective sentence for the retry attempt. */
export function leakRetrySuffix(leaks: string[]): string {
  return [
    "",
    `YOUR PREVIOUS ATTEMPT FAILED: it kept ${leaks.map((l) => `"${l}"`).join(" and ")}`,
    "from the original card. Remove every trace of it — the text, the logo, the",
    "mark — and continue the background where it was. None of it may appear",
    "anywhere on the output.",
  ].join("\n");
}
