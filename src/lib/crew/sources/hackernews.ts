// ── Hacker News, read only (Algolia's public HN search) ─────────────────────
// https://hn.algolia.com/api: free, no key, generous limits. Checked live
// 2026-10-27: search_by_date with tags=(story,comment) returns each hit's
// objectID, author, story or comment text and created_at_i. Every hit links
// to its own page (news.ycombinator.com/item?id=<objectID>), which for a
// comment is that comment with its reply box: the exact place to answer.
// A refused or failed search is "no results this run", never a failed run.

export type HnHit = { id: string; url: string; kind: "story" | "comment"; author: string; title: string; text: string; createdAt: number };

type RawHit = {
  objectID?: string;
  _tags?: string[];
  author?: string;
  title?: string | null;
  story_title?: string | null;
  comment_text?: string | null;
  story_text?: string | null;
  created_at_i?: number;
};

const SEARCH = "https://hn.algolia.com/api/v1/search_by_date";

/** HN text comes as HTML (<p>, &#x27;, links); keep the words. */
export function hnText(html: string): string {
  return html
    .replace(/<p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&#x2F;/g, "/")
    .replace(/&amp;/g, "&")
    .trim();
}

export function toHits(raw: RawHit[]): HnHit[] {
  const out: HnHit[] = [];
  for (const h of raw) {
    const id = h.objectID ?? "";
    if (!/^\d+$/.test(id) || !h.author) continue;
    const kind = h._tags?.includes("comment") ? "comment" : "story";
    const text = hnText(kind === "comment" ? (h.comment_text ?? "") : (h.story_text ?? ""));
    const title = (h.title ?? h.story_title ?? "").trim();
    if (!text && !title) continue;
    out.push({ id, url: `https://news.ycombinator.com/item?id=${id}`, kind, author: h.author, title: kind === "comment" ? `Re: ${title}` : title, text: text.slice(0, 3000), createdAt: h.created_at_i ?? 0 });
  }
  return out;
}

/** Stories and comments from the last `days` days matching a query (one request). */
export async function searchHackerNews(query: string, limit = 20, now = new Date(), days = 14): Promise<HnHit[]> {
  const since = Math.floor(now.getTime() / 1000) - days * 86400;
  const q = new URLSearchParams({ query, tags: "(story,comment)", numericFilters: `created_at_i>${since}`, hitsPerPage: String(limit) });
  try {
    const r = await fetch(`${SEARCH}?${q}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return [];
    const j = (await r.json()) as { hits?: RawHit[] };
    return toHits(j.hits ?? []);
  } catch {
    return [];
  }
}
