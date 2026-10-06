// ── The custom card's layout engine ─────────────────────────────────────────
//
// Pure logic, no React, no hooks — so the SERVER renderer (CustomCard) and the
// CLIENT editor (CustomCardDesigner) run the exact same rules. That shared
// origin is what makes the editor honest: it previews with the real renderer at
// the real 460 design width, rather than approximating it on its own canvas.
//
// The design rule everything follows from: BLOCKS FLOW, THEY DO NOT FLOAT.
// The old designer stored x/y percentages and absolute font sizes, which made
// four failure modes reachable by ordinary use — overlapping text, values
// clipped by the card edge, layouts that looked different once published, and
// alignment that drifted a percent or two off. None of them are reachable here,
// because nothing is positioned and no size is typed in.

import type {
  AiDesignBrief, CardData, CardEmphasis, CardSkeleton, CardZone, CustomBlock, CustomElement, CustomLayout,
} from "@/components/card-templates/types";
import { fitName, fitPx } from "@/components/card-templates/shared";

// ── How big a line of text is drawn — ONE rule, for the renderer AND the model ──
//
// A field is drawn at its emphasis size x the card's density, and then made
// smaller again for its own length (a long title, an unbroken email that has to
// fit its column). The density model used to know only the first half, so it
// planned for lines it would never draw and solved a full card far smaller than
// it needed to be — the details sat in the top half with the rest empty (owner,
// 2026-10-02: "maximize their space"). CustomCard draws with this function and
// the model measures with it, so the two cannot disagree.

/** The smallest a custom card's text is ever drawn, design px. */
export const TEXT_MIN_PX = 6.5;
/** Fields drawn with a contact icon in front of the text. */
const ICON_FIELDS = new Set(["phone", "fax", "email", "website", "address"]);

export function fieldHasIcon(block: CustomBlock): boolean {
  return block.type === "field" && ICON_FIELDS.has(block.field ?? "");
}

/**
 * The font size a field or text block is drawn at, given its density-scaled
 * size `fs` and the text it prints. `zonePx` is the width the renderer fits an
 * unbroken token against (the main zone, or a share of it).
 */
export function textBlockPx(block: CustomBlock, shown: string, fs: number, zonePx = 248): number {
  // Auto-fit by length so a long value shrinks instead of overflowing. The name
  // additionally fits by longest WORD, the same rule the preset templates use.
  // An email or a domain is ONE unbroken token: it either fits its column or it
  // splits mid-word, so anything without a space is ALSO clamped to the zone's
  // real width (0.6em per character errs small rather than splitting); prose
  // with spaces just wraps.
  let sized = block.field === "name" ? fitName(fs, shown, 16) : fitPx(fs, shown, block.emphasis === "hero" ? 18 : 26);
  if (!/\s/.test(shown)) {
    const chars = shown.length + (fieldHasIcon(block) ? 2 : 0);
    sized = Math.min(sized, Math.max(fs * 0.4, Math.min(fs, zonePx / Math.max(1, chars * 0.6))));
  }
  return Math.max(Math.min(TEXT_MIN_PX, fs), sized);
}

// ── Sizing ──────────────────────────────────────────────────────────────────
// Design px at the 460 natural card width, exactly like the preset templates.
// Owners choose an EMPHASIS; the engine owns the number. That is the difference
// between "make my name bigger" and knowing that 22 is the right value.
// Hero is 26, not 22. At 22 a fork came out visibly smaller and emptier than the
// template it was forked from — the preset templates run their names at 23 to 28
// — and looking like a downgrade of the card you just chose is the one outcome
// that would make this feature feel worse than not using it.
const EMPHASIS_PX: Record<CardEmphasis, number> = { hero: 25, normal: 13, quiet: 10 };
const EMPHASIS_IMG: Record<CardEmphasis, number> = { hero: 108, normal: 84, quiet: 62 };

/** Text blocks that carry a written value, i.e. the ones that cost vertical room. */
const TEXT_TYPES = new Set(["field", "text", "social", "socials"]);

/**
 * The side panel holds MARKS, not sentences.
 *
 * It is a third of the card wide, and a single unbroken token — a handle, an
 * email — either fits that column or splits mid-word. Fitting by character
 * count and then by measured pixels both failed to converge; the fuzz kept
 * finding a size where a handle broke. The honest answer is that there is no
 * good rendering of a job title at hero size in 116px, so the layout does not
 * offer one. Every preset already puts only a logo, headshot or QR there.
 *
 * Enforced in the renderer as well as hidden in the editor, so an older or
 * hand-edited layout can't put text there either.
 */
export function zoneFor(block: CustomBlock): CardZone {
  return TEXT_TYPES.has(block.type) ? "right" : block.zone;
}

// ── The card is a FIXED size, so the content has to be solved for ───────────
//
// The card used to GROW when it ran out of room. It doesn't any more — a
// business card is 1.75:1 in the hand and the owner's is 1.75:1 on screen no
// matter what they put on it — so the height that used to be the release valve
// is now a hard budget, and the model has to be good enough to live inside it.
//
// The old model counted weighted ROWS. Sweeping every reachable shape against
// the fixed box showed exactly where that breaks: it cannot see WRAPPING. An
// address is one row and three rendered lines, so cards with four blocks
// overflowed while cards with nine did not, and no amount of tuning a
// rows-based curve fixes a model that is blind to the dominant term.
//
// So this estimates rendered PIXELS instead. Every quantity below is a design px
// at the 460 natural card width, measured off the real renderer.

/** The card's own height: 460 / 1.75. */
const CARD_PX = 460 / 1.75;

// Every number below is READ OFF THE RENDERER, not guessed. Where the renderer
// says `maxHeight: px * 0.72` or `size: round(px * 0.68)`, that factor appears
// here — a model that invents its own constants is a second implementation of
// the layout, and it will drift.

/** CustomBlockContent renders text at lineHeight 1.25. */
const LINE = 1.25;

/** Zone puts `marginTop: round(5 * density)` on EVERY block in the main column. */
const GAP_PX = 5;

/** Usable text width in the main column, with and without a side panel. */
const MAIN_W_PANEL = 236;
const MAIN_W_FULL = 396;

/** Mean glyph advance as a fraction of font size, for the app's stacks. */
const CHAR_W = 0.52;

/** Vertical padding: main column, and the side panel. */
const MAIN_PAD_SPLIT = 30;   // 16 top + 14 bottom
const MAIN_PAD_STACKED = 24; // 10 top + 14 bottom
const SIDE_PAD = 32;         // 16 + 16

/** Rendered heights, as the renderer computes them from blockImagePx. */
const LOGO_F = 0.72;     // img maxHeight: px * 0.72
const QR_F = 0.68;       // MiniQR size: round(px * 0.68)
const HEADSHOT_CAP = 116; // img height: min(px, 116)
const DIVIDER_PX = 2;

/**
 * The smallest a QR may be drawn, in design px at the 460 card.
 *
 * Shared with the renderer, and it has to be: the floor makes the code BIGGER
 * than the density solve asked for, so a model that didn't know about it would
 * budget for a 27px code and the card would draw a 34px one — the overflow this
 * whole engine exists to prevent.
 */
export const QR_MIN_PX = 34;

/**
 * Socials FLOW: they fill across the row and wrap down.
 *
 *   linkedin  tiktok    instagram
 *   facebook  youtube   snapchat
 *
 * Each social used to be its own block on its own full-width row, so six of
 * them were six rows — most of a card spent on handles, and the density model
 * then shrank everything else to make room for rows that were mostly empty.
 *
 * Exported and used by BOTH the renderer and the sizing model. If they grouped
 * differently the model would budget for rows the card doesn't draw, which is
 * the exact class of bug that made the card overflow before.
 */
export const SOCIAL_COLS = 3;

/** Runs of adjacent social blocks become one group; everything else stays itself. */
export function groupSocials(blocks: CustomBlock[]): (CustomBlock | CustomBlock[])[] {
  const out: (CustomBlock | CustomBlock[])[] = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    if (b.type !== "social") { out.push(b); continue; }
    if (Array.isArray(last)) last.push(b);
    else out.push([b]);
  }
  return out;
}

/** How many share a row: three when there are three or more, else the count. */
export function socialCols(count: number): number {
  return Math.min(SOCIAL_COLS, Math.max(1, count));
}

/** The drawn height of an image block at density 1. */
function imagePx(block: CustomBlock, scale = 1): number {
  const px = EMPHASIS_IMG[block.emphasis] * scale;
  if (block.type === "logo") return px * LOGO_F;
  if (block.type === "headshot") return Math.min(px, HEADSHOT_CAP);
  if (block.type === "qr") return px * QR_F;
  return px;
}

/**
 * What one main-column block occupies, in design px, at density 1.
 *
 * Text WRAPS, so this is `lines x fontSize x lineHeight` rather than one row per
 * block — being blind to wrapping is what made the previous row-count model
 * mispredict by up to 130px. The per-block gap matters just as much at the other
 * end: eleven quiet blocks are 137px of text and 55px of gaps, so a model that
 * folded the gap into the line height under-counted the smallest cards worst.
 *
 * Without `data` (the designer's placeholder mode) every string is a short
 * stand-in, which is exactly what placeholder mode draws.
 */
function blockPx(block: CustomBlock, data: CardData | undefined, width: number, placeholder: boolean, d: number): number {
  // The gap the renderer puts on every main-column block: round(5 x density).
  const gap = Math.round(GAP_PX * d);
  if (!TEXT_TYPES.has(block.type)) {
    if (block.type === "divider") return DIVIDER_PX + gap;
    return imagePx(block) * Math.min(1.1, d) + gap;
  }
  // Real text first, ALWAYS — including in the designer. Sizing the preview off
  // a stand-in while the published card sizes off a 60-character address is how
  // a WYSIWYG editor stops being one. The stand-in is only for the blocks that
  // genuinely have nothing yet, which are exactly the ones placeholder mode
  // draws a `{name}` chip for, and those chips take room too.
  const text = (data ? blockTextForFit(block, data) : "") || (placeholder ? "{placeholder}" : "");
  if (!text) return 0;
  // Wrapping is counted AT THE SIZE THE TEXT WILL BE DRAWN (owner, 2026-10-02:
  // "maximize their space"). It used to be counted at full size and the whole
  // estimate then scaled down — but smaller text wraps onto FEWER lines, so a
  // full card was solved for lines it would never draw: every field at the
  // limits came out at the 0.42 floor with half the card empty below it.
  const fs = blockFontPx(block.emphasis, d);
  // …and at the size the RENDERER draws it — after its own length fit
  // (textBlockPx), which is smaller than `fs` for every long value.
  const isSocial = block.type === "social" || block.type === "socials";
  const sized = isSocial ? fs : textBlockPx(block, text, fs);
  // The contact icon and its gap take width from the text beside them.
  const textW = width - (fieldHasIcon(block) ? fs * 1.05 + Math.max(5, fs * 0.5) : 0);
  // Ceil, because half a rendered line still occupies a whole one. Split on
  // HARD breaks first: the address arrives as up to three lines joined by \n
  // and the renderer sets `white-space: pre-line` for it, so counting its
  // characters alone modelled a three-line address as one.
  const perLine = Math.max(1, Math.floor(textW / (sized * CHAR_W)));
  const lines = text
    .split("\n")
    .reduce((n, seg) => n + Math.max(1, Math.ceil(seg.length / perLine)), 0);
  // A line is never shorter than its icon (the row centres the two).
  const lineH = Math.max(sized * LINE, fieldHasIcon(block) ? fs * 1.05 : 0);
  return Math.max(1, lines) * lineH + gap;
}

/**
 * The string a block will render, for LENGTH purposes only.
 *
 * Deliberately not the renderer's exact formatting — a formatted phone is four
 * characters longer than the raw one, which is inside the safety margin — but it
 * has to see the same PRESENCE, so a block with no value costs nothing here just
 * as it draws nothing there.
 */
function blockTextForFit(block: CustomBlock, data: CardData): string {
  if (!blockHasValue(block, data)) return "";
  if (block.type === "text") return block.text ?? "";
  if (block.type === "social" || block.type === "socials") return "@handle_placeholder";
  const c = data.customization;
  switch (block.field) {
    case "name": return data.name ?? "";
    case "title": return data.title ?? "";
    case "company": return data.company ?? "";
    case "phone": return (data.phone || c?.phones?.find((p) => p?.showOnCard)?.number) ?? "";
    case "email": return data.email ?? "";
    case "website": return data.website ?? "";
    case "address": return data.address ?? "";
    case "fax": return `Fax: ${c?.fax ?? ""}`;
    default: return "";
  }
}

/**
 * The height each zone takes, in design px, with everything drawn at density
 * `d` — text at its real size (and therefore its real wrapping), images and
 * gaps scaled as the renderer scales them, padding fixed, and the QR never
 * below its floor.
 *
 * Padding is the part that doesn't shrink — it is written in fixed px and
 * stays there however small the type gets. Stacked cards carry 56px of it (a
 * band and a column).
 */
function zoneHeights(
  blocks: CustomBlock[], skeleton: CardSkeleton | undefined, data: CardData | undefined, placeholder: boolean,
  // Whether the renderer will actually DRAW a side panel. It is not the same
  // question as "are there side blocks": a coloured panel survives an empty
  // side zone, so an owner who has not uploaded a logo yet still gets a panel
  // and a main column 30% narrower than a full-width one.
  panelShown: boolean | undefined,
  d: number,
): { main: number; side: number } {
  const on = blocks.filter((b) => b.on);
  const stacked = skeleton === "stacked";
  const side = on.filter((b) => zoneFor(b) === "left");
  const hasPanel = panelShown ?? side.length > 0;
  const width = hasPanel && !stacked ? MAIN_W_PANEL : MAIN_W_FULL;

  const qr = on.find((b) => zoneFor(b) === "right" && b.type === "qr");
  const main = on.filter((b) => zoneFor(b) === "right" && b.type !== "qr");

  // Socials are grouped with the SAME rule the renderer groups them by, so the
  // budget counts the rows that will actually be drawn.
  const mainText = groupSocials(main).reduce((n, g) => {
    if (!Array.isArray(g)) return n + blockPx(g, data, width, placeholder, d);
    const shown = data ? g.filter((b) => blockHasValue(b, data)) : g;
    if (!shown.length) return n;
    const rows = Math.ceil(shown.length / socialCols(shown.length));
    return n + rows * blockFontPx(shown[0].emphasis, d) * LINE + Math.round(GAP_PX * d);
  }, 0);
  // The QR sits in its own bottom row, outside Zone, so it carries no gap, and
  // its floor is ABSOLUTE: the renderer refuses to draw it smaller.
  const qrPx = qr ? Math.max(QR_MIN_PX, imagePx(qr) * Math.min(1.1, d)) : 0;
  const mainPx = mainText + qrPx + (stacked ? MAIN_PAD_STACKED : MAIN_PAD_SPLIT);

  // The side panel's Zone is rendered with gap 0, so its blocks stack flush.
  const scale = sideImageScale(skeleton);
  const sideImgs = side.map((b) => imagePx(b, scale) * Math.min(1.1, d));
  const sidePx = side.length === 0 ? 0
    // A band is a ROW: its height is its tallest item, not their sum.
    : (stacked ? Math.max(...sideImgs) : sideImgs.reduce((n, h) => n + h, 0)) + (hasPanel ? SIDE_PAD : 0);

  return { main: mainPx, side: sidePx };
}

/** Total design px the content wants at density 1. */
export function contentPx(
  blocks: CustomBlock[], skeleton?: CardSkeleton, data?: CardData, placeholder = false, panelShown?: boolean,
): number {
  const h = zoneHeights(blocks, skeleton, data, placeholder, panelShown, 1);
  return skeleton === "stacked" ? h.main + h.side : Math.max(h.main, h.side);
}

/**
 * Density factor: shrink everything TOGETHER so hierarchy survives and nothing
 * has to be cut. Solved directly — the content wants `contentPx` and the card
 * has CARD_PX, so the scale is their ratio.
 *
 * SAFETY is the margin between a model and a renderer. Wrapping is estimated
 * from a mean glyph width, so a line of capitals or a run of wide characters
 * lands slightly over; 0.9 buys back more than the sweep's worst observed
 * error. Costing more than it needs to only makes a card slightly smaller than
 * it could be. Costing less makes it wrong.
 *
 * FLOOR is legibility, not fit. Past it the answer is "your card is full", which
 * is what MAX_VISIBLE_BLOCKS says — and the floor is set low enough that the
 * cap, not the floor, is always what an owner actually meets.
 */
const SAFETY = 0.9;
/**
 * Low enough that the SOLVE always wins.
 *
 * A floor that binds is a floor that overflows: clamping density UP to keep
 * type readable is the same as deciding to cut the card off, and cutting a
 * phone number in half is worse than setting it small. Nine blocks all set to
 * Big on a banded card is the only shape that reaches down here, no real card
 * looks like that, and the editor's counter warns long before it. So this
 * exists to stop a hand-edited payload dividing by something absurd, not to
 * make aesthetic decisions.
 */
const FLOOR = 0.42;
const CEILING = 1.14;

/** The largest density in [FLOOR, CEILING] at which `height(d)` fits the card. */
function solveDensity(height: (d: number) => number): number {
  const room = CARD_PX * SAFETY;
  if (height(CEILING) <= room) return CEILING;
  if (height(FLOOR) > room) return FLOOR;
  // Height rises with density (bigger type, never fewer lines), so the largest
  // fitting density is found by bisection. 24 steps is far below 0.01px.
  let lo = FLOOR, hi = CEILING;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (height(mid) <= room) lo = mid; else hi = mid;
  }
  return lo;
}

/** The main column's density: its text, gaps and QR (and, stacked, the band above it). */
export function blockDensity(
  blocks: CustomBlock[], skeleton?: CardSkeleton, data?: CardData, placeholder = false, panelShown?: boolean,
): number {
  return solveDensity((d) => {
    const h = zoneHeights(blocks, skeleton, data, placeholder, panelShown, d);
    // Stacked, the zones ADD — the band sits above the main column. Side by
    // side they don't share height, so the main column answers for itself.
    return skeleton === "stacked" ? h.main + h.side : h.main;
  });
}

/**
 * The side panel's own density. Side by side, the panel is a column of its own
 * with the card's full height, so a busy main column must not shrink its logo
 * and headshot — on a full card they came out as a dot in an empty panel.
 * Stacked, the band and the column share the height, so they share the density.
 */
export function sideDensity(
  blocks: CustomBlock[], skeleton?: CardSkeleton, data?: CardData, placeholder = false, panelShown?: boolean,
): number {
  if (skeleton === "stacked") return blockDensity(blocks, skeleton, data, placeholder, panelShown);
  return solveDensity((d) => zoneHeights(blocks, skeleton, data, placeholder, panelShown, d).side);
}

/** Side-band images sit above the text when stacked, so they cost real height. */
export function sideImageScale(skeleton?: CardSkeleton): number {
  return skeleton === "stacked" ? 0.78 : 1;
}

/**
 * How much a card can hold.
 *
 * Not an arbitrary limit — it is the point past which no amount of shrinking
 * keeps the card readable. There used to be a second, softer answer to a card
 * that was too full: grow it. That is gone, so this is the only one, and it is
 * enforced in BOTH places on purpose — the editor stops you before you get
 * there and says why, and the renderer trims defensively so a hand-edited
 * payload can't produce a broken public card.
 *
 * Real business cards carry six to nine things; twelve is already generous.
 */
export const MAX_VISIBLE_BLOCKS = 12;

/**
 * What a card is carrying, in ROWS rather than in blocks.
 *
 * The cap exists because a fixed-size card can only hold so many rows — so it
 * has to be counted in rows. Socials share a row three at a time, so counting
 * them one-for-one said a card starting with the usual nine things was full
 * after three socials: the owner asks for six, the "+" buttons go grey at
 * three, and the layout that handles six is unreachable.
 */
export function blockLoad(blocks: CustomBlock[]): number {
  const on = blocks.filter((b) => b.on);
  const socials = on.filter((b) => b.type === "social").length;
  return on.length - socials + Math.ceil(socials / SOCIAL_COLS);
}

/**
 * Trimmed by the same row count the editor caps by, so the two agree about what
 * "full" means — and trimmed by whole social ROWS, so a defensive trim can't
 * leave a group half-drawn.
 */
export function visibleBlocks(blocks: CustomBlock[]): CustomBlock[] {
  const on = blocks.filter((b) => b.on);
  if (blockLoad(on) <= MAX_VISIBLE_BLOCKS) return on;
  const out: CustomBlock[] = [];
  for (const b of on) {
    const next = [...out, b];
    if (blockLoad(next) > MAX_VISIBLE_BLOCKS) break;
    out.push(b);
  }
  return out;
}

export function blockFontPx(emphasis: CardEmphasis, density: number): number {
  return Math.round(EMPHASIS_PX[emphasis] * density * 10) / 10;
}

export function blockImagePx(emphasis: CardEmphasis, density: number): number {
  return Math.round(EMPHASIS_IMG[emphasis] * Math.min(1.1, density));
}

// ── Presets ─────────────────────────────────────────────────────────────────

const b = (
  id: string,
  type: CustomBlock["type"],
  zone: CardZone,
  emphasis: CardEmphasis,
  extra: Partial<CustomBlock> = {},
): CustomBlock => ({ id, type, zone, emphasis, on: true, ...extra });

/**
 * Every starting point is a finished card, never a blank canvas. Forking a look
 * you already like is the difference between adjusting and building, and
 * "building" is what made the old designer feel like work.
 */
/** The contact stack every card shares, so presets differ where they should. */
const contacts = (): CustomBlock[] => [
  b("phone", "field", "right", "normal", { field: "phone" }),
  b("email", "field", "right", "normal", { field: "email" }),
  b("website", "field", "right", "quiet", { field: "website" }),
  // ON, matching the templates. A block with no value renders nothing, so this
  // costs a card without an address exactly nothing — while a fork that silently
  // dropped an address the original showed looked like the fork had lost it.
  b("address", "field", "right", "quiet", { field: "address" }),
];

const SANS = "var(--font-geist-sans), system-ui, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";
const MONO = "'Courier New', ui-monospace, monospace";

/**
 * Eight looks you CANNOT get anywhere else on SwiftCard.
 *
 * These used to be one reconstruction per shipped template — "Start from Logo
 * First", "Start from Classic Pro", and so on. That was the wrong offer: a Pro
 * subscriber opened the one feature they pay for and was shown the same six
 * names anybody can pick for free. Nothing here was theirs.
 *
 * So the starting points are now their own design set. Between them they use all
 * three skeletons, both light and dark grounds, three typefaces, and — the part
 * no template offers at all — different HIERARCHIES: Marquee makes the phone the
 * biggest thing on the card, Ember leads with the firm rather than the person.
 * That is the answer to "why would I pay for this": these are the arrangements
 * the six fixed templates deliberately don't make.
 *
 * Every one is a finished card, never a blank canvas. Forking a look you already
 * like is the difference between adjusting and building, and "building" is what
 * made the old designer feel like work.
 */
export const LAYOUT_PRESETS: Record<string, { label: string; blurb: string; build: () => CustomLayout }> = {
  ink: {
    label: "Ink",
    blurb: "Deep navy, your mark on a darker panel, name large.",
    build: () => ({
      background: "#141b26", textColor: "#ffffff", accentColor: "#7fa6f0",
      panelBackground: "#0b1220", panelTextColor: "#ffffff",
      fontFamily: SANS, skeleton: "split", elements: [],
      blocks: [
        b("logo", "logo", "left", "normal"),
        b("name", "field", "right", "hero", { field: "name" }),
        b("title", "field", "right", "quiet", { field: "title" }),
        b("company", "field", "right", "quiet", { field: "company" }),
        ...contacts(),
        b("qr", "qr", "right", "normal"),
        b("headshot", "headshot", "left", "normal", { on: false }),
        b("socials", "socials", "right", "quiet", { on: false }),
      ],
    }),
  },
  signal: {
    label: "Signal",
    blurb: "Your face on a blue panel — on the right, where nothing else puts it.",
    build: () => ({
      background: "#ffffff", textColor: "#0e1b35", accentColor: "#2563eb",
      panelBackground: "linear-gradient(200deg, #1d4ed8 0%, #3b82f6 100%)",
      panelTextColor: "#ffffff",
      fontFamily: SANS, skeleton: "mirror", elements: [],
      blocks: [
        b("headshot", "headshot", "left", "hero"),
        b("name", "field", "right", "hero", { field: "name" }),
        b("title", "field", "right", "quiet", { field: "title" }),
        b("company", "field", "right", "quiet", { field: "company" }),
        ...contacts(),
        b("qr", "qr", "right", "normal"),
        b("logo", "logo", "left", "quiet", { on: false }),
      ],
    }),
  },
  marquee: {
    label: "Marquee",
    blurb: "Black band on top, and the phone number as the biggest thing on the card.",
    build: () => ({
      background: "#fffdf7", textColor: "#1c1917", accentColor: "#b45309",
      panelBackground: "#111827", panelTextColor: "#ffffff",
      fontFamily: SANS, skeleton: "stacked", elements: [],
      blocks: [
        b("logo", "logo", "left", "quiet"),
        b("company", "field", "right", "quiet", { field: "company" }),
        b("name", "field", "right", "hero", { field: "name" }),
        b("phone", "field", "right", "hero", { field: "phone" }),
        b("email", "field", "right", "normal", { field: "email" }),
        b("qr", "qr", "right", "normal"),
        b("website", "field", "right", "quiet", { field: "website", on: false }),
        b("address", "field", "right", "quiet", { field: "address", on: false }),
        b("title", "field", "right", "quiet", { field: "title", on: false }),
      ],
    }),
  },
  atelier: {
    label: "Atelier",
    blurb: "Bone paper, a serif face, a gold accent and a lot of restraint.",
    build: () => ({
      // A panel tint one step off the ground. Without it the mark sits in a
      // third of the card that reads as blank space rather than as a panel.
      background: "#f4f2ed", textColor: "#1c1612", accentColor: "#8a6a3b",
      panelBackground: "#eae6dd", panelTextColor: "#1c1612",
      fontFamily: SERIF, skeleton: "split", elements: [],
      blocks: [
        b("logo", "logo", "left", "quiet"),
        b("company", "field", "right", "quiet", { field: "company" }),
        b("name", "field", "right", "hero", { field: "name" }),
        b("title", "field", "right", "quiet", { field: "title" }),
        ...contacts(),
        b("qr", "qr", "right", "quiet"),
        b("headshot", "headshot", "left", "normal", { on: false }),
      ],
    }),
  },
  noir: {
    label: "Noir",
    blurb: "Near-black, typewriter type, everything small and exact.",
    build: () => ({
      background: "#0a0a0a", textColor: "#fafafa", accentColor: "#a3a3a3",
      panelBackground: "#171717", panelTextColor: "#fafafa",
      fontFamily: MONO, skeleton: "split", elements: [],
      blocks: [
        b("logo", "logo", "left", "normal"),
        b("name", "field", "right", "hero", { field: "name" }),
        b("title", "field", "right", "quiet", { field: "title" }),
        b("company", "field", "right", "quiet", { field: "company" }),
        b("phone", "field", "right", "quiet", { field: "phone" }),
        b("email", "field", "right", "quiet", { field: "email" }),
        b("website", "field", "right", "quiet", { field: "website" }),
        b("address", "field", "right", "quiet", { field: "address" }),
        b("qr", "qr", "right", "quiet"),
      ],
    }),
  },
  meridian: {
    label: "Meridian",
    blurb: "A deep green panel carrying both your photo and your logo.",
    build: () => ({
      background: "#f7f5ef", textColor: "#14312a", accentColor: "#2f6f5b",
      panelBackground: "linear-gradient(165deg, #16352c 0%, #2f6f5b 100%)",
      panelTextColor: "#ffffff",
      fontFamily: SANS, skeleton: "split", elements: [],
      blocks: [
        b("headshot", "headshot", "left", "normal"),
        b("logo", "logo", "left", "quiet"),
        b("name", "field", "right", "hero", { field: "name" }),
        b("title", "field", "right", "quiet", { field: "title" }),
        b("company", "field", "right", "quiet", { field: "company" }),
        ...contacts(),
        b("qr", "qr", "right", "normal"),
      ],
    }),
  },
  broadsheet: {
    label: "Broadsheet",
    blurb: "No panel at all — one clean column, edge to edge.",
    build: () => ({
      background: "#ffffff", textColor: "#111827", accentColor: "#111827",
      fontFamily: SANS, skeleton: "split", elements: [],
      blocks: [
        b("name", "field", "right", "hero", { field: "name" }),
        b("title", "field", "right", "normal", { field: "title" }),
        b("company", "field", "right", "quiet", { field: "company" }),
        ...contacts(),
        b("qr", "qr", "right", "normal"),
        b("logo", "logo", "left", "quiet", { on: false }),
        b("headshot", "headshot", "left", "normal", { on: false }),
      ],
    }),
  },
  ember: {
    label: "Ember",
    blurb: "Oxblood, panel on the right, and the firm named above the person.",
    build: () => ({
      background: "#33191d", textColor: "#f6ece9", accentColor: "#e0a3a0",
      panelBackground: "#261215", panelTextColor: "#f6ece9",
      fontFamily: SERIF, skeleton: "mirror", elements: [],
      blocks: [
        b("logo", "logo", "left", "normal"),
        b("company", "field", "right", "hero", { field: "company" }),
        b("name", "field", "right", "normal", { field: "name" }),
        b("title", "field", "right", "quiet", { field: "title" }),
        ...contacts(),
        b("qr", "qr", "right", "normal"),
        b("headshot", "headshot", "left", "normal", { on: false }),
      ],
    }),
  },
};

export const DEFAULT_PRESET = "ink";

export function buildPreset(key: string): CustomLayout {
  return (LAYOUT_PRESETS[key] ?? LAYOUT_PRESETS[DEFAULT_PRESET]).build();
}

// ── Building a layout from a scanned card ───────────────────────────────────

/** Perceived brightness (YIQ), 0-255. Null for anything unparseable. */
function yiq(hex: string): number | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000;
}

const hex = (v: unknown, fallback: string): string =>
  typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : fallback;

/**
 * Every block a scan is allowed to place, and what it maps to.
 *
 * A Map, not an object literal, because the key comes from model output and
 * `literal["__proto__"]` returns Object.prototype — which is TRUTHY, so a plain
 * lookup would treat "__proto__" or "constructor" as a valid block and build one
 * with an undefined type. The renderer degrades gracefully enough that the fuzz
 * never flagged it, which is exactly why it needed closing rather than trusting.
 */
const SCANNABLE = new Map<string, { type: CustomBlock["type"]; field?: string; zone: CardZone }>([
  ["logo",     { type: "logo", zone: "left" }],
  ["headshot", { type: "headshot", zone: "left" }],
  ["qr",       { type: "qr", zone: "right" }],
  ["name",     { type: "field", field: "name", zone: "right" }],
  ["title",    { type: "field", field: "title", zone: "right" }],
  ["company",  { type: "field", field: "company", zone: "right" }],
  ["phone",    { type: "field", field: "phone", zone: "right" }],
  ["email",    { type: "field", field: "email", zone: "right" }],
  ["website",  { type: "field", field: "website", zone: "right" }],
  ["address",  { type: "field", field: "address", zone: "right" }],
  ["fax",      { type: "field", field: "fax", zone: "right" }],
]);

export type ScanReading = {
  background?: unknown; textColor?: unknown; accentColor?: unknown;
  panelBackground?: unknown; skeleton?: unknown; serif?: unknown;
  blocks?: unknown;
};

/**
 * Where a scanned block sits, when the source card puts it somewhere the
 * default mapping wouldn't.
 *
 * Only marks can move. `zoneFor` forces every text block into the main area no
 * matter what is stored, because the side panel is a third of the card wide and
 * a single unbroken token — an email, a handle — either fits it or splits
 * mid-word. So a card with its phone number printed down a coloured spine comes
 * back with the number in the main area: the closest arrangement this renderer
 * can actually hold. Reading it and then dropping it would be worse than not
 * reading it, so the prompt only ever asks about the three that can move.
 */
function scannedZone(spec: { type: CustomBlock["type"]; zone: CardZone }, place: unknown): CardZone {
  if (TEXT_TYPES.has(spec.type)) return spec.zone;
  return place === "panel" ? "left" : place === "main" ? "right" : spec.zone;
}

/**
 * Turn what the model saw into a layout.
 *
 * The model CHOOSES AMONG OPTIONS; it never authors the layout. Every value is
 * validated against a whitelist here and anything unrecognised is dropped, so a
 * hallucinated block type, a malformed colour, or a hostile response can only
 * ever produce a plainer card — never a broken or unreadable one. The result is
 * then built through the same shape every preset uses, which is what makes a
 * scanned card inherit the guarantees the fuzz proved for hand-built ones.
 */
export function layoutFromScan(input: ScanReading | null | undefined): CustomLayout {
  const base = buildPreset(DEFAULT_PRESET);
  // Defensive rather than relying on the caller. The route already rejects a
  // non-object body, but this is exported and parses model output — a function
  // whose whole job is to survive untrusted input should not throw on null.
  const reading: ScanReading = input && typeof input === "object" ? input : {};

  const skeleton: CardSkeleton =
    reading.skeleton === "stacked" || reading.skeleton === "mirror" || reading.skeleton === "split"
      ? reading.skeleton
      : "split";

  const background = hex(reading.background, base.background);
  let textColor = hex(reading.textColor, "#ffffff");
  const accentColor = hex(reading.accentColor, textColor);

  // A card whose text matches its background is unreadable, and a photograph of
  // a glossy card makes that reading easy to get wrong. Rather than trust it,
  // flip the text to whichever end actually contrasts.
  const bgY = yiq(background);
  const txY = yiq(textColor);
  if (bgY !== null && txY !== null && Math.abs(bgY - txY) < 60) {
    textColor = bgY < 140 ? "#ffffff" : "#141b26";
  }

  const panelBackground = typeof reading.panelBackground === "string" && /^#[0-9a-f]{6}$/i.test(reading.panelBackground.trim())
    ? reading.panelBackground.trim().toLowerCase()
    : undefined;
  const panelY = panelBackground ? yiq(panelBackground) : null;

  // Read the block list, keeping only known ids, in the order given, no repeats.
  const raw = Array.isArray(reading.blocks) ? reading.blocks : [];
  const seen = new Set<string>();
  const chosen: CustomBlock[] = [];
  for (const item of raw) {
    const id = typeof item === "string" ? item : (item as { id?: unknown })?.id;
    if (typeof id !== "string") continue;
    const key = id.trim().toLowerCase();
    const spec = SCANNABLE.get(key);
    if (!spec || seen.has(key)) continue;
    seen.add(key);
    const e = (item as { emphasis?: unknown })?.emphasis;
    const emphasis: CardEmphasis = e === "hero" || e === "quiet" || e === "normal" ? e : "normal";
    chosen.push({
      id: key, type: spec.type, field: spec.field as CustomBlock["field"],
      on: true, zone: scannedZone(spec, (item as { place?: unknown })?.place), emphasis,
    });
    if (chosen.length >= MAX_VISIBLE_BLOCKS) break;
  }

  // A reading that produced nothing usable falls back to the default preset's
  // blocks rather than an empty card.
  const blocks = chosen.length >= 3 ? chosen : base.blocks!;

  // Anything the scan didn't mention is kept, switched OFF, so the owner can
  // turn it on without rebuilding it.
  const present = new Set(blocks.map((x) => x.id));
  const rest = (base.blocks ?? [])
    .filter((x) => !present.has(x.id))
    .map((x) => ({ ...x, on: false }));

  return {
    ...base,
    background, textColor, accentColor, panelBackground,
    panelTextColor: panelY !== null ? (panelY < 140 ? "#ffffff" : "#141b26") : undefined,
    fontFamily: reading.serif === true ? "Georgia, 'Times New Roman', serif" : base.fontFamily,
    skeleton,
    blocks: [...blocks, ...rest],
    elements: [],
  };
}

/** The ids whose ZONE the reader is allowed to choose — see `scannedZone`. */
const PLACEABLE = [...SCANNABLE].filter(([, s]) => !TEXT_TYPES.has(s.type)).map(([k]) => k);

/**
 * The exact instruction the vision model is given. Exported so a test can pin it.
 *
 * Two things this prompt must keep doing, both of which are easy to lose in an
 * innocent-looking edit:
 *
 *  1. It asks for a LAYOUT, never for content. The owner is copying the shape of
 *     a card — often somebody else's card, or a template they found — and the
 *     wording has to make that unambiguous, because a vision model handed a
 *     business card will otherwise volunteer the name and phone number on it.
 *     Nothing downstream would store them (`layoutFromScan` builds blocks from a
 *     whitelist and never reads a value), but the cheapest place to not have
 *     somebody else's phone number is to never ask for it.
 *  2. It offers a CHOICE AMONG OPTIONS. Every field here is either an enum or a
 *     #rrggbb, so the worst a bad reading can do is pick the wrong option.
 */
export const SCAN_PROMPT = [
  "You are looking at an image of a business card — a photograph of a printed",
  "card, or a screenshot of a card design or template.",
  "",
  "Report only its LAYOUT AND COLOURS so the same arrangement can be rebuilt.",
  "Do NOT read, transcribe, translate or return any of the text printed on it:",
  "no names, job titles, company names, phone numbers, emails or addresses.",
  "Report only WHICH KIND of thing appears and WHERE it sits.",
  "",
  "Return ONLY valid JSON, no prose:",
  '{"background":"#rrggbb","textColor":"#rrggbb","accentColor":"#rrggbb",',
  '"panelBackground":"#rrggbb or null","skeleton":"split|mirror|stacked","serif":true|false,',
  '"blocks":[{"id":"...","emphasis":"hero|normal|quiet","place":"panel|main"}]}',
  "",
  "background = the card's main surface colour.",
  "panelBackground = a SECOND surface if the card has a coloured band or side panel, else null.",
  'skeleton = "split" if that band/panel sits on the LEFT, "mirror" if on the RIGHT,',
  '  "stacked" if it runs across the TOP. Use "split" when the card has no band.',
  "blocks = only the kinds of thing actually on the card, IN READING ORDER.",
  `Allowed ids: ${[...SCANNABLE.keys()].join(", ")}.`,
  'emphasis = "hero" for the largest element, "quiet" for the smallest, "normal" otherwise.',
  `place = only for ${PLACEABLE.join(", ")}: "panel" if it sits on the coloured band`,
  '  or side panel, "main" if it sits among the text. Omit place for everything else.',
  "Do not invent anything you cannot see. Omit what is not there.",
].join("\n");

// ── Adding blocks ───────────────────────────────────────────────────────────

// ── Legacy ──────────────────────────────────────────────────────────────────

// ── Normalisation ───────────────────────────────────────────────────────────

export function hasBlocks(layout: CustomLayout | null | undefined): boolean {
  return Array.isArray(layout?.blocks) && (layout as CustomLayout).blocks!.length > 0;
}

/**
 * Anything that would end a CSS declaration, start a comment, or fetch.
 *
 * `customLayout` is a JSON blob the owner PATCHes; the renderer spreads its
 * colours straight into a style object, so a value of `#111;position:fixed;
 * top:0;width:100vw;z-index:2147483647` becomes real declarations on the public
 * card, and `url(https://…)` becomes a request from every visitor. React
 * escapes quotes, so this was never XSS — but a stored full-viewport overlay on
 * someone else's card is worth closing anyway, and an office owner can push a
 * layout onto members' cards through the branding seed.
 */
const CSS_UNSAFE = /[;{}<>\\]|url\s*\(|image\s*\(|expression\s*\(|@import|\/\*/i;

/** A colour or gradient, or the fallback. Rejects rather than sanitising. */
function safeCss(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const s = v.trim();
  // No colon: kills `position:fixed` and every `url(https://…)` in one test.
  if (!s || s.length > 200 || s.includes(":") || CSS_UNSAFE.test(s)) return fallback;
  return /^[#a-z0-9.,%()\s/-]+$/i.test(s) ? s : fallback;
}

/** Same rules, plus the quotes and underscores a font stack legitimately uses. */
function safeFont(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const s = v.trim();
  if (!s || s.length > 200 || s.includes(":") || CSS_UNSAFE.test(s)) return fallback;
  return /^[a-z0-9\s,'"()._-]+$/i.test(s) ? s : fallback;
}

/**
 * The same two guards for the OTHER style paths that take owner-typed values:
 * a template card's customization colours/font (lib/template-style) and the
 * Swift Links page style. Those spread raw strings into style objects too, so
 * `linkBgColor: "#000;position:fixed;inset:0;background:url(https://…)"` drew
 * a full-page overlay and pinged a tracker from every visitor (security audit
 * 2026-09-24). Anything unsafe reads as "not set" → the template default.
 */
export function safeCssValue(v: unknown): string | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  return safeCss(v, "") || undefined;
}
export function safeFontValue(v: unknown): string | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  return safeFont(v, "") || undefined;
}

/** Optional colour: undefined stays undefined so `??` defaults still fire. */
function safeCssOpt(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const out = safeCss(v, "");
  return out || undefined;
}

/**
 * The design-transfer face image. Same threat model as the colours: the layout
 * blob is owner-PATCHable JSON that lands in a render sink — here an <img src>
 * fetched by every visitor — so only https URLs on our own hosts survive.
 * (Mirrors the allowlist wallet-strip.tsx uses for the same reason.)
 */
function safeFaceImage(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s || s.length > 500) return undefined;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:") return undefined;
    const ok = new Set<string>();
    for (const env of [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me"]) {
      if (env) try { ok.add(new URL(env).hostname.toLowerCase()); } catch { /* ignore */ }
    }
    return ok.has(u.hostname.toLowerCase().replace(/\.$/, "")) ? s : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Always hand back something renderable. A corrupted or half-written layout —
 * a restored guest draft that saved `customLayout: {}` is the real case that
 * crashed a card page once — falls back to the default preset rather than
 * throwing on a missing array.
 *
 * This is also the security boundary for the style sinks: every colour, every
 * gradient and the font stack are validated here, once, for both renderers.
 */
export function normalizeCustomLayout(raw: unknown): CustomLayout {
  const fallback = buildPreset(DEFAULT_PRESET);
  if (!raw || typeof raw !== "object") return fallback;
  const l = raw as CustomLayout;

  const style = {
    background: safeCss(l.background, fallback.background),
    textColor: safeCss(l.textColor, fallback.textColor),
    accentColor: safeCssOpt(l.accentColor),
    panelBackground: safeCssOpt(l.panelBackground),
    panelTextColor: safeCssOpt(l.panelTextColor),
    fontFamily: safeFont(l.fontFamily, fallback.fontFamily),
    faceImage: safeFaceImage(l.faceImage),
  };

  if (Array.isArray(l.blocks) && l.blocks.length) {
    return {
      ...fallback,
      ...l,
      ...style,
      blocks: l.blocks
        .filter((x) => x && typeof x.id === "string" && typeof x.type === "string")
        .map((x) => ({ ...x, color: safeCssOpt(x.color) })),
      elements: [],
    };
  }
  // An element that isn't an object crashes the legacy renderer on `el.x`, and
  // `Array.isArray([null]) && .length` was happily letting one through.
  const elements = Array.isArray(l.elements)
    ? l.elements
        .filter((e) => e && typeof e === "object" && typeof e.id === "string" && typeof e.type === "string" && ELEMENT_TYPES.has(e.type))
        .slice(0, MAX_FREE_ELEMENTS)
        .map(safeElement)
    : [];
  if (elements.length) return { ...fallback, ...l, ...style, blocks: undefined, elements, ai: safeBrief(l.ai) };
  return { ...fallback, ...l, ...style, blocks: fallback.blocks, elements: [] };
}

// ── Free design elements ────────────────────────────────────────────────────
// A free design (AI design + the fine-tune editor) is positioned elements, the
// same shape the previous designer wrote, with more style on each. Every value
// is clamped or whitelisted HERE, the one boundary both renderers pass through,
// for the same reason as the colours above: the layout is owner-PATCHable JSON.
const ELEMENT_TYPES = new Set(["field", "text", "logo", "headshot", "socials", "social", "qr", "divider", "shape"]);
const FIELDS = new Set(["name", "title", "company", "phone", "email", "website", "address", "fax"]);
const SOCIALS = new Set(["instagram", "linkedin", "twitter", "tiktok", "snapchat", "youtube", "facebook"]);
/** Far more than any real card holds; a bound on what a PATCH can make every visitor render. */
export const MAX_FREE_ELEMENTS = 40;

const num = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined;
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;

function safeElement(e: CustomElement): CustomElement {
  const out: CustomElement = {
    id: e.id.slice(0, 40),
    type: e.type,
    // Positions stay on (or just off) the card: a design can bleed a shape past
    // an edge on purpose, but nothing can be parked a screen away.
    x: num(e.x, -60, 160) ?? 0,
    y: num(e.y, -60, 160) ?? 0,
  };
  if (e.type === "field" && typeof e.field === "string" && FIELDS.has(e.field)) out.field = e.field;
  if (e.type === "social" && typeof e.social === "string" && SOCIALS.has(e.social)) out.social = e.social;
  if (e.type === "text" && typeof e.text === "string") out.text = e.text.slice(0, 120);
  const fontSize = num(e.fontSize, 4, 90); if (fontSize !== undefined) out.fontSize = fontSize;
  const size = num(e.size, 8, 300); if (size !== undefined) out.size = size;
  const width = num(e.width, 4, 460); if (width !== undefined) out.width = width;
  const color = safeCssOpt(e.color); if (color) out.color = color;
  if (e.bold === true) out.bold = true;
  if (e.italic === true) out.italic = true;
  const align = oneOf(e.align, ["left", "center", "right"] as const); if (align) out.align = align;
  if (typeof e.font === "string") { const f = safeFont(e.font, ""); if (f) out.font = f; }
  const weight = num(e.weight, 300, 900); if (weight !== undefined) out.weight = Math.round(weight / 50) * 50;
  if (e.upper === true) out.upper = true;
  const tracking = num(e.tracking, -0.05, 0.5); if (tracking !== undefined) out.tracking = tracking;
  if (e.icon === true) out.icon = true;
  const frame = oneOf(e.frame, ["circle", "rounded", "square"] as const); if (frame) out.frame = frame;
  const shape = oneOf(e.shape, ["rect", "circle"] as const); if (shape) out.shape = shape;
  const w = num(e.w, 0.5, 250); if (w !== undefined) out.w = w;
  const h = num(e.h, 0.5, 250); if (h !== undefined) out.h = h;
  const fill = safeCssOpt(e.fill); if (fill) out.fill = fill;
  const radius = num(e.radius, 0, 200); if (radius !== undefined) out.radius = radius;
  const stroke = safeCssOpt(e.stroke); if (stroke) out.stroke = stroke;
  const strokeWidth = num(e.strokeWidth, 0, 12); if (strokeWidth !== undefined) out.strokeWidth = strokeWidth;
  const opacity = num(e.opacity, 0.05, 1); if (opacity !== undefined) out.opacity = opacity;
  const rotate = num(e.rotate, -60, 60); if (rotate !== undefined) out.rotate = rotate;
  return out;
}

/** The AI design brief. Only the designer reads it; still validated, like everything in the blob. */
function safeBrief(v: unknown): AiDesignBrief | undefined {
  if (!v || typeof v !== "object") return undefined;
  const b = v as Partial<AiDesignBrief>;
  if (typeof b.theme !== "string" || !/^[a-z-]{1,20}$/.test(b.theme)) return undefined;
  const colors = Array.isArray(b.colors)
    ? b.colors.filter((c): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)).slice(0, 3)
    : [];
  return {
    theme: b.theme,
    colors,
    headshot: b.headshot === true,
    logo: b.logo === true,
    variant: num(b.variant, 0, 10_000) ?? 0,
  };
}

/** Does this block have anything to show for this card? Drives "hidden" hints. */
export function blockHasValue(block: CustomBlock, data: CardData): boolean {
  const c = data.customization;
  switch (block.type) {
    case "logo": return !!data.logoUrl;
    case "headshot": return !!data.photoUrl;
    case "qr": return true;
    case "divider": return true;
    case "text": return !!block.text?.trim();
    case "socials":
      return [data.linkedin, data.instagram, data.twitter, data.tiktok, data.snapchat].some((s) => (s || "").trim());
    case "social":
      switch (block.social) {
        case "instagram": return !!data.instagram;
        case "linkedin": return !!data.linkedin;
        case "twitter": return !!data.twitter;
        case "tiktok": return !!data.tiktok;
        case "snapchat": return !!(data.snapchat || c?.snapchat);
        case "youtube": return !!c?.youtube;
        case "facebook": return !!c?.facebook;
        default: return false;
      }
    case "field":
      switch (block.field) {
        case "name": return !!data.name;
        case "title": return !!data.title;
        case "company": return !!data.company;
        case "phone": return !!(data.phone || c?.phones?.some((p) => p?.showOnCard && p.number?.trim()));
        case "email": return !!data.email;
        case "website": return !!data.website;
        case "address": return !!data.address;
        case "fax": return !!c?.fax?.trim();
        default: return false;
      }
    default: return false;
  }
}

// ── A custom design for a WHOLE TEAM ─────────────────────────────────────────
//
// Office Branding can set a custom design as the look every member inherits
// (owner, 2026-09-18). A team layout is blocks — live text each member's card
// fills with THEIR details — and never a face image: the exact-copy image is one
// person's card with their name, number and email baked into the pixels, and
// applied to a team it would put the admin's details on every member's card.

/** Drop a face image from any layout-shaped value, leaving everything else as stored. */
export function withoutFaceImage<T>(raw: T): T {
  if (!raw || typeof raw !== "object" || !("faceImage" in (raw as object))) return raw;
  const { faceImage: _face, ...rest } = raw as Record<string, unknown>;
  void _face;
  return rest as T;
}

/** A submitted team layout, made safe to store: validated like any layout, never a face image. */
export function teamCustomLayout(raw: unknown): CustomLayout | null {
  if (!raw || typeof raw !== "object") return null;
  return withoutFaceImage(normalizeCustomLayout(raw));
}
