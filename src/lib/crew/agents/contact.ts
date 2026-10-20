import type { AgentDef } from "../agent-def";
import type { AgentContext } from "../context";
import { normalizeHandle } from "../ledger";
import { runEngagement, type Candidate } from "../replies/engine";
import { redditConfigured, searchSubreddits } from "../sources/reddit";
import { searchPlatform } from "../sources/web-discovery";
import type { CrewInput, Platform } from "../types";
import { DEFAULT_SUBREDDITS, guessAuthor } from "./replies";

// ── Team 2: Contact (the team that DMs) ─────────────────────────────────────
// Every message is a DRAFT a person sends by hand from their own account:
// Instagram only lets apps message people who wrote first, LinkedIn's
// messaging API is partner-only and needs a member action, Reddit chat has no
// API, Alignable has none at all. The HARD rule holds across every team and
// platform: nobody we have replied to or contacted is ever drafted a DM
// (crew_claim_dm). Business professionals only.

export const LINK_IN_BIO = /linktr\.ee|linktree|hoo\.be|hoobe|link\.me\b/i;

const REDDIT_DM_QUERIES = ["\"link in bio\" recommend", "\"good link in bio\"", "linktree expensive", "\"digital business card\" recommend", "hihello OR blinq OR popl price"];

function pasted(inputs: CrewInput[], platform: Platform): Candidate[] {
  return inputs.map((i) => ({
    platform,
    url: i.url ?? `paste:${i.id}`,
    author: guessAuthor(i.text, platform) ?? (i.url ? handleFromUrl(platform, i.url) : null),
    title: i.text.split("\n")[0].slice(0, 140),
    text: i.text,
    community: null,
    promoAllowed: true,
    fromPaste: true,
  }));
}

export function handleFromUrl(platform: Platform, url: string): string | null {
  const re: Partial<Record<Platform, RegExp>> = {
    instagram: /instagram\.com\/([A-Za-z0-9._]+)/i,
    linkedin: /linkedin\.com\/in\/([^/?#]+)/i,
    alignable: /alignable\.com\/([^?#]+)/i,
    reddit: /reddit\.com\/u(?:ser)?\/([A-Za-z0-9_-]+)/i,
  };
  const m = re[platform] ? url.match(re[platform]!) : null;
  if (!m || ["p", "reel", "explore", "stories"].includes(m[1])) return null;
  return m[1];
}

const base = {
  team: "contact" as const,
  role: "worker" as const,
  tier: "sonnet" as const,
  needs: ["CREW_ANTHROPIC_API_KEY" as const],
  maxPending: 6,
  approvalKind: "dm" as const,
};

export const redditDms: AgentDef = {
  ...base,
  id: "contact-reddit",
  name: "Reddit DMs",
  schedule: { kind: "daily", hour: 10, minute: 30 },
  dailyUsd: 0.6,
  purpose: "Drafts up to 10 tailored DMs a day to people on Reddit asking for a link-in-bio or card tool, or complaining about a competitor. You send them by hand.",
  async run(ctx) {
    return runEngagement(ctx, {
      platform: "reddit",
      kind: "dm",
      action: "dm",
      ceiling: 10,
      mustBePro: true,
      register: "Reddit chat: casual and brief, like a person who read their post. Use their complaint or question to explain the one SwiftCard strength that matches it.",
      length: "35 to 80 words",
      label: (c) => `Reddit DM to u/${c.author}: ${c.title.slice(0, 80)}`,
      person: (c) => (c.author ? { platform: "reddit", handle: `u/${c.author}` } : null),
      async find() {
        const out: Candidate[] = pasted(await ctx.store.takeInputs(["reddit"], 3, ctx.def.id), "reddit");
        if (!redditConfigured()) return [...out, ...(await searchPlatform(ctx, "reddit", ["asking for a link in bio tool or digital business card app", "complaining about Linktree, HiHello, Blinq, Popl or Link.me price"], 10)).map((w) => ({ ...w, promoAllowed: true }))];
        for (const q of REDDIT_DM_QUERIES) {
          for (const p of await searchSubreddits(ctx.config<string[]>("subreddits", DEFAULT_SUBREDDITS), q, 10)) {
            out.push({ platform: "reddit", url: p.url, author: p.author, title: p.title, text: p.text, community: p.subreddit, promoAllowed: true });
          }
        }
        return out;
      },
    });
  },
};

async function igCandidates(ctx: AgentContext, topic: string): Promise<Candidate[]> {
  const fromPaste = pasted(await ctx.store.takeInputs(["instagram"], 5, ctx.def.id), "instagram");
  const web = (await searchPlatform(ctx, "instagram", [topic], 10)).map((w) => ({ ...w, author: w.author ?? handleFromUrl("instagram", w.url), promoAllowed: true }));
  return [...fromPaste, ...web].filter((c) => !!c.author);
}

export const instagramDms: AgentDef = {
  ...base,
  id: "contact-instagram",
  name: "Instagram DMs",
  schedule: { kind: "daily", hour: 15, minute: 0 },
  dailyUsd: 0.6,
  purpose: "Drafts tailored Instagram DMs to business professionals, about something they actually posted. You send them by hand.",
  async run(ctx) {
    return runEngagement(ctx, {
      platform: "instagram",
      kind: "dm",
      action: "dm",
      ceiling: 10,
      mustBePro: true,
      keywordFilter: false,
      register: "Instagram DM: warm, brief, about one specific post of theirs.",
      length: "35 to 80 words",
      label: (c) => `Instagram DM to @${normalizeHandle("instagram", c.author ?? "").replace(/^@/, "")}`,
      person: (c) => (c.author ? { platform: "instagram", handle: c.author } : null),
      find: () => igCandidates(ctx, "public posts by realtors, recruiters, loan officers, sales coaches, wholesalers or local service businesses (plumbers, window washers, landscapers) about their work. No law firms."),
    });
  },
};

export const instagramSwitchers: AgentDef = {
  ...base,
  id: "contact-instagram-linkinbio",
  name: "Instagram link-in-bio switchers",
  schedule: { kind: "daily", hour: 15, minute: 30 },
  dailyUsd: 0.6,
  purpose: "Finds business pros with a Linktree, Hoobe or Link.me link in their bio and drafts a DM on why SwiftCard does more (link page plus business card).",
  async run(ctx) {
    return runEngagement(ctx, {
      platform: "instagram",
      kind: "dm",
      action: "dm_switch",
      ceiling: 10,
      mustBePro: true,
      keywordFilter: false,
      register: "Instagram DM: warm and brief. Mention that their bio uses a link page, and that SwiftCard gives the same link page plus a digital business card. No hard sell.",
      length: "35 to 80 words",
      label: (c) => `Instagram DM to @${normalizeHandle("instagram", c.author ?? "").replace(/^@/, "")} (uses a link-in-bio tool)`,
      person: (c) => (c.author ? { platform: "instagram", handle: c.author } : null),
      async find() {
        const all = await igCandidates(ctx, "Instagram profiles of realtors, recruiters, loan officers or local service businesses whose bio links to linktr.ee, hoo.be or link.me");
        return all.filter((c) => LINK_IN_BIO.test(`${c.title} ${c.text}`));
      },
    });
  },
};

export const linkedinConnect: AgentDef = {
  ...base,
  id: "contact-linkedin",
  name: "LinkedIn connections",
  approvalKind: "connect_note",
  schedule: { kind: "daily", hour: 11, minute: 30 },
  dailyUsd: 0.6,
  purpose: "Picks a few new business pros a day and drafts a very specific connection note and a follow-up message. You send them from LinkedIn.",
  async run(ctx) {
    return runEngagement(ctx, {
      platform: "linkedin",
      kind: "connect_note",
      action: "connect",
      ceiling: 8,
      mustBePro: true,
      keywordFilter: false,
      register:
        "LinkedIn. Write TWO parts separated by a blank line and the line 'After they accept:'. Part 1, the connection note: under 200 characters, about one specific thing they did or posted, no pitch. Part 2, the follow-up message: under 90 words, specific to what they do, and only then how SwiftCard could help grow their personal brand. It must not sound written by AI.",
      length: "note under 200 characters, message under 90 words",
      label: (c) => `LinkedIn: connect with ${c.author ?? "a business pro"}`,
      person: (c) => {
        const h = c.author && /^[a-z0-9-]+$/i.test(c.author) ? c.author : handleFromUrl("linkedin", c.url);
        return h ? { platform: "linkedin", handle: h, name: c.author } : null;
      },
      async find() {
        const fromPaste = pasted(await ctx.store.takeInputs(["linkedin"], 5, ctx.def.id), "linkedin");
        const web = (await searchPlatform(ctx, "linkedin", ["recent posts or profiles of realtors, recruiters, sales coaches, loan officers or small business owners building a personal brand (no lawyers)"], 10)).map((w) => ({ ...w, promoAllowed: true }));
        return [...fromPaste, ...web];
      },
    });
  },
};

export const alignableMessages: AgentDef = {
  ...base,
  id: "contact-alignable",
  name: "Alignable messages",
  schedule: { kind: "on_input", platforms: ["alignable"] },
  dailyUsd: 0.4,
  purpose: "Drafts personable, non-pitchy Alignable messages to the profiles you paste in (Alignable has no API).",
  async run(ctx) {
    return runEngagement(ctx, {
      platform: "alignable",
      kind: "dm",
      action: "dm",
      ceiling: 10,
      keywordFilter: false,
      register: "Alignable: a neighborly local-business owner saying hello. Personal, human, about their business. No pitch at all.",
      length: "35 to 80 words",
      label: (c) => `Alignable: say hello to ${c.author ?? "a local business"}`,
      // Alignable profile URL when pasted; otherwise the business name on the
      // first line, so the same business is still one person in the ledger.
      person: (c) => {
        const h = (c.url.startsWith("paste:") ? null : handleFromUrl("alignable", c.url)) ?? c.title.trim().toLowerCase().slice(0, 80);
        return h ? { platform: "alignable", handle: h, name: c.author ?? c.title.slice(0, 80) } : null;
      },
      find: async () => pasted(await ctx.store.takeInputs(["alignable"], 6, ctx.def.id), "alignable").map((c) => ({ ...c, promoAllowed: false })),
    });
  },
};

export const CONTACT: AgentDef[] = [redditDms, instagramDms, instagramSwitchers, linkedinConnect, alignableMessages];
