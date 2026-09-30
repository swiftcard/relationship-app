// ── The Radar: what people are saying, found by code, answered by agents ─────
//
// Owner order (2026-09-30): "all our agents and bots work for us in terms of
// marketing when we scan Reddit, Telegram and all relevant websites."
//
// The Radar is the listening layer under the Growth team. It runs inside the
// always-on watchdog loop and spends NO tokens: plain HTTP against public
// feeds, keyword matching, a score, a route. Every hit becomes a SIGNAL row
// (agent_radar_signals) assigned to the agent whose job it is — Zoe for
// Reddit, Wes for forums/Telegram/Hacker News, Ava for people complaining
// about a competitor, Ivy for creators, Piper for press, Cleo for competitor
// chatter — and the loop wakes that agent. The agent then READS the actual
// thread (WebFetch) and hands the owner two finished replies, exactly as
// before. The Radar never posts, replies, DMs or joins anything.
//
// Sources (all read-only, all public):
//   reddit     official read API when REDDIT_CLIENT_ID/SECRET exist (free,
//              100 req/min, the way Reddit wants it); the public Atom search
//              feed otherwise (rate-limited — a 429 stops the family for
//              this scan and says so on the source row)
//   telegram   public channel previews (t.me/s/<channel>) — no account needed
//              — plus every group a SwiftCard bot has been added to
//              (TELEGRAM_BOT_TOKEN, getUpdates; privacy mode off so it sees
//              all messages, never just commands)
//   hn         Hacker News via the Algolia search API
//   rss        any RSS/Atom feed — Google News + Bing News queries by default;
//              the owner can add Google Alerts feeds, competitor blogs, etc.
//   appstore   competitors' newest App Store reviews (public RSS); 1-2★ ones
//              are the billing/cancellation complaints that are our wedge
//   youtube    fresh videos on the topic (YOUTUBE_API_KEY, optional) — the
//              creators Ivy should be talking to
//
// No LLM is imported or called anywhere in this file. tests/agent-radar
// pins that.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { sb, say } from "./agentkit.mjs";

const CONFIG = JSON.parse(readFileSync(new URL("../config.json", import.meta.url), "utf8"));
const DEFAULTS = CONFIG.radar ?? {};
const TARGETS = CONFIG.targets ?? {};

/** The LLM agents the Radar feeds and wakes. Cleo (competitors) only READS
 *  radar chatter on her own runs — competitor mentions are intel, not work. */
export const RADAR_AGENTS = ["mentions", "forums", "outreach", "influencer", "pr"];

const UA_BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const UA_BOT = "SwiftCardRadar/1.0 (+https://swiftcard.me; hello@swiftcard.me)";
const BODY_CHARS = 1500;
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => createHash("sha1").update(String(s)).digest("hex");
const stamp = () => new Date().toISOString().slice(11, 19);

// ── HTTP, defensive ──────────────────────────────────────────────────────────

/** Fetch with a hard timeout. Returns { status, text } — never throws. */
async function get(url, { headers = {}, timeoutMs = 20_000, method = "GET", body } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, body, signal: ctrl.signal, redirect: "follow", headers: { "user-agent": UA_BOT, ...headers } });
    return { status: res.status, text: await res.text() };
  } catch (e) {
    return { status: 0, text: "", error: String(e?.message ?? e) };
  } finally { clearTimeout(timer); }
}

function decodeEntities(s) {
  return String(s ?? "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}
/** Visible text of an HTML fragment. */
export function stripHtml(html) {
  return decodeEntities(String(html ?? "")
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}
/** Text of one XML tag (first match), entity-decoded, CDATA unwrapped. */
function tag(xml, name) {
  const m = String(xml).match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  if (!m) return "";
  return decodeEntities(m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1")).trim();
}
function attr(xml, name, attrName) {
  const m = String(xml).match(new RegExp(`<${name}\\b[^>]*\\b${attrName}="([^"]*)"`, "i"));
  return m ? decodeEntities(m[1]) : "";
}
const isoOrNull = (v) => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null; };

// ── The listening list: defaults + the owner's overrides ─────────────────────

/** config.json `radar` (+ the brand/competitor lists in `targets`) merged with
 *  agent_system.radar, which Settings → Radar writes. Missing column = defaults. */
export async function listeningList() {
  let over = {};
  try { over = (await sb("GET", "agent_system", { params: "select=radar&limit=1" }))?.[0]?.radar ?? {}; } catch { over = {}; }
  const pick = (k, fallback) => (Array.isArray(over?.[k]) && over[k].length ? over[k] : fallback) ?? [];
  return {
    keywords: pick("keywords", DEFAULTS.keywords),
    brand: pick("brand", TARGETS.brand_variations),
    competitors: pick("competitors", TARGETS.competitors),
    ask_words: pick("ask_words", DEFAULTS.ask_words),
    complaint_words: pick("complaint_words", DEFAULTS.complaint_words),
    subreddits: pick("subreddits", DEFAULTS.subreddits).map((s) => String(s).replace(/^r\//i, "").trim()).filter(Boolean),
    telegram_channels: pick("telegram_channels", DEFAULTS.telegram_channels).map((s) => String(s).replace(/^@|^https?:\/\/t\.me\/(s\/)?/i, "").trim()).filter(Boolean),
    feeds: pick("feeds", DEFAULTS.feeds).filter((f) => f?.url),
    hn_queries: pick("hn_queries", DEFAULTS.hn_queries),
    youtube_queries: pick("youtube_queries", DEFAULTS.youtube_queries),
    interval_min: Number(over?.interval_min ?? DEFAULTS.interval_min ?? 15),
    wake_cooldown_min: Number(over?.wake_cooldown_min ?? DEFAULTS.wake_cooldown_min ?? 120),
    wake_score: Number(over?.wake_score ?? DEFAULTS.wake_score ?? 50),
    expire_hours: Number(over?.expire_hours ?? DEFAULTS.expire_hours ?? 72),
  };
}

// ── Classification: is this post about us, and what kind of post is it? ──────

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A competitor name as a whole-word pattern. Generic names get a stricter one. */
const COMPETITOR_PATTERNS = { wave: /\bwave\s?(card|connect|cnct|nfc)\b|wavecnct/i, linq: /\blinq\b(?!\s*(query|to sql))/i };
function competitorRe(name) {
  const k = String(name).toLowerCase();
  return COMPETITOR_PATTERNS[k] ?? new RegExp(`\\b${escapeRe(k)}\\b`, "i");
}
const wordRe = (w) => new RegExp(`(^|[^a-z0-9])${escapeRe(String(w).toLowerCase())}(?![a-z0-9])`, "i");

/**
 * Decide whether a post is a signal and what it is. Returns null when the
 * post never mentions the brand, a competitor or a topic keyword — that is
 * the whole filter, so a subreddit's firehose costs nothing to read.
 *
 *   brand                — SwiftCard itself is mentioned (always flagged)
 *   competitor_complaint — a competitor + a billing/cancel/broken word
 *   ask                  — a question or a request for a recommendation
 *   competitor           — a competitor mentioned neutrally (intel only)
 *   topic                — the category came up, no question asked
 * Platforms override afterwards: news → press, YouTube → creator.
 */
export function classify(text, list, { title = null } = {}) {
  const t = String(text ?? "").replace(/\s+/g, " ");
  if (!t) return null;
  const lower = t.toLowerCase();
  const hit = (words) => (words ?? []).filter((w) => w && wordRe(w).test(lower)).map(String);
  const brand = hit(list.brand);
  const competitors = (list.competitors ?? []).filter((c) => competitorRe(c).test(t));
  const topic = hit(list.keywords);
  if (!brand.length && !competitors.length && !topic.length) return null;
  const complaint = hit(list.complaint_words);
  const asks = hit(list.ask_words);
  // A question is one asked in the title (or the opening line) — a "?" buried
  // in paragraph four of a sales post is not someone asking for help.
  const question = /\?/.test(title ? String(title) : t.slice(0, 200));
  let intent;
  if (brand.length) intent = "brand";
  else if (competitors.length && complaint.length) intent = "competitor_complaint";
  else if (question || asks.length) intent = "ask";
  else if (competitors.length) intent = "competitor";
  else intent = "topic";
  return { intent, matched: [...new Set([...brand, ...competitors, ...topic.slice(0, 3), ...complaint.slice(0, 2), ...asks.slice(0, 2)])] };
}

const INTENT_BASE = { brand: 90, competitor_complaint: 75, ask: 70, press: 55, creator: 50, competitor: 40, topic: 30 };
/** 0-100. Intent carries it; engagement and freshness nudge it. */
export function scoreSignal({ intent, engagement = {}, posted_at }) {
  let s = INTENT_BASE[intent] ?? 30;
  const eng = Number(engagement.ups ?? engagement.points ?? 0) + 2 * Number(engagement.comments ?? 0) + Number(engagement.views ?? 0) / 500;
  if (eng > 0) s += Math.min(15, Math.round(Math.log10(1 + eng) * 7));
  const age = posted_at ? Date.now() - new Date(posted_at).getTime() : null;
  if (age !== null) {
    if (age < 6 * HOUR) s += 10; else if (age < DAY) s += 5; else if (age > 3 * DAY) s -= 20; else if (age > DAY) s -= 5;
  }
  return Math.max(0, Math.min(100, s));
}

/** Which agent owns a signal. */
export function routeAgent(platform, intent) {
  if (intent === "creator") return "influencer";
  if (intent === "press") return "pr";
  if (intent === "competitor") return "competitors";
  if (intent === "competitor_complaint") return platform === "appstore" ? "competitors" : "outreach";
  if (intent === "brand") return "mentions";
  return platform === "reddit" ? "mentions" : "forums";
}

// ── Sources ──────────────────────────────────────────────────────────────────

/** The source rows the listening list implies. Upserted with ignore-duplicates
 *  so the owner's active toggles and cursors survive; removing a source is
 *  the owner's click in Settings → Radar (which deletes the row). */
export async function ensureSources(list) {
  const rows = [
    { id: "reddit:search", kind: "reddit_search", target: "*", label: "Reddit · keyword search (site-wide)" },
    ...list.subreddits.map((s) => ({ id: `reddit:r/${s}`, kind: "reddit_sub", target: s, label: `Reddit · r/${s} (new posts)` })),
    ...list.telegram_channels.map((c) => ({ id: `telegram:@${c}`, kind: "telegram_channel", target: c, label: `Telegram · @${c}` })),
    { id: "telegram:bot", kind: "telegram_bot", target: "bot", label: "Telegram · groups the SwiftCard bot is in" },
    { id: "hn:search", kind: "hn", target: list.hn_queries.join(" | "), label: "Hacker News · keyword search" },
    ...list.feeds.map((f) => ({ id: `rss:${sha(f.url).slice(0, 10)}`, kind: "rss", target: f.url, label: f.label ?? f.url })),
    { id: "youtube:search", kind: "youtube", target: list.youtube_queries.join(" | "), label: "YouTube · new videos on the topic" },
  ];
  let competitors = [];
  try { competitors = (await sb("GET", "agent_competitors", { params: "active=is.true&app_store=not.is.null&select=id,name,app_store" })) ?? []; } catch { competitors = []; }
  for (const c of competitors) {
    const appId = String(c.app_store ?? "").match(/id(\d+)/)?.[1];
    if (appId) rows.push({ id: `appstore:${c.id}`, kind: "appstore_reviews", target: appId, label: `${c.name} · newest App Store reviews` });
  }
  try { await sb("POST", "agent_radar_sources", { body: rows, prefer: "resolution=ignore-duplicates" }); } catch (e) { console.log(`${stamp()} radar: sources not seeded (${String(e).slice(0, 120)})`); }
  return (await sb("GET", "agent_radar_sources", { params: "active=is.true&select=*&order=id" })) ?? [];
}

async function markSource(id, patch) {
  try { await sb("PATCH", "agent_radar_sources", { params: `id=eq.${encodeURIComponent(id)}`, body: patch }); } catch { /* best-effort */ }
}

// ── Readers: each returns normalized posts, never throws ─────────────────────
// post = { external_id, url, title, body, author, community, posted_at, engagement }

let redditToken = null;
/** App-only OAuth (client_credentials). Null when no keys are set. */
async function redditAuth() {
  const id = process.env.REDDIT_CLIENT_ID, secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (redditToken && redditToken.expires > Date.now() + MIN) return redditToken.token;
  const r = await get("https://www.reddit.com/api/v1/access_token", {
    method: "POST", body: "grant_type=client_credentials",
    headers: { Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
  });
  try {
    const j = JSON.parse(r.text);
    if (!j.access_token) return null;
    redditToken = { token: j.access_token, expires: Date.now() + Number(j.expires_in ?? 3600) * 1000 };
    return redditToken.token;
  } catch { return null; }
}

function redditFromListing(json) {
  let j; try { j = JSON.parse(json); } catch { return []; }
  const children = j?.data?.children ?? [];
  return children.filter((c) => c?.kind === "t3" && c.data && !c.data.over_18).map(({ data: d }) => ({
    external_id: d.name,
    url: `https://www.reddit.com${d.permalink}`,
    title: d.title ?? "",
    body: String(d.selftext ?? "").slice(0, BODY_CHARS),
    author: d.author ? `u/${d.author}` : null,
    community: d.subreddit_name_prefixed ?? (d.subreddit ? `r/${d.subreddit}` : null),
    posted_at: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : null,
    engagement: { ups: d.ups ?? 0, comments: d.num_comments ?? 0 },
  }));
}

/** Reddit's public Atom feeds (search.rss, r/<sub>/new.rss). Subreddit
 *  results (t5_*) are skipped; only posts (t3_*) count. */
export function redditFromAtom(xml) {
  const out = [];
  for (const e of String(xml).split(/<entry>/).slice(1)) {
    const id = tag(e, "id");
    if (!/^t3_/.test(id)) continue;
    const link = attr(e, "link", "href");
    const category = attr(e, "category", "label") || (attr(e, "category", "term") ? `r/${attr(e, "category", "term")}` : null);
    out.push({
      external_id: id, url: link, title: tag(e, "title"),
      body: stripHtml(tag(e, "content")).replace(/\s*\[link\]\s*\[comments\]\s*$/, "").slice(0, BODY_CHARS),
      author: tag(e, "name").replace(/^\//, "") || null, community: category,
      posted_at: isoOrNull(tag(e, "published") || tag(e, "updated")), engagement: {},
    });
  }
  return out;
}

/** One scan of Reddit: keyword searches site-wide + the newest posts of every
 *  listed subreddit. Returns { posts, mode, error }. */
async function readReddit(list, sources) {
  const token = await redditAuth();
  const mode = token ? "api" : "rss";
  const subs = sources.filter((s) => s.kind === "reddit_sub").map((s) => s.target);
  const searchOn = sources.some((s) => s.kind === "reddit_search");
  const queries = [];
  if (searchOn) {
    const quote = (w) => (/\s/.test(w) ? `"${w}"` : w);
    const chunk = (arr, n) => arr.reduce((a, x, i) => ((a[Math.floor(i / n)] ??= []).push(x), a), []);
    for (const group of chunk(list.keywords, 6)) queries.push(group.map(quote).join(" OR "));
    queries.push([...list.brand].slice(0, 6).map(quote).join(" OR "));
    queries.push(list.competitors.map(quote).join(" OR "));
  }
  const posts = [];
  let error = null;
  const requests = [
    ...queries.map((q) => ({ q, sub: null })),
    ...subs.map((sub) => ({ q: null, sub })),
  ];
  for (const r of requests) {
    let res;
    if (token) {
      const url = r.q
        ? `https://oauth.reddit.com/search?q=${encodeURIComponent(r.q)}&sort=new&t=week&limit=100&type=link&raw_json=1`
        : `https://oauth.reddit.com/r/${encodeURIComponent(r.sub)}/new?limit=100&raw_json=1`;
      res = await get(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 200) posts.push(...redditFromListing(res.text));
      await sleep(700);
    } else {
      const url = r.q
        ? `https://www.reddit.com/search.rss?q=${encodeURIComponent(r.q)}&sort=new&t=week`
        : `https://www.reddit.com/r/${encodeURIComponent(r.sub)}/new.rss`;
      res = await get(url, { headers: { "user-agent": UA_BROWSER } });
      if (res.status === 200) posts.push(...redditFromAtom(res.text));
      await sleep(2500);
    }
    if (res.status === 429) { error = "Reddit rate-limited this scan — add REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET (a free script app) so the Radar reads through the official API instead of the public feed."; break; }
    if (res.status === 401 || res.status === 403) { error = `Reddit refused the read (${res.status}) — ${token ? "check the app credentials" : "the public feed is blocked from here; add REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET"}.`; if (token) break; }
  }
  return { posts, mode, error };
}

/** A public Telegram channel's preview page (t.me/s/<channel>). */
export function telegramFromPreview(html, handle) {
  const out = [];
  const title = stripHtml((String(html).match(/tgme_channel_info_header_title[^>]*>([\s\S]*?)<\/div>/) ?? [])[1] ?? "") || `@${handle}`;
  for (const block of String(html).split(/<div class="tgme_widget_message_wrap/).slice(1)) {
    const post = block.match(/data-post="([^"]+)"/)?.[1];
    if (!post) continue;
    const text = stripHtml((block.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/) ?? [])[1] ?? "");
    if (!text) continue;
    const views = (block.match(/tgme_widget_message_views">([^<]+)</) ?? [])[1] ?? "";
    const n = /k$/i.test(views) ? Math.round(parseFloat(views) * 1000) : /m$/i.test(views) ? Math.round(parseFloat(views) * 1e6) : Number(views.replace(/\D/g, "")) || 0;
    out.push({
      external_id: post, url: `https://t.me/${post}`, title: text.split("\n")[0].slice(0, 140), body: text.slice(0, BODY_CHARS),
      author: title, community: `Telegram · ${title}`,
      posted_at: isoOrNull((block.match(/<time[^>]*datetime="([^"]+)"/) ?? [])[1]), engagement: { views: n },
    });
  }
  return out;
}
async function readTelegramChannel(handle) {
  const res = await get(`https://t.me/s/${encodeURIComponent(handle)}`, { headers: { "user-agent": UA_BROWSER } });
  if (res.status !== 200) return { posts: [], error: `t.me/s/${handle} → ${res.status || res.error} (only PUBLIC channels have a preview page)` };
  const posts = telegramFromPreview(res.text, handle);
  if (!posts.length && !/tgme_widget_message/.test(res.text)) return { posts, error: `@${handle} has no public preview — is it a public channel? Groups need the bot instead.` };
  return { posts, error: null };
}

/** Messages from every group/channel the SwiftCard bot was added to. The
 *  cursor (update offset) lives in the source row's state. */
export function telegramFromUpdates(updates) {
  const out = [];
  for (const u of updates ?? []) {
    const m = u.message ?? u.channel_post;
    if (!m) continue;
    const text = String(m.text ?? m.caption ?? "").trim();
    if (!text || !m.chat) continue;
    const chat = m.chat;
    const url = chat.username ? `https://t.me/${chat.username}/${m.message_id}` : `https://t.me/c/${String(chat.id).replace(/^-100/, "")}/${m.message_id}`;
    out.push({
      external_id: `${chat.id}:${m.message_id}`, url, title: text.split("\n")[0].slice(0, 140), body: text.slice(0, BODY_CHARS),
      author: m.from ? (m.from.username ? `@${m.from.username}` : [m.from.first_name, m.from.last_name].filter(Boolean).join(" ")) : (m.sender_chat?.title ?? null),
      community: `Telegram · ${chat.title ?? chat.username ?? chat.id}`,
      posted_at: m.date ? new Date(m.date * 1000).toISOString() : null, engagement: {},
    });
  }
  return out;
}
async function readTelegramBot(source) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { posts: [], error: "no TELEGRAM_BOT_TOKEN — create a bot with @BotFather, turn its privacy mode OFF (/setprivacy → Disable), add it to the groups you want scanned, and set the token as a repo secret.", state: source.state };
  let offset = Number(source.state?.offset ?? 0);
  const posts = [];
  for (let page = 0; page < 5; page++) {
    const res = await get(`https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&limit=100&timeout=0&allowed_updates=%5B%22message%22%2C%22channel_post%22%5D`);
    if (res.status === 409) return { posts, error: "a webhook is set on this bot — call deleteWebhook once so the Radar can poll getUpdates.", state: { ...source.state, offset } };
    if (res.status !== 200) return { posts, error: `Telegram getUpdates → ${res.status || res.error}`, state: { ...source.state, offset } };
    let j; try { j = JSON.parse(res.text); } catch { break; }
    const updates = j?.result ?? [];
    posts.push(...telegramFromUpdates(updates));
    if (updates.length) offset = Math.max(...updates.map((u) => Number(u.update_id))) + 1;
    if (updates.length < 100) break;
  }
  return { posts, error: null, state: { ...source.state, offset, mode: "bot" } };
}

/** Hacker News stories + comments via Algolia. */
export function hnFromAlgolia(json) {
  let j; try { j = JSON.parse(json); } catch { return []; }
  return (j?.hits ?? []).map((h) => ({
    external_id: String(h.objectID),
    url: `https://news.ycombinator.com/item?id=${h.objectID}`,
    title: h.title ?? h.story_title ?? "",
    body: stripHtml(h.comment_text ?? h.story_text ?? "").slice(0, BODY_CHARS),
    author: h.author ?? null, community: "Hacker News",
    posted_at: isoOrNull(h.created_at), engagement: { points: h.points ?? 0, comments: h.num_comments ?? 0 },
  }));
}
async function readHn(queries) {
  const since = Math.floor((Date.now() - 7 * DAY) / 1000);
  const posts = [];
  for (const q of queries) {
    const res = await get(`https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(q)}&tags=(story,comment)&hitsPerPage=50&numericFilters=created_at_i>${since}`);
    if (res.status === 200) posts.push(...hnFromAlgolia(res.text));
    await sleep(300);
  }
  return { posts, error: null };
}

/** Any RSS 2.0 or Atom feed. */
export function itemsFromFeed(xml, label) {
  const out = [];
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const chunks = String(xml).split(isAtom ? /<entry(?:\s[^>]*)?>/i : /<item(?:\s[^>]*)?>/i).slice(1);
  for (const c of chunks) {
    const link = isAtom ? (attr(c, "link", "href") || tag(c, "link")) : (tag(c, "link") || attr(c, "link", "href"));
    const title = tag(c, "title");
    if (!link && !title) continue;
    const guid = tag(c, "guid") || tag(c, "id") || sha(link || title);
    const source = tag(c, "source") || label;
    out.push({
      external_id: guid.length > 200 ? sha(guid) : guid, url: link, title,
      body: stripHtml(tag(c, "description") || tag(c, "content") || tag(c, "summary") || tag(c, "content:encoded")).slice(0, BODY_CHARS),
      author: tag(c, "dc:creator") || tag(c, "name") || tag(c, "author") || null, community: source,
      posted_at: isoOrNull(tag(c, "pubDate") || tag(c, "published") || tag(c, "updated") || tag(c, "dc:date")), engagement: {},
    });
  }
  return out;
}
async function readFeed(url, label) {
  const res = await get(url, { headers: { "user-agent": UA_BROWSER, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" } });
  if (res.status !== 200) return { posts: [], error: `feed → ${res.status || res.error}` };
  return { posts: itemsFromFeed(res.text, label), error: null };
}

/** A competitor's newest App Store reviews (public RSS). Only 1-2★ ones are
 *  signals — the cancellation/billing complaints that are SwiftCard's wedge. */
export function reviewsFromAppStoreRss(json, { appId, name }) {
  let j; try { j = JSON.parse(json); } catch { return []; }
  const entries = j?.feed?.entry ?? [];
  return (Array.isArray(entries) ? entries : [entries]).filter((e) => e?.["im:rating"]).map((e) => ({
    external_id: `${appId}:${e.id?.label ?? sha(e.title?.label + e.content?.label)}`,
    url: `https://apps.apple.com/us/app/id${appId}?see-all=reviews`,
    title: `${name} · ${e["im:rating"].label}★ · ${e.title?.label ?? ""}`.trim(),
    body: String(e.content?.label ?? "").slice(0, BODY_CHARS),
    author: e.author?.name?.label ?? null, community: `${name} · App Store`,
    posted_at: isoOrNull(e.updated?.label), engagement: {}, rating: Number(e["im:rating"].label),
  })).filter((r) => r.rating <= 2);
}
async function readAppStore(appId, name) {
  const res = await get(`https://itunes.apple.com/us/rss/customerreviews/id=${appId}/sortBy=mostRecent/json`, { headers: { "user-agent": UA_BROWSER } });
  if (res.status !== 200) return { posts: [], error: `App Store RSS → ${res.status || res.error}` };
  return { posts: reviewsFromAppStoreRss(res.text, { appId, name }), error: null };
}

/** Fresh videos on the topic (YouTube Data API, key only — no OAuth). */
export function videosFromYouTube(json) {
  let j; try { j = JSON.parse(json); } catch { return []; }
  return (j?.items ?? []).filter((v) => v?.id?.videoId).map((v) => ({
    external_id: v.id.videoId, url: `https://www.youtube.com/watch?v=${v.id.videoId}`,
    title: decodeEntities(v.snippet?.title ?? ""), body: String(v.snippet?.description ?? "").slice(0, BODY_CHARS),
    author: v.snippet?.channelTitle ?? null, community: `YouTube · ${v.snippet?.channelTitle ?? ""}`.trim(),
    posted_at: isoOrNull(v.snippet?.publishedAt), engagement: {},
  }));
}
async function readYouTube(queries) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return { posts: [], error: "no YOUTUBE_API_KEY — create an API key in the SwiftCard Agents Google Cloud project (YouTube Data API v3) and set it as a repo secret." };
  const after = new Date(Date.now() - 7 * DAY).toISOString();
  const posts = [];
  for (const q of queries) {
    const res = await get(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=date&maxResults=25&publishedAfter=${encodeURIComponent(after)}&q=${encodeURIComponent(q)}&key=${key}`);
    if (res.status !== 200) return { posts, error: `YouTube search → ${res.status}` };
    posts.push(...videosFromYouTube(res.text));
  }
  return { posts, error: null };
}

// ── The scan ─────────────────────────────────────────────────────────────────

const PLATFORM_OF = { reddit_search: "reddit", reddit_sub: "reddit", telegram_channel: "telegram", telegram_bot: "telegram", hn: "hn", rss: "news", appstore_reviews: "appstore", youtube: "youtube" };

/** Turn raw posts into signal rows (classified, scored, routed). */
export function toSignals(posts, { platform, source_id, list }) {
  const rows = [];
  for (const p of posts) {
    if (!p?.external_id) continue;
    const text = `${p.title ?? ""}\n${p.body ?? ""}`;
    let c;
    if (platform === "appstore") c = { intent: "competitor_complaint", matched: ["1-2★ review"] };
    else if (platform === "youtube") c = { intent: "creator", matched: classify(text, list)?.matched ?? [] };
    else {
      c = classify(text, list, { title: p.title });
      if (!c) continue;
      if (platform === "news" && c.intent !== "brand") c = { ...c, intent: "press" };
    }
    const score = scoreSignal({ intent: c.intent, engagement: p.engagement, posted_at: p.posted_at });
    const assigned_agent = routeAgent(platform, c.intent);
    rows.push({
      source_id, platform, external_id: String(p.external_id).slice(0, 300), url: p.url ?? null,
      title: String(p.title ?? "").slice(0, 300), body: String(p.body ?? "").slice(0, BODY_CHARS),
      author: p.author ?? null, community: p.community ?? null, posted_at: p.posted_at ?? null,
      intent: c.intent, matched: c.matched, score, engagement: p.engagement ?? {}, assigned_agent,
      // Competitor chatter is intel for Cleo, not a thread to answer.
      status: assigned_agent === "competitors" ? "noted" : "new",
    });
  }
  return rows;
}

/** Insert what is new; the unique (platform, external_id) drops repeats.
 *  PostgREST resolves conflicts on the PRIMARY KEY unless told otherwise, so
 *  `on_conflict` names our unique pair — without it a story that two feeds
 *  both carry raised 23505 and lost the whole batch (2026-09-30). */
async function saveSignals(rows) {
  const inserted = [];
  const unique = [...new Map(rows.map((r) => [`${r.platform}\n${r.external_id}`, r])).values()];
  for (let i = 0; i < unique.length; i += 150) {
    const batch = unique.slice(i, i + 150);
    try {
      const out = await sb("POST", "agent_radar_signals", { params: "on_conflict=platform,external_id", body: batch, prefer: "resolution=ignore-duplicates,return=representation" });
      inserted.push(...(out ?? []));
    } catch (e) { console.log(`${stamp()} radar: save failed: ${String(e).slice(0, 160)}`); }
  }
  return inserted;
}

/** Signals nobody answered in time are not lost — they are just old. */
export async function expireStale(hours) {
  const cutoff = new Date(Date.now() - hours * HOUR).toISOString();
  try { await sb("PATCH", "agent_radar_signals", { params: `status=eq.new&found_at=lt.${cutoff}`, body: { status: "expired" } }); } catch { /* best-effort */ }
}

/**
 * One full pass over every active source. Code only. Returns a summary:
 * { sources, fetched, inserted, byAgent: {agent: nNewActionable}, errors }.
 */
export async function scanRadar({ log = console.log } = {}) {
  const list = await listeningList();
  const sources = await ensureSources(list);
  const summary = { sources: sources.length, fetched: 0, inserted: 0, byAgent: {}, errors: [] };
  const now = new Date().toISOString();

  const finish = async (source, { posts, error, state }) => {
    summary.fetched += posts.length;
    const rows = toSignals(posts, { platform: PLATFORM_OF[source.kind], source_id: source.id, list });
    const inserted = await saveSignals(rows);
    summary.inserted += inserted.length;
    for (const s of inserted) if (s.status === "new" && s.score >= list.wake_score) summary.byAgent[s.assigned_agent] = (summary.byAgent[s.assigned_agent] ?? 0) + 1;
    if (error) summary.errors.push(`${source.id}: ${error}`);
    await markSource(source.id, { last_scanned_at: now, last_error: error ?? null, found_total: Number(source.found_total ?? 0) + inserted.length, ...(state ? { state } : {}) });
    if (inserted.length || error) log(`${stamp()} radar ${source.id}: ${posts.length} read, ${inserted.length} new${error ? ` — ${error}` : ""}`);
  };

  // Reddit is one family (one auth, one rate limit): read it once, then
  // credit each source with what came from it.
  const redditSources = sources.filter((s) => s.kind === "reddit_search" || s.kind === "reddit_sub");
  if (redditSources.length) {
    const { posts, mode, error } = await readReddit(list, redditSources);
    const bySub = new Map();
    for (const p of posts) { const k = String(p.community ?? "").toLowerCase(); if (!bySub.has(k)) bySub.set(k, []); bySub.get(k).push(p); }
    const claimed = new Set();
    for (const s of redditSources.filter((x) => x.kind === "reddit_sub")) {
      const mine = bySub.get(`r/${s.target}`.toLowerCase()) ?? [];
      for (const p of mine) claimed.add(p.external_id);
      await finish(s, { posts: mine, error: error && !mine.length ? error : null, state: { ...(s.state ?? {}), mode } });
    }
    const search = redditSources.find((x) => x.kind === "reddit_search");
    if (search) await finish(search, { posts: posts.filter((p) => !claimed.has(p.external_id)), error, state: { ...(search.state ?? {}), mode } });
  }

  for (const s of sources) {
    try {
      if (s.kind === "telegram_channel") await finish(s, await readTelegramChannel(s.target));
      else if (s.kind === "telegram_bot") await finish(s, await readTelegramBot(s));
      else if (s.kind === "hn") await finish(s, await readHn(list.hn_queries));
      else if (s.kind === "rss") await finish(s, await readFeed(s.target, s.label));
      else if (s.kind === "appstore_reviews") await finish(s, await readAppStore(s.target, String(s.label ?? "").split(" · ")[0]));
      else if (s.kind === "youtube") await finish(s, await readYouTube(list.youtube_queries));
    } catch (e) {
      summary.errors.push(`${s.id}: ${String(e?.message ?? e).slice(0, 160)}`);
      await markSource(s.id, { last_scanned_at: now, last_error: String(e?.message ?? e).slice(0, 300) });
    }
  }

  await expireStale(list.expire_hours);
  return summary;
}

// ── What the agents see ──────────────────────────────────────────────────────

const ago = (iso) => {
  if (!iso) return "date unknown";
  const h = Math.round((Date.now() - new Date(iso).getTime()) / HOUR);
  return h < 1 ? "just now" : h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};
const engText = (e) => {
  const parts = [];
  if (e?.ups) parts.push(`${e.ups} upvotes`); if (e?.points) parts.push(`${e.points} points`);
  if (e?.comments) parts.push(`${e.comments} comments`); if (e?.views) parts.push(`${e.views} views`);
  return parts.join(", ");
};
const INTENT_TEXT = { brand: "MENTIONS SWIFTCARD", competitor_complaint: "complaining about a competitor", ask: "asking for a recommendation", competitor: "competitor mentioned", topic: "on our topic", press: "press coverage", creator: "a creator on our topic" };

/** The agent's open signals, highest score first. */
export async function openSignals(agentId, { limit = 12, minScore = 35 } = {}) {
  try {
    return (await sb("GET", "agent_radar_signals", { params: `assigned_agent=eq.${agentId}&status=eq.new&score=gte.${minScore}&select=id,platform,url,title,body,author,community,posted_at,intent,matched,score,engagement&order=score.desc,found_at.desc&limit=${limit}` })) ?? [];
  } catch { return []; }
}

/**
 * The prompt block for a Radar-fed agent: real threads, found in the last
 * three days, that come BEFORE anything it would search for itself. Empty
 * string when there is nothing (the agent researches as usual) and for agents
 * the Radar does not feed.
 */
export async function radarBlock(agentId) {
  if (!RADAR_AGENTS.includes(agentId)) return "";
  const rows = await openSignals(agentId);
  if (!rows.length) return "";
  const lines = rows.map((s) => [
    `- signal_id ${s.id} · ${s.platform} · ${s.community ?? ""} · ${ago(s.posted_at)}${engText(s.engagement) ? ` · ${engText(s.engagement)}` : ""} · ${INTENT_TEXT[s.intent] ?? s.intent} (matched: ${(s.matched ?? []).join(", ")})`,
    `  ${s.url ?? ""}`,
    `  "${String(s.title ?? "").slice(0, 160)}"${s.body ? ` — ${String(s.body).replace(/\s+/g, " ").slice(0, 280)}` : ""}`,
  ].join("\n"));
  return `\n---\nLIVE RADAR SIGNALS (real posts the Radar found — code scanned Reddit, Telegram, Hacker News, news feeds and more in the last 72 hours; nothing here is invented):
Work these FIRST, before anything you would search for yourself. For each one worth answering: WebFetch the URL, read the whole thread and what is already said, then write the two options. Put the signal's id in the item's "signal_id" so it is marked handled. Skip a signal that is not worth the owner's time (old, already answered well, a community that bans vendor replies — for that one, still queue a "DO NOT POST —" item so he knows). Never claim a thread the Radar did not hand you unless you actually found it.
${lines.join("\n")}`;
}

/** Competitor chatter for Cleo's runs: what people said about the tracked
 *  competitors this week (the complaints are the wedge). Read-only intel. */
export async function chatterBlock() {
  try {
    const since = new Date(Date.now() - 7 * DAY).toISOString();
    const rows = (await sb("GET", "agent_radar_signals", { params: `intent=in.(competitor,competitor_complaint)&found_at=gte.${since}&select=platform,community,title,body,url,intent,posted_at&order=score.desc&limit=15` })) ?? [];
    if (!rows.length) return "";
    return `\n---\nWHAT PEOPLE SAID ABOUT COMPETITORS THIS WEEK (from the Radar — use it where it sharpens an angle, never name-call):\n` +
      rows.map((r) => `- [${r.intent === "competitor_complaint" ? "complaint" : "mention"}] ${r.community ?? r.platform} · ${ago(r.posted_at)} · "${String(r.title).slice(0, 120)}"${r.body ? ` — ${String(r.body).replace(/\s+/g, " ").slice(0, 160)}` : ""} ${r.url ?? ""}`).join("\n");
  } catch { return ""; }
}

/** An agent wrote a two-option item for this signal. */
export async function markSignalQueued(signalId, itemId) {
  if (!signalId) return;
  try { await sb("PATCH", "agent_radar_signals", { params: `id=eq.${signalId}&status=eq.new`, body: { status: "queued", item_id: itemId ?? null } }); } catch { /* best-effort */ }
}

// ── The tick: called by the always-on loop ───────────────────────────────────

let lastScanAt = 0;
const lastWakeAt = new Map();

/**
 * Scan on the interval and wake the agents that have something to answer.
 * Nothing here is a schedule for an agent: a wake is the same signal-driven
 * dispatch the watchdogs use, rate-limited so one agent is not woken twice
 * for the same conversations. `dispatch(agentId, reason, trigger)` is the
 * loop's own GitHub dispatcher.
 */
export async function radarTick({ dispatch, log = console.log, force = false } = {}) {
  const list = await listeningList();
  if (!force && Date.now() - lastScanAt < list.interval_min * MIN) return null;
  const settings = (await sb("GET", "agent_settings", { params: `agent_id=in.(${RADAR_AGENTS.join(",")})&select=agent_id,enabled,paused` })) ?? [];
  const awake = settings.filter((r) => r.enabled && !r.paused).map((r) => r.agent_id);
  lastScanAt = Date.now();
  if (!awake.length) { log(`${stamp()} radar: no listening agent is awake — not scanning.`); return { skipped: "no listening agent is awake" }; }

  const summary = await scanRadar({ log });
  const woke = [];
  for (const agentId of awake) {
    // Anything new and actionable since this agent last worked?
    const runs = await sb("GET", "agent_runs", { params: `agent_id=eq.${agentId}&trigger=neq.chat&status=in.(success,running,paused)&select=started_at&order=started_at.desc&limit=1` }).catch(() => []);
    const lastRun = runs?.[0]?.started_at ?? "1970-01-01T00:00:00Z";
    const fresh = await sb("GET", "agent_radar_signals", { params: `assigned_agent=eq.${agentId}&status=eq.new&score=gte.${list.wake_score}&found_at=gt.${lastRun}&select=id&limit=1` }).catch(() => []);
    if (!fresh?.length) continue;
    const cooldownMs = list.wake_cooldown_min * MIN;
    const recent = lastWakeAt.get(agentId) ?? 0;
    if (Date.now() - recent < cooldownMs) continue;
    const radarRuns = await sb("GET", "agent_runs", { params: `agent_id=eq.${agentId}&trigger=eq.radar&started_at=gte.${new Date(Date.now() - cooldownMs).toISOString()}&select=id&limit=1` }).catch(() => []);
    if (radarRuns?.length) { lastWakeAt.set(agentId, Date.now()); continue; }
    const n = summary.byAgent[agentId] ?? 0;
    const ok = dispatch ? await dispatch(agentId, `${n || "new"} radar signal(s)`, "radar") : false;
    if (ok) { lastWakeAt.set(agentId, Date.now()); woke.push(agentId); }
  }
  const total = Object.values(summary.byAgent).reduce((a, b) => a + b, 0);
  if (total) {
    const parts = Object.entries(summary.byAgent).map(([a, n]) => `${n} for ${a}`).join(", ");
    await say("atlas", "owner", `📡 Radar: ${total} new conversation(s) worth answering (${parts})${woke.length ? ` — woke ${woke.join(", ")}` : ""}. They land in the queue as two-option replies.`, { kind: "owner_out" });
  }
  log(`${stamp()} radar: ${summary.sources} source(s), ${summary.fetched} read, ${summary.inserted} new signal(s)${woke.length ? `, woke ${woke.join(", ")}` : ""}${summary.errors.length ? `, ${summary.errors.length} source error(s)` : ""}`);
  return { ...summary, woke };
}
