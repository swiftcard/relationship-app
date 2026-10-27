import type { AgentDef } from "../agent-def";
import type { AgentContext } from "../context";
import { normalizeHandle } from "../ledger";
import { exactProfileLink, instagramHandle } from "../exact-links";
import { pairs, rotate, runEngagement, type Candidate } from "../replies/engine";
import { PROFESSIONS, US_METROS } from "../search-plan";
import { redditConfigured, searchSubreddits } from "../sources/reddit";
import { searchItems, searchPlatform } from "../sources/web-discovery";
import type { CrewInput, Platform } from "../types";
import { DEFAULT_SUBREDDITS, SHEET_MAX_PENDING, guessAuthor } from "./replies";

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
  maxPending: SHEET_MAX_PENDING,
  approvalKind: "dm" as const,
  continuous: true,
};

/** The next profession and city to look in (an endless rotation, remembered per agent). */
async function nextWhoWhere(ctx: AgentContext): Promise<{ who: string; where: string }> {
  const [[who, where]] = await rotate(ctx, "where_i", pairs(PROFESSIONS, US_METROS), 1);
  return { who, where };
}

export const redditDms: AgentDef = {
  ...base,
  id: "contact-reddit",
  name: "Reddit DMs",
  schedule: { kind: "daily", hour: 10, minute: 30 },
  dailyUsd: 0.6,
  purpose: "Finds people on Reddit asking for a card or link page tool, or unhappy with a competitor, and writes them a short private message. The link opens Reddit's message screen to that person.",
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
        // Reddit blocks Anthropic's web search: without the API keys, pasted posts only.
        if (!redditConfigured()) return out;
        for (const q of await rotate(ctx, "query_i", REDDIT_DM_QUERIES, 2)) {
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
  const web = (await searchPlatform(ctx, "instagram", [topic], 10)).map((w) => ({ ...w, author: instagramHandle(w.author) ?? handleFromUrl("instagram", w.url), promoAllowed: true }));
  return [...fromPaste, ...web].filter((c) => !!c.author);
}

export const instagramDms: AgentDef = {
  ...base,
  id: "contact-instagram",
  name: "Instagram DMs",
  schedule: { kind: "daily", hour: 15, minute: 0 },
  dailyUsd: 0.6,
  purpose: "Finds business professionals' recent Instagram posts and writes each a short DM about that post. The link opens the chat with them in the Instagram app.",
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
      async find() {
        const { who, where } = await nextWhoWhere(ctx);
        return igCandidates(ctx, `recent public Instagram posts (instagram.com/p/ or /reel/ links) by ${who} in ${where} about their work. For author give their @username. No law firms.`);
      },
    });
  },
};

/** A professional whose Instagram bio links to their LinkedIn, as web search shows it. */
type BioHit = { username: string; name: string; occupation: string; company: string; location: string; linkedin_url: string; bio: string };

const LINKEDIN_IN = /linkedin\.com\/in\/[\w%.-]+/i;

/** Keep only real profiles whose bio links a real LinkedIn profile. */
export function bioCandidates(hits: BioHit[]): Candidate[] {
  const out: Candidate[] = [];
  for (const h of hits) {
    const handle = instagramHandle(h.username);
    const inBio = LINKEDIN_IN.exec(h.bio)?.[0];
    const linkedin = exactProfileLink("linkedin", h.linkedin_url) ?? (inBio ? exactProfileLink("linkedin", `https://www.${inBio}`) : null);
    if (!handle || !linkedin) continue;
    out.push({
      platform: "instagram",
      url: `https://www.instagram.com/${handle}/`,
      author: handle,
      title: [h.name, h.occupation].filter(Boolean).join(", ") || `@${handle}`,
      text: h.bio.slice(0, 600),
      community: null,
      promoAllowed: true,
      extra: { name: h.name.slice(0, 80), occupation: h.occupation.slice(0, 80), company: h.company.slice(0, 120), location: h.location.slice(0, 80), linkedin },
    });
  }
  return out;
}

export const instagramLinkedinBio: AgentDef = {
  ...base,
  id: "contact-instagram-linkinbio",
  name: "Instagram LinkedIn Bio",
  schedule: { kind: "daily", hour: 15, minute: 30 },
  dailyUsd: 0.8,
  purpose: "Finds realtors, insurance agents, loan officers and other professionals whose Instagram bio links to their LinkedIn, and writes each one a short message built on what their bio says. The link opens the chat with them in the Instagram app.",
  async run(ctx) {
    return runEngagement(ctx, {
      platform: "instagram",
      kind: "dm",
      action: "dm_linkedin_bio",
      ceiling: 10,
      mustBePro: true,
      keywordFilter: false,
      linkKind: "profile",
      register:
        "Instagram DM: warm, brief, written like a quick text. Open with something specific from their bio or their work (their niche, their area, their brokerage, something they're proud of). They send people from Instagram to LinkedIn, so being easy to find and remembered matters to them; if SwiftCard comes up, connect it to that in your own words (one tap saves their contact with everything, LinkedIn included) without listing features. Ask one easy question.",
      length: "30 to 70 words",
      label: (c) => `Instagram DM to @${c.author} (LinkedIn in bio)`,
      person: (c) => (c.author ? { platform: "instagram", handle: c.author, name: c.extra?.name || null } : null),
      async find() {
        const fromPaste = pasted(await ctx.store.takeInputs(["instagram"], 3, ctx.def.id), "instagram").filter((c) => LINKEDIN_IN.test(c.text));
        const { who, where } = await nextWhoWhere(ctx);
        const hits = await searchItems<BioHit>(ctx, {
          system: "You find public Instagram profiles of working professionals from web search results.",
          prompt: `Find Instagram profiles (instagram.com/<username>) of ${who} in or near ${where} whose Instagram bio contains a link to their LinkedIn profile (linkedin.com/in/...). Search for example: site:instagram.com "linkedin.com/in" ${who} ${where}. For each profile: username (without @), name, occupation, company (brokerage, agency or business, if shown), location, linkedin_url (the linkedin.com/in/ link in the bio, exactly as shown), bio (the bio text as shown, under 400 characters). Skip anyone whose bio has no LinkedIn link. No law firms, no students.`,
          fields: ["username", "name", "occupation", "company", "location", "linkedin_url", "bio"],
          domains: ["instagram.com"],
          maxUses: 5,
          want: 12,
        }).catch(() => [] as BioHit[]);
        return [...fromPaste, ...bioCandidates(hits)];
      },
    });
  },
};

export const linkedinConnect: AgentDef = {
  ...base,
  id: "contact-linkedin",
  name: "LinkedIn Connections",
  approvalKind: "connect_note",
  schedule: { kind: "daily", hour: 11, minute: 30 },
  dailyUsd: 0.6,
  purpose: "Finds business professionals on LinkedIn and writes a very specific connection note plus a follow up message for after they accept. The link opens their profile, where the Connect button is.",
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
      linkKind: "profile",
      async find() {
        const fromPaste = pasted(await ctx.store.takeInputs(["linkedin"], 5, ctx.def.id), "linkedin");
        const { who, where } = await nextWhoWhere(ctx);
        const hits = await searchItems<{ url: string; name: string; headline: string; location: string; detail: string }>(ctx, {
          system: "You find public LinkedIn profiles of working professionals from web search results.",
          prompt: `Find LinkedIn profiles (linkedin.com/in/...) of ${who} in or near ${where} who post about their work or build a personal brand. No lawyers, no students. For each: url (the linkedin.com/in/ profile link exactly as shown), name, headline, location, detail (one specific, checkable thing from the result: a recent post topic, a niche, an award, years in business).`,
          fields: ["url", "name", "headline", "location", "detail"],
          domains: ["linkedin.com"],
          maxUses: 5,
          want: 10,
        }).catch(() => []);
        const web: Candidate[] = hits.map((h) => ({ platform: "linkedin", url: h.url, author: h.name || null, title: [h.name, h.headline].filter(Boolean).join(", "), text: h.detail, community: null, promoAllowed: true, extra: { name: h.name, occupation: h.headline, location: h.location } }));
        return [...fromPaste, ...web];
      },
    });
  },
};

export const alignableMessages: AgentDef = {
  ...base,
  id: "contact-alignable",
  name: "Alignable",
  continuous: false,
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

export const CONTACT: AgentDef[] = [redditDms, instagramDms, instagramLinkedinBio, linkedinConnect, alignableMessages];
