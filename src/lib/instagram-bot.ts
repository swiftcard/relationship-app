import { createHmac, timingSafeEqual } from "node:crypto";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { loadConnections, type AgentConnection } from "@/lib/agent-connections";
import { META_GRAPH } from "@/lib/agent-connect-oauth";
import { campaignLink } from "@/lib/campaign-links";
import { answerSalesQuestion } from "@/lib/sales-answer";
import { igPrivateReply, igReplyToComment, igSendMessage, isAccessError, type SendResult } from "@/lib/instagram-send";

// ── The Instagram bot ────────────────────────────────────────────────────────
// Owner order 2026-10-02: "Comment CARD and I'll send you one" — and the one
// goal is signups. So:
//   • someone comments the keyword on one of OUR posts → they get the card
//     link privately (one per person per post), and a short public reply;
//   • someone asks a question in a comment or a message → the website's sales
//     assistant answers (lib/sales-answer.ts);
//   • every link carries that post's own code (ig_p_<id>), which is also the
//     signup source — so the admin sees which post brought the accounts.
//
// THE RULES (pinned in tests/agent-instagram.test.ts):
//   • OFF by default. Until the owner turns it on, nothing is sent: each reply
//     is filed in the Agent Flow queue for a one-tap Approve instead.
//   • It only answers people who wrote to us first. Sends live in
//     lib/instagram-send.ts, which cannot address anyone else.
//   • One card link per person per post. A daily cap. Never twice for the same
//     comment (unique index on agent_ig_events).
//   • AI answers stay drafts until the owner's second switch (auto_answers).

// ── Settings ─────────────────────────────────────────────────────────────────

export type IgSettings = {
  /** Send the card link automatically when someone comments the keyword. */
  enabled: boolean;
  /** Also send AI answers to questions automatically (otherwise: drafts in the queue). */
  auto_answers: boolean;
  keywords: string[];
  /** The private message. {link} becomes that post's tracked link. */
  message: string;
  /** Rotated so the public replies under a post never read as copy-paste. */
  public_replies: string[];
  daily_cap: number;
  /** /for/ slug whose design the builder opens on (null = the default design). */
  profession: string | null;
  /** Hashtags the Radar reads for fresh posts by new professionals. */
  hashtags: string[];
};

export const IG_DEFAULTS: IgSettings = {
  enabled: false,
  auto_answers: false,
  keywords: ["CARD"],
  message: "Hi, it's the SwiftCard assistant. Here's your free digital business card, it takes about 2 minutes to set up: {link}\n\nReply here if you have any questions.",
  public_replies: ["Sent! Check your messages 📩", "Just sent it over, check your DMs 🙌", "On its way to your inbox ✅", "Sent you the link, take a look 📲"],
  daily_cap: 300,
  profession: null,
  hashtags: ["newrealtor", "justlicensed", "realtorlife", "loanofficer", "insuranceagent", "openhouse", "hvaclife", "plumberlife", "barberlife", "newagent"],
};

export type IgState = {
  media?: Record<string, number>;
  last_tick_at?: string;
  last_error?: string | null;
  hashtag_ids?: Record<string, string>;
  hashtag_cursor?: number;
};

const strList = (v: unknown, max: number, len: number): string[] | null =>
  Array.isArray(v) ? v.map((x) => String(x ?? "").trim().slice(0, len)).filter(Boolean).slice(0, max) : null;

/** Owner overrides laid over the defaults; anything malformed falls back. */
export function mergeIgSettings(over: unknown): IgSettings {
  const o = (over && typeof over === "object" ? over : {}) as Record<string, unknown>;
  const keywords = strList(o.keywords, 10, 30)?.map((k) => k.replace(/[^\p{L}\p{N}]/gu, "").toUpperCase()).filter(Boolean);
  const replies = strList(o.public_replies, 12, 200);
  const hashtags = strList(o.hashtags, 30, 60)?.map((h) => h.replace(/^#/, "").replace(/[^\p{L}\p{N}_]/gu, "").toLowerCase()).filter(Boolean);
  const message = typeof o.message === "string" && o.message.includes("{link}") ? o.message.trim().slice(0, 900) : IG_DEFAULTS.message;
  return {
    enabled: o.enabled === true,
    auto_answers: o.auto_answers === true,
    keywords: keywords?.length ? keywords : IG_DEFAULTS.keywords,
    message,
    public_replies: replies?.length ? replies : IG_DEFAULTS.public_replies,
    daily_cap: Math.max(1, Math.min(1000, Math.round(Number(o.daily_cap) || IG_DEFAULTS.daily_cap))),
    profession: typeof o.profession === "string" && /^[a-z-]{2,40}$/.test(o.profession) ? o.profession : null,
    hashtags: hashtags?.length ? hashtags : IG_DEFAULTS.hashtags,
  };
}

// ── Pure helpers (unit-tested; no network) ───────────────────────────────────

/**
 * The keyword a comment is asking with, or null. The comment must be SHORT
 * (four words or fewer) and contain the keyword as a whole word: "CARD",
 * "card please!", "Card 🙌". A sentence that merely uses the word ("love the
 * card design on this one") is a compliment, not a request, and messaging
 * that person would be unsolicited.
 */
export function matchKeyword(text: string | null | undefined, keywords: string[]): string | null {
  const words = (text ?? "").toUpperCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 4) return null;
  return keywords.find((k) => words.includes(k.toUpperCase())) ?? null;
}

const ASK = /\?|\b(how|what|where|when|which|why|who|price|pricing|cost|costs|free|does it|do you|can i|can you|is it|is there|work with|android|iphone|nfc)\b/i;
/** Worth an answer: a question, or a clear ask about the product. */
export function isQuestion(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  return t.length >= 6 && ASK.test(t);
}

/** Instagram media id ↔ the short code its link carries (and its signups are recorded under). */
export function postCode(mediaId: string): string {
  try { return `ig_p_${BigInt(mediaId).toString(36)}`; } catch { return "ig_dm"; }
}

export function buildDm(settings: IgSettings, code: string): string {
  return settings.message.replace(/\{link\}/g, campaignLink(code, settings.profession));
}

/** Stable per comment, so a retry says the same thing; varied across comments. */
export function pickPublicReply(settings: IgSettings, commentId: string): string {
  let h = 0;
  for (const ch of commentId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return settings.public_replies[h % settings.public_replies.length];
}

/** Meta signs every webhook body: X-Hub-Signature-256: sha256=<hmac of the raw body with the app secret>. */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string | undefined): boolean {
  if (!appSecret || !header?.startsWith("sha256=")) return false;
  const want = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  let got: Buffer;
  try { got = Buffer.from(header.slice(7), "hex"); } catch { return false; }
  return got.length === want.length && timingSafeEqual(got, want);
}

export type IgComment = { id: string; text: string; username: string | null; userId: string | null; mediaId: string | null; timestamp?: string | null };
export type IgMessage = { id: string; text: string; userId: string; timestamp?: string | null };

/** The comments and messages inside one webhook delivery. Echoes of our own sends are dropped. */
export function parseWebhook(body: unknown): { comments: IgComment[]; messages: IgMessage[] } {
  const comments: IgComment[] = [];
  const messages: IgMessage[] = [];
  const b = body as { object?: string; entry?: unknown[] } | null;
  if (!b || b.object !== "instagram" || !Array.isArray(b.entry)) return { comments, messages };
  for (const e of b.entry as Array<{ changes?: unknown[]; messaging?: unknown[] }>) {
    for (const ch of (e.changes ?? []) as Array<{ field?: string; value?: Record<string, unknown> }>) {
      if (ch.field !== "comments" || !ch.value) continue;
      const v = ch.value as { id?: unknown; text?: unknown; from?: { id?: unknown; username?: unknown }; media?: { id?: unknown } };
      if (typeof v.id !== "string") continue;
      comments.push({
        id: v.id, text: String(v.text ?? ""),
        username: typeof v.from?.username === "string" ? v.from.username : null,
        userId: v.from?.id != null ? String(v.from.id) : null,
        mediaId: v.media?.id != null ? String(v.media.id) : null,
      });
    }
    for (const m of (e.messaging ?? []) as Array<{ sender?: { id?: unknown }; timestamp?: unknown; message?: { mid?: unknown; text?: unknown; is_echo?: unknown } }>) {
      if (!m.message || m.message.is_echo || typeof m.message.mid !== "string" || typeof m.message.text !== "string" || m.sender?.id == null) continue;
      messages.push({ id: m.message.mid, text: m.message.text, userId: String(m.sender.id), timestamp: typeof m.timestamp === "number" ? new Date(m.timestamp).toISOString() : null });
    }
  }
  return { comments, messages };
}

// ── The decision, with its I/O injected (so the rules are testable) ──────────

export type IgEventRow = {
  kind: "comment" | "message"; external_id: string; media_id: string | null; ig_user_id: string | null;
  username: string | null; text: string; keyword: string | null; action: "link" | "answer" | "none";
  status: "new" | "sent" | "queued" | "skipped" | "failed"; reason?: string | null; reply?: string | null; code?: string | null;
};
export type IgQueueItem = {
  item_type: `${"ig" | "fb"}_${"dm" | "reply" | "message"}`; target: string | null; target_url: string | null;
  title: string; content: string; context: string; payload: Record<string, unknown>; dedupe_key: string;
};

export type IgIo = {
  /** Insert the event; null when this comment/message was already recorded. */
  record: (row: IgEventRow) => Promise<string | null>;
  update: (id: string, patch: Partial<IgEventRow> & { item_id?: string | null }) => Promise<void>;
  /** Has this person already been sent (or queued) the link for this post? */
  alreadyLinked: (userId: string, mediaId: string | null) => Promise<boolean>;
  sentToday: () => Promise<number>;
  queue: (item: IgQueueItem) => Promise<string | null>;
  permalink: (mediaId: string | null) => Promise<string | null>;
  answer: (question: string) => Promise<string | null>;
  privateReply: (commentId: string, text: string) => Promise<SendResult>;
  replyToComment: (commentId: string, text: string) => Promise<SendResult>;
  sendMessage: (igsid: string, text: string) => Promise<SendResult>;
};

/**
 * Where the conversation is happening. The decisions below are the same on
 * Instagram and on the SwiftCard Facebook Page (lib/facebook-bot.ts runs them
 * with FACEBOOK): only the names, the link code and the inbox differ.
 */
export type Channel = {
  platform: "instagram" | "facebook"; name: string; prefix: "ig" | "fb";
  /** The code a post's link carries — and the signup source it is recorded under. */
  postCode: (postId: string) => string;
  /** Where the owner answers a message by hand. */
  inbox: string;
  /** How a person is shown in the queue: "@maya" on Instagram, "Maya R." on Facebook. */
  handle: (username: string) => string;
};
export const INSTAGRAM: Channel = { platform: "instagram", name: "Instagram", prefix: "ig", postCode, inbox: "https://www.instagram.com/direct/inbox/", handle: (u) => `@${u}` };

export type IgContext = { settings: IgSettings; ownUsername: string | null; ownUserId: string | null; io: IgIo; channel?: Channel };
export type Outcome = "seen" | "own" | "sent" | "queued" | "skipped" | "failed";

const WEEK = 7 * 86400e3;

export async function processComment(c: IgComment, ctx: IgContext): Promise<Outcome> {
  const { settings, io } = ctx;
  const ch = ctx.channel ?? INSTAGRAM;
  if ((c.username && ctx.ownUsername && c.username.toLowerCase() === ctx.ownUsername.toLowerCase()) || (c.userId && c.userId === ctx.ownUserId)) return "own";

  const keyword = matchKeyword(c.text, settings.keywords);
  const question = !keyword && isQuestion(c.text);
  const base: IgEventRow = {
    kind: "comment", external_id: c.id, media_id: c.mediaId, ig_user_id: c.userId, username: c.username,
    text: c.text.slice(0, 1000), keyword, action: keyword ? "link" : question ? "answer" : "none", status: "new",
  };
  const skip = async (reason: string): Promise<Outcome> => ((await io.record({ ...base, status: "skipped", reason })) ? "skipped" : "seen");

  if (!keyword && !question) return skip("not_a_request");
  // Meta only allows a private reply within 7 days of the comment.
  if (c.timestamp && Date.now() - new Date(c.timestamp).getTime() > WEEK) return skip("older_than_7_days");

  const target = c.username ? ch.handle(c.username) : null;
  const url = await io.permalink(c.mediaId);

  if (keyword) {
    // One link per person per post — checked BEFORE recording this comment.
    if (c.userId && (await io.alreadyLinked(c.userId, c.mediaId))) return skip("already_sent_for_this_post");
    const code = c.mediaId ? ch.postCode(c.mediaId) : `${ch.prefix}_dm`;
    const dm = buildDm(settings, code);
    const publicReply = pickPublicReply(settings, c.id);
    const id = await io.record({ ...base, reply: dm, code });
    if (!id) return "seen";

    const toQueue = async (reason: string): Promise<Outcome> => {
      const item = await io.queue({
        item_type: `${ch.prefix}_dm`, target, target_url: url,
        title: `${target ?? "Someone"} commented "${keyword}" — send their card link`,
        content: dm, context: `Comment: "${c.text.slice(0, 300)}"`,
        payload: { platform: ch.platform, comment_id: c.id, media_id: c.mediaId, public_reply: publicReply, code, event_id: id },
        dedupe_key: `${ch.prefix}:comment:${c.id}`,
      });
      await io.update(id, { status: "queued", reason, item_id: item });
      return "queued";
    };

    if (!settings.enabled) return toQueue("bot_is_off");
    if ((await io.sentToday()) >= settings.daily_cap) return toQueue("daily_cap_reached");

    const sent = await io.privateReply(c.id, dm);
    if (!sent.ok) {
      if (isAccessError(sent)) return toQueue(`${ch.platform}_refused: ${sent.error}`);
      await io.update(id, { status: "failed", reason: sent.error });
      return "failed";
    }
    await io.update(id, { status: "sent" });
    // The public reply is a courtesy; the link already went.
    await io.replyToComment(c.id, publicReply).catch(() => null);
    return "sent";
  }

  // A question: the sales assistant answers, publicly, under the comment.
  // Recorded FIRST: a comment we already handled must not cost another model call.
  const id = await io.record(base);
  if (!id) return "seen";
  const answer = await io.answer(c.text);
  if (answer) await io.update(id, { reply: answer });
  if (settings.enabled && settings.auto_answers && answer) {
    const sent = await io.replyToComment(c.id, answer);
    if (sent.ok) { await io.update(id, { status: "sent" }); return "sent"; }
    if (!isAccessError(sent)) { await io.update(id, { status: "failed", reason: sent.error }); return "failed"; }
  }
  const item = await io.queue({
    item_type: `${ch.prefix}_reply`, target, target_url: url,
    title: `${target ?? "Someone"} asked a question on ${ch.name}`,
    content: answer ?? "", context: `Comment: "${c.text.slice(0, 300)}"${answer ? "" : "\n\nThe assistant had no answer from the knowledge base — this one needs you."}`,
    payload: { platform: ch.platform, comment_id: c.id, media_id: c.mediaId, event_id: id },
    dedupe_key: `${ch.prefix}:comment:${c.id}`,
  });
  await io.update(id, { status: "queued", reason: answer ? "answers_are_drafts" : "no_answer", item_id: item });
  return "queued";
}

export async function processMessage(m: IgMessage, ctx: IgContext): Promise<Outcome> {
  const { settings, io } = ctx;
  const ch = ctx.channel ?? INSTAGRAM;
  const dmCode = `${ch.prefix}_dm`;
  if (m.userId === ctx.ownUserId) return "own";
  const keyword = matchKeyword(m.text, settings.keywords);
  const base: IgEventRow = {
    kind: "message", external_id: m.id, media_id: null, ig_user_id: m.userId, username: null,
    text: m.text.slice(0, 1000), keyword, action: keyword ? "link" : "answer", status: "new",
  };
  // "thanks", "ok", an emoji: nothing to answer.
  if (!keyword && !isQuestion(m.text)) return (await io.record({ ...base, action: "none", status: "skipped", reason: "not_a_request" })) ? "skipped" : "seen";

  const id = await io.record({ ...base, code: keyword ? dmCode : null });
  if (!id) return "seen";
  const reply = keyword ? buildDm(settings, dmCode) : await io.answer(m.text);
  if (reply) await io.update(id, { reply });

  const auto = settings.enabled && (keyword ? true : settings.auto_answers);
  if (auto && reply && (await io.sentToday()) < settings.daily_cap) {
    const sent = await io.sendMessage(m.userId, reply);
    if (sent.ok) { await io.update(id, { status: "sent" }); return "sent"; }
    if (!isAccessError(sent)) { await io.update(id, { status: "failed", reason: sent.error }); return "failed"; }
  }
  const item = await io.queue({
    item_type: `${ch.prefix}_message`, target: null, target_url: ch.inbox,
    title: keyword ? `Someone messaged "${keyword}" — send their card link` : `Someone messaged SwiftCard a question on ${ch.name}`,
    content: reply ?? "", context: `Message: "${m.text.slice(0, 300)}"${reply ? "" : "\n\nThe assistant had no answer from the knowledge base — this one needs you."}`,
    payload: { platform: ch.platform, igsid: m.userId, event_id: id },
    dedupe_key: `${ch.prefix}:message:${m.id}`,
  });
  await io.update(id, { status: "queued", reason: !settings.enabled ? "bot_is_off" : reply ? "answers_are_drafts" : "no_answer", item_id: item });
  return "queued";
}

// ── The real I/O ─────────────────────────────────────────────────────────────

export function realIo(conn: AgentConnection): IgIo {
  const db = getAdminSupabase();
  const token = conn.access_token;
  return {
    record: async (row) => {
      const { data, error } = await db.from("agent_ig_events").insert(row).select("id").single();
      if (error) {
        if (error.code === "23505") return null; // already recorded — the unique index is the de-dupe
        throw new Error(`agent_ig_events: ${error.message}`);
      }
      return data.id as string;
    },
    update: async (id, patch) => {
      await db.from("agent_ig_events").update({ ...patch, ...(patch.status && patch.status !== "new" ? { handled_at: new Date().toISOString() } : {}) }).eq("id", id);
    },
    alreadyLinked: async (userId, mediaId) => {
      let q = db.from("agent_ig_events").select("id", { count: "exact", head: true }).eq("ig_user_id", userId).eq("action", "link").in("status", ["sent", "queued", "new"]);
      q = mediaId ? q.eq("media_id", mediaId) : q.is("media_id", null);
      const { count } = await q;
      return (count ?? 0) > 0;
    },
    sentToday: async () => {
      const { count } = await db.from("agent_ig_events").select("id", { count: "exact", head: true }).eq("status", "sent").gte("handled_at", new Date(Date.now() - 86400e3).toISOString());
      return count ?? 0;
    },
    queue: async (item) => {
      const { data } = await db.from("agent_queue_items")
        .upsert({ agent_id: "social", platform: "instagram", status: "pending", ...item }, { onConflict: "agent_id,dedupe_key", ignoreDuplicates: true })
        .select("id").maybeSingle();
      return (data?.id as string | undefined) ?? null;
    },
    permalink: async (mediaId) => {
      if (!mediaId) return null;
      const { data } = await db.from("agent_ig_posts").select("permalink").eq("media_id", mediaId).maybeSingle();
      return (data?.permalink as string | undefined) ?? null;
    },
    answer: (q) => answerSalesQuestion(q).catch(() => null),
    privateReply: (id, text) => igPrivateReply(token, id, text),
    replyToComment: (id, text) => igReplyToComment(token, id, text),
    sendMessage: (igsid, text) => igSendMessage(token, igsid, text),
  };
}

export async function loadIg(): Promise<{ settings: IgSettings; state: IgState; ready: boolean }> {
  const { data, error } = await getAdminSupabase().from("agent_system").select("instagram, instagram_state").limit(1).single();
  // Before supabase/agent-instagram.sql has run there is no column — say so, never throw.
  if (error) return { settings: IG_DEFAULTS, state: {}, ready: false };
  return { settings: mergeIgSettings(data?.instagram), state: ((data?.instagram_state as IgState | null) ?? {}), ready: true };
}

async function saveState(state: IgState): Promise<void> {
  await getAdminSupabase().from("agent_system").update({ instagram_state: state }).eq("id", true);
}

async function context(): Promise<{ ctx: IgContext; conn: AgentConnection; state: IgState } | { error: string }> {
  const conn = (await loadConnections()).meta;
  if (!conn?.meta.ig_user_id) return { error: "not_connected" };
  const { settings, state, ready } = await loadIg();
  if (!ready) return { error: "schema_missing" };
  return {
    conn, state,
    ctx: { settings, ownUsername: (conn.meta.ig_username as string | null) ?? null, ownUserId: String(conn.meta.ig_user_id), io: realIo(conn) },
  };
}

// ── Reading Instagram (GET only) ─────────────────────────────────────────────

type GraphPage<T> = { data?: T[]; paging?: { next?: string }; error?: { message?: string } };
async function graph<T>(url: string, token: string): Promise<GraphPage<T>> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const j = (await res.json().catch(() => ({}))) as GraphPage<T>;
  if (!res.ok && !j.error) return { error: { message: `HTTP ${res.status}` } };
  return j;
}

type Media = { id: string; caption?: string; permalink?: string; timestamp?: string; comments_count?: number; like_count?: number; media_type?: string; media_product_type?: string };
type RawComment = { id: string; text?: string; username?: string; timestamp?: string; from?: { id?: string; username?: string } };

export type TickSummary = { ok: boolean; reason?: string; posts: number; comments: number; messages: number; sent: number; queued: number; failed: number; errors: string[] };

/**
 * One pass: refresh our posts, read new comments on the ones whose comment
 * count moved, read new messages, and act on each. Safe to run as often as
 * wanted and alongside the webhook — every comment is recorded once.
 */
export async function runInstagramTick(): Promise<TickSummary> {
  const sum: TickSummary = { ok: true, posts: 0, comments: 0, messages: 0, sent: 0, queued: 0, failed: 0, errors: [] };
  const c = await context();
  if ("error" in c) return { ...sum, ok: false, reason: c.error };
  const { ctx, conn, state } = c;
  const token = conn.access_token;
  const ig = String(conn.meta.ig_user_id);
  const db = getAdminSupabase();
  const tally = (o: Outcome) => { if (o === "sent") sum.sent++; else if (o === "queued") sum.queued++; else if (o === "failed") sum.failed++; };

  const media = await graph<Media>(`${META_GRAPH}/${ig}/media?fields=id,caption,permalink,timestamp,comments_count,like_count,media_type,media_product_type&limit=30`, token);
  if (media.error) sum.errors.push(`posts: ${media.error.message}`);
  const posts = (media.data ?? []).filter((m) => m.id);
  sum.posts = posts.length;
  if (posts.length) {
    await db.from("agent_ig_posts").upsert(posts.map((m) => ({
      media_id: m.id, code: postCode(m.id), permalink: m.permalink ?? null, caption: (m.caption ?? "").slice(0, 600),
      media_type: m.media_product_type ?? m.media_type ?? null, posted_at: m.timestamp ?? null,
      like_count: m.like_count ?? 0, comments_count: m.comments_count ?? 0, updated_at: new Date().toISOString(),
    })), { onConflict: "media_id" });
  }

  const seenCounts = { ...(state.media ?? {}) };
  for (const m of posts) {
    const count = m.comments_count ?? 0;
    const old = m.timestamp ? Date.now() - new Date(m.timestamp).getTime() > 45 * 86400e3 : false;
    if (old || count === 0 || seenCounts[m.id] === count) continue;
    let url: string | undefined = `${META_GRAPH}/${m.id}/comments?fields=id,text,username,timestamp,from&limit=50`;
    let failed = false;
    for (let page = 0; url && page < 5; page++) {
      const res: GraphPage<RawComment> = await graph<RawComment>(url, token);
      if (res.error) { sum.errors.push(`comments ${m.id}: ${res.error.message}`); failed = true; break; }
      let fresh = 0;
      for (const rc of res.data ?? []) {
        sum.comments++;
        try {
          const o = await processComment({ id: rc.id, text: rc.text ?? "", username: rc.from?.username ?? rc.username ?? null, userId: rc.from?.id ?? null, mediaId: m.id, timestamp: rc.timestamp ?? null }, ctx);
          if (o !== "seen" && o !== "own") fresh++;
          tally(o);
        } catch (e) { sum.errors.push(`comment ${rc.id}: ${String((e as Error).message).slice(0, 120)}`); }
      }
      // A whole page of comments we already had: everything older is known too.
      if (!fresh) break;
      url = res.paging?.next;
    }
    if (!failed) seenCounts[m.id] = count;
  }

  // Messages people sent us in the last day (Instagram's reply window).
  const pageId = String(conn.meta.page_id ?? conn.account_id ?? "");
  if (pageId) {
    type Convo = { messages?: { data?: Array<{ id: string; message?: string; created_time?: string; from?: { id?: string } }> } };
    const convos = await graph<Convo>(`${META_GRAPH}/${pageId}/conversations?platform=instagram&fields=messages.limit(1){id,message,created_time,from}&limit=25`, token);
    if (convos.error) sum.errors.push(`messages: ${convos.error.message}`);
    for (const cv of convos.data ?? []) {
      const last = cv.messages?.data?.[0];
      if (!last?.id || !last.message || !last.from?.id || last.from.id === ig) continue;
      if (last.created_time && Date.now() - new Date(last.created_time).getTime() > 23 * 3600e3) continue;
      sum.messages++;
      try { tally(await processMessage({ id: last.id, text: last.message, userId: last.from.id, timestamp: last.created_time ?? null }, ctx)); }
      catch (e) { sum.errors.push(`message ${last.id}: ${String((e as Error).message).slice(0, 120)}`); }
    }
  }

  await saveState({ ...state, media: seenCounts, last_tick_at: new Date().toISOString(), last_error: sum.errors[0] ?? null });
  return sum;
}

/** The webhook's entry point: the same decisions, the moment Instagram tells us. */
export async function handleWebhook(body: unknown): Promise<{ handled: number }> {
  const { comments, messages } = parseWebhook(body);
  if (!comments.length && !messages.length) return { handled: 0 };
  const c = await context();
  if ("error" in c) return { handled: 0 };
  let handled = 0;
  for (const cm of comments) { try { await processComment(cm, c.ctx); handled++; } catch { /* the 10-minute pass will pick it up */ } }
  for (const m of messages) { try { await processMessage(m, c.ctx); handled++; } catch { /* same */ } }
  return { handled };
}

// ── Hashtag posts for the Radar (read-only) ──────────────────────────────────
// Instagram allows 30 different hashtags per account per rolling week, so the
// list is capped at 30 and each pass reads a few, rotating.

export type HashtagPost = { external_id: string; url: string | null; title: string; body: string; author: null; community: string; posted_at: string | null; engagement: { ups: number; comments: number } };

export async function readHashtagPosts(perPass = 6): Promise<{ posts: HashtagPost[]; error: string | null }> {
  const conn = (await loadConnections()).meta;
  if (!conn?.meta.ig_user_id) return { posts: [], error: "Instagram is not connected — connect Meta in Agent Flow → Settings." };
  const { settings, state, ready } = await loadIg();
  if (!ready) return { posts: [], error: "Run supabase/agent-instagram.sql first." };
  const token = conn.access_token;
  const ig = String(conn.meta.ig_user_id);
  const tags = settings.hashtags.slice(0, 30);
  const ids = { ...(state.hashtag_ids ?? {}) };
  const start = (state.hashtag_cursor ?? 0) % Math.max(1, tags.length);
  const pass = Array.from({ length: Math.min(perPass, tags.length) }, (_, i) => tags[(start + i) % tags.length]);
  const posts: HashtagPost[] = [];
  let error: string | null = null;
  for (const tag of pass) {
    if (!ids[tag]) {
      const found = await graph<{ id: string }>(`${META_GRAPH}/ig_hashtag_search?user_id=${ig}&q=${encodeURIComponent(tag)}`, token);
      if (found.error || !found.data?.[0]?.id) { error = `#${tag}: ${found.error?.message ?? "not found"}`; if (found.error) break; continue; }
      ids[tag] = found.data[0].id;
    }
    const recent = await graph<Media>(`${META_GRAPH}/${ids[tag]}/recent_media?user_id=${ig}&fields=id,caption,permalink,timestamp,like_count,comments_count,media_type&limit=25`, token);
    if (recent.error) { error = `#${tag}: ${recent.error.message}`; break; }
    for (const m of recent.data ?? []) {
      const caption = (m.caption ?? "").trim();
      posts.push({
        external_id: m.id, url: m.permalink ?? null, title: caption.split("\n")[0].slice(0, 140) || `#${tag} post`, body: caption.slice(0, 1500),
        author: null, community: `Instagram · #${tag}`, posted_at: m.timestamp ?? null, engagement: { ups: m.like_count ?? 0, comments: m.comments_count ?? 0 },
      });
    }
  }
  await saveState({ ...state, hashtag_ids: ids, hashtag_cursor: (start + pass.length) % Math.max(1, tags.length) });
  return { posts, error };
}
