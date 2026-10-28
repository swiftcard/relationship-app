import { safeFetch } from "@/lib/safe-fetch";

// ── Polite reading of public business websites ─────────────────────────────
// For the lead agents: a business's own homepage and contact page, where it
// chose to publish its email. robots.txt is obeyed, one request per second
// per site, small pages only, a clear user agent, nothing behind a login.
// The URLs come from web search results (untrusted), so every request goes
// through lib/safe-fetch: private/loopback/metadata addresses are refused,
// DNS is pinned at connect time, and every redirect hop is re-checked.

export const CREW_UA = "SwiftCardCrew/1.0 (+https://swiftcard.me; business contact discovery)";
const MAX_BYTES = 600_000;

export function robotsAllows(robots: string, path: string, ua = "swiftcardcrew"): boolean {
  const lines = robots.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim());
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const l of lines) {
    const m = l.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (cur && (key === "disallow" || key === "allow")) cur.rules.push({ allow: key === "allow", path: val });
    }
  }
  const mine = groups.find((g) => g.agents.some((a) => a !== "*" && ua.includes(a))) ?? groups.find((g) => g.agents.includes("*"));
  if (!mine) return true;
  let best: { allow: boolean; len: number } = { allow: true, len: -1 };
  for (const r of mine.rules) {
    if (!r.path) continue;
    if (path.startsWith(r.path.replace(/\*$/, "")) && r.path.length > best.len) best = { allow: r.allow, len: r.path.length };
  }
  return best.allow;
}

const robotsCache = new Map<string, string>();

/** Why a page did or didn't come back. Only the category is kept (run stats), never the address. */
export type FetchOutcome = "ok" | "http_403" | "http_error" | "timeout" | "unreadable";

async function fetchText(url: string): Promise<{ text: string | null; outcome: FetchOutcome }> {
  try {
    const r = await safeFetch(url, { headers: { "User-Agent": CREW_UA, Accept: "text/html,text/plain" }, signal: AbortSignal.timeout(10_000) }, 3);
    // 401, 403 and 429 are how bot protection answers; anything else not OK is a plain HTTP error.
    if (!r.ok) return { text: null, outcome: [401, 403, 429].includes(r.status) ? "http_403" : "http_error" };
    const type = r.headers.get("content-type") ?? "";
    if (!/text\/(html|plain)/.test(type)) return { text: null, outcome: "unreadable" };
    const len = Number(r.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) return { text: null, outcome: "unreadable" };
    return { text: (await r.text()).slice(0, MAX_BYTES), outcome: "ok" };
  } catch (e) {
    const name = (e as { name?: string }).name ?? "";
    return { text: null, outcome: name === "TimeoutError" || name === "AbortError" ? "timeout" : "unreadable" };
  }
}

async function getText(url: string): Promise<string | null> {
  return (await fetchText(url)).text;
}

export async function allowedByRobots(url: string): Promise<boolean> {
  const u = new URL(url);
  let robots = robotsCache.get(u.origin);
  if (robots === undefined) {
    robots = (await getText(`${u.origin}/robots.txt`)) ?? "";
    robotsCache.set(u.origin, robots);
  }
  return robotsAllows(robots, u.pathname || "/");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What happened to one site: readable, or the first thing that stopped it. */
export type SiteOutcome = "readable" | "robots" | "http_403" | "http_error" | "timeout" | "unreadable";
export type SiteRead = { pages: { url: string; html: string }[]; outcome: SiteOutcome };

/** Homepage plus up to two contact/about/team pages, one second apart. */
export async function readSite(homeUrl: string): Promise<{ url: string; html: string }[]> {
  return (await readSiteDetailed(homeUrl)).pages;
}

/** readSite, saying why a site gave nothing. A site is readable when its homepage is. */
export async function readSiteDetailed(homeUrl: string): Promise<SiteRead> {
  let home: URL;
  try {
    home = new URL(homeUrl);
  } catch {
    return { pages: [], outcome: "unreadable" };
  }
  if (!/^https?:$/.test(home.protocol)) return { pages: [], outcome: "unreadable" };
  const pages: { url: string; html: string }[] = [];
  if (!(await allowedByRobots(home.href))) return { pages: [], outcome: "robots" };
  const first = await fetchText(home.href);
  if (!first.text) return { pages: [], outcome: first.outcome === "ok" ? "unreadable" : first.outcome };
  const html = first.text;
  pages.push({ url: home.href, html });
  const links = [...html.matchAll(/href=["']([^"'#]+)["']/gi)]
    .map((m) => {
      try {
        return new URL(m[1], home).href;
      } catch {
        return null;
      }
    })
    .filter((h): h is string => !!h && new URL(h).hostname === home.hostname && /contact|about|team|agents|staff|our-people/i.test(h));
  for (const l of [...new Set(links)].slice(0, 2)) {
    await sleep(1000);
    if (!(await allowedByRobots(l))) continue;
    const t = await getText(l);
    if (t) pages.push({ url: l, html: t });
  }
  return { pages, outcome: "readable" };
}

export function textOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#64;|&commat;/g, "@")
    .replace(/\s+/g, " ")
    .trim();
}

export function mailtos(html: string): string[] {
  return [...html.matchAll(/mailto:([^"'?\s>]+)/gi)].map((m) => decodeURIComponent(m[1]).toLowerCase());
}

export function phonesIn(text: string): string[] {
  const found = text.match(/(?:\+1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g) ?? [];
  return [...new Set(found.map((p) => p.replace(/[^\d+]/g, "")).filter((p) => p.replace(/\D/g, "").length >= 10))].slice(0, 3);
}

export function pageTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]{2,120})<\/title>/i);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}
