// ── Swift Links tile layout ─────────────────────────────────────────────────
//
// hoo.be's pages breathe because tiles VARY — a full-width feature, pairs of
// half-width cards, slim rows for plain links. Ours rendered one shape. Each
// link can now carry a size, with an automatic default, and this module is the
// single place the layout decision lives (pure, so it's testable without
// rendering anything).
//
//   featured — full-width 1.91:1 image tile (the hero treatment)
//   grid     — half-width tile, packs in pairs (the classic album grid)
//   compact  — slim full-width row: icon circle + label + chevron. For plain
//              links that don't deserve a big image tile.
//
// AUTO (no explicit size): video → featured is wrong as a blanket rule (three
// videos would each eat a full row), so auto = grid, and the odd-grid-out is
// PROMOTED to featured — which reproduces the pre-sizes layout exactly for
// all-auto pages: odd count → first tile big, rest in pairs.
//
// PLAN LINE (the agreed Free floor): Free pages render every link COMPACT —
// featured tiles, the grid, and inline video are the "premium Swift Links"
// that plan-content has always advertised as Pro. Sizes a Free account has
// stored are kept, not deleted; they simply don't render until the plan does.

export type TileSize = "featured" | "grid" | "compact";

/** What a row renders as: a tile size, or a section header. */
export type TileRender = TileSize | "header";

/** Row treatment for a COMPACT link — "tile" is the stock translucent row. */
export type RowStyle = "tile" | "solid" | "outline";

/** An uploaded preview for a FEATURED / GRID tile: a photo shown in place
 *  of the link's og:image, or a short video that autoplays muted as the tile. */
export type LinkMedia = { url: string; type: "image" | "video" };

export type SizedLink = {
  label: string;
  url: string;
  emoji?: string;
  size?: TileSize;
  kind?: "link" | "header";
  /** Compact rows only. Absent → the page-wide linkButtonStyle (legacy) → "tile". */
  rowStyle?: RowStyle;
  /** Featured/Grid tiles only. Absent → the link's own preview. */
  media?: LinkMedia;
  /** Frosted glass for this link (Link buttons → Blur). */
  glass?: boolean;
};

/** The picker's vocabulary — "Auto" was retired 2026-09-09 (owner order:
 *  every link is chosen explicitly in Social design). A stored link with no
 *  size still resolves as before, so old pages don't move. */
export const TILE_SIZES: { id: TileSize; name: string; hint: string }[] = [
  { id: "featured", name: "Featured", hint: "Full-width tile with a big preview" },
  { id: "grid",     name: "Grid",     hint: "Half-width tile, shown in pairs" },
  { id: "compact",  name: "Compact",  hint: "Slim row — icon, name, arrow" },
];

/**
 * The compact row's style for ONE link. Per-link wins; a link that was never
 * touched in the new per-link picker falls back to the page-wide setting the
 * old "Link buttons" control wrote, so pages styled before 2026-09-09 render
 * unchanged.
 */
export function resolveRowStyle(link: Pick<SizedLink, "rowStyle">, pageStyle?: string | null): RowStyle {
  if (link.rowStyle === "solid" || link.rowStyle === "outline" || link.rowStyle === "tile") return link.rowStyle;
  if (pageStyle === "solid" || pageStyle === "outline") return pageStyle;
  return "tile";
}

/**
 * The uploaded media a tile may show. HTTPS-only: the URL rides in the
 * client-writable customization blob, so anything else is dropped rather than
 * rendered. Free never renders tiles, so it never renders media either.
 */
export function tileMedia(link: Pick<SizedLink, "media">, paid: boolean): LinkMedia | null {
  const m = link.media;
  if (!paid || !m || typeof m.url !== "string" || !/^https:\/\//i.test(m.url)) return null;
  if (m.type !== "image" && m.type !== "video") return null;
  return { url: m.url, type: m.type };
}

/** What one link renders as, given the plan. */
export function resolveTileSize(link: SizedLink, paid: boolean): TileSize {
  if (!paid) return "compact";
  if (link.size === "featured" || link.size === "grid" || link.size === "compact") return link.size;
  return "grid";
}

/**
 * The final render plan: every link with its effective size, with the lone
 * odd grid tile (if any) promoted to featured so no half-width tile ever sits
 * alone next to empty space. Promotion picks the FIRST auto-sized grid tile —
 * the pre-sizes layout rule — and only falls back to the first EXPLICIT grid
 * tile when every grid tile was explicitly chosen.
 */
export function layoutTiles(links: SizedLink[], paid: boolean): { link: SizedLink; size: TileRender }[] {
  // Section headers: chapters for long pages, so Pro-only by design — Free
  // caps at two links, and a heading over two rows is furniture. They pass
  // through in place and never count toward grid pairing.
  const visible = paid ? links : links.filter((l) => l.kind !== "header");
  const out: { link: SizedLink; size: TileRender }[] = visible.map((link) => ({
    link,
    size: link.kind === "header" ? "header" : resolveTileSize(link, paid),
  }));
  const grids = out.filter((t) => t.size === "grid");
  if (grids.length % 2 === 1) {
    const firstAuto = out.find((t) => t.size === "grid" && t.link.size === undefined);
    (firstAuto ?? grids[0]).size = "featured";
  }
  return out;
}

/**
 * The rows the card page's "Swift Links" box lists: the same links, in the
 * same order, with the owner's section headers between them — so the box
 * reads like a short version of the Swift Links page. Headers follow the
 * page's plan line (Pro only; Free renders none). A header with no link
 * under it — at the end, or straight before another header — titles nothing
 * and is dropped, so the box never shows an empty section.
 */
export function cardLinkRows<T extends { label?: string; url?: string; kind?: string }>(raw: unknown, paid: boolean): T[] {
  const rows = (Array.isArray(raw) ? raw : []).filter(
    (l): l is T => !!l && typeof l === "object" && !!String((l as T).label ?? "").trim()
      && ((l as T).kind === "header" ? paid : !!String((l as T).url ?? "").trim()),
  );
  return rows.filter((l, i) => l.kind !== "header" || (i + 1 < rows.length && rows[i + 1].kind !== "header"));
}
