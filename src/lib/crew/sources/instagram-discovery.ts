// ── Instagram Business Discovery: a known account's real profile and posts ──
//
// Instagram's own API (Graph API business_discovery), read-only and free: give
// it an @handle and it returns that business or creator account's bio,
// website, follower count and latest posts with their captions, dates and
// links. It does not search; the handles still come from the DM agent's web
// search and Paste a Post. Tested live on 2026-11-06 (@mike.mclean_realtor:
// bio, website, 11,196 followers, 5 posts with caption, date and permalink).
//
// The token is the owner's long-lived Facebook user token from the existing
// Meta connection (/api/admin/connect/meta), asked as SwiftCard's own
// Instagram account. Nothing here writes to Instagram.

import { META_GRAPH } from "@/lib/agent-connect-oauth";
import { freshAccessToken, loadConnections } from "@/lib/agent-connections";
import type { CrewStore } from "../store";
import { exactPostLink, instagramHandle } from "../exact-links";

export type IgApiPost = { url: string; caption: string; at: string; type: string; comments: number | null };
export type IgApiProfile = {
  handle: string;
  name: string | null;
  bio: string;
  website: string | null;
  followers: number | null;
  mediaCount: number | null;
  posts: IgApiPost[];
};
export type IgLookup =
  | { ok: true; profile: IgApiProfile }
  | { ok: false; reason: "not_business" | "auth" | "rate_limited" | "error"; detail: string };

export type DiscoveryAuth = { igUserId: string; token: string };

/** Posts per lookup. */
export const LOOKUP_POSTS = 10;
/** "Recently active" means a post within this many days: a scoring signal, never a reason to drop a business. */
export const ACTIVE_DAYS = 30;

const HANDLE = /^[a-z0-9._]{1,30}$/;

/** The owner's Meta connection, if there is one and its token hasn't lapsed. */
export async function discoveryAuth(): Promise<DiscoveryAuth | null> {
  const conn = (await loadConnections()).meta;
  const ig = conn?.meta?.ig_user_id;
  if (!conn || typeof ig !== "string" || !ig) return null;
  const token = await freshAccessToken(conn).catch(() => null);
  return token ? { igUserId: ig, token } : null;
}

type GraphError = { error?: { code?: number; error_subcode?: number; message?: string } };
type GraphMedia = { caption?: string; timestamp?: string; permalink?: string; media_type?: string; comments_count?: number };
type GraphBd = {
  business_discovery?: {
    username?: string; name?: string; biography?: string; website?: string;
    followers_count?: number; media_count?: number; media?: { data?: GraphMedia[] };
  };
} & GraphError;

/** One account, read-only. Never throws. */
export async function lookupBusiness(auth: DiscoveryAuth, rawHandle: string, fetchImpl: typeof fetch = fetch): Promise<IgLookup> {
  const handle = (instagramHandle(rawHandle) ?? "").toLowerCase();
  if (!HANDLE.test(handle)) return { ok: false, reason: "error", detail: `not an Instagram username: ${rawHandle.slice(0, 40)}` };
  const fields = `business_discovery.username(${handle}){username,name,biography,website,followers_count,media_count,media.limit(${LOOKUP_POSTS}){caption,timestamp,permalink,media_type,comments_count}}`;
  let j: GraphBd;
  try {
    // The token goes in the header, never the URL (it would land in logs).
    const res = await fetchImpl(`${META_GRAPH}/${auth.igUserId}?fields=${encodeURIComponent(fields)}`, { headers: { Authorization: `Bearer ${auth.token}` }, signal: AbortSignal.timeout(15_000) });
    j = (await res.json().catch(() => ({}))) as GraphBd;
  } catch (e) {
    return { ok: false, reason: "error", detail: e instanceof Error ? e.message.slice(0, 120) : "request failed" };
  }
  if (j.error) {
    const { code, error_subcode: sub, message } = j.error;
    const detail = `${code ?? "?"}${sub ? `/${sub}` : ""}: ${(message ?? "").slice(0, 160)}`;
    // 110 / 2207013 and "Invalid user id": no business or creator account by that name (personal, renamed or gone).
    if (code === 110 || sub === 2207013 || /cannot be found|invalid user id|not a business/i.test(message ?? "")) return { ok: false, reason: "not_business", detail };
    if (code === 190 || code === 10 || code === 200) return { ok: false, reason: "auth", detail };
    if (code === 4 || code === 17 || code === 32 || code === 613 || code === 80002) return { ok: false, reason: "rate_limited", detail };
    return { ok: false, reason: "error", detail };
  }
  const bd = j.business_discovery;
  if (!bd?.username) return { ok: false, reason: "not_business", detail: "no business_discovery in the response" };
  const posts: IgApiPost[] = [];
  for (const m of bd.media?.data ?? []) {
    const url = m.permalink ? exactPostLink("instagram", m.permalink) ?? m.permalink : null;
    if (!url || !m.timestamp) continue;
    posts.push({ url, caption: (m.caption ?? "").trim(), at: new Date(m.timestamp).toISOString(), type: m.media_type ?? "", comments: typeof m.comments_count === "number" ? m.comments_count : null });
  }
  return {
    ok: true,
    profile: {
      handle: bd.username.toLowerCase(),
      name: bd.name ?? null,
      bio: (bd.biography ?? "").trim(),
      website: bd.website ?? null,
      followers: typeof bd.followers_count === "number" ? bd.followers_count : null,
      mediaCount: typeof bd.media_count === "number" ? bd.media_count : null,
      posts,
    },
  };
}

/** Whole days since their newest post, or null when they have none. */
export function daysSincePost(p: IgApiProfile, now: Date): number | null {
  const newest = p.posts.reduce((t, x) => Math.max(t, Date.parse(x.at) || 0), 0);
  return newest ? Math.max(0, Math.floor((now.getTime() - newest) / 86400_000)) : null;
}

const day = (iso: string) => iso.slice(0, 10);

/**
 * The profile as the scorer and the writer read it. Activity is stated plainly
 * so scoring can weigh it; an account that hasn't posted lately is still listed.
 */
export function profileText(p: IgApiProfile, now: Date): string {
  const since = daysSincePost(p, now);
  const activity = since === null
    ? "Activity: no posts visible."
    : since <= ACTIVE_DAYS
      ? `Activity: active, newest post ${since} day${since === 1 ? "" : "s"} ago.`
      : `Activity: no post in the last ${ACTIVE_DAYS} days (newest is ${since} days old).`;
  const lines = [
    `Instagram profile, read through Instagram's API on ${day(now.toISOString())}: ${p.name ? `${p.name} ` : ""}(@${p.handle})${p.followers !== null ? `, ${p.followers} followers` : ""}${p.mediaCount !== null ? `, ${p.mediaCount} posts` : ""}.`,
    `Bio: ${p.bio ? `"${p.bio}"` : "(empty)"}`,
    ...(p.website ? [`Website: ${p.website}`] : []),
    activity,
    ...(p.posts.length ? ["Recent posts:"] : []),
    ...p.posts.slice(0, 4).map((x) => `- ${day(x.at)} ${x.url}: ${x.caption ? `"${x.caption.replace(/\s+/g, " ").slice(0, 160)}"` : "(no caption)"}`),
  ];
  return lines.join("\n");
}

// ── Posts handed to the comment agent ───────────────────────────────────────
// The DM agent reads each prospect's latest posts anyway; the ones that are
// recent and touch the comment agent's topics wait here for it. Kept in the
// key-value store, not Paste a Post, so they never crowd the owner's pastes.

export const DISCOVERED_POSTS_KEY = "ig-api-posts";
export const DISCOVERED_KEEP = 40;

export type DiscoveredPost = { url: string; handle: string; name: string | null; caption: string; at: string; found: string };

/** Recent captioned posts that pass the comment agent's free topic gate. */
export function commentablePosts(p: IgApiProfile, now: Date, onTopic: RegExp): DiscoveredPost[] {
  return p.posts
    .filter((x) => now.getTime() - Date.parse(x.at) <= ACTIVE_DAYS * 86400_000 && x.caption.length >= 30 && onTopic.test(x.caption))
    .map((x) => ({ url: x.url, handle: p.handle, name: p.name, caption: x.caption.slice(0, 1500), at: x.at, found: now.toISOString() }));
}

/** Add posts to the queue: newest first, no repeats, at most DISCOVERED_KEEP. */
export async function queueDiscovered(store: CrewStore, posts: DiscoveredPost[]): Promise<void> {
  if (!posts.length) return;
  const have = (await store.kvGet<DiscoveredPost[]>(DISCOVERED_POSTS_KEY)) ?? [];
  const byUrl = new Map<string, DiscoveredPost>();
  for (const x of [...posts, ...have]) if (!byUrl.has(x.url)) byUrl.set(x.url, x);
  const list = [...byUrl.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, DISCOVERED_KEEP);
  await store.kvSet(DISCOVERED_POSTS_KEY, list);
}

/** Take up to n posts from the queue (still recent ones only); the rest stay. */
export async function takeDiscovered(store: CrewStore, n: number, now: Date): Promise<DiscoveredPost[]> {
  const have = (await store.kvGet<DiscoveredPost[]>(DISCOVERED_POSTS_KEY)) ?? [];
  const recent = have.filter((x) => now.getTime() - Date.parse(x.at) <= ACTIVE_DAYS * 86400_000);
  const taken = recent.slice(0, Math.max(0, n));
  if (taken.length || recent.length !== have.length) await store.kvSet(DISCOVERED_POSTS_KEY, recent.slice(taken.length));
  return taken;
}
