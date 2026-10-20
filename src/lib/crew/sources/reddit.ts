import { env } from "../env";

// ── Reddit, read only (application-only OAuth) ──────────────────────────────
// Verified 2026-10-20 against Reddit's OAuth2 docs: confidential apps can use
// grant_type=client_credentials (HTTP Basic client id:secret) at
// https://www.reddit.com/api/v1/access_token and then call
// https://oauth.reddit.com with the bearer token. No user login, no posting,
// no messages: drafts are posted by a person. Reddit's terms ask that stored
// Reddit content be deleted quickly, so Crew keeps only the link and a short
// summary, never the post body. Volume is tiny (a few calls a run) against
// the ~60-100 requests/minute app limit.

export type RedditPost = { id: string; url: string; subreddit: string; author: string; title: string; text: string; created: number; numComments: number; locked: boolean; over18: boolean };

let cached: { token: string; until: number } | null = null;

export function redditConfigured(): boolean {
  return !!(env("REDDIT_CLIENT_ID") && env("REDDIT_CLIENT_SECRET") && env("REDDIT_USER_AGENT"));
}

async function token(): Promise<string> {
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  const id = env("REDDIT_CLIENT_ID")!;
  const secret = env("REDDIT_CLIENT_SECRET")!;
  const r = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded", "User-Agent": env("REDDIT_USER_AGENT")! },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`reddit token: HTTP ${r.status}`);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, until: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`https://oauth.reddit.com${path}`, {
    headers: { Authorization: `Bearer ${await token()}`, "User-Agent": env("REDDIT_USER_AGENT")! },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`reddit ${path.split("?")[0]}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

type Listing = { data: { children: { data: Record<string, unknown> }[] } };

function toPost(d: Record<string, unknown>): RedditPost {
  return {
    id: String(d.id),
    url: `https://www.reddit.com${String(d.permalink)}`,
    subreddit: String(d.subreddit),
    author: String(d.author),
    title: String(d.title ?? ""),
    text: String(d.selftext ?? "").slice(0, 3000),
    created: Number(d.created_utc ?? 0),
    numComments: Number(d.num_comments ?? 0),
    locked: !!d.locked || !!d.archived,
    over18: !!d.over_18,
  };
}

/** Recent posts matching a query across a set of subreddits (one request). */
export async function searchSubreddits(subs: string[], query: string, limit = 25): Promise<RedditPost[]> {
  const multi = subs.map((s) => s.replace(/^r\//, "")).join("+");
  const q = new URLSearchParams({ q: query, restrict_sr: "1", sort: "new", t: "week", limit: String(limit), type: "link" });
  const j = await get<Listing>(`/r/${multi}/search?${q}`);
  return j.data.children.map((c) => toPost(c.data)).filter((p) => !p.locked && !p.over18 && p.author !== "[deleted]");
}

/** A subreddit's rules text, to decide whether a product mention is allowed there. */
export async function subredditRules(sub: string): Promise<string> {
  const j = await get<{ rules?: { short_name?: string; description?: string }[] }>(`/r/${sub.replace(/^r\//, "")}/about/rules`);
  return (j.rules ?? []).map((r) => `${r.short_name ?? ""}: ${r.description ?? ""}`).join("\n");
}

export function rulesBanPromotion(rules: string): boolean {
  return /\b(no|ban|banned|prohibit|not allowed)\b[^.\n]{0,40}\b(self[- ]?promo\w*|promotion|advertis\w*|spam|solicit\w*)|\b(self[- ]?promo\w*|advertis\w*|solicit\w*)\b[^.\n]{0,40}\b(not allowed|prohibited|banned|will be removed)/i.test(rules);
}
