import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { leadsWeb } from "@/lib/crew/agents/leads";
import { officeOutreach } from "@/lib/crew/agents/office";
import { LEAD_RUN_STATS } from "@/lib/crew/leads/diagnostics";
import type { SiteRead } from "@/lib/crew/leads/fetch-page";
import { dnsLookup } from "@/lib/crew/leads/quality";
import type { LlmRequest } from "@/lib/crew/llm/types";
import { setup } from "./crew-helpers";

// ── Whole runs report their funnel, and nothing personal ────────────────────
// The search, the site reads and DNS are faked; the model is the fake Claude.

let search: { name: string; website: string; city?: string; state?: string }[] = [];
const sites = new Map<string, SiteRead>();

vi.mock("@/lib/crew/leads/fetch-page", async (orig) => ({
  ...(await orig<typeof import("@/lib/crew/leads/fetch-page")>()),
  readSiteDetailed: async (u: string) => sites.get(u) ?? { pages: [], outcome: "unreadable" },
}));
vi.mock("@/lib/crew/sources/web-discovery", async (orig) => ({ ...(await orig<typeof import("@/lib/crew/sources/web-discovery")>()), searchItems: async () => search }));

const page = (url: string, html: string): SiteRead => ({ pages: [{ url, html }], outcome: "readable" });
const assess = (req: LlmRequest) => {
  const n = (JSON.stringify(req).match(/SITE #\d+/g) ?? []).length;
  return JSON.stringify({ sites: Array.from({ length: n }, (_, i) => ({ i, people: [], fit: i === 1 ? 0 : 25, why: "Fits.", hook: "", opener: "", talking_point: "" })) });
};

beforeEach(() => {
  vi.stubEnv("CREW_ANTHROPIC_API_KEY", "test");
  vi.spyOn(dnsLookup, "mx").mockResolvedValue([{ exchange: "mx.example.com", priority: 10 }]);
  search = [];
  sites.clear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Every value a number, every key a funnel key or one the agents already reported. */
function countsOnly(stats: Record<string, unknown>) {
  const known = new Set<string>([...LEAD_RUN_STATS, "leads_web", "leads_none", "emails_drafted", "no_llm_needed", "proposed"]);
  for (const [k, v] of Object.entries(stats)) {
    expect(known.has(k), `unexpected stat ${k}`).toBe(true);
    expect(typeof v).toBe("number");
  }
}
const PERSONAL = /@|https?:\/\/|\b\d{3}[ .-]?\d{3}[ .-]?\d{4}\b/;

describe("a Web Leads run", () => {
  it("records every step: filtered, refused, failed, readable, poor fit, no contact, saved", async () => {
    search = [
      { name: "Acme Realty", website: "https://acmerealty.com", city: "Austin", state: "TX" },
      { name: "Poor Fit Co", website: "https://poorfit.com" },
      { name: "No Email Co", website: "https://noemail.com" },
      { name: "Blocked Co", website: "https://blocked.com" },
      { name: "Robots Co", website: "https://robots.com" },
      { name: "Slow Co", website: "https://slow.com" },
      { name: "On Yelp", website: "https://www.yelp.com/biz/x" },
      { name: "No site", website: "" },
    ];
    sites.set("https://acmerealty.com", page("https://acmerealty.com/", "<title>Acme</title> jane@acmerealty.com (512) 555-0100"));
    sites.set("https://poorfit.com", page("https://poorfit.com/", "hello@poorfit.com"));
    sites.set("https://noemail.com", page("https://noemail.com/", "Call us any time."));
    sites.set("https://blocked.com", { pages: [], outcome: "http_403" });
    sites.set("https://robots.com", { pages: [], outcome: "robots" });
    sites.set("https://slow.com", { pages: [], outcome: "timeout" });
    const { ctx, store } = await setup({ def: leadsWeb, script: assess });
    const r = await leadsWeb.run(ctx);
    expect(store.leads).toHaveLength(1);
    expect(ctx.stats).toMatchObject({
      search_results: 8,
      search_filtered_directory: 1,
      search_filtered_invalid_url: 1,
      unique_companies: 6,
      sites_attempted: 6,
      sites_not_attempted: 0,
      sites_readable: 3,
      sites_http_403: 1,
      sites_blocked_robots: 1,
      sites_timeout: 1,
      rejected_poor_fit: 1,
      sites_no_contact: 1,
      leads_added: 1,
      usable_leads: 1,
      duplicates_rejected: 0,
    });
    countsOnly(ctx.stats);
    expect(r.summary).toContain("Funnel: search 8, 2 filtered, 6 tried, 3 readable, 2 blocked (1 robots.txt, 1 refused), 1 failed, 1 poor fit, 1 saved.");
    expect(r.summary).not.toMatch(PERSONAL);
  });
});

describe("an Office Prospects run", () => {
  it("says the search came back empty, not that sites couldn't be read", async () => {
    const { ctx, claude } = await setup({ def: officeOutreach, script: assess });
    const r = await officeOutreach.run(ctx);
    expect(r.summary).toMatch(/the search found no office websites/);
    expect(ctx.stats).toMatchObject({ search_results: 0, sites_attempted: 0, sites_readable: 0, leads_added: 0 });
    expect(claude.calls.filter((c) => JSON.stringify(c).includes("SITE #"))).toHaveLength(0); // no read paid for
    countsOnly(ctx.stats);
  });
  it("says every site refused us, and how", async () => {
    search = [
      { name: "Big Brokerage", website: "https://bigbrokerage.com/team/x" },
      { name: "Other Brokerage", website: "https://otherbrokerage.com/" },
      { name: "Third", website: "https://third.com/" },
    ];
    sites.set("https://bigbrokerage.com/team/x", { pages: [], outcome: "http_403" });
    sites.set("https://otherbrokerage.com/", { pages: [], outcome: "http_403" });
    sites.set("https://third.com/", { pages: [], outcome: "robots" });
    const { ctx } = await setup({ def: officeOutreach, script: assess });
    const r = await officeOutreach.run(ctx);
    expect(r.summary).toMatch(/no readable sites this time/);
    expect(r.summary).toContain("Funnel: search 3, 0 filtered, 3 tried, 0 readable, 3 blocked (1 robots.txt, 2 refused), 0 saved.");
    expect(ctx.stats).toMatchObject({ search_results: 3, unique_companies: 3, sites_attempted: 3, sites_http_403: 2, sites_blocked_robots: 1, sites_readable: 0 });
    expect(r.summary).not.toMatch(PERSONAL);
  });
  it("counts the offices over the per-run cap of 8 as not attempted", async () => {
    search = Array.from({ length: 11 }, (_, i) => ({ name: `Office ${i}`, website: `https://office${i}.com/` }));
    const { ctx } = await setup({ def: officeOutreach, script: assess });
    await officeOutreach.run(ctx);
    expect(ctx.stats).toMatchObject({ search_results: 11, sites_attempted: 8, sites_not_attempted: 3, sites_unreadable: 8 });
  });
});
