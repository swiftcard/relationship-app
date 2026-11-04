import type { AgentDef } from "../agent-def";
import { inboxFull, propose } from "../approvals";
import { BudgetStop } from "../budget";
import type { AgentContext } from "../context";
import { exactPostLink, instagramHandle } from "../exact-links";
import { remainingToday } from "../rate-limit";
import { emptyRest, rotate } from "../replies/engine";
import { minutesToTomorrow, nyDayStart } from "../schedule";
import { blockedDomain, onDomain, searchItems } from "../sources/web-discovery";
import type { RunResult } from "../types";
import { BANNED_PHRASES } from "../voice";
import { writingProblems } from "../writing-check";
import { SHEET_DAILY_TARGET, SHEET_MAX_PENDING } from "./replies";

// ── Instagram conversations (agent id contact-instagram-linkinbio) ──────────
// Until 2026-11-04 this agent searched for Instagram PROFILES whose bio holds
// a linkedin.com/in/ link and drafted a cold DM to each. Every run since
// 2026-10-29 came back empty ({"items":[]} after 5 to 7 web searches, about
// $0.10 a run): a search engine's copy of an Instagram profile is the name,
// the counts and the bio text, never the bio's link button, so the one thing
// the search had to see is the thing it can't. When a profile did slip
// through, the shared scorer (written for posts asking for a card tool) gave
// it under 0.55 and nothing was drafted.
//
// Now (owner, 2026-11-04): it finds public Instagram POSTS where people talk
// about networking, business cards, events and relationship building, and
// drafts a comment that adds something to that conversation. SwiftCard is
// mentioned only when the post asks for a tool. Drafts go to the Sheet and the
// admin inbox; a person posts them by hand. Nothing is posted or sent here.
//
// Where the posts come from: Claude's web_search restricted to instagram.com,
// i.e. a search engine's public index. Instagram's own API offers no keyword
// or topic search to us (hashtag search needs Meta's Public Content Access
// review, which SwiftCard does not have), so this is the supported route.

export const AGENT_ID = "contact-instagram-linkinbio";

/** Its own daily limit (the $0.18 of 2026-11-04 had no cap below the $3 shared one). Admin → Agents → Settings can change it; the shared limit still applies. */
export const IG_CONVERSATIONS_USD = 0.5;

/** Comments drafted per run at most: a run costs one search, one scoring call and up to this many drafts (2 to 3 cents each). Agent config drafts_per_run lowers it. */
export const DRAFTS_PER_RUN = 8;

/** Web searches inside the one search call. Agent config search_max_uses lowers it (1 to 4). */
export const SEARCH_MAX_USES = 4;

/**
 * What one web search can cost beyond the $0.01 search fee, at worst: the
 * results come back as cached input. Measured in crew_usage up to 2026-11-04:
 * the dearest discover call was $0.377 for 6 searches (108k cache-write and
 * 126k cache-read tokens on Sonnet), about $0.055 a search beyond the fee.
 * The budget guard only estimates the prompt and output, so the search call
 * reserves this per search: it won't start unless the worst case still fits
 * under the agent's and the shared limit.
 */
export const SEARCH_RESERVE_USD_PER_USE = 0.055;

/** Below this the post isn't a real chance to add something. */
export const MIN_SCORE = 0.6;

/** Don't comment on the same account again within this many days, from any Instagram agent. */
export const PERSON_COOLDOWN_DAYS = 30;

/** The Instagram agents whose drafts count as "already answered" here. */
const IG_AGENTS = [AGENT_ID, "replies-instagram", "contact-instagram"];

/**
 * What each run searches for: two of these, rotating, so every run looks
 * somewhere new. Phrased the way captions talk, because the search engine
 * matches caption text.
 */
export const SEARCH_TOPICS = [
  "networking events: what people learned, how they follow up after meeting someone",
  "business cards: new card designs, running out of cards, whether paper cards still matter",
  "digital business cards, NFC cards or QR codes for sharing contact info",
  "realtors at open houses, broker events or realtor networking nights",
  "insurance agents talking about referrals and building client relationships",
  "mortgage loan officers networking with realtors and referral partners",
  "sales reps on prospecting, follow ups, or working a trade show booth",
  "small business owners and entrepreneurs on growing through word of mouth and relationships",
  "conference or trade show recaps from business professionals",
  "chamber of commerce, BNI or local business networking group meetings",
  "tips for introducing yourself and making a first impression at business events",
  "entrepreneurs on how they keep in touch with the people they meet",
];

/** A free first gate (no model): the caption must touch one of the topics. Scoring decides quality. */
export const ON_TOPIC =
  /network|business cards?|contact (info|card|details)|vcard|qr code|\bnfc\b|digital card|follow(ing)?[ -]?up|referr|realtor|real estate|open house|brokerage|mortgage|loan officer|lender|insurance|\bsales\b|prospect|entrepreneur|small business|business owner|founder|conference|trade ?show|\bexpo\b|summit|chamber|\bbni\b|meetup|mixer|first impression|relationship|introduc|word of mouth/i;

export type IgPost = { url: string; handle: string | null; title: string; text: string; topic: string };

type SearchHit = { url: string; author: string; title: string; text: string };

/** Exact post link and the account that posted it, from what web search returned. Profiles, hashtag pages and search pages are not posts and are dropped. */
export function toPosts(hits: SearchHit[], topic: string, stat: (k: string, n?: number) => void = () => {}): IgPost[] {
  const out: IgPost[] = [];
  for (const h of hits) {
    if (!onDomain(h.url, ["instagram.com"])) {
      stat("dropped_not_instagram");
      continue;
    }
    const url = exactPostLink("instagram", h.url);
    if (!url) {
      stat("dropped_not_a_post");
      continue;
    }
    const text = `${h.text ?? ""}`.trim();
    if (text.length < 30) {
      // Nothing to ground a reply in: a comment on a post we can't read is a guess.
      stat("dropped_no_caption");
      continue;
    }
    // instagram.com/<handle>/p/<code>/ carries the account; otherwise the author field or "Name (@handle)" in the title.
    const inUrl = /instagram\.com\/([\w.]{1,30})\/(?:p|reels?)\//i.exec(h.url)?.[1];
    const inTitle = /@([\w.]{1,30})/.exec(h.title ?? "")?.[1];
    const handle = instagramHandle(inUrl) ?? instagramHandle(h.author) ?? instagramHandle(inTitle);
    out.push({ url, handle, title: `${h.title ?? ""}`.slice(0, 200), text: text.slice(0, 600), topic });
  }
  return out;
}

// ── Scoring ────────────────────────────────────────────────────────────────

const POST_KINDS = ["question", "tip_or_advice", "event_recap", "story", "announcement", "ad_or_promo", "giveaway", "other"] as const;

const SCORE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["i", "score", "post_kind", "professional", "why_selected", "angle", "mention_ok"],
        properties: {
          i: { type: "integer" },
          score: { type: "number" },
          post_kind: { type: "string", enum: [...POST_KINDS] },
          professional: { type: "boolean" },
          why_selected: { type: "string" },
          angle: { type: "string" },
          mention_ok: { type: "boolean" },
        },
      },
    },
  },
} as const;

export type Scored = { i: number; score: number; post_kind: (typeof POST_KINDS)[number]; professional: boolean; why_selected: string; angle: string; mention_ok: boolean };

const SCORE_SYSTEM = `You pick public Instagram posts where a thoughtful comment from a real person would add something to the conversation. The commenter works on a small company that makes digital business cards, but the comment is NOT an ad: the goal is to be interesting and useful in conversations about networking, exchanging contact info, business cards, business events and relationship building, so people who read it get curious about who wrote it.
Topics that matter: networking and exchanging contact information; business cards and digital business cards; entrepreneurs and small business owners; sales, real estate, insurance and mortgage professionals; business events, conferences and relationship building.
For each post:
- score 0 to 1. High (0.7+) when the post is on those topics, written by a working professional, business owner or event organizer, and a specific comment could add a real idea, answer a question, or ask a sharp follow up question. Low (under 0.4) for ads, giveaways, contests, listings with no discussion, motivational quotes with nothing to add, memes, students, law firms, anything off topic, or a caption too thin to say anything specific about.
- post_kind: what the post is.
- professional: true only if the author is clearly a working professional, business owner or organizer.
- why_selected: one sentence, specific to this post, on why it's worth a comment.
- angle: the one concrete thing a comment could add (a practical idea, a question about their specific situation, a relevant observation). Never "compliment them".
- mention_ok: true ONLY if the post itself asks for a tool, app or way to share contact info or replace paper business cards. Otherwise false.`;

/** The free part of choosing: drop what scoring said no to, best first. */
export function pickPosts(scored: Scored[], n: number, batch: number): Scored[] {
  return scored
    .filter((s) => s.i >= 0 && s.i < batch && s.score >= MIN_SCORE && s.professional && s.post_kind !== "ad_or_promo" && s.post_kind !== "giveaway")
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

// ── Drafting ───────────────────────────────────────────────────────────────

const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "reply_fit"],
  properties: { reply: { type: "string" }, reply_fit: { type: "string" } },
} as const;

export const COMMENT_SYSTEM = `You write one Instagram comment, for a real person to read, check and post by hand from their own account. The person is a young founder who cares about how professionals meet and stay in touch. The comment must be worth reading on its own: it adds a specific idea, answers their question, or asks one sharp question about their situation. People should want to look at the commenter's profile because the comment was smart, not because it advertised anything.

Rules:
- Ground every word in the post you are given. Refer to something specific in it. If you could paste the comment under a different post, rewrite it.
- Add something: a practical idea, a concrete detail, a real question. No generic praise ("great post", "love this", "so true", "well said", "this is so important", "amazing"), and never open with a compliment.
- Never invent personal experience, clients, a job, a past, results, numbers or a relationship with them. Don't write "when I was...", "my clients", "in my experience", "I've seen". You may share an idea or ask a question.
- No emoji, no hashtags, no exclamation points, no em dashes, en dashes or hyphenated words, no links, no @mentions.
- No corporate or marketing language. Plain words, contractions, like a person typing on their phone. 12 to 40 words. At most one question.
- Do not mention SwiftCard, digital business cards as a product, or any product or company, unless the instructions say a mention is allowed. When it is allowed, at most one plain sentence, only because they asked, and say you work on it.
- Never use these phrases: ${BANNED_PHRASES.join(", ")}.

Return JSON: reply (the comment text only) and reply_fit (one sentence for the owner: why this comment fits this post and what it adds).`;

const EMOJI = /\p{Extended_Pictographic}/u;
const GENERIC_OPENER = /^(great|love|loved|awesome|amazing|nice|beautiful|so true|this is (so )?(great|true|important|awesome)|well said|totally agree|congrats|congratulations|wow|yes)\b/i;
const INVENTED = /\b(when i was|my clients?|my team|my broker|my agents?|in my experience|i(?:'ve| have) (seen|found|been|worked|done)|i used to|back when i|years? (in|of) (real estate|sales|insurance|the business))\b/i;
const PRODUCT = /swift ?card|swiftcard\.me|our app|my app|our product|digital business card app/i;

/**
 * What's wrong with a comment, in words the rewrite can act on. Empty means
 * it may go to the Sheet. `recent` are this agent's last comments: the same
 * opening or mostly the same words reads as spam.
 */
export function commentProblems(text: string, o: { mentionOk: boolean; recent?: string[] }): string[] {
  const out = new Set(writingProblems(text, { kind: "comment", platform: "instagram" }));
  const t = text.trim();
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 8) out.add(`only ${words.length} words; say something specific`);
  if (words.length > 45) out.add(`${words.length} words; keep it under 40`);
  if (EMOJI.test(t)) out.add("has an emoji");
  if (/#\w{2,}/.test(t)) out.add("has hashtags");
  if (/!/.test(t)) out.add("has an exclamation point");
  if (/https?:\/\/|www\./i.test(t)) out.add("has a link");
  if (/(^|\s)@[\w.]{2,}/.test(t)) out.add("tags someone");
  if (GENERIC_OPENER.test(t)) out.add("opens with a generic compliment");
  if (INVENTED.test(t)) out.add("claims a personal experience or client we can't back up");
  if (!o.mentionOk && PRODUCT.test(t)) out.add("mentions SwiftCard or a product where the post didn't ask for one");
  for (const r of o.recent ?? []) {
    if (opening(r) && opening(r) === opening(t)) {
      out.add("starts the same way as an earlier comment");
      break;
    }
    if (overlap(r, t) > 0.6) {
      out.add("too close to an earlier comment");
      break;
    }
  }
  return [...out];
}

function opening(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s']/g, "").split(/\s+/).filter(Boolean).slice(0, 4).join(" ");
}

function overlap(a: string, b: string): number {
  const set = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s']/g, "").split(/\s+/).filter((w) => w.length > 3));
  const x = set(a);
  const y = set(b);
  if (!x.size || !y.size) return 0;
  let n = 0;
  for (const w of x) if (y.has(w)) n++;
  return n / Math.min(x.size, y.size);
}

// ── Memory: what it has seen and said ──────────────────────────────────────

const SEEN = `seen:${AGENT_ID}`;
const RECENT = `recent-comments:${AGENT_ID}`;

/** Why a run ended with nothing, in one sentence for the admin page. */
export function emptyReason(s: Record<string, number>, topics: string[]): string {
  const where = topics.map((t) => t.split(":")[0]).join(" and ");
  const hits = s.search_results ?? 0;
  if (s.search_blocked) return `Web search can't read instagram.com right now; nothing searched (${where}).`;
  if (!hits) return `The search engine returned no Instagram posts for ${where}${s.search_web_searches ? ` after ${s.search_web_searches} searches` : ""}. Trying other topics next run.`;
  const parts = [
    ["dropped_not_a_post", "were profiles or pages, not posts"],
    ["dropped_no_caption", "had no caption to reply to"],
    ["dropped_seen", "were already seen"],
    ["dropped_already_answered", "already have a draft"],
    ["dropped_recent_person", "were from accounts drafted for in the last 30 days"],
    ["dropped_off_topic", "were off topic"],
    ["rejected_by_score", "weren't a real chance to add something"],
    ["drafts_failed_checks", "got drafts that failed the writing check twice"],
  ]
    .filter(([k]) => (s[k] ?? 0) > 0)
    .map(([k, w]) => `${s[k]} ${w}`);
  return `Found ${hits} Instagram results for ${where}; ${parts.join(", ") || "none qualified"}.`;
}

export async function runInstagramConversations(ctx: AgentContext): Promise<RunResult> {
  const quota = await remainingToday(ctx.store, { agentId: ctx.def.id, platform: "instagram", action: "comment_conversation", defaultCeiling: SHEET_DAILY_TARGET, now: ctx.now(), warmup: false });
  if (quota.left === 0) return { summary: `Done for today: ${quota.cap} comments drafted.`, restMinutes: minutesToTomorrow(ctx.now()) };
  if (await inboxFull(ctx)) return { summary: "Waiting: there are already plenty of my drafts to work through.", restMinutes: 30 };
  const replyCap = Number((await ctx.store.getControls().catch(() => ({}) as Record<string, unknown>)).social_reply_limit ?? 0);
  if (replyCap > 0 && (await ctx.store.countTouchesSince("instagram", ["commented", "replied"], nyDayStart(ctx.now()).toISOString())) >= replyCap) {
    return { summary: `Done for today: the Controls limit of ${replyCap} Instagram messages is reached.`, restMinutes: minutesToTomorrow(ctx.now()) };
  }

  // 1. Find: one web search call, two topics.
  const topics = await rotate(ctx, "topic_i", SEARCH_TOPICS, 2);
  const maxUses = Math.max(1, Math.min(SEARCH_MAX_USES, Math.floor(ctx.config<number>("search_max_uses", SEARCH_MAX_USES)) || SEARCH_MAX_USES));
  let hits: SearchHit[] = [];
  try {
    hits = await searchItems<SearchHit>(ctx, {
      system: "You find recent public Instagram posts for a small company's staff to read and comment on by hand.",
      prompt: `Search instagram.com for individual public Instagram posts or reels (links like instagram.com/p/<code>/ or instagram.com/reel/<code>/; search engines title them like 'Jane Doe on Instagram: "caption..."') where people talk about any of these:\n${topics.map((t) => `- ${t}`).join("\n")}\nGood searches look like: site:instagram.com/p "networking event" follow up, site:instagram.com/reel realtor "business cards". Skip profile pages, hashtag pages and ads.\nFor each post: url (the exact post or reel link as the result shows it), author (the account's @username if the link, title or caption shows it, else empty), title (the result's title), text (the caption words the result shows, under 400 characters).`,
      fields: ["url", "author", "title", "text"],
      domains: ["instagram.com"],
      maxUses,
      reserveUsd: maxUses * SEARCH_RESERVE_USD_PER_USE,
      want: 20,
    });
  } catch (e) {
    if (blockedDomain(e)) ctx.stat("search_blocked");
    else throw e;
  }
  ctx.stat("search_results", hits.length);
  ctx.stat("posts_read", hits.length);
  const posts = toPosts(hits, topics.join(" | "), (k, n) => ctx.stat(k, n));

  // 2. Never twice: not a post it has seen, not a post any Instagram agent drafted for, not an account drafted for lately.
  const seen = new Set((await ctx.store.kvGet<string[]>(SEEN)) ?? []);
  const since = new Date(ctx.now().getTime() - PERSON_COOLDOWN_DAYS * 86400_000).toISOString();
  const earlier = await ctx.store.listApprovals({ agentIds: IG_AGENTS, sinceIso: since, limit: 1000 });
  const answered = new Set(earlier.map((a) => exactPostLink("instagram", a.target_url) ?? a.target_url ?? ""));
  const recentPeople = new Set(earlier.map((a) => instagramHandle(String(a.meta?.author ?? "")) ?? "").filter(Boolean));
  const fresh: IgPost[] = [];
  for (const p of new Map(posts.map((p) => [p.url, p])).values()) {
    if (seen.has(p.url)) ctx.stat("dropped_seen");
    else if (answered.has(p.url)) ctx.stat("dropped_already_answered");
    else if (p.handle && recentPeople.has(p.handle)) ctx.stat("dropped_recent_person");
    else if (p.handle && fresh.some((f) => f.handle === p.handle)) ctx.stat("dropped_recent_person");
    else if (!ON_TOPIC.test(`${p.title} ${p.text}`)) ctx.stat("dropped_off_topic");
    else fresh.push(p);
  }
  await ctx.store.kvSet(SEEN, [...new Set([...posts.map((p) => p.url), ...seen])].slice(0, 3000));
  ctx.stat("posts_relevant", fresh.length);
  if (!fresh.length) {
    const summary = emptyReason(ctx.stats, topics);
    ctx.log(summary);
    return { summary, restMinutes: await emptyRest(ctx) };
  }

  // 3. Score: one call for the batch.
  const batch = fresh.slice(0, 20);
  const scored = await ctx.llm.askJson<{ items: Scored[] }>("score", {
    effort: "low",
    maxTokens: 3000,
    schema: SCORE_SCHEMA as unknown as Record<string, unknown>,
    system: SCORE_SYSTEM,
    prompt: batch.map((p, i) => `#${i} ${p.handle ? `@${p.handle}` : "(account not shown)"}: ${p.title}\n${p.text}`).join("\n\n"),
  });
  ctx.stat("posts_scored", batch.length);
  const qualified = pickPosts(scored?.items ?? [], batch.length, batch.length);
  const perRun = Math.max(0, Math.min(DRAFTS_PER_RUN, Math.floor(ctx.config<number>("drafts_per_run", DRAFTS_PER_RUN))));
  const picks = qualified.slice(0, Math.min(perRun, quota.left));
  ctx.stat("rejected_by_score", batch.length - qualified.length);
  if (qualified.length > picks.length) ctx.stat("qualified_not_drafted", qualified.length - picks.length);

  // 4. Draft, check, keep.
  const mentionPolicy = ctx.config<"when_asked" | "never">("mention_swiftcard", "when_asked");
  const recent = (await ctx.store.kvGet<string[]>(RECENT)) ?? [];
  const examples = await ctx.ownerExamples("comment");
  let made = 0;
  let stoppedFor: string | null = null;
  for (const s of picks) {
    if (await inboxFull(ctx)) break;
    if (ctx.deadline !== null && ctx.now().getTime() > ctx.deadline - 30_000) {
      ctx.stat("stopped_for_time");
      break;
    }
    const p = batch[s.i];
    const mentionOk = mentionPolicy !== "never" && s.mention_ok;
    const instructions = [
      `INSTAGRAM POST by ${p.handle ? `@${p.handle}` : "an account the search didn't show"}:\n${p.title}\n${p.text}`,
      `Why it was picked: ${s.why_selected}\nWhat the comment should add: ${s.angle}`,
      mentionOk
        ? "They asked for a tool or a way to share contact info, so ONE plain sentence saying you work on SwiftCard, a digital business card, is allowed if it truly answers them. No link, no pitch."
        : "Do NOT mention SwiftCard or any product or company.",
      ...(examples ? [examples] : []),
      recent.length ? `Your recent comments (don't repeat their openings or wording):\n${recent.slice(0, 8).map((r) => `- ${r}`).join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    let draft: { reply: string; reply_fit: string } | null = null;
    try {
      draft = await ctx.llm.askJson<{ reply: string; reply_fit: string }>("draft", { system: COMMENT_SYSTEM, effort: "medium", maxTokens: 800, schema: DRAFT_SCHEMA as unknown as Record<string, unknown>, prompt: instructions });
      let problems = draft?.reply ? commentProblems(draft.reply, { mentionOk, recent }) : ["empty"];
      if (draft?.reply && problems.length) {
        ctx.stat("rewritten_for_style");
        const again = await ctx.llm.askJson<{ reply: string; reply_fit: string }>("revise", {
          system: COMMENT_SYSTEM,
          effort: "medium",
          maxTokens: 800,
          schema: DRAFT_SCHEMA as unknown as Record<string, unknown>,
          prompt: `${instructions}\n\nYOUR DRAFT:\n${draft.reply}\n\nRewrite it without these problems:\n- ${problems.join("\n- ")}`,
        });
        if (again?.reply) draft = again;
        problems = draft?.reply ? commentProblems(draft.reply, { mentionOk, recent }) : ["empty"];
      }
      if (!draft?.reply || problems.length) {
        ctx.stat("drafts_failed_checks");
        ctx.log(`skipped ${p.url}: ${problems.join(", ")}`);
        continue;
      }
    } catch (e) {
      if (e instanceof BudgetStop) {
        stoppedFor = e.reason;
        break;
      }
      throw e;
    }
    const body = draft.reply.trim();
    const r = await propose(ctx, {
      kind: "comment",
      title: `Instagram comment${p.handle ? ` on @${p.handle}` : ""}: ${p.title.replace(/^.*?on Instagram:\s*/i, "").slice(0, 70)}`,
      summary: `Picked because: ${s.why_selected.replace(/\.$/, "")}. The comment: ${draft.reply_fit.replace(/\.$/, "")}. Approve it, then post it yourself from your own account.`,
      body,
      platform: "instagram",
      targetUrl: p.url,
      person: p.handle ? { platform: "instagram", handle: p.handle } : null,
      meta: {
        score: s.score,
        angle: s.angle,
        why: s.why_selected,
        reply_fit: draft.reply_fit,
        post_kind: s.post_kind,
        mention_ok: mentionOk,
        pitched: PRODUCT.test(body),
        author: p.handle ? `@${p.handle}` : null,
        post_title: p.title,
        excerpt: p.text.slice(0, 500),
        search_topic: p.topic,
        source: "web_search",
      },
    });
    if (r.ok) {
      made++;
      recent.unshift(body);
      if (p.handle) recentPeople.add(p.handle);
    }
  }
  if (made) await ctx.store.kvSet(RECENT, recent.slice(0, 30));
  ctx.stat("drafts_made", made);
  if (made > 0 && ctx.config<number>("empty_runs", 0) > 0) await ctx.saveConfig({ empty_runs: 0 });
  if (stoppedFor) return { summary: `Drafted ${made}, then stopped: ${stoppedFor}`, restMinutes: minutesToTomorrow(ctx.now()) };
  if (!made) {
    const summary = emptyReason(ctx.stats, topics);
    return { summary, restMinutes: await emptyRest(ctx) };
  }
  return { summary: `Found ${hits.length} Instagram results, ${fresh.length} new and on topic, ${picks.length} worth a comment; added ${made} to the Sheet.` };
}

export const instagramLinkedinBio: AgentDef = {
  id: AGENT_ID,
  // The name stays: it's the Sheet tab's name and the owner's name for it.
  name: "Instagram LinkedIn Bio",
  team: "contact",
  role: "worker",
  tier: "sonnet",
  needs: ["CREW_ANTHROPIC_API_KEY"],
  maxPending: SHEET_MAX_PENDING,
  approvalKind: "comment",
  continuous: true,
  schedule: { kind: "daily", hour: 15, minute: 30 },
  dailyUsd: IG_CONVERSATIONS_USD,
  purpose:
    "Finds public Instagram posts about networking, business cards, events and relationship building by realtors, loan officers, insurance and sales pros and business owners, and drafts a comment that adds something to each one (SwiftCard only when the post asks for a tool). Drafts only: the link opens the post and you post it yourself. Its search can't see the link in an Instagram bio, so it no longer looks for LinkedIn links.",
  run: runInstagramConversations,
};
