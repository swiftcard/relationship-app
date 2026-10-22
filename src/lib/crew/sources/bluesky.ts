// ── Bluesky, read only (public AppView search) ──────────────────────────────
// Verified live 2026-10-21: https://api.bsky.app/xrpc/app.bsky.feed.searchPosts
// answers without a login, while public.api.bsky.app returns a 403 page for
// search. No login, no posting: drafts are posted by a person from their own
// account. A refused search (HTTP error) means "no results this run", never a
// failed run, the same as a blocked domain in web-discovery.

export type BlueskyPost = { url: string; author: string; title: string; text: string; replyCount: number; isReply: boolean };

const SEARCH = "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts";

type RawPost = {
  uri?: string;
  author?: { handle?: string; labels?: unknown[] };
  record?: { text?: string; reply?: unknown };
  replyCount?: number;
  labels?: unknown[];
};

/** at://did/app.bsky.feed.post/<rkey> + handle → the post's bsky.app link. */
export function postUrl(uri: string, handle: string): string | null {
  const rkey = uri.match(/\/app\.bsky\.feed\.post\/([A-Za-z0-9]+)$/)?.[1];
  return rkey && handle ? `https://bsky.app/profile/${handle}/post/${rkey}` : null;
}

export function toPosts(raw: RawPost[]): BlueskyPost[] {
  const out: BlueskyPost[] = [];
  for (const p of raw) {
    const handle = p.author?.handle ?? "";
    const url = postUrl(p.uri ?? "", handle);
    const text = (p.record?.text ?? "").trim();
    // Labeled posts or authors (adult, spam, etc.) are never worth a reply.
    if (!url || !text || handle === "handle.invalid" || p.labels?.length || p.author?.labels?.length) continue;
    out.push({ url, author: handle, title: text.split("\n")[0].slice(0, 140), text: text.slice(0, 3000), replyCount: p.replyCount ?? 0, isReply: !!p.record?.reply });
  }
  return out;
}

/** Recent English posts matching a query (one request). */
export async function searchBluesky(query: string, limit = 25, now = new Date()): Promise<BlueskyPost[]> {
  const since = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const q = new URLSearchParams({ q: query, sort: "latest", lang: "en", since, limit: String(limit) });
  try {
    const r = await fetch(`${SEARCH}?${q}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return [];
    const j = (await r.json()) as { posts?: RawPost[] };
    return toPosts(j.posts ?? []);
  } catch {
    return [];
  }
}
