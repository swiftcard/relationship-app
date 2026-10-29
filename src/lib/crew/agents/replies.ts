import type { AgentDef } from "../agent-def";
import type { AgentContext } from "../context";
import { propose } from "../approvals";
import { normalizeHandle } from "../ledger";
import { pairs, rotate, runEngagement, type Candidate } from "../replies/engine";
import { PROBLEMS, PROFESSIONS } from "../search-plan";
import { searchHackerNews } from "../sources/hackernews";
import { redditConfigured, rulesBanPromotion, searchSubreddits, subredditRules } from "../sources/reddit";
import { searchBluesky } from "../sources/bluesky";
import { searchPlatform } from "../sources/web-discovery";
import type { CrewInput, Platform } from "../types";

// ── Team 1: Replies (one agent per platform) ────────────────────────────────
// Every reply is a DRAFT for a person to post by hand. Where the platform has
// an API we may read (Reddit, Bluesky), the agent reads it; where it doesn't, it finds
// public posts through web search, or works from posts the owner pastes in
// (Facebook groups have had no API since April 2024).

export const DEFAULT_SUBREDDITS = [
  "realtors",
  "RealEstate",
  "RealEstateTechnology",
  "sales",
  "recruiting",
  "smallbusiness",
  "Entrepreneur",
  "sweatystartup",
  "marketing",
  "networking",
  "mortgage",
  "WindowCleaning",
  "landscaping",
  "Plumbing",
  "Contractor",
];

export const DEFAULT_QUERIES = ["linktree", "\"link in bio\"", "\"digital business card\"", "\"business card app\"", "hihello OR blinq OR popl", "\"link.me\" OR hoobe", "\"QR code\" business card"];

export const TOPICS = [
  "digital business cards or business card apps",
  "link in bio pages, Linktree, Link.me, Hoobe",
  "HiHello, Blinq or Popl being too expensive or missing something",
  "how realtors, recruiters, loan officers or local service businesses share contact info and capture leads",
];

const RULES_TTL_MS = 7 * 86400_000;

async function promoAllowedIn(ctx: AgentContext, sub: string): Promise<boolean> {
  const key = `reddit-rules:${sub.toLowerCase()}`;
  const cached = await ctx.store.kvGet<{ at: number; bans: boolean }>(key);
  if (cached && Date.now() - cached.at < RULES_TTL_MS) return !cached.bans;
  try {
    const bans = rulesBanPromotion(await subredditRules(sub));
    await ctx.store.kvSet(key, { at: Date.now(), bans });
    return !bans;
  } catch {
    return false; // can't read the rules → assume no promotion
  }
}

function fromInputs(inputs: CrewInput[], platform: Platform): Candidate[] {
  return inputs.map((i) => ({
    platform,
    url: i.url ?? `paste:${i.id}`,
    author: guessAuthor(i.text, platform),
    title: i.text.split("\n")[0].slice(0, 140),
    text: i.text,
    community: null,
    // A person chose this post; promotion is still only allowed if they paste
    // from somewhere that allows it, so default to "helpful only" for groups.
    promoAllowed: platform !== "facebook",
    fromPaste: true,
  }));
}

/** "@handle" or "u/handle" at the start of pasted text. */
export function guessAuthor(text: string, platform: Platform): string | null {
  const m = text.match(platform === "reddit" ? /\bu\/([A-Za-z0-9_-]{3,20})/ : /(?:^|\s)@([A-Za-z0-9._]{2,30})/);
  return m ? m[1] : null;
}

/** Sheet agents add rows until today's ceiling; the owner works through them in the Sheet, so they don't stop for unread drafts. */
export const SHEET_MAX_PENDING = 300;

const base = {
  team: "replies" as const,
  role: "worker" as const,
  tier: "sonnet" as const,
  needs: ["CREW_ANTHROPIC_API_KEY" as const],
  maxPending: SHEET_MAX_PENDING,
  approvalKind: "reply" as const,
  continuous: true,
};

/** Two new searches a run: a problem people post about, for a profession we sell to. */
export async function nextTopics(ctx: AgentContext, n = 2): Promise<string[]> {
  return (await rotate(ctx, "topic_i", pairs(PROBLEMS, PROFESSIONS), n)).map(([problem, who]) => `${who} talking about ${problem}`);
}

export const redditReplies: AgentDef = {
  ...base,
  id: "replies-reddit",
  name: "Reddit Reply",
  schedule: { kind: "daily", hour: 9, minute: 0 },
  dailyUsd: 0.6,
  purpose: "Finds Reddit threads where an answer helps (people asking about cards, follow ups, link pages, or unhappy with a competitor) and writes the reply, with the exact thread link.",
  async run(ctx) {
    const r = await runEngagement(ctx, {
      platform: "reddit",
      kind: "reply",
      action: "reply",
      ceiling: 8,
      register: "Reddit: casual, no greeting, no sign-off, no emoji.",
      length: "40 to 120 words",
      label: (c) => `Reddit${c.community ? ` r/${c.community}` : ""}: ${c.title.slice(0, 90)}`,
      person: (c) => (c.author ? { platform: "reddit", handle: `u/${c.author}` } : null),
      async find() {
        const pasted = fromInputs(await ctx.store.takeInputs(["reddit"], 5, ctx.def.id), "reddit");
        // Reddit blocks Anthropic's web search (seen live 2026-10-20), so
        // without the Reddit API keys only pasted posts can be answered.
        if (!redditConfigured()) return pasted;
        const subs = ctx.config<string[]>("subreddits", DEFAULT_SUBREDDITS);
        // Two queries a run, in rotation, so a continuous run looks somewhere new each time.
        const queries = await rotate(ctx, "query_i", ctx.config<string[]>("queries", DEFAULT_QUERIES), 2);
        const out: Candidate[] = [...pasted];
        for (const q of queries) {
          for (const p of await searchSubreddits(subs, q, 15)) {
            if (p.numComments > 60) continue; // a reply is lost in a huge thread
            out.push({ platform: "reddit", url: p.url, author: p.author, title: p.title, text: p.text, community: p.subreddit, promoAllowed: await promoAllowedIn(ctx, p.subreddit) });
          }
        }
        return out;
      },
    });
    return redditConfigured() ? r : { ...r, summary: `${r.summary} Searching Reddit needs the Reddit app keys (Reddit blocks AI web search); until then it only answers posts you paste in.` };
  },
};

function webAgent(o: { id: string; name: string; platform: Platform; purpose: string; ceiling: number; register: string; hour: number; length?: string; kind?: "reply" | "comment" }): AgentDef {
  return {
    ...base,
    id: o.id,
    name: o.name,
    schedule: { kind: "daily", hour: o.hour, minute: 0 },
    dailyUsd: 0.5,
    purpose: o.purpose,
    async run(ctx) {
      return runEngagement(ctx, {
        platform: o.platform,
        kind: o.kind ?? "reply",
        action: o.kind ?? "reply",
        ceiling: o.ceiling,
        register: o.register,
        length: o.length ?? (o.platform === "quora" ? "80 to 180 words, a real answer first" : "40 to 120 words"),
        label: (c) => `${o.name.replace(/ (Replies|Answers)$/, "")}: ${c.title.slice(0, 90)}`,
        person: (c) => (c.author && (o.platform === "threads" || o.platform === "x" || o.platform === "tiktok") ? { platform: o.platform, handle: normalizeHandle(o.platform, c.author) } : null),
        async find() {
          const pasted = fromInputs(await ctx.store.takeInputs([o.platform], 5, ctx.def.id), o.platform);
          const web = (await searchPlatform(ctx, o.platform, await nextTopics(ctx), 10)).map((w) => ({ ...w, promoAllowed: true }));
          return [...pasted, ...web];
        },
      });
    },
  };
}

export const threadsReplies = webAgent({ id: "replies-threads", name: "Threads Replies", platform: "threads", ceiling: 5, hour: 10, register: "Threads: short, warm, conversational.", purpose: "Finds Threads posts where SwiftCard would help and drafts a reply for you to post." });
export const quoraReplies = webAgent({ id: "replies-quora", name: "Quora Answers", platform: "quora", ceiling: 3, hour: 11, register: "Quora: a clear, useful answer; personal experience welcome.", purpose: "Finds Quora questions about business cards and link-in-bio tools and drafts an answer for you to post." });
export const ihReplies = webAgent({ id: "replies-indiehackers", name: "Indie Hackers", platform: "indiehackers", ceiling: 3, hour: 12, register: "Indie Hackers: founder to founder, honest, specific.", purpose: "Finds Indie Hackers threads about cards, link-in-bio and personal branding and drafts a reply." });

// Bluesky's search takes plain words or "phrases"; OR is not reliable there.
// Searched live 2026-10-22: hardly anyone there talks about card apps, and
// realtor / loan officer / recruiter searches return ads and listings. What
// does turn up is people about to hand out paper business cards at an event,
// and networking-event posts, so those lead. "linktree" / "link in bio" are
// artists linking their own pages, and are gone.
export const BLUESKY_QUERIES = ["\"business cards\"", "\"networking event\"", "\"QR code\" business", "\"digital business card\"", "\"business card app\"", "hihello", "blinq", "popl"];

/** One from each search in turn, so the 15 posts that get scored aren't all from the first search. */
export function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

/** Our own posts come back in search; never draft a reply to ourselves. */
export function isOwnBlueskyHandle(handle: string): boolean {
  return /swiftcard/i.test(handle);
}

export const blueskyReplies: AgentDef = {
  ...base,
  id: "replies-bluesky",
  name: "Bluesky Replies",
  schedule: { kind: "daily", hour: 15, minute: 0 },
  dailyUsd: 0.5,
  purpose: "Searches Bluesky for posts where SwiftCard would help and drafts a reply for you to post (most are just helpful, with no mention of SwiftCard).",
  async run(ctx) {
    return runEngagement(ctx, {
      platform: "bluesky",
      kind: "reply",
      action: "reply",
      ceiling: 5,
      // Bluesky is quick to block accounts that look like ads.
      register: "Bluesky: short, warm, conversational, under 300 characters (Bluesky's limit). No hashtags, no emoji.",
      length: "under 300 characters",
      label: (c) => `Bluesky${c.author ? ` @${c.author}` : ""}: ${c.title.slice(0, 90)}`,
      person: (c) => (c.author ? { platform: "bluesky", handle: normalizeHandle("bluesky", c.author) } : null),
      async find() {
        const pasted = fromInputs(await ctx.store.takeInputs(["bluesky"], 5, ctx.def.id), "bluesky");
        const perQuery: Candidate[][] = [];
        for (const q of await rotate(ctx, "query_i", ctx.config<string[]>("queries", BLUESKY_QUERIES), 3)) {
          perQuery.push(
            (await searchBluesky(q, 25, ctx.now()))
              .filter((p) => p.replyCount <= 40 && !isOwnBlueskyHandle(p.author)) // lost in a huge thread, or our own post
              .map((p) => ({ platform: "bluesky" as const, url: p.url, author: p.author, title: p.title, text: p.text, community: null, promoAllowed: true })),
          );
        }
        return [...pasted, ...interleave(perQuery)];
      },
    });
  },
};

export const facebookReplies: AgentDef = {
  ...base,
  id: "replies-facebook",
  continuous: false,
  name: "Facebook Groups",
  schedule: { kind: "on_input", platforms: ["facebook"] },
  dailyUsd: 0.4,
  purpose: "Drafts replies to Facebook group posts you paste in (Facebook doesn't let apps read groups).",
  async run(ctx) {
    return runEngagement(ctx, {
      platform: "facebook",
      kind: "reply",
      action: "reply",
      ceiling: 5,
      register: "Facebook group: friendly, neighborly, plain.",
      length: "30 to 100 words",
      keywordFilter: false,
      label: (c) => `Facebook group: ${c.title.slice(0, 90)}`,
      find: async () => fromInputs(await ctx.store.takeInputs(["facebook"], 6, ctx.def.id), "facebook"),
    });
  },
};

export const instagramComments: AgentDef = {
  ...base,
  economyTier: "haiku",
  id: "replies-instagram",
  name: "Instagram Comments",
  continuous: false,
  approvalKind: "comment",
  schedule: { kind: "daily", hour: 13, minute: 0 },
  dailyUsd: 0.5,
  purpose: "Drafts 3 to 5 useful comments a day on business pros' public posts (most don't mention SwiftCard), plus a list of 20 to 30 accounts to follow.",
  async run(ctx) {
    const follow = await followList(ctx);
    const r = await runEngagement(ctx, {
      platform: "instagram",
      kind: "comment",
      action: "comment",
      ceiling: 5,
      register: "Instagram comment: warm, specific to the post, no hashtags.",
      length: "40 words or less",
      keywordFilter: false,
      label: (c) => `Instagram comment${c.author ? ` on @${c.author}` : ""}: ${c.title.slice(0, 70)}`,
      person: (c) => (c.author ? { platform: "instagram", handle: c.author } : null),
      find: async () => fromInputs(await ctx.store.takeInputs(["instagram"], 6, ctx.def.id), "instagram"),
    });
    return { summary: `${r.summary}${follow ? ` ${follow}` : ""}` };
  },
};

/** Weekly: suggest business pros to follow, until 30 have been suggested. */
async function followList(ctx: AgentContext): Promise<string | null> {
  const suggested = ctx.config<string[]>("follow_suggested", []);
  const lastAt = ctx.config<number>("follow_at", 0);
  if (suggested.length >= 30 || Date.now() - lastAt < 7 * 86400_000) return null;
  const found = await searchPlatform(ctx, "instagram", ["realtors, recruiters, loan officers, sales coaches, plumbers, window washers or landscapers who post about their business (public profiles, no law firms)"], 15);
  const handles = [...new Set(found.map((f) => f.author || f.url.match(/instagram\.com\/([A-Za-z0-9._]+)/)?.[1] || "").filter(Boolean).map((h) => normalizeHandle("instagram", h)))].filter((h) => !suggested.includes(h)).slice(0, 30 - suggested.length);
  await ctx.saveConfig({ follow_at: Date.now(), follow_suggested: [...suggested, ...handles] });
  if (!handles.length) return null;
  await propose(ctx, {
    kind: "ask",
    title: `Instagram: ${handles.length} business accounts worth following`,
    summary: "Follow these from your Instagram account, a few a day. Paste their posts into Paste a post when you want a comment drafted.",
    body: handles.map((h) => `https://instagram.com/${h.replace(/^@/, "")}`).join("\n"),
    platform: "instagram",
  });
  return `Suggested ${handles.length} accounts to follow.`;
}

export const linkedinComments: AgentDef = {
  ...base,
  economyTier: "haiku",
  id: "replies-linkedin",
  name: "LinkedIn Comments",
  approvalKind: "comment",
  schedule: { kind: "daily", hour: 14, minute: 0 },
  dailyUsd: 0.5,
  purpose: "Drafts insightful comments on specific LinkedIn posts by business pros, for you to post.",
  async run(ctx) {
    return runEngagement(ctx, {
      platform: "linkedin",
      kind: "comment",
      action: "comment",
      ceiling: 5,
      register: "LinkedIn: thoughtful, specific to THIS post, adds a real point of view. First person, no hashtags.",
      length: "25 to 70 words",
      keywordFilter: false,
      label: (c) => `LinkedIn comment${c.author ? ` for ${c.author}` : ""}: ${c.title.slice(0, 70)}`,
      async find() {
        const pasted = fromInputs(await ctx.store.takeInputs(["linkedin"], 5, ctx.def.id), "linkedin");
        const web = (await searchPlatform(ctx, "linkedin", (await nextTopics(ctx)).map((t) => `LinkedIn posts by ${t}`), 10)).map((w) => ({ ...w, promoAllowed: true }));
        return [...pasted, ...web];
      },
    });
  },
};

// Hacker News: the free Algolia search over every story and comment. HN is
// allergic to promotion, so SwiftCard comes up in at most one reply in four,
// and only when someone asked for a tool. Each row opens the exact comment
// (news.ycombinator.com/item?id=…), which has its own reply box.
export const HN_QUERIES = ["\"business card\"", "\"business cards\"", "\"networking event\"", "\"follow up\" leads", "linktree", "\"link in bio\"", "\"contact info\" QR", "hihello OR blinq OR popl", "\"personal CRM\"", "\"trade show\" leads"];

export const hackerNewsReplies: AgentDef = {
  ...base,
  id: "replies-hackernews",
  name: "Hacker News",
  schedule: { kind: "daily", hour: 12, minute: 30 },
  dailyUsd: 0.4,
  purpose: "Finds Hacker News stories and comments about business cards, networking follow ups and link pages, and writes a genuinely useful reply with the exact comment link.",
  async run(ctx) {
    return runEngagement(ctx, {
      platform: "hackernews",
      kind: "reply",
      action: "reply",
      ceiling: 3,
      register: "Hacker News: precise, technical where it helps, zero marketing tone, no greeting, no sign-off, plain text only.",
      length: "40 to 120 words",
      label: (c) => `Hacker News: ${c.title.slice(0, 90)}`,
      person: (c) => (c.author ? { platform: "hackernews", handle: c.author } : null),
      async find() {
        const out: Candidate[] = [];
        for (const q of await rotate(ctx, "query_i", ctx.config<string[]>("queries", HN_QUERIES), 2)) {
          for (const h of await searchHackerNews(q, 20, ctx.now())) out.push({ platform: "hackernews", url: h.url, author: h.author, title: h.title, text: h.text, community: h.kind === "comment" ? "comment" : "story", promoAllowed: true });
        }
        return out;
      },
    });
  },
};

// X and TikTok (owner, 2026-10-29): found through web search, free, so a few
// posts a run rather than hundreds; X's own search API would cost about $200 a
// month and the owner chose the free way.
export const xReplies = webAgent({ id: "replies-x", name: "X Replies", platform: "x", ceiling: 8, hour: 11, length: "15 to 45 words, under 280 characters", register: "X: short and punchy, like a real reply under a tweet. No greeting.", purpose: "Finds posts on X about business cards, link in bio pages and following up with leads, and writes a reply that brings up SwiftCard. The link opens the post." });
export const tiktokComments = webAgent({ id: "replies-tiktok", name: "TikTok Comments", platform: "tiktok", kind: "comment", ceiling: 6, hour: 13, length: "10 to 35 words", register: "TikTok comment: casual, quick, like a real viewer who has something useful to add.", purpose: "Finds TikTok videos about networking, business cards and link in bio pages, and writes a comment that brings up SwiftCard. The link opens the video." });

export const REPLIES: AgentDef[] = [redditReplies, xReplies, threadsReplies, blueskyReplies, facebookReplies, quoraReplies, ihReplies, instagramComments, tiktokComments, linkedinComments, hackerNewsReplies];
