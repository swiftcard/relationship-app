import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OFFICE_READ_BUDGET_MS, OFFICE_SITES_PER_EXTRACT, OFFICE_SITES_PER_RUN, officeOutreach } from "@/lib/crew/agents/office";
import { BudgetStop } from "@/lib/crew/budget";
import { buildContext, type AgentContext } from "@/lib/crew/context";
import { assessSites, type SiteForAssess } from "@/lib/crew/leads/assess";
import type { SiteRead } from "@/lib/crew/leads/fetch-page";
import { dnsLookup } from "@/lib/crew/leads/quality";
import { readSites } from "@/lib/crew/leads/read-sites";
import { FakeClaude, FakeCritic } from "@/lib/crew/llm/fake";
import type { LlmRequest } from "@/lib/crew/llm/types";
import { MemoryStore } from "@/lib/crew/store-memory";
import { TICK_BUDGET_MS } from "@/lib/crew/tick";
import { setup } from "./crew-helpers";

// ── Office Prospects reads up to 12 offices a run ───────────────────────────
// 2026-10-29: a supervised run's search found 12 offices and the agent read
// only the first 8, so a third of what it paid to find was never opened. Now
// it reads every different office up to 12, a few hosts at a time, and splits
// the extract step so the answer fits. Robots.txt, safe-fetch, timeouts and
// the budget checks are the same; the search is the same single call.

let search: { name: string; website: string }[] = [];
const sites = new Map<string, SiteRead>();
const searchCalls: { maxUses?: number }[] = [];
let inFlight = 0;
let maxInFlight = 0;
const hostsInFlight = new Set<string>();
let sameHostOverlap = false;

vi.mock("@/lib/crew/leads/fetch-page", async (orig) => ({
  ...(await orig<typeof import("@/lib/crew/leads/fetch-page")>()),
  readSiteDetailed: async (u: string) => {
    const host = new URL(u).hostname;
    if (hostsInFlight.has(host)) sameHostOverlap = true;
    hostsInFlight.add(host);
    maxInFlight = Math.max(maxInFlight, ++inFlight);
    await new Promise((r) => setTimeout(r, 2));
    inFlight--;
    hostsInFlight.delete(host);
    return sites.get(u) ?? { pages: [], outcome: "unreadable" };
  },
}));
vi.mock("@/lib/crew/sources/web-discovery", async (orig) => ({
  ...(await orig<typeof import("@/lib/crew/sources/web-discovery")>()),
  searchItems: async (_ctx: unknown, o: { maxUses?: number }) => (searchCalls.push(o), search),
}));
const { legacyMirror } = vi.hoisted(() => ({ legacyMirror: vi.fn(async () => 0) }));
vi.mock("@/lib/crew/sources/sheets", async (orig) => ({ ...(await orig<typeof import("@/lib/crew/sources/sheets")>()), syncLeadsToSheet: legacyMirror }));

/** A readable office with its own email and phone, so it becomes a lead even without the model. */
function office(i: number) {
  const url = `https://office${i}.com/`;
  sites.set(url, { pages: [{ url, html: `<title>Office ${i}</title> hello@office${i}.com (212) 555-${String(1000 + i)}` }], outcome: "readable" });
  return { name: `Office ${i}`, website: url };
}

/** Answers every SITE # in the prompt; "Office 8" is not a fit, so its answer must land on the right site. */
const assess = (req: LlmRequest) => {
  const named = [...req.prompt.matchAll(/SITE #(\d+) (Office \d+)/g)].map((m) => ({ i: Number(m[1]), name: m[2] }));
  return JSON.stringify({ sites: named.map(({ i, name }) => ({ i, people: [], fit: name === "Office 8" ? 0 : 25, why: "Team of agents.", hook: "", opener: "", talking_point: "" })) });
};
const extractCalls = (calls: LlmRequest[]) => calls.filter((c) => c.prompt.includes("SITE #"));

beforeEach(() => {
  vi.stubEnv("CREW_ANTHROPIC_API_KEY", "test");
  vi.spyOn(dnsLookup, "mx").mockResolvedValue([{ exchange: "mx.example.com", priority: 10 }]);
  search = [];
  sites.clear();
  searchCalls.length = 0;
  legacyMirror.mockClear();
  inFlight = maxInFlight = 0;
  sameHostOverlap = false;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the 12-site ceiling", () => {
  it("reads 12 different offices, skips repeats, and counts the rest as not attempted", async () => {
    search = [...Array.from({ length: 15 }, (_, i) => office(i)), { name: "Office 1", website: "https://www.office1.com/contact" }, { name: "Office 2", website: "https://office2.com/about" }];
    const { ctx, store } = await setup({ def: officeOutreach, script: assess });
    const r = await officeOutreach.run(ctx);
    expect(OFFICE_SITES_PER_RUN).toBe(12);
    expect(ctx.stats).toMatchObject({ search_results: 17, search_repeats: 2, unique_companies: 15, sites_attempted: 12, sites_not_attempted: 3, sites_readable: 12, rejected_poor_fit: 1, leads_added: 11 });
    // Every business the search returned is accounted for, once.
    const s = ctx.stats;
    expect(s.search_filtered_directory + s.search_filtered_invalid_url + s.search_repeats + s.unique_companies).toBe(s.search_results);
    expect(s.sites_attempted + s.sites_not_attempted).toBe(s.unique_companies);
    expect(s.sites_readable + s.sites_blocked_robots + s.sites_http_403 + s.sites_http_error + s.sites_timeout + s.sites_unreadable).toBe(s.sites_attempted);
    expect(s.rejected_poor_fit + s.sites_no_contact + s.leads_added + s.duplicates_rejected).toBe(s.sites_readable);
    // The first 12, in the search's order; Office 8 rejected on its own answer.
    expect(store.leads.map((l) => l.company).sort()).toEqual(["Office 0", "Office 1", "Office 2", "Office 3", "Office 4", "Office 5", "Office 6", "Office 7", "Office 9", "Office 10", "Office 11"].sort());
    expect(r.summary).toContain("Funnel: search 17, 0 filtered, 12 tried, 12 readable, 1 poor fit, 11 saved.");
  });
  it("still makes one search call with the same number of web searches", async () => {
    search = Array.from({ length: 12 }, (_, i) => office(i));
    const { ctx } = await setup({ def: officeOutreach, script: assess });
    await officeOutreach.run(ctx);
    expect(searchCalls).toEqual([expect.objectContaining({ maxUses: 6 })]);
  });
  it("keeps the blocked and failed counts per site", async () => {
    search = [office(0), office(1), { name: "Big", website: "https://big.com/team" }, { name: "Robots", website: "https://robots.com/" }, { name: "Slow", website: "https://slow.com/" }];
    sites.set("https://big.com/team", { pages: [], outcome: "http_403" });
    sites.set("https://robots.com/", { pages: [], outcome: "robots" });
    sites.set("https://slow.com/", { pages: [], outcome: "timeout" });
    const { ctx } = await setup({ def: officeOutreach, script: assess });
    await officeOutreach.run(ctx);
    expect(ctx.stats).toMatchObject({ sites_attempted: 5, sites_not_attempted: 0, sites_readable: 2, sites_http_403: 1, sites_blocked_robots: 1, sites_timeout: 1, leads_added: 2 });
  });
});

describe("reading a few sites at a time", () => {
  it("reads at most 4 at once, never two on the same host, and keeps the order", async () => {
    const items = [
      ...Array.from({ length: 10 }, (_, i) => ({ name: `S${i}`, website: `https://s${i}.com/` })),
      { name: "Team A", website: "https://www.compass.com/agents/a/" },
      { name: "Team B", website: "https://www.compass.com/agents/b/" },
    ];
    const { read, notStarted } = await readSites(items, { concurrency: 4, deadline: Date.now() + 60_000 });
    expect(read.map((r) => r.name)).toEqual(items.map((i) => i.name));
    expect(notStarted).toBe(0);
    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(sameHostOverlap).toBe(false);
  });
  it("starts no new site after the deadline", async () => {
    let t = 0;
    const items = Array.from({ length: 6 }, (_, i) => ({ name: `S${i}`, website: `https://s${i}.com/` }));
    // Each check of the clock moves it 10s on; the deadline is 25s away.
    const { read, notStarted } = await readSites(items, { concurrency: 1, deadline: 25_000, now: () => (t += 10_000) - 10_000 });
    expect(read.map((r) => r.name)).toEqual(["S0", "S1", "S2"]);
    expect(notStarted).toBe(3);
  });
  it("the reading budget leaves room for the slowest site inside the tick", () => {
    // One site at worst: robots.txt + homepage + two pages, 10s timeouts, 1s apart.
    const slowestSiteMs = 4 * 10_000 + 2 * 1_000;
    expect(OFFICE_READ_BUDGET_MS + slowestSiteMs).toBeLessThan(TICK_BUDGET_MS / 2);
  });
  it("every read still goes through readSiteDetailed (robots.txt, safe-fetch, timeouts)", () => {
    const src = readFileSync("src/lib/crew/leads/read-sites.ts", "utf8");
    expect(src).toContain('import { readSiteDetailed, type SiteRead } from "./fetch-page";');
    expect(src).not.toMatch(/\bfetch\(|safeFetch/);
  });
});

describe("the extract step", () => {
  it("12 readable sites: two calls of at most 6, each answer on its own site", async () => {
    search = Array.from({ length: 12 }, (_, i) => office(i));
    const { ctx, claude } = await setup({ def: officeOutreach, script: assess });
    await officeOutreach.run(ctx);
    const calls = extractCalls(claude.calls);
    expect(OFFICE_SITES_PER_EXTRACT).toBe(6);
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect((c.prompt.match(/SITE #\d+/g) ?? []).length).toBeLessThanOrEqual(6);
      expect(c.maxTokens).toBe(6000);
    }
    expect(ctx.stats).toMatchObject({ rejected_poor_fit: 1, leads_added: 11 });
  });
  it("6 or fewer readable sites: still one call, as before", async () => {
    search = Array.from({ length: 6 }, (_, i) => office(i));
    const { ctx, claude } = await setup({ def: officeOutreach, script: assess });
    await officeOutreach.run(ctx);
    expect(extractCalls(claude.calls)).toHaveLength(1);
  });
});

describe("budget safety", () => {
  it("with no budget left: no model call is made and the pages' own contacts are still saved", async () => {
    search = Array.from({ length: 12 }, (_, i) => office(i));
    const store = new MemoryStore();
    await store.patchAgentState(officeOutreach.id, { enabled: true, daily_usd_cap: 0 });
    const claude = new FakeClaude(assess);
    const ctx = await buildContext({ def: officeOutreach, store, providers: { claude, critic: new FakeCritic() }, runId: null });
    const r = await officeOutreach.run(ctx);
    expect(claude.calls).toHaveLength(0);
    expect(ctx.stats).toMatchObject({ sites_attempted: 12, sites_readable: 12, leads_added: 12 });
    expect(r.summary).toContain("12 new call rows");
  });
  it("a refused second call keeps the first call's answers and makes no third", async () => {
    let calls = 0;
    const ctx = {
      llm: {
        askJson: async (_p: string, o: { prompt: string }) => {
          calls++;
          if (calls > 1) throw new BudgetStop("Hit its daily limit.");
          const n = (o.prompt.match(/SITE #\d+/g) ?? []).length;
          return { sites: Array.from({ length: n }, (_, i) => ({ i, people: [], fit: 20, why: "", hook: "", opener: "", talking_point: "" })) };
        },
      },
    } as unknown as AgentContext;
    const list: SiteForAssess[] = Array.from({ length: 18 }, (_, i) => ({ name: `S${i}`, website: `https://s${i}.com/`, type: "t", area: "a", pages: [{ url: `https://s${i}.com/`, html: "x" }] }));
    const out = await assessSites(ctx, list, { office: true, perCall: 6 });
    expect(calls).toBe(2);
    expect(out?.map((a) => a.i)).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it("a refused first call is the caller's, as before", async () => {
    const ctx = { llm: { askJson: async () => { throw new BudgetStop("Hit its daily limit."); } } } as unknown as AgentContext;
    await expect(assessSites(ctx, [{ name: "S", website: "https://s.com/", type: "t", area: "a", pages: [{ url: "https://s.com/", html: "x" }] }], { office: true, perCall: 6 })).rejects.toThrow(BudgetStop);
  });
  it("answers with an index outside their call are dropped, never moved onto another site", async () => {
    const ctx = { llm: { askJson: async () => ({ sites: [{ i: 0, people: [], fit: 9, why: "", hook: "", opener: "", talking_point: "" }, { i: 7, people: [], fit: 9, why: "", hook: "", opener: "", talking_point: "" }] }) } } as unknown as AgentContext;
    const list: SiteForAssess[] = Array.from({ length: 8 }, (_, i) => ({ name: `S${i}`, website: `https://s${i}.com/`, type: "t", area: "a", pages: [{ url: `https://s${i}.com/`, html: "x" }] }));
    expect((await assessSites(ctx, list, { office: true, perCall: 6 }))?.map((a) => a.i)).toEqual([0, 6]);
  });
});

describe("the old two-sheet mirror", () => {
  it("Office Prospects no longer calls it; Sheet sync puts its rows on the tab", async () => {
    search = Array.from({ length: 3 }, (_, i) => office(i));
    const { ctx } = await setup({ def: officeOutreach, script: assess });
    const r = await officeOutreach.run(ctx);
    expect(legacyMirror).not.toHaveBeenCalled();
    expect(r.summary).not.toMatch(/on the sheet/);
    expect(readFileSync("src/lib/crew/agents/office.ts", "utf8")).not.toContain("sources/sheets");
  });
  it("the workbook's Sheet sync and Web Leads are untouched", () => {
    expect(readFileSync("src/lib/crew/agents/leads.ts", "utf8")).toContain('syncLeadsToSheet(ctx.store, "cold")');
    expect(readFileSync("src/lib/crew/sheets/rows.ts", "utf8")).toContain("tab: OFFICE_PROSPECTS");
  });
});
