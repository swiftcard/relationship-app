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
};

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

export async function searchPlatform(ctx: AgentContext, platform: Platform, topics: string[], n = 12): Promise<FoundPost[]> {
  const domains = DOMAINS[platform];
  if (!domains) return [];
  const items = await searchItems<{ url: string; author: string; title: string; text: string; community: string }>(ctx, {
    system: "You find recent public posts for a small company's staff to read and answer by hand.",
    prompt: `Search ${domains[0]} for recent public posts or profiles about any of these topics:\n${topics.map((t) => `- ${t}`).join("\n")}\nFor each: url, author (name or handle), title, text (the post's own words from the result, under 400 characters), community (group or subreddit, or empty).`,
    fields: ["url", "author", "title", "text", "community"],
    domains,
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

/** "The following domains are not accessible to our user agent" (HTTP 400). */
export function blockedDomain(e: unknown): boolean {
  return /not accessible to our user agent/i.test(e instanceof Error ? e.message : String(e));
}
