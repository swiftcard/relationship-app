// CustomCard — a user-designed card.
// Layout comes from data.customization.customLayout (built in the Pro designer).
// NO hooks here — this renders server-side on the public card page.
//
// Two layouts can arrive:
//   BLOCKS (current)  — content flows inside zones. Nothing is positioned, so
//                       nothing can overlap, hang off the edge, or render at a
//                       different scale than the editor showed.
//   ELEMENTS (free)   — positioned x/y: what AI design builds and its fine-tune
//                       editor moves (and what the old designer saved). Lines
//                       shrink to fit the card rather than run off its edge.
import type { CardData, CustomBlock, CustomElement, CustomLayout, CustomSocial } from "./types";
import { MiniQR } from "./MiniQR";
import { fitName, formatPhone, IcoPhone, IcoMail, IcoGlobe, IcoPin } from "./shared";
import {
  QR_MIN_PX, blockDensity, sideDensity, textBlockPx, blockFontPx, blockHasValue, blockImagePx, groupSocials, hasBlocks,
  normalizeCustomLayout, sideImageScale, socialCols, visibleBlocks, zoneFor,
} from "@/lib/custom-layout";
import PlatformIcon from "@/components/PlatformIcon";

// Map a per-platform social element to its value in the card data + icon label.
const SOCIAL_META: Record<CustomSocial, { label: string; icon: string }> = {
  instagram: { label: "Instagram", icon: "Instagram" },
  linkedin:  { label: "LinkedIn",  icon: "LinkedIn" },
  twitter:   { label: "X",         icon: "X / Twitter" },
  tiktok:    { label: "TikTok",    icon: "TikTok" },
  snapchat:  { label: "Snapchat",  icon: "Snapchat" },
  youtube:   { label: "YouTube",   icon: "YouTube" },
  facebook:  { label: "Facebook",  icon: "Facebook" },
};

function socialValue(data: CardData, s?: CustomSocial): string {
  switch (s) {
    case "instagram": return data.instagram || "";
    case "linkedin":  return data.linkedin || "";
    case "twitter":   return data.twitter || "";
    case "tiktok":    return data.tiktok || "";
    case "snapchat":  return data.snapchat || data.customization?.snapchat || "";
    case "youtube":   return (data.customization as { youtube?: string } | undefined)?.youtube || "";
    case "facebook":  return (data.customization as { facebook?: string } | undefined)?.facebook || "";
    default: return "";
  }
}

// Shorten stored values (URLs, long handles) to a card-friendly handle.
/**
 * The smallest a handle may be set before the row drops to marks instead.
 * Design px at the 460 card, so ~6px on a phone at the floor — the point where
 * a handle stops being something you could actually read off a card.
 */
const SOCIAL_HANDLE_MIN_PX = 8;

/**
 * The smallest any line may be shrunk TO FIT ITS WIDTH.
 *
 * fitPx floors only RELATIVELY, at a fraction of its base — and its base here
 * is already multiplied by the density solve, so two multipliers compounded
 * with nothing absolute underneath them. A normal two-line address rendered at
 * 4.7px on seven of the eight shipped Looks: present, un-clipped, and a grey
 * smudge. Nothing overflowed, which is exactly why a sweep measuring overflow
 * and aspect ratio called those cards clean.
 *
 * Capped at `fs` so it can only stop the FIT shrinking, never overrule the
 * density solve — on a card full enough that even the emphasis size is under
 * the floor, the card still has to fit, and that is the solve's call to make.
 */
// The value, and the fit it floors, live in lib/custom-layout (TEXT_MIN_PX, textBlockPx)
// so the density model sizes text with exactly the rule drawn here.

/** The handle a social block will draw — shared so the row can size to its longest. */
function socialShown(block: CustomBlock, data: CardData, placeholder: boolean): string {
  const raw = socialValue(data, block.social ?? "instagram");
  return raw ? shortHandle(raw) : placeholder ? `@your-${block.social}` : "";
}

function shortHandle(v: string): string {
  const cleaned = v.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const last = cleaned.split("/").filter(Boolean).pop() ?? cleaned;
  return last.startsWith("@") ? last : cleaned.includes("/") ? `@${last.replace(/^@/, "")}` : cleaned;
}

export const DEFAULT_CUSTOM_LAYOUT: CustomLayout = {
  background: "#0e1b35",
  fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
  textColor: "#ffffff",
  elements: [
    { id: "name",     type: "field", field: "name",    x: 7,  y: 14, fontSize: 22, bold: true },
    { id: "title",    type: "field", field: "title",   x: 7,  y: 32, fontSize: 11, color: "#93c5fd" },
    { id: "company",  type: "field", field: "company", x: 7,  y: 44, fontSize: 11 },
    { id: "phone",    type: "field", field: "phone",   x: 7,  y: 62, fontSize: 11 },
    { id: "email",    type: "field", field: "email",   x: 7,  y: 74, fontSize: 11 },
    { id: "logo",     type: "logo",     x: 76, y: 12, size: 46 },
    { id: "headshot", type: "headshot", x: 74, y: 44, size: 64 },
    { id: "socials",  type: "socials",  x: 7,  y: 87, fontSize: 9 },
  ],
};

function fieldValue(data: CardData, field?: string): string {
  switch (field) {
    case "name": return data.name || "";
    case "title": return data.title || "";
    case "company": return data.company || "";
    case "phone": {
      const shown = data.customization?.phones?.filter((p) => p?.showOnCard && p.number?.trim());
      return shown && shown.length ? shown[0].number : (data.phone || "");
    }
    case "email": return data.email || "";
    case "website": return data.website || "";
    case "address": return data.address || "";
    case "fax": {
      const f = data.customization?.fax?.trim();
      // Formatted like the phone. A scanned card that carried a fax was
      // printing a raw 3125550122 one line under a formatted (312) 555-0121.
      return f ? `Fax: ${formatPhone(f)}` : "";
    }
    default: return "";
  }
}

function socialHandles(data: CardData): string[] {
  return [data.linkedin, data.instagram, data.twitter, data.tiktok, data.snapchat]
    .map((s) => (s || "").trim())
    .filter(Boolean);
}

// ── Free design: positioned elements ────────────────────────────────────────
// What AI design builds and its fine-tune editor moves around, and also what
// the previous positioned designer saved — one format, one renderer, so a card
// looks the same in the editor, on the public page and in every image made of
// it. Positions are % of the card; every size is design px at the 460 card
// (CardScaler scales the whole thing), so nothing drifts between widths.

/** The card's design width, the width every size here is measured against. */
export const FREE_CARD_W = 460;

/** Average advance of one character, in em, by typeface family — for fitting. */
function charEm(font: string): number {
  const f = font.toLowerCase();
  if (f.includes("courier") || f.includes("mono")) return 0.61;
  if (f.includes("georgia") || f.includes("palatino") || f.includes("serif") && !f.includes("sans")) return 0.53;
  if (f.includes("trebuchet")) return 0.55;
  if (f.includes("--font-display")) return 0.56;
  return 0.55;
}

/**
 * The room a line has before it would leave the card, in design px, from where
 * it is anchored. A line anchored left can run to the right edge; one anchored
 * in the centre can grow both ways only as far as the nearer edge.
 */
function roomPx(el: CustomElement): number {
  const x = el.x;
  const margin = 2.5; // % kept clear of the edge
  const pct = el.align === "center" ? 2 * Math.min(x, 100 - x) - 2 * margin
    : el.align === "right" ? x - margin
    : 100 - x - margin;
  return Math.max(0, (pct / 100) * FREE_CARD_W);
}

/**
 * Shrink a line so it fits its room. Deterministic — the same estimate on the
 * server-rendered card and in the editor — so a long email written after the
 * design was made gets smaller instead of hanging off the card, and never
 * differs between the two.
 */
function fitLine(base: number, chars: number, el: CustomElement, font: string, extraEm = 0): number {
  const room = roomPx(el);
  if (room < 24 || chars <= 0) return base;
  const perChar = charEm(font) * (el.upper ? 1.12 : 1) + (el.tracking ?? 0);
  const need = chars * perChar + extraEm;
  return Math.max(Math.min(base, 5), Math.min(base, room / need));
}

const FREE_CONTACT_ICON: Record<string, () => React.ReactElement> = {
  phone: IcoPhone, fax: IcoPhone, email: IcoMail, website: IcoGlobe, address: IcoPin,
};

/** Inner content of a single element (no positioning). */
export function CustomElementContent({
  el,
  data,
  layout,
  placeholder = false,
}: {
  el: CustomElement;
  data: CardData;
  layout: CustomLayout;
  placeholder?: boolean;
}) {
  const font = el.font ?? layout.fontFamily;
  const ink = el.color ?? layout.textColor;
  const dashed = `1px dashed ${withOpacity(layout.textColor, 0.45)}`;

  if (el.type === "shape") {
    // Sized by its wrapper (FreeElement); this is only the paint.
    return (
      <div
        style={{
          width: "100%", height: "100%",
          background: el.fill ?? layout.accentColor ?? layout.textColor,
          borderRadius: el.shape === "circle" ? "9999px" : el.radius ?? 0,
          border: el.stroke && (el.strokeWidth ?? 0) > 0 ? `${el.strokeWidth}px solid ${el.stroke}` : undefined,
        }}
      />
    );
  }

  if (el.type === "logo" || el.type === "headshot") {
    const src = el.type === "logo" ? data.logoUrl : data.photoUrl;
    const size = el.size ?? (el.type === "logo" ? 46 : 64);
    const frame = el.frame ?? (el.type === "headshot" ? "circle" : "rounded");
    const radius = frame === "circle" ? "9999px" : frame === "rounded" ? Math.round(size * 0.18) : 0;
    if (src) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={el.type === "logo" ? "logo" : ""}
          style={{
            width: size, height: size, maxWidth: "none", borderRadius: radius, display: "block",
            // A photo fills its frame; a logo is never cropped.
            objectFit: el.type === "logo" ? "contain" : "cover",
          }}
        />
      );
    }
    return placeholder ? (
      <div style={{ width: size, height: size, borderRadius: radius, border: dashed, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, color: withOpacity(layout.textColor, 0.7) }}>
        {el.type === "logo" ? "Logo" : "Photo"}
      </div>
    ) : null;
  }

  if (el.type === "qr") {
    // Floored: the QR is the one thing on the card with a job beyond looking
    // right, and a code a phone camera can't read fails at it.
    return <MiniQR size={Math.max(QR_MIN_PX, Math.round(el.size ?? 52))} bg="#ffffff" fg="#111827" url={data.cardUrl} />;
  }

  if (el.type === "divider") {
    return <div style={{ width: el.width ?? 80, height: 2, borderRadius: 2, background: ink, opacity: 0.85 }} />;
  }

  const textStyle = (fs: number): React.CSSProperties => ({
    display: "block",
    fontSize: fs,
    lineHeight: 1.2,
    color: ink,
    fontFamily: el.font,
    fontWeight: el.weight ?? (el.bold ? 700 : 400),
    fontStyle: el.italic ? "italic" : "normal",
    letterSpacing: el.tracking ? `${el.tracking}em` : undefined,
    textTransform: el.upper ? "uppercase" : undefined,
    whiteSpace: "nowrap",
  });

  if (el.type === "socials") {
    const handles = socialHandles(data);
    const shown = handles.length ? handles.map(shortHandle) : placeholder ? ["@handle"] : [];
    if (!shown.length) return null;
    const base = el.fontSize ?? 9;
    const fs = fitLine(base, shown.join("   ").length, el, font);
    return (
      <span style={{ ...textStyle(fs), display: "flex", gap: fs * 0.9 }}>
        {shown.map((h, i) => <span key={i}>{h}</span>)}
      </span>
    );
  }

  if (el.type === "social") {
    const meta = SOCIAL_META[el.social ?? "instagram"];
    const raw = socialValue(data, el.social ?? "instagram");
    const shown = raw ? shortHandle(raw) : placeholder ? `@your-${el.social ?? "handle"}` : "";
    if (!shown) return null;
    const fs = fitLine(el.fontSize ?? 10, shown.length, el, font, 1.6);
    return (
      <span style={{ ...textStyle(fs), display: "inline-flex", alignItems: "center", gap: Math.max(3, fs * 0.4), opacity: raw ? 1 : 0.6 }}>
        <span style={{ width: fs * 1.15, height: fs * 1.15, display: "inline-flex", flexShrink: 0, color: layout.accentColor ?? ink }}>
          <PlatformIcon label={meta.icon} className="w-full h-full" />
        </span>
        <span>{shown}</span>
      </span>
    );
  }

  // field or static text
  const raw = el.type === "field" ? fieldValue(data, el.field) : (el.text ?? "");
  const value = el.field === "phone" && raw ? formatPhone(raw) : raw;
  const shown = value || (placeholder ? (el.type === "field" ? `{${el.field}}` : "Text") : "");
  if (!shown) return null;
  const multiline = el.type === "field" && el.field === "address";
  const longest = shown.split("\n").reduce((m, l) => Math.max(m, l.length), 0);
  const Icon = el.icon && el.type === "field" ? FREE_CONTACT_ICON[el.field ?? ""] : undefined;
  const base = el.fontSize ?? 12;
  // The name also fits by its longest WORD, the rule every template uses.
  const byWord = el.field === "name" ? fitName(base, value, 16) : base;
  const fs = fitLine(byWord, longest, el, font, Icon ? 1.6 : 0);
  const text = (
    <span style={{ ...textStyle(fs), whiteSpace: multiline ? "pre-line" : "nowrap" }}>
      {shown}
    </span>
  );
  if (!Icon) return text;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: fs * 0.5, color: layout.accentColor ?? ink }}>
      <span style={{ width: fs * 1.05, height: fs * 1.05, display: "inline-flex", flexShrink: 0 }}><Icon /></span>
      {text}
    </span>
  );
}

/** One element, placed. `data-el` is what the editor hit-tests. */
function FreeElement({ el, data, layout, placeholder }: { el: CustomElement; data: CardData; layout: CustomLayout; placeholder: boolean }) {
  const shift = el.align === "center" ? "-50%" : el.align === "right" ? "-100%" : "0";
  const box: React.CSSProperties = el.type === "shape"
    ? {
        position: "absolute", left: `${el.x}%`, top: `${el.y}%`,
        width: `${el.w ?? 20}%`,
        ...(el.shape === "circle" ? { aspectRatio: "1 / 1" } : { height: `${el.h ?? 20}%` }),
        transform: el.rotate ? `rotate(${el.rotate}deg)` : undefined,
        opacity: el.opacity,
      }
    : {
        position: "absolute", left: `${el.x}%`, top: `${el.y}%`,
        // max-content, not shrink-to-fit: an absolutely placed box only gets
        // the room between its left edge and the card's, so a photo anchored
        // right (x near 100%) was squeezed into a sliver — and the base style
        // (img max-width 100%) shrank the picture with it.
        width: "max-content",
        transform: shift === "0" ? undefined : `translateX(${shift})`,
        lineHeight: 1.2,
        opacity: el.opacity,
        textAlign: el.align ?? "left",
      };
  return (
    <div data-el={el.id} style={box}>
      <CustomElementContent el={el} data={data} layout={layout} placeholder={placeholder} />
    </div>
  );
}

/**
 * A free design, drawn. The shape comes from a padding spacer rather than
 * aspect-ratio (see CustomBlockCard: an overflow-clipped box can collapse), and
 * the elements paint in array order — later ones on top.
 */
export function FreeCard({ data, layout, placeholder = false }: { data: CardData; layout: CustomLayout; placeholder?: boolean }) {
  return (
    <div
      className="sc-card"
      style={{
        position: "relative", width: "100%",
        background: layout.background, fontFamily: layout.fontFamily, color: layout.textColor,
        borderRadius: 16, overflow: "hidden",
        boxShadow: "0 4px 20px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.10)",
      }}
    >
      <div aria-hidden style={{ width: 0, paddingBottom: `${(100 / 1.75).toFixed(3)}%` }} />
      {layout.elements.map((el) => (
        <FreeElement key={el.id} el={el} data={data} layout={layout} placeholder={placeholder} />
      ))}
    </div>
  );
}

// ── Block rendering ─────────────────────────────────────────────────────────

const CONTACT_ICON: Record<string, () => React.ReactElement> = {
  phone: IcoPhone, fax: IcoPhone, email: IcoMail, website: IcoGlobe, address: IcoPin,
};

/** Perceived brightness of the first #rrggbb in a colour or gradient string. */
function lum(color?: string): number | null {
  const m = /#([0-9a-f]{6})/i.exec(color ?? "");
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000;
}

/**
 * Colour ramp so an owner never has to pick a shade per line.
 *
 * The accent draws the job title and the contact icons directly on the card's
 * surface, so unlike a body colour it has no ground of its own. An accent close
 * to the background renders them invisible — a scanned card reading a dark red
 * mark on a navy ground produced exactly that, and it is equally reachable by
 * choosing a custom background under an existing Look. So the accent falls back
 * to the text colour whenever it doesn't separate from what it sits on.
 */
function ramp(layout: CustomLayout, onPanel = false) {
  const strong = (onPanel && layout.panelTextColor) || layout.textColor;
  const ground = onPanel ? (layout.panelBackground ?? layout.background) : layout.background;
  const a = lum(layout.accentColor);
  const g = lum(ground);
  const accentReads = !layout.accentColor || a === null || g === null || Math.abs(a - g) >= 26;
  return {
    hero: strong,
    normal: strong,
    quiet: withOpacity(strong, 0.72),
    accent: accentReads ? (layout.accentColor || strong) : strong,
  };
}
function withOpacity(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/**
 * One block, laid out in flow. Every text block wraps and auto-fits — there is
 * no `nowrap` anywhere, which is what stops a long email from running past the
 * card edge the way the legacy renderer could.
 */
export function CustomBlockContent({
  block, data, layout, density, imageScale = 1, onPanel = false, placeholder = false,
  // What fraction of the zone's width this block gets. 1 for a block on its own
  // row; 1/3 for a social sharing a row with two others, so it is sized to the
  // column it actually occupies rather than to the whole card.
  widthShare = 1,
  // The longest handle among the socials sharing this row, so they all take one
  // size instead of each shrinking to its own length.
  peerChars = 0,
  // Set when the row decided its handles can't be read at the size they'd need.
  iconOnly = false,
}: {
  block: CustomBlock; data: CardData; layout: CustomLayout; density: number;
  imageScale?: number; onPanel?: boolean; placeholder?: boolean;
  widthShare?: number; peerChars?: number; iconOnly?: boolean;
}) {
  const c = ramp(layout, onPanel);
  const fs = blockFontPx(block.emphasis, density);
  const px = Math.round(blockImagePx(block.emphasis, density) * imageScale);
  const tone = block.color || (block.emphasis === "quiet" ? c.quiet : c.normal);

  if (block.type === "logo") {
    if (!data.logoUrl) return placeholder
      ? <div style={{ width: px, height: px * 0.62, borderRadius: 9, border: `1px dashed ${withOpacity(layout.textColor, 0.4)}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: c.quiet }}>Logo</div>
      : null;
    return (
      // Clipped to its own radius: real logos are opaque rectangles, so rounding
      // the image itself is the only thing that looks deliberate for all of them.
      <div style={{ borderRadius: 10, overflow: "hidden", boxShadow: `0 0 0 1px ${withOpacity(layout.textColor, 0.16)}`, display: "flex", maxWidth: "100%" }}>
        {/* Width and height are capped SEPARATELY. A wordmark needs room across,
            not down, and height is the scarce dimension — raising both together
            made a full card overflow again, which the fuzz caught immediately. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={data.logoUrl}
          alt="logo"
          style={{
            maxWidth: Math.min(px * 1.34, 118), maxHeight: px * 0.72,
            // minWidth 0 is load-bearing: a flex item's automatic minimum size
            // is its CONTENT size, and for a replaced element that is the
            // image's own width — so it refused to shrink to the tile's cap and
            // hung 3px past the panel edge. The fuzz caught it only in the
            // mirror skeleton, where the panel sits against the card's right.
            minWidth: 0, objectFit: "contain", display: "block",
          }}
        />
      </div>
    );
  }

  if (block.type === "headshot") {
    if (!data.photoUrl) return placeholder
      ? <div style={{ width: px, height: px, borderRadius: 9999, border: `1px dashed ${withOpacity(layout.textColor, 0.4)}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: c.quiet }}>Photo</div>
      : null;
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={data.photoUrl} alt="" style={{ width: Math.min(px, 116), height: Math.min(px, 116), minWidth: 0, objectFit: "cover", borderRadius: 9999, display: "block" }} />;
  }

  if (block.type === "qr") {
    // FLOORED. The QR is the only thing on the card with a job beyond looking
    // right, and "quiet" emphasis on a full card took it to 27 design px —
    // small enough that a phone camera struggles, which makes the card fail at
    // the one task it exists for. A too-small code is worse than a slightly
    // larger one crowding the corner, so this floor wins over the density
    // solve. It costs the layout nothing at normal loads: only Atelier and
    // Noir, which deliberately set the QR quiet, ever reach it.
    return <MiniQR size={Math.max(QR_MIN_PX, Math.round(px * 0.68))} bg="#ffffff" fg="#111827" url={data.cardUrl} />;
  }

  if (block.type === "divider") {
    return <div style={{ width: "62%", height: 2, borderRadius: 2, background: block.color || c.accent, opacity: 0.8 }} />;
  }

  // A handle is ONE unbroken token, so it either fits its column or it splits
  // mid-word. fitPx sizes by character count against a "comfy" length, which is
  // a proxy — and two rounds of tuning that proxy still left the fuzz failing.
  // The zone widths are known, so fit against actual PIXELS instead: 0.6em per
  // character is a deliberate over-estimate of average advance, so the result
  // errs small rather than splitting.
  // Minus the column gaps a shared row spends: three across lose two gaps.
  const zonePx = (onPanel ? 116 : 248) * widthShare - (widthShare < 1 ? 8 : 0);
  const fitToWidth = (text: string, base: number) =>
    Math.max(base * 0.4, Math.min(base, zonePx / Math.max(1, text.length * 0.6)));

  if (block.type === "socials") {
    const handles = socialHandles(data);
    const shown = handles.length ? handles : placeholder ? ["@handle"] : [];
    if (!shown.length) return null;
    const longest = shown.reduce((m, h) => Math.max(m, shortHandle(h).length), 0);
    return (
      // lineHeight is EXPLICIT here, and that is load-bearing. Zone's wrapper
      // sets lineHeight 0 to kill the preflight strut, and this was the one
      // branch of CustomBlockContent with no line-height of its own — so the 0
      // inherited straight through, every line box collapsed, and the row drew
      // 0px tall with its glyphs painting over the lines above and below it.
      // Five handles wrapped to two flex lines 9px apart and overlapped each
      // other. Every other branch is safe by accident: logo, headshot, QR and
      // divider have explicit heights, and field/text set 1.25 on their span.
      <div style={{ display: "flex", gap: 9, flexWrap: "wrap", fontSize: fitToWidth("x".repeat(longest), fs), lineHeight: 1.25, color: tone, minWidth: 0 }}>
        {shown.map((h, i) => <span key={i} style={{ overflowWrap: "anywhere" }}>{shortHandle(h)}</span>)}
      </div>
    );
  }

  if (block.type === "social") {
    const meta = SOCIAL_META[block.social ?? "instagram"];
    const shown = socialShown(block, data, placeholder);
    if (!shown) return null;
    // Past the legibility floor the row shows MARKS instead of handles.
    // Six handles in three columns is 6.5px design type — about 5px on a phone
    // — and a handle nobody can read is worse than a logo everybody recognises.
    // One long handle used to drag the whole row down there; now the row makes
    // a decision instead, and the QR carries the handles in full.
    if (iconOnly) {
      const isz = Math.max(11, fs * 1.5);
      return (
        <span
          title={shown}
          style={{ display: "inline-flex", width: isz, height: isz, color: c.accent, flexShrink: 0 }}
        >
          <PlatformIcon label={meta.icon} className="w-full h-full" />
        </span>
      );
    }
    // The icon eats room too, so the text is fitted to what's left of the zone.
    //
    // Sized against the LONGEST handle in the row, not this one. Fitting each
    // independently set "@aaronlavicapital" visibly smaller than the
    // "@aaronlavi" sitting next to it — three different type sizes on one line,
    // which reads as a mistake rather than as fitting.
    const sfs = fitToWidth("x".repeat(Math.max(shown.length, peerChars)) + "xx", fs);
    return (
      // Explicit lineHeight for the same reason as the block above.
      <span style={{ display: "inline-flex", alignItems: "center", gap: sfs * 0.45, fontSize: sfs, lineHeight: 1.25, color: tone, minWidth: 0 }}>
        <span style={{ width: sfs * 1.15, height: sfs * 1.15, display: "inline-flex", flexShrink: 0, color: c.accent }}>
          <PlatformIcon label={meta.icon} className="w-full h-full" />
        </span>
        <span style={{ overflowWrap: "anywhere" }}>{shown}</span>
      </span>
    );
  }

  // field / text
  const rawValue = block.type === "field" ? fieldValue(data, block.field) : (block.text ?? "");
  // Numbers go through the same formatter every preset template uses, so a
  // custom card never shows a raw 4048550515 where the others show (404) 855-0515.
  const value = block.field === "phone" && rawValue ? formatPhone(rawValue) : rawValue;
  const shown = value || (placeholder ? (block.type === "field" ? `{${block.field}}` : "Text") : "");
  if (!shown) return null;

  const isName = block.field === "name";
  const isTitle = block.field === "title";
  const Icon = block.type === "field" ? CONTACT_ICON[block.field ?? ""] : undefined;
  // Auto-fit by length so a long value shrinks instead of overflowing. The name
  // additionally fits by longest WORD, the same rule the preset templates use.
  // An email or a domain is ONE unbroken token: it either fits its column or it
  // splits mid-word ("aaron@malvecapita / l.com"). Length-based fitting sizes by
  // character count against a comfy length, which is a proxy and was still
  // letting a hero-emphasis email split. Anything without a space is therefore
  // ALSO clamped to the zone's real width; prose with spaces just wraps.
  // ONE rule, shared with the density model (lib/custom-layout textBlockPx), so
  // the model plans for the size this actually draws.
  const sized = textBlockPx(block, shown, fs, zonePx);

  const text = (
    <span
      style={{
        fontSize: sized,
        color: isTitle ? c.accent : tone,
        fontWeight: block.emphasis === "hero" ? 650 : isTitle || block.field === "phone" ? 600 : 400,
        letterSpacing: isName ? "0.03em" : isTitle ? "0.13em" : undefined,
        textTransform: isName || isTitle ? "uppercase" : undefined,
        lineHeight: 1.25,
        overflowWrap: "anywhere",
        whiteSpace: block.field === "address" ? "pre-line" : undefined,
        minWidth: 0,
      }}
    >
      {shown}
    </span>
  );

  if (!Icon) return text;
  return (
    <span style={{ display: "flex", alignItems: "center", gap: Math.max(5, fs * 0.5), minWidth: 0, color: c.accent }}>
      <span style={{ width: fs * 1.05, height: fs * 1.05, display: "inline-flex", flexShrink: 0 }}><Icon /></span>
      {text}
    </span>
  );
}

function Zone({
  blocks, data, layout, density, placeholder, gap, imageScale = 1, onPanel = false,
}: {
  blocks: CustomBlock[]; data: CardData; layout: CustomLayout; density: number;
  placeholder: boolean; gap: number; imageScale?: number; onPanel?: boolean;
}) {
  // lineHeight 0 kills the STRUT. Preflight sets line-height 1.5 on the body,
  // so a wrapper contributed a 16 x 1.5 = 24px line box whatever was inside it:
  // a 13px name at lineHeight 1.25 wants 16.25px and got 24. Every text block
  // was 7.75px taller than its own text, the dead space did NOT shrink with
  // density (the strut comes from the root's fixed 16px, not the block's), and
  // on a fixed-size card that is the difference between shrinking working and
  // not. The inner span sets its own line-height, so the line box is exact.
  const row = { minWidth: 0, marginTop: gap, lineHeight: 0 } as const;
  return (
    <>
      {groupSocials(blocks).map((g, i) => {
        if (!Array.isArray(g)) {
          return (
            <div key={g.id} data-cb={g.id} style={row}>
              <CustomBlockContent
                block={g} data={data} layout={layout} density={density}
                imageScale={imageScale} onPanel={onPanel} placeholder={placeholder}
              />
            </div>
          );
        }
        // A run of socials is ONE row that flows across and wraps down, rather
        // than one full-width row each. Every social keeps its own data-cb, so
        // tapping one in the designer still selects that social and not the
        // group.
        const cols = socialCols(g.length);
        const peerChars = g.reduce((m, bl) => Math.max(m, socialShown(bl, data, placeholder).length), 0);
        const colGap = gap + 3;
        // The row's decision, made with the same maths CustomBlockContent
        // fits with, so the two can't disagree about what will fit. `+ 2` is
        // the icon's share, matching the "xx" the fitter appends.
        const colPx = (onPanel ? 116 : 248) / cols - 8;
        const wouldBe = Math.min(blockFontPx(g[0].emphasis, density), colPx / Math.max(1, (peerChars + 2) * 0.6));
        const iconOnly = wouldBe < SOCIAL_HANDLE_MIN_PX;
        return (
          <div
            key={`socials-${i}`}
            style={{
              ...row, display: "flex", flexWrap: "wrap", alignItems: "center",
              columnGap: iconOnly ? Math.max(7, gap + 2) : colGap,
              rowGap: Math.max(2, gap - 2),
            }}
          >
            {g.map((bl) => (
              // A FIXED basis, not natural width. Letting flex decide put four
              // on the first row and one on the second once they all shared a
              // type size — a full row then a stray. Three even columns wrap
              // 3+3 and 3+2, which is the shape a row of handles should have.
              <span
                key={bl.id}
                data-cb={bl.id}
                style={{
                  // Handles get even columns so they line up. MARKS don't need
                  // a column each — held to a third of the card they sat marooned
                  // in the middle of nothing, so they cluster at their own width
                  // and still fill right and wrap down.
                  flex: iconOnly ? "0 0 auto" : `0 0 calc((100% - ${(cols - 1) * colGap}px) / ${cols})`,
                  minWidth: 0, overflow: "hidden",
                }}
              >
                <CustomBlockContent
                  block={bl} data={data} layout={layout} density={density}
                  imageScale={imageScale} onPanel={onPanel} placeholder={placeholder}
                  widthShare={1 / cols} peerChars={peerChars} iconOnly={iconOnly}
                />
              </span>
            ))}
          </div>
        );
      })}
    </>
  );
}

export function CustomBlockCard({ data, placeholder = false }: { data: CardData; placeholder?: boolean }) {
  const layout = normalizeCustomLayout(data.customization?.customLayout);
  const skeleton = layout.skeleton ?? "split";
  const stacked = skeleton === "stacked";
  // A block with nothing to show must not take SPACE either.
  //
  // Found by round-tripping real printed cards through the scanner: a card whose
  // photo shows a logo produces a logo block, but the account that scanned it
  // may not have uploaded one yet — and `side.length` counted blocks that were
  // ON rather than blocks that would draw. The result was a third of the card
  // given to an empty panel with a hairline rule down the middle of nothing.
  // The same miscount gave every empty text block a phantom `marginTop` gap and
  // fed blockDensity rows it would never draw, shrinking the card to fit them.
  //
  // Not applied in placeholder mode: the designer deliberately shows dashed
  // stand-ins so you can arrange a card before its content exists.
  //
  // Trimmed here as well as in the editor: the editor stops an owner going past
  // the cap, and this stops a hand-edited payload from rendering a broken card.
  const blocks = visibleBlocks(
    (layout.blocks ?? []).filter((bl) => placeholder || blockHasValue(bl, data)),
  );
  // Whether a panel will be DRAWN — decided here, once, and handed to both the
  // sizing model and the markup below so they cannot disagree. A coloured panel
  // survives an empty side zone, so an owner who has not uploaded a logo still
  // gets one; the model, reading only the filtered block list, saw no side
  // blocks, budgeted for a full-width column, and sized the text for 396px of
  // room that the renderer then gave 236px of. That is how the designer preview
  // and the published card came out 18-35% apart.
  const sideForPanel = blocks.filter((bl) => zoneFor(bl) === "left");
  const panelIntended = (layout.blocks ?? []).some((bl) => bl.on && zoneFor(bl) === "left");
  const panelShown = sideForPanel.length > 0 || (!!layout.panelBackground && panelIntended);

  // `data` is what lets the model see WRAPPING — the dominant term in how tall
  // the content really is, and invisible to a block list on its own. Passed in
  // placeholder mode too, so the designer previews at the size it will publish.
  const density = blockDensity(blocks, skeleton, data, placeholder, panelShown);
  // The side panel is solved on its own (lib/custom-layout sideDensity): side
  // by side it has the card's whole height, so a full main column no longer
  // shrinks the logo and headshot in an otherwise empty panel.
  const panelDensity = sideDensity(blocks, skeleton, data, placeholder, panelShown);
  const sideScale = sideImageScale(skeleton);

  const side = sideForPanel;
  const main = blocks.filter((bl) => zoneFor(bl) === "right" && bl.type !== "qr");
  const qr = blocks.find((bl) => zoneFor(bl) === "right" && bl.type === "qr");
  const gap = Math.round(5 * density);

  // A panel with its own surface is what makes a two-tone card possible — a
  // coloured column beside a light field, or a band across the top.
  //
  // A COLOURED panel is a design element in its own right and stays even when
  // the mark it was going to hold hasn't been uploaded yet: dropping it turned
  // a scanned salon card's plum column and a plumber's red header stripe into
  // plain white, losing the very thing that made them recognisable. An
  // UNCOLOURED panel is only a container, and an empty container is a third of
  // the card spent on a hairline rule around nothing — that one goes.
  // panelShown, computed once above, is the SAME decision the sizing model was
  // given — having the markup re-derive it is how the two drifted apart.
  const panelBg = layout.panelBackground;
  const sidePanel = panelShown ? (
    <div
      className="shrink-0 flex items-center"
      style={{
        background: panelBg,
        // Stacked reads as a letterhead, so the band aligns LEFT with the text
        // beneath it. Centring it looked like a mistake rather than a choice.
        ...(stacked
          ? { width: "100%", padding: panelBg ? "16px 18px" : "15px 18px 0", gap: 12, justifyContent: "flex-start" }
          : { width: "34%", padding: "16px 12px 16px 17px", flexDirection: "column" as const, justifyContent: "center" }),
      }}
    >
      <Zone
        blocks={side} data={data} layout={layout} density={panelDensity} placeholder={placeholder}
        gap={0} imageScale={sideScale} onPanel={!!panelBg}
      />
    </div>
  ) : null;

  // The hairline only earns its place when there is no panel colour; with one,
  // the panel's own edge already separates the two halves.
  const rule = !stacked && side.length > 0 && !panelBg ? (
    <div className="self-stretch shrink-0" style={{ width: 1, margin: "20px 0", background: withOpacity(layout.textColor, 0.2) }} />
  ) : null;

  return (
    <div
      className="sc-card"
      // The solved density, for the layout sweep: at the ceiling the card is as
      // large as it is allowed to be, so spare height is not "unused space".
      data-density={density.toFixed(3)}
      style={{
        position: "relative", width: "100%",
        background: layout.background, fontFamily: layout.fontFamily, color: layout.textColor,
        borderRadius: 16,
        overflow: "clip",
        // The card is ALWAYS a row; the skeleton's direction lives one level in.
        // That is what lets the spacer below work: a zero-width flex item only
        // costs nothing when the axis is horizontal. When the card itself was a
        // column for the stacked skeleton, the spacer took a full row at the top
        // and pushed Local Business's header stripe into the middle of the card.
        display: "flex",
        boxShadow: "0 4px 20px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.10)",
      }}
    >
      {/* THE SHAPE, and nothing can change it.
          A business card is 1.75:1 in the hand and the owner's is 1.75:1 on the
          screen no matter what they put on it — turning a block on must never
          make the card a different object.
          This spacer is the only thing that sets the height: percentage padding
          resolves against the CONTAINING BLOCK's inline size, so it is 0 wide
          and exactly width/1.75 tall. `aspectRatio` alone can't do this job —
          with overflow clip the card is a scroll container whose automatic
          minimum size is zero, so it collapses rather than holding the shape.
          The spacer used to be a FLOOR, with the content layer as a sibling
          flex item free to make the card taller. It is now the whole story: the
          content layer is absolutely positioned, so it contributes no height at
          all and physically cannot stretch the card. Fitting inside it is
          blockDensity's job, and MAX_VISIBLE_BLOCKS is the point past which no
          amount of shrinking would still be readable — both calibrated against
          this exact box (see the sweep in custom-layout.ts). */}
      <div aria-hidden style={{ width: 0, flexShrink: 0, paddingBottom: `${(100 / 1.75).toFixed(3)}%` }} />
      <div
        className="flex min-w-0"
        style={{
          position: "absolute",
          inset: 0,
          flexDirection: stacked ? "column" : skeleton === "mirror" ? "row-reverse" : "row",
        }}
      >
        {sidePanel}
        {rule}
        <div
          className="flex-1 min-w-0 flex flex-col justify-between"
          // minHeight 0: a flex item's automatic minimum size is its content,
          // which would let a tall block push this column past the card it now
          // has to live inside.
          style={{ minHeight: 0, padding: stacked ? "10px 18px 14px" : "16px 16px 14px 15px" }}
        >
          <div className="min-w-0 flex flex-col">
            <Zone blocks={main} data={data} layout={layout} density={density} placeholder={placeholder} gap={gap} />
          </div>
          {/* The QR always lands bottom-right at a fixed inset, the same place it
              sits on all six preset templates. */}
          {qr ? (
            <div className="flex items-end justify-end" data-cb={qr.id}>
              <CustomBlockContent block={qr} data={data} layout={layout} density={density} placeholder={placeholder} />
            </div>
          ) : <div />}
        </div>
      </div>
    </div>
  );
}

// ── Design transfer: the card IS a picture ──────────────────────────────────
// The face image is a finished card design (the owner's approved AI rebuild of
// a card they photographed), so nothing is composed here — the image fills the
// 1.75:1 box edge to edge, and the only live element is the QR, overlaid
// bottom-right where every preset puts it. It is overlaid rather than baked
// into the image because an image model cannot draw a scannable QR code — the
// one on the generated picture would LOOK right and scan as garbage.
export function FaceCard({ data, src }: { data: CardData; src: string }) {
  return (
    <div className="relative w-full rounded-2xl overflow-hidden" style={{ background: "#0f172a" }}>
      <div aria-hidden style={{ width: 0, paddingBottom: `${(100 / 1.75).toFixed(3)}%` }} />
      {/* eslint-disable-next-line @next/next/no-img-element -- storage URL, sized by the box */}
      <img
        src={src}
        alt=""
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
      />
      <div style={{ position: "absolute", right: 12, bottom: 12 }}>
        <MiniQR size={52} url={data.cardUrl} />
      </div>
    </div>
  );
}

export default function CustomCard({ data }: { data: CardData }) {
  const raw = data.customization?.customLayout;
  // Face image wins over everything: it only exists when the owner explicitly
  // approved an exact-design preview, and normalizeCustomLayout has already
  // dropped any URL that isn't ours.
  const face = normalizeCustomLayout(raw as CustomLayout).faceImage;
  if (face) return <FaceCard data={data} src={face} />;
  if (hasBlocks(raw as CustomLayout)) return <CustomBlockCard data={data} />;

  // ── Free design (AI design, and the previous positioned designer) ─────
  // Through normalizeCustomLayout, exactly like the block renderer: it validates
  // every element and every style sink (colours, gradients, fonts) the blob can
  // carry, and drops anything that isn't an object — `elements: [null]` once
  // made this path throw on `el.x`, a 500 on the public card page.
  const norm = normalizeCustomLayout(raw);
  const layout = norm.elements?.length
    ? norm
    : { ...norm, elements: DEFAULT_CUSTOM_LAYOUT.elements };
  return <FreeCard data={data} layout={layout} />;
}
