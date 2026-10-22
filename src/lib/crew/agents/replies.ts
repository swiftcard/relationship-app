import type { AgentDef } from "../agent-def";
import type { AgentContext } from "../context";
import { propose } from "../approvals";
import { normalizeHandle } from "../ledger";
import { runEngagement, type Candidate } from "../replies/engine";
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

const base = {
  team: "replies" as const,
  role: "worker" as const,
  tier: "sonnet" as const,
  needs: ["CREW_ANTHROPIC_API_KEY" as const],
  maxPending: 5,
  approvalKind: "reply" as const,
};

export const redditReplies: AgentDef = {
  ...base,
  id: "replies-reddit",
  name: "Reddit replies",
  schedule: { kind: "daily", hour: 9, minute: 0 },
  dailyUsd: 0.6,
  purpose: "Finds Reddit threads where SwiftCard would help, or people complaining about a competitor, and drafts a reply for you to post.",
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
        const queries = ctx.config<string[]>("queries", DEFAULT_QUERIES);
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
    return redditConfigured() ? r : { summary: `${r.summary} Searching Reddit needs the Reddit app keys (Reddit blocks AI web search); until then it only answers posts you paste in.` };
  },
};

function webAgent(o: { id: string; name: string; platform: Platform; purpose: string; ceiling: number; register: string; hour: number }): AgentDef {
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
        kind: "reply",
        action: "reply",
        ceiling: o.ceiling,
        register: o.register,
        length: o.platform === "quora" ? "80 to 180 words, a real answer first" : "40 to 120 words",
        label: (c) => `${o.name.replace(/ replies$/, "")}: ${c.title.slice(0, 90)}`,
        person: (c) => (c.author && o.platform === "threads" ? { platform: "threads", handle: normalizeHandle("threads", c.author) } : null),
        async find() {
          const pasted = fromInputs(await ctx.store.takeInputs([o.platform], 5, ctx.def.id), o.platform);
          const web = (await searchPlatform(ctx, o.platform, TOPICS, 10)).map((w) => ({ ...w, promoAllowed: true }));
          return [...pasted, ...web];
        },
      });
    },
  };
}

export const threadsReplies = webAgent({ id: "replies-threads", name: "Threads replies", platform: "threads", ceiling: 5, hour: 10, register: "Threads: short, warm, conversational.", purpose: "Finds Threads posts where SwiftCard would help and drafts a reply for you to post." });
export const quoraReplies = webAgent({ id: "replies-quora", name: "Quora answers", platform: "quora", ceiling: 3, hour: 11, register: "Quora: a clear, useful answer; personal experience welcome.", purpose: "Finds Quora questions about business cards and link-in-bio tools and drafts an answer for you to post." });
export const ihReplies = webAgent({ id: "replies-indiehackers", name: "Indie Hackers replies", platform: "indiehackers", ceiling: 3, hour: 12, register: "Indie Hackers: founder to founder, honest, specific.", purpose: "Finds Indie Hackers threads about cards, link-in-bio and personal branding and drafts a reply." });

// Bluesky's search takes plain words or "phrases"; OR is not reliable there.
// Highest signal first: only the first 15 on-topic posts are scored, and
// "linktree" / "link in bio" are mostly artists linking their own pages (seen
// live 2026-10-21).
export const BLUESKY_QUERIES = ["\"digital business card\"", "\"business card app\"", "\"business cards\" networking", "hihello", "blinq", "popl", "linktree", "\"link in bio\""];

/** Our own posts come back in search; never draft a reply to ourselves. */
export function isOwnBlueskyHandle(handle: string): boolean {
  return /swiftcard/i.test(handle);
}

export const blueskyReplies: AgentDef = {
  ...base,
  id: "replies-bluesky",
  name: "Bluesky replies",
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
      pitchShare: 1 / 3,
      register: "Bluesky: short, warm, conversational, under 300 characters (Bluesky's limit). No hashtags, no emoji.",
      length: "under 300 characters",
      label: (c) => `Bluesky${c.author ? ` @${c.author}` : ""}: ${c.title.slice(0, 90)}`,
      person: (c) => (c.author ? { platform: "bluesky", handle: normalizeHandle("bluesky", c.author) } : null),
      async find() {
        const pasted = fromInputs(await ctx.store.takeInputs(["bluesky"], 5, ctx.def.id), "bluesky");
        const out: Candidate[] = [...pasted];
        for (const q of ctx.config<string[]>("queries", BLUESKY_QUERIES)) {
          for (const p of await searchBluesky(q, 25, ctx.now())) {
            if (p.replyCount > 40 || isOwnBlueskyHandle(p.author)) continue; // lost in a huge thread, or our own post
            out.push({ platform: "bluesky", url: p.url, author: p.author, title: p.title, text: p.text, community: null, promoAllowed: true });
          }
        }
        return out;
      },
    });
  },
};

export const facebookReplies: AgentDef = {
  ...base,
  id: "replies-facebook",
  name: "Facebook group replies",
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
  name: "Instagram comments",
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
      pitchShare: 1 / 3,
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
  name: "LinkedIn comments",
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
      pitchShare: 1 / 3,
      register: "LinkedIn: thoughtful, specific to THIS post, adds a real point of view. First person, no hashtags.",
      length: "25 to 70 words",
      keywordFilter: false,
      label: (c) => `LinkedIn comment${c.author ? ` for ${c.author}` : ""}: ${c.title.slice(0, 70)}`,
      async find() {
        const pasted = fromInputs(await ctx.store.takeInputs(["linkedin"], 5, ctx.def.id), "linkedin");
        const web = (await searchPlatform(ctx, "linkedin", ["posts by realtors, recruiters, sales coaches or small business owners about networking, personal branding or getting more leads"], 10)).map((w) => ({ ...w, promoAllowed: true }));
        return [...pasted, ...web];
      },
    });
  },
};

export const REPLIES: AgentDef[] = [redditReplies, threadsReplies, blueskyReplies, facebookReplies, quoraReplies, ihReplies, instagramComments, linkedinComments];
