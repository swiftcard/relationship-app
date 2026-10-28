import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEAD_RUN_STATS, funnelLine, recordSites, screenSearch, startFunnel } from "@/lib/crew/leads/diagnostics";
import { readSiteDetailed } from "@/lib/crew/leads/fetch-page";

// ── Where a lead run's businesses went ──────────────────────────────────────
// 2026-10-28: a supervised Office Prospects run spent $0.09 and said only "no
// readable sites this time", the same as on 27 Oct. Nothing said whether the
// search found nothing or every site refused us. Now every Web Leads and
// Office run records the whole funnel, in counts only.

type Reply = { status?: number; type?: string; body?: string; throws?: { name?: string; message: string } };
const replies = new Map<string, Reply>();

vi.mock("@/lib/safe-fetch", () => ({
  safeFetch: async (url: string) => {
    const r = replies.get(url) ?? (url.endsWith("/robots.txt") ? { status: 404 } : { status: 200, body: "<html>home</html>" });
    if (r.throws) throw Object.assign(new Error(r.throws.message), { name: r.throws.name ?? "Error" });
    return new Response(r.body ?? "", { status: r.status ?? 200, headers: { "content-type": r.type ?? "text/html" } });
  },
}));

beforeEach(() => replies.clear());

describe("readSiteDetailed says why a site gave nothing", () => {
  it("readable: the homepage came back", async () => {
    replies.set("https://ok.example/", { body: "<html>Welcome</html>" });
    const r = await readSiteDetailed("https://ok.example/");
    expect(r.outcome).toBe("readable");
    expect(r.pages).toHaveLength(1);
  });
  it("robots: the site's robots.txt says no to us", async () => {
    replies.set("https://norobots.example/robots.txt", { body: "User-agent: *\nDisallow: /" });
    expect(await readSiteDetailed("https://norobots.example/")).toEqual({ pages: [], outcome: "robots" });
  });
  it("http_403: refused by bot protection (401, 403, 429)", async () => {
    for (const [host, status] of [["forbidden.example", 403], ["auth.example", 401], ["slowdown.example", 429]] as const) {
      replies.set(`https://${host}/`, { status });
      expect((await readSiteDetailed(`https://${host}/`)).outcome).toBe("http_403");
    }
  });
  it("http_error: any other non-OK status", async () => {
    replies.set("https://gone.example/", { status: 404 });
    replies.set("https://broken.example/", { status: 503 });
    expect((await readSiteDetailed("https://gone.example/")).outcome).toBe("http_error");
    expect((await readSiteDetailed("https://broken.example/")).outcome).toBe("http_error");
  });
  it("timeout: the site took too long", async () => {
    replies.set("https://slow.example/", { throws: { name: "TimeoutError", message: "The operation timed out." } });
    expect((await readSiteDetailed("https://slow.example/")).outcome).toBe("timeout");
  });
  it("unreadable: not a web page, a refused address, or not a URL at all", async () => {
    replies.set("https://pdf.example/", { type: "application/pdf", body: "%PDF" });
    replies.set("https://private.example/", { throws: { message: "blocked ip" } });
    expect((await readSiteDetailed("https://pdf.example/")).outcome).toBe("unreadable");
    expect((await readSiteDetailed("https://private.example/")).outcome).toBe("unreadable");
    expect((await readSiteDetailed("not a url")).outcome).toBe("unreadable");
    expect((await readSiteDetailed("ftp://files.example/")).outcome).toBe("unreadable");
  });
});

/** A stand-in for the run context: just the stats. */
function stats() {
  const s: Record<string, number> = {};
  return { stats: s, stat: (k: string, n = 1) => void (s[k] = (s[k] ?? 0) + n) };
}

describe("the funnel", () => {
  it("starts every key at 0, so a step that saw nothing still says so", () => {
    const c = stats();
    startFunnel(c);
    expect(Object.keys(c.stats).sort()).toEqual([...LEAD_RUN_STATS].sort());
    expect(Object.values(c.stats).every((v) => v === 0)).toBe(true);
  });
  it("screenSearch counts invalid URLs, directories, repeats and unique companies, and keeps the order", () => {
    const c = stats();
    const kept = screenSearch(
      c,
      [
        { name: "Acme Realty", website: "https://acmerealty.com" },
        { name: "Acme Realty", website: "https://www.acmerealty.com/contact" }, // the same company again
        { name: "On Yelp", website: "https://www.yelp.com/biz/acme" },
        { name: "No site", website: "" },
        { name: "Ryan Team", website: "https://www.compass.com/agents/ryan-team/" },
        { name: "Kantha Team", website: "https://www.compass.com/agents/kantha/" },
      ],
      /(yelp|facebook)\./i,
    );
    expect(kept.map((k) => k.name)).toEqual(["Acme Realty", "Acme Realty", "Ryan Team", "Kantha Team"]);
    expect(c.stats).toEqual({ search_results: 6, search_filtered_invalid_url: 1, search_filtered_directory: 1, search_repeats: 1, unique_companies: 3 });
  });
  it("recordSites counts every outcome and what was left over the per-run cap", () => {
    const c = stats();
    recordSites(c, { kept: 10, outcomes: ["readable", "readable", "robots", "http_403", "http_403", "http_error", "timeout", "unreadable"] });
    expect(c.stats).toEqual({ sites_attempted: 8, sites_not_attempted: 2, sites_readable: 2, sites_blocked_robots: 1, sites_http_403: 2, sites_http_error: 1, sites_timeout: 1, sites_unreadable: 1 });
  });
  it("the summary line is counts only", () => {
    const line = funnelLine({ search_results: 9, search_filtered_directory: 2, sites_attempted: 7, sites_readable: 2, sites_blocked_robots: 1, sites_http_403: 3, sites_timeout: 1, rejected_poor_fit: 1, leads_added: 1 });
    expect(line).toBe("search 9, 2 filtered, 7 tried, 2 readable, 4 blocked (1 robots.txt, 3 refused), 1 failed, 1 poor fit, 1 saved");
  });
});

afterEach(() => vi.restoreAllMocks());
