import type { AgentContext } from "../context";
import type { Platform } from "../types";

// ── Finding public posts through web search ─────────────────────────────────
// For platforms with no API we may read (Threads before Meta approves keyword
// search, Quora, Indie Hackers, public LinkedIn posts), the agent asks Claude's
// web_search tool, i.e. a search engine's public index, restricted to that
// platform's domain. No logging in, no scraping the platform itself.

export type FoundPost = { platform: Platform; url: string; author: string | null; title: string; text: string; community: string | null };

const DOMAINS: Partial<Record<Platform, string[]>> = {
  threads: ["threads.net", "threads.com"],
  quora: ["quora.com"],
  indiehackers: ["indiehackers.com"],
  linkedin: ["linkedin.com"],
  instagram: ["instagram.com"],
  reddit: ["reddit.com"],
};

const SCHEMA_HINT = `Reply with ONLY a JSON array (no prose, no code fence) of up to {N} objects: {"url": string, "author": string or null, "title": string, "text": string (the post's own words from the search result, max 400 chars), "community": string or null}. Only include real posts you found in the search results, from the last 30 days if dates are shown. Never invent a URL.`;

export async function searchPlatform(ctx: AgentContext, platform: Platform, topics: string[], n = 12): Promise<FoundPost[]> {
  const domains = DOMAINS[platform];
  if (!domains) return [];
  const res = await ctx.llm.ask("discover", {
    effort: "low",
    maxTokens: 4000,
    webSearch: { maxUses: 4, allowedDomains: domains },
    system: "You find recent public posts for a small company's staff to read and answer by hand. You only report what the search results actually show.",
    prompt: `Search ${domains[0]} for recent public posts where someone asks about or complains about any of these topics:\n${topics.map((t) => `- ${t}`).join("\n")}\n\n${SCHEMA_HINT.replace("{N}", String(n))}`,
  });
  const arr = parseArray(res.text);
  return arr
    .filter((x) => typeof x.url === "string" && domains.some((d) => new URL(x.url).hostname.endsWith(d)))
    .map((x) => ({ platform, url: x.url, author: typeof x.author === "string" ? x.author : null, title: String(x.title ?? "").slice(0, 200), text: String(x.text ?? "").slice(0, 600), community: typeof x.community === "string" ? x.community : null }));
}

function parseArray(text: string): { url: string; author?: unknown; title?: unknown; text?: unknown; community?: unknown }[] {
  const s = text.indexOf("[");
  const e = text.lastIndexOf("]");
  if (s === -1 || e <= s) return [];
  try {
    const v = JSON.parse(text.slice(s, e + 1));
    return Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : [];
  } catch {
    return [];
  }
}
