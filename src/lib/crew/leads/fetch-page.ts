import { safeFetch } from "@/lib/safe-fetch";
import { sharedCompanyHost } from "./quality";

// ── Polite reading of public business websites ─────────────────────────────
// For the lead agents: a business's own homepage and contact page, where it
// chose to publish its email. robots.txt is obeyed, one request per second
// per site, small pages only, a clear user agent, nothing behind a login.
// The URLs come from web search results (untrusted), so every request goes
// through lib/safe-fetch: private/loopback/metadata addresses are refused,
// DNS is pinned at connect time, and every redirect hop is re-checked.

export const CREW_UA = "SwiftCardCrew/1.0 (+https://swiftcard.me; business contact discovery)";
const MAX_BYTES = 600_000;
const restrictedHost = (host: string) => /(^|\.)(linkedin\.com|facebook\.com|instagram\.com)$/.test(host);

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
  const specificity = (agents: string[]) => Math.max(-1, ...agents.map((a) => a === "*" ? 0 : a && ua.includes(a) ? a.length : -1));
  const longest = Math.max(-1, ...groups.map((g) => specificity(g.agents)));
  const mine = groups.filter((g) => longest >= 0 && specificity(g.agents) === longest);
  let best: { allow: boolean; len: number } = { allow: true, len: -1 };
  for (const r of mine.flatMap((g) => g.rules)) {
    if (!r.path) continue;
    const anchored = r.path.endsWith("$");
    const pattern = r.path.replace(/\$$/, "").split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    const len = r.path.replace(/[\*$]/g, "").length;
    if (new RegExp(`^${pattern}${anchored ? "$" : ""}`).test(path) && (len > best.len || (len === best.len && r.allow))) best = { allow: r.allow, len };
  }
  return best.allow;
}

const robotsCache = new Map<string, { text: string; until: number }>();
const domainTurns = new Map<string, Promise<void>>();
async function rateLimit(url: URL) {
  const host = url.hostname.replace(/^www\./, "");
  const previous = domainTurns.get(host) ?? Promise.resolve();
  const next = previous.then(() => new Promise<void>((r) => setTimeout(r, 1000)));
  domainTurns.set(host, next);
  await previous;
  void next.then(() => { if (domainTurns.get(host) === next) domainTurns.delete(host); });
}

/** Why a page did or didn't come back. Only the category is kept (run stats), never the address. */
export type FetchOutcome = "ok" | "http_403" | "http_error" | "timeout" | "unreadable";

async function fetchText(url: string, robotsRequest = false): Promise<{ text: string | null; outcome: FetchOutcome; status?: number; url?: string }> {
  try {
    const r = await safeFetch(url, { headers: { "User-Agent": CREW_UA, Accept: "text/html,text/plain" }, signal: AbortSignal.timeout(10_000) }, 3, async (target) => {
      if (restrictedHost(target.hostname) || /\/(?:login|signin|sign-in|account|captcha)(?:\/|$)/i.test(target.pathname)) throw new Error("restricted page");
      if (!robotsRequest && !(await allowedByRobots(target.href))) throw new Error("robots denied redirect");
      await rateLimit(target);
    });
    // 401, 403 and 429 are how bot protection answers; anything else not OK is a plain HTTP error.
    if (!r.ok) return { text: null, status: r.status, outcome: [401, 403, 429].includes(r.status) ? "http_403" : "http_error" };
    const type = r.headers.get("content-type") ?? "";
    if (!/text\/(html|plain)/.test(type)) return { text: null, outcome: "unreadable" };
    const len = Number(r.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) return { text: null, outcome: "unreadable" };
    const text = (await r.text()).slice(0, MAX_BYTES);
    if (!robotsRequest && /<title[^>]*>[^<]*(?:just a moment|access denied|verify you are human)|automated (?:access|scraping|collection) (?:is )?(?:prohibited|not permitted)/i.test(text)) return { text: null, outcome: "http_403" };
    return { text, outcome: "ok", url: r.url || url, status: r.status };
  } catch (e) {
    const name = (e as { name?: string }).name ?? "";
    return { text: null, outcome: name === "TimeoutError" || name === "AbortError" ? "timeout" : "unreadable" };
  }
}

export async function allowedByRobots(url: string): Promise<boolean> {
  const u = new URL(url);
  let robots = robotsCache.get(u.origin);
  if (!robots || robots.until < Date.now()) {
    const r = await fetchText(`${u.origin}/robots.txt`, true);
    // Only a missing robots file permits reading. Refusals and outages do not.
    if (r.text === null && r.status !== 404 && r.status !== 410) return false;
    robots = { text: r.text ?? "", until: Date.now() + 3600_000 };
    robotsCache.set(u.origin, robots);
  }
  return robotsAllows(robots.text, (u.pathname || "/") + u.search);
}

/** What happened to one site: readable, or the first thing that stopped it. */
export type SiteOutcome = "readable" | "robots" | "http_403" | "http_error" | "timeout" | "unreadable";
export type SiteRead = { pages: { url: string; html: string }[]; outcome: SiteOutcome };

/** Up to twelve relevant public pages, rate-limited across reads of a host. */
export async function readSite(homeUrl: string): Promise<{ url: string; html: string }[]> {
  return (await readSiteDetailed(homeUrl)).pages;
}

/** readSite, saying why a site gave nothing. A site is readable when its homepage is. */
export async function readSiteDetailed(homeUrl: string, o: { deadline?: number | null } = {}): Promise<SiteRead> {
  const deadline = Math.min(o.deadline ?? Infinity, Date.now() + 25_000);
  let home: URL;
  try {
    home = new URL(homeUrl);
  } catch {
    return { pages: [], outcome: "unreadable" };
  }
  if (!/^https?:$/.test(home.protocol)) return { pages: [], outcome: "unreadable" };
  if (restrictedHost(home.hostname)) return { pages: [], outcome: "unreadable" };
  if (Date.now() + 10_000 >= deadline) return { pages: [], outcome: "timeout" };
  const pages: { url: string; html: string }[] = [];
  if (!(await allowedByRobots(home.href))) return { pages: [], outcome: "robots" };
  const first = await fetchText(home.href);
  if (!first.text) return { pages: [], outcome: first.outcome === "ok" ? "unreadable" : first.outcome };
  const html = first.text;
  home = new URL(first.url ?? home.href);
  const teamPath = sharedCompanyHost(home.hostname) ? home.pathname.replace(/\/$/, "") : "";
  pages.push({ url: home.href, html });
  const visited = new Set([home.href]);
  const linksIn = (html: string, base: URL) => [...html.matchAll(/href=["']([^"'#]+)["']/gi)]
    .map((m) => {
      try {
        const u = new URL(m[1].replace(/&amp;/g, "&"), base);
        u.hash = "";
        return u.href;
      } catch {
        return null;
      }
    })
    .filter((h): h is string => {
      if (!h) return false;
      const u = new URL(h);
      return u.origin === home.origin && !u.search && (!teamPath || u.pathname.startsWith(`${teamPath}/`)) && /contact|about|team|agents|staff|our-people|leadership/i.test(u.pathname);
    });
  const links = linksIn(html, home);
  for (let i = 0; i < links.length && visited.size < 12 && Date.now() + 10_000 < deadline; i++) {
    const l = links[i];
    if (visited.has(l)) continue;
    visited.add(l);
    if (!(await allowedByRobots(l))) continue;
    const t = await fetchText(l);
    if (t.text) {
      const url = t.url ?? l;
      // Redirects to another origin are checked, but never expand the crawl.
      if (new URL(url).origin !== home.origin) continue;
      pages.push({ url, html: t.text });
      links.push(...linksIn(t.text, new URL(url)).filter((h) => !visited.has(h)).slice(0, 24));
    }
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
  return [...html.matchAll(/mailto:([^"'?\s>]+)/gi)].flatMap((m) => {
    try { return [decodeURIComponent(m[1]).toLowerCase()]; } catch { return []; }
  });
}

export function phonesIn(text: string): string[] {
  const found = text.match(/(?:\+1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g) ?? [];
  return [...new Set(found.map((p) => p.replace(/[^\d+]/g, "")).filter((p) => p.replace(/\D/g, "").length >= 10))].slice(0, 3);
}

export function pageTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]{2,120})<\/title>/i);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}
