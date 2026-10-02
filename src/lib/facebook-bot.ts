import { getAdminSupabase } from "@/lib/supabase-admin";
import { loadConnections, type AgentConnection } from "@/lib/agent-connections";
import { META_GRAPH } from "@/lib/agent-connect-oauth";
import { answerSalesQuestion } from "@/lib/sales-answer";
import { fbPrivateReply, fbReplyToComment, fbSendMessage } from "@/lib/facebook-send";
import {
  mergeIgSettings, processComment, processMessage,
  type Channel, type IgComment, type IgContext, type IgIo, type IgMessage, type IgSettings, type Outcome,
} from "@/lib/instagram-bot";

// ── The Facebook bot ─────────────────────────────────────────────────────────
// Owner order 2026-10-02: every platform gets its bot, and the one goal is
// signups. On Facebook that is the SwiftCard PAGE: "Comment CARD and we'll
// send you one" under our own posts, and the questions people ask the Page.
//
// The decisions are lib/instagram-bot.ts's processComment / processMessage,
// run with the FACEBOOK channel — so the rules cannot drift apart:
//   • OFF by default. Until the owner turns it on, each reply waits in the
//     Agent Flow queue for a one-tap Approve.
//   • It only answers people who wrote to the Page first. Sends live in
//     lib/facebook-send.ts, which cannot address anyone else.
//   • One card link per person per post, a daily cap, never twice for the same
//     comment (unique index on agent_fb_events).
//   • AI answers stay drafts until the owner's second switch (auto_answers).
//   • Every link carries its post's own code (fb_p_<id>), which is also the
//     signup source — so the admin sees which post brought the accounts.
//
// Facebook GROUPS are not here on purpose: Meta gives no tool a way to read or
// post in a group, so those stay with Wes as drafts the owner posts by hand.

// ── Settings ─────────────────────────────────────────────────────────────────

export type FbSettings = Omit<IgSettings, "hashtags">;

export const FB_DEFAULTS: FbSettings = {
  enabled: false,
  auto_answers: false,
  keywords: ["CARD"],
  message: "Hi, it's the SwiftCard assistant. Here's your free digital business card, it takes about 2 minutes to set up: {link}\n\nReply here if you have any questions.",
  public_replies: ["Sent! Check your Messenger 📩", "Just sent it over, check your messages 🙌", "On its way to your inbox ✅", "Sent you the link, take a look 📲"],
  daily_cap: 300,
  profession: null,
};

/** Owner overrides laid over the defaults — the Instagram bot's validation, with Facebook's own wording as the fallback. */
export function mergeFbSettings(over: unknown): FbSettings {
  const o = (over && typeof over === "object" ? over : {}) as Record<string, unknown>;
  const m = mergeIgSettings(o);
  const hasList = (v: unknown) => Array.isArray(v) && v.some((x) => String(x ?? "").trim());
  return {
    enabled: m.enabled, auto_answers: m.auto_answers, keywords: m.keywords, daily_cap: m.daily_cap, profession: m.profession,
    message: typeof o.message === "string" && o.message.includes("{link}") ? m.message : FB_DEFAULTS.message,
    public_replies: hasList(o.public_replies) ? m.public_replies : FB_DEFAULTS.public_replies,
  };
}

export type FbState = { posts?: Record<string, number>; last_tick_at?: string; last_error?: string | null };

// ── Pure helpers (unit-tested; no network) ───────────────────────────────────

/** A Page post id is "<page>_<post>"; the post half, shortened, is the link code. */
export function fbPostCode(postId: string): string {
  try { return `fb_p_${BigInt(String(postId).split("_").pop() ?? "").toString(36)}`; } catch { return "fb_dm"; }
}

export const FACEBOOK: Channel = {
  platform: "facebook", name: "Facebook", prefix: "fb", postCode: fbPostCode,
  inbox: "https://business.facebook.com/latest/inbox/all", handle: (name) => name,
};

/**
 * The comments and messages inside one webhook delivery for the Page. Our own
 * comments and the echoes of our own sends are dropped; so is everything that
 * is not a NEW comment (edits, removals, likes, posts).
 */
export function parseFacebookWebhook(body: unknown): { comments: IgComment[]; messages: IgMessage[] } {
  const comments: IgComment[] = [];
  const messages: IgMessage[] = [];
  const b = body as { object?: string; entry?: unknown[] } | null;
  if (!b || b.object !== "page" || !Array.isArray(b.entry)) return { comments, messages };
  for (const e of b.entry as Array<{ id?: unknown; changes?: unknown[]; messaging?: unknown[] }>) {
    const pageId = e.id != null ? String(e.id) : null;
    for (const ch of (e.changes ?? []) as Array<{ field?: string; value?: Record<string, unknown> }>) {
      if (ch.field !== "feed" || !ch.value) continue;
      const v = ch.value as { item?: unknown; verb?: unknown; comment_id?: unknown; post_id?: unknown; message?: unknown; from?: { id?: unknown; name?: unknown }; created_time?: unknown };
      if (v.item !== "comment" || v.verb !== "add" || typeof v.comment_id !== "string") continue;
      const userId = v.from?.id != null ? String(v.from.id) : null;
      if (userId && userId === pageId) continue;
      comments.push({
        id: v.comment_id, text: String(v.message ?? ""),
        username: typeof v.from?.name === "string" ? v.from.name : null, userId,
        mediaId: v.post_id != null ? String(v.post_id) : null,
        timestamp: typeof v.created_time === "number" ? new Date(v.created_time * 1000).toISOString() : null,
      });
    }
    for (const m of (e.messaging ?? []) as Array<{ sender?: { id?: unknown }; timestamp?: unknown; message?: { mid?: unknown; text?: unknown; is_echo?: unknown } }>) {
      if (!m.message || m.message.is_echo || typeof m.message.mid !== "string" || typeof m.message.text !== "string" || m.sender?.id == null) continue;
      if (String(m.sender.id) === pageId) continue;
      messages.push({ id: m.message.mid, text: m.message.text, userId: String(m.sender.id), timestamp: typeof m.timestamp === "number" ? new Date(m.timestamp).toISOString() : null });
    }
  }
  return { comments, messages };
}

// ── The real I/O ─────────────────────────────────────────────────────────────

// The shared decisions speak the Instagram bot's field names; the Facebook
// ledger has its own (post_id, user_id).
const toRow = (r: Record<string, unknown>): Record<string, unknown> => {
  const { media_id, ig_user_id, ...rest } = r;
  return { ...rest, ...(media_id !== undefined ? { post_id: media_id } : {}), ...(ig_user_id !== undefined ? { user_id: ig_user_id } : {}) };
};

export function fbIo(conn: AgentConnection): IgIo {
  const db = getAdminSupabase();
  const token = conn.access_token;
  const pageId = String(conn.meta.page_id ?? conn.account_id ?? "");
  return {
    record: async (row) => {
      const { data, error } = await db.from("agent_fb_events").insert(toRow(row)).select("id").single();
      if (error) {
        if (error.code === "23505") return null; // already recorded — the unique index is the de-dupe
        throw new Error(`agent_fb_events: ${error.message}`);
      }
      return data.id as string;
    },
    update: async (id, patch) => {
      await db.from("agent_fb_events").update({ ...toRow(patch), ...(patch.status && patch.status !== "new" ? { handled_at: new Date().toISOString() } : {}) }).eq("id", id);
    },
    alreadyLinked: async (userId, postId) => {
      let q = db.from("agent_fb_events").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("action", "link").in("status", ["sent", "queued", "new"]);
      q = postId ? q.eq("post_id", postId) : q.is("post_id", null);
      const { count } = await q;
      return (count ?? 0) > 0;
    },
    sentToday: async () => {
      const { count } = await db.from("agent_fb_events").select("id", { count: "exact", head: true }).eq("status", "sent").gte("handled_at", new Date(Date.now() - 86400e3).toISOString());
      return count ?? 0;
    },
    queue: async (item) => {
      const { data } = await db.from("agent_queue_items")
        .upsert({ agent_id: "social", platform: "facebook", status: "pending", ...item }, { onConflict: "agent_id,dedupe_key", ignoreDuplicates: true })
        .select("id").maybeSingle();
      return (data?.id as string | undefined) ?? null;
    },
    permalink: async (postId) => {
      if (!postId) return null;
      const { data } = await db.from("agent_fb_posts").select("permalink").eq("post_id", postId).maybeSingle();
      return (data?.permalink as string | undefined) ?? null;
    },
    answer: (q) => answerSalesQuestion(q).catch(() => null),
    privateReply: (id, text) => fbPrivateReply(token, pageId, id, text),
    replyToComment: (id, text) => fbReplyToComment(token, id, text),
    sendMessage: (psid, text) => fbSendMessage(token, pageId, psid, text),
  };
}

export async function loadFb(): Promise<{ settings: FbSettings; state: FbState; ready: boolean }> {
  const { data, error } = await getAdminSupabase().from("agent_system").select("facebook, facebook_state").limit(1).single();
  // Before supabase/agent-facebook.sql has run there is no column — say so, never throw.
  if (error) return { settings: FB_DEFAULTS, state: {}, ready: false };
  return { settings: mergeFbSettings(data?.facebook), state: ((data?.facebook_state as FbState | null) ?? {}), ready: true };
}

async function saveState(state: FbState): Promise<void> {
  await getAdminSupabase().from("agent_system").update({ facebook_state: state }).eq("id", true);
}

async function context(): Promise<{ ctx: IgContext; conn: AgentConnection; state: FbState; pageId: string } | { error: string }> {
  const conn = (await loadConnections()).meta;
  const pageId = String(conn?.meta.page_id ?? "");
  if (!conn || !pageId) return { error: "not_connected" };
  const { settings, state, ready } = await loadFb();
  if (!ready) return { error: "schema_missing" };
  return {
    conn, state, pageId,
    ctx: { settings: { ...settings, hashtags: [] }, ownUsername: (conn.meta.page_name as string | null) ?? null, ownUserId: pageId, io: fbIo(conn), channel: FACEBOOK },
  };
}

// ── Reading the Page (GET only) ──────────────────────────────────────────────

type GraphPage<T> = { data?: T[]; paging?: { next?: string }; error?: { message?: string } };
async function graph<T>(url: string, token: string): Promise<GraphPage<T>> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const j = (await res.json().catch(() => ({}))) as GraphPage<T>;
  if (!res.ok && !j.error) return { error: { message: `HTTP ${res.status}` } };
  return j;
}

type Post = { id: string; message?: string; permalink_url?: string; created_time?: string; comments?: { summary?: { total_count?: number } } };
type RawComment = { id: string; message?: string; created_time?: string; from?: { id?: string; name?: string } };

export type FbTickSummary = { ok: boolean; reason?: string; posts: number; comments: number; messages: number; sent: number; queued: number; failed: number; errors: string[] };

/**
 * One pass: refresh the Page's posts, read new comments on the ones whose
 * comment count moved, read new Messenger messages, and act on each. Safe to
 * run as often as wanted and alongside the webhook — every comment is
 * recorded once.
 */
export async function runFacebookTick(): Promise<FbTickSummary> {
  const sum: FbTickSummary = { ok: true, posts: 0, comments: 0, messages: 0, sent: 0, queued: 0, failed: 0, errors: [] };
  const c = await context();
  if ("error" in c) return { ...sum, ok: false, reason: c.error };
  const { ctx, conn, state, pageId } = c;
  const token = conn.access_token;
  const db = getAdminSupabase();
  const tally = (o: Outcome) => { if (o === "sent") sum.sent++; else if (o === "queued") sum.queued++; else if (o === "failed") sum.failed++; };

  const feed = await graph<Post>(`${META_GRAPH}/${pageId}/posts?fields=id,message,permalink_url,created_time,comments.limit(0).summary(true)&limit=30`, token);
  if (feed.error) sum.errors.push(`posts: ${feed.error.message}`);
  const posts = (feed.data ?? []).filter((p) => p.id);
  sum.posts = posts.length;
  if (posts.length) {
    await db.from("agent_fb_posts").upsert(posts.map((p) => ({
      post_id: p.id, code: fbPostCode(p.id), permalink: p.permalink_url ?? null, message: (p.message ?? "").slice(0, 600),
      posted_at: p.created_time ?? null, comments_count: p.comments?.summary?.total_count ?? 0, updated_at: new Date().toISOString(),
    })), { onConflict: "post_id" });
  }

  const seenCounts = { ...(state.posts ?? {}) };
  for (const p of posts) {
    const count = p.comments?.summary?.total_count ?? 0;
    const old = p.created_time ? Date.now() - new Date(p.created_time).getTime() > 45 * 86400e3 : false;
    if (old || count === 0 || seenCounts[p.id] === count) continue;
    // filter=stream: replies to comments too, newest first.
    let url: string | undefined = `${META_GRAPH}/${p.id}/comments?fields=id,message,created_time,from{id,name}&filter=stream&order=reverse_chronological&limit=50`;
    let failed = false;
    for (let page = 0; url && page < 5; page++) {
      const res: GraphPage<RawComment> = await graph<RawComment>(url, token);
      if (res.error) { sum.errors.push(`comments ${p.id}: ${res.error.message}`); failed = true; break; }
      let fresh = 0;
      for (const rc of res.data ?? []) {
        sum.comments++;
        try {
          const o = await processComment({ id: rc.id, text: rc.message ?? "", username: rc.from?.name ?? null, userId: rc.from?.id ?? null, mediaId: p.id, timestamp: rc.created_time ?? null }, ctx);
          if (o !== "seen" && o !== "own") fresh++;
          tally(o);
        } catch (e) { sum.errors.push(`comment ${rc.id}: ${String((e as Error).message).slice(0, 120)}`); }
      }
      // A whole page of comments we already had: everything older is known too.
      if (!fresh) break;
      url = res.paging?.next;
    }
    if (!failed) seenCounts[p.id] = count;
  }

  // Messages people sent the Page in the last day (Messenger's reply window).
  type Convo = { messages?: { data?: Array<{ id: string; message?: string; created_time?: string; from?: { id?: string } }> } };
  const convos = await graph<Convo>(`${META_GRAPH}/${pageId}/conversations?platform=messenger&fields=messages.limit(1){id,message,created_time,from}&limit=25`, token);
  if (convos.error) sum.errors.push(`messages: ${convos.error.message}`);
  for (const cv of convos.data ?? []) {
    const last = cv.messages?.data?.[0];
    if (!last?.id || !last.message || !last.from?.id || last.from.id === pageId) continue;
    if (last.created_time && Date.now() - new Date(last.created_time).getTime() > 23 * 3600e3) continue;
    sum.messages++;
    try { tally(await processMessage({ id: last.id, text: last.message, userId: last.from.id, timestamp: last.created_time ?? null }, ctx)); }
    catch (e) { sum.errors.push(`message ${last.id}: ${String((e as Error).message).slice(0, 120)}`); }
  }

  await saveState({ ...state, posts: seenCounts, last_tick_at: new Date().toISOString(), last_error: sum.errors[0] ?? null });
  return sum;
}

/** The webhook's entry point: the same decisions, the moment Facebook tells us. */
export async function handleFacebookWebhook(body: unknown): Promise<{ handled: number }> {
  const { comments, messages } = parseFacebookWebhook(body);
  if (!comments.length && !messages.length) return { handled: 0 };
  const c = await context();
  if ("error" in c) return { handled: 0 };
  let handled = 0;
  for (const cm of comments) { try { await processComment(cm, c.ctx); handled++; } catch { /* the 10-minute pass will pick it up */ } }
  for (const m of messages) { try { await processMessage(m, c.ctx); handled++; } catch { /* same */ } }
  return { handled };
}
