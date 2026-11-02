import type { AgentContext } from "../context";
import type { Platform } from "../types";

// ── Finding public posts through web search ─────────────────────────────────
// For platforms with no API we may read (Threads before Meta approves keyword
// search, Quora, Indie Hackers, public LinkedIn posts), the agent asks Claude's
// web_search tool, i.e. a search engine's public index, restricted to that
// platform's domain. No logging in, no scraping the platform itself.

export type FoundPost = { platform: Platform; url: string; author: string | null; title: string; text: string; community: string | null };

const DOMAINS: Partial<Record<Platform, string[]>> = {
  // Anthropic's search refuses threads.net (seen live 2026-10-20); Threads
  // now lives on threads.com.
  threads: ["threads.com"],
  quora: ["quora.com"],
  indiehackers: ["indiehackers.com"],
  linkedin: ["linkedin.com"],
  instagram: ["instagram.com"],
  x: ["x.com", "twitter.com"],
  tiktok: ["tiktok.com"],
  // Public Facebook group posts, when the search engine has them (2026-10-29;
  // most groups are private, so pasted posts still come first).
  facebook: ["facebook.com"],
};

/** Results one search call asks for: 100 messages a day per agent (owner, 2026-10-29) needs full pages, not a handful. */
export const SEARCH_WANT = 25;

/** Live-tested 2026-10-20: asking for free-form JSON with web search came back
 *  in pieces around the search steps (or as "[]"). A required JSON shape
 *  (structured output) always arrives as one valid block, so every web-search
 *  agent goes through here. */
export async function searchItems<T extends Record<string, string>>(
  ctx: AgentContext,
  o: { system: string; prompt: string; fields: (keyof T & string)[]; domains?: string[]; maxUses?: number; want?: number },
): Promise<T[]> {
  const want = o.want ?? 10;
  const out = await ctx.llm.askJson<{ items: T[] }>("discover", {
    // Medium, not low: at low effort the search gave up after one failed
    // filtering step and answered with nothing.
    effort: "medium",
    maxTokens: 6000,
    // The search step re-runs queries inside its own filtering code, which
    // uses up searches; 3 often ran out with only a few results (seen live).
    webSearch: { maxUses: o.maxUses ?? 6, ...(o.domains ? { allowedDomains: o.domains } : {}) },
    system: `${o.system} Only report what the search results actually show; never invent a URL. Use an empty string for anything the results don't show.`,
    prompt: `${o.prompt}\nFind as many as you can, up to ${want}; if a search finds few, try up to two different searches before answering.`,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: { type: "object", additionalProperties: false, required: o.fields, properties: Object.fromEntries(o.fields.map((f) => [f, { type: "string" }])) },
        },
      },
    },
  });
  return (out?.items ?? []).slice(0, want);
}

export function onDomain(url: string, domains: string[]): boolean {
  try {
    const h = new URL(url).hostname;
    return domains.some((d) => h === d || h.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

export async function searchPlatform(ctx: AgentContext, platform: Platform, topics: string[], n = SEARCH_WANT, o?: { maxUses?: number }): Promise<FoundPost[]> {
  const domains = DOMAINS[platform];
  if (!domains) return [];
  const items = await searchItems<{ url: string; author: string; title: string; text: string; community: string }>(ctx, {
    system: "You find recent public posts for a small company's staff to read and answer by hand.",
    // The handle matters: a message needs the account it goes to, and a found
    // post without one is dropped (seen live 2026-10-29: every Instagram
    // result came back with a display name only, so all of them were lost).
    prompt: `Search ${domains[0]} for recent public posts or profiles about any of these topics:\n${topics.map((t) => `- ${t}`).join("\n")}\nFor each: url (the exact link as the result shows it), author (the account's @handle exactly as the result shows it, in the link or in a title like "Name (@handle)"; only when no handle shows, their name), title, text (the post's or profile's own words from the result, under 400 characters), community (group or subreddit, or empty).`,
    fields: ["url", "author", "title", "text", "community"],
    domains,
    maxUses: o?.maxUses ?? 8,
    want: n,
  }).catch((e) => {
    // A site that blocks Anthropic's crawler (Reddit does) fails the whole
    // request. The agent then works from pasted posts instead of erroring.
    if (blockedDomain(e)) {
      ctx.log(`web search can't read ${domains.join(", ")}; only pasted posts this run`);
      return [];
    }
    throw e;
  });
  return items
    .filter((x) => onDomain(x.url, domains))
    .map((x) => ({ platform, url: x.url, author: x.author || null, title: x.title.slice(0, 200), text: x.text.slice(0, 600), community: x.community || null }));
}

/**
 * Reddit threads through an open web search (no domain filter: Anthropic's
 * search refuses reddit.com as a filter, seen live 2026-10-20), for when the
 * Reddit app keys aren't set. Only real thread links are kept; a search that
 * returns none costs one call and the agent rests.
 */
export async function searchRedditByWeb(ctx: AgentContext, topics: string[], n = SEARCH_WANT): Promise<FoundPost[]> {
  const items = await searchItems<{ url: string; author: string; title: string; text: string; community: string }>(ctx, {
    system: "You find recent public Reddit threads for a small company's staff to read and answer by hand.",
    prompt: `Search the web for recent Reddit threads (links like reddit.com/r/<subreddit>/comments/...) where people talk about any of these:\n${topics.map((t) => `- ${t}`).join("\n")}\nTry searches like: site:reddit.com <topic>. For each thread: url (the reddit.com/r/.../comments/... link exactly as shown), author (the u/ username if shown, else empty), title, text (what the result shows of the post, under 300 characters), community (the subreddit name without r/).`,
    fields: ["url", "author", "title", "text", "community"],
    maxUses: 8,
    want: n,
  }).catch((e) => {
    if (blockedDomain(e)) {
      ctx.log("web search can't read reddit.com; only pasted posts this run");
      return [];
    }
    throw e;
  });
  return items
    .filter((x) => onDomain(x.url, ["reddit.com"]))
    .map((x) => ({ platform: "reddit" as const, url: x.url, author: x.author.replace(/^\/?u\//i, "") || null, title: x.title.slice(0, 200), text: x.text.slice(0, 600), community: x.community.replace(/^\/?r\//i, "") || null }));
}

/** "The following domains are not accessible to our user agent" (HTTP 400). */
export function blockedDomain(e: unknown): boolean {
  return /not accessible to our user agent/i.test(e instanceof Error ? e.message : String(e));
}
