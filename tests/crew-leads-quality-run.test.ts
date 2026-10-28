import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { leadsWeb } from "@/lib/crew/agents/leads";
import { officeOutreach } from "@/lib/crew/agents/office";
import { dnsLookup } from "@/lib/crew/leads/quality";
import { leadRows } from "@/lib/crew/sheets/rows";
import type { LlmRequest } from "@/lib/crew/llm/types";
import { setup } from "./crew-helpers";

// ── A whole Web Leads run and a whole Office run, no network ────────────────
// The search, the site reads and DNS are faked; the model is the fake Claude.
// What lands in the database is what the Sheet will show.

const SITES: Record<string, { url: string; html: string }[]> = {
  "https://acmerealty.com": [
    { url: "https://acmerealty.com/", html: "<title>Acme Realty</title> 14 agents. Second office in Ballantyne." },
    { url: "https://acmerealty.com/team", html: "Jane Park, Owner and Broker, jane@acmerealty.com. info@acmerealty.com (704) 555-0100" },
  ],
  "https://bestroofs.com": [{ url: "https://bestroofs.com/", html: "<title>Best Roofs</title> info@bestroofs.com" }],
  "https://parkslopehomes.com": [{ url: "https://parkslopehomes.com/", html: "Maria Lopez, Broker/Owner. Twelve agents in Park Slope. Call (718) 555-0142" }],
};

vi.mock("@/lib/crew/leads/fetch-page", async (orig) => ({ ...(await orig<typeof import("@/lib/crew/leads/fetch-page")>()), readSiteDetailed: async (u: string) => (SITES[u] ? { pages: SITES[u], outcome: "readable" } : { pages: [], outcome: "unreadable" }) }));
vi.mock("@/lib/crew/sources/web-discovery", async (orig) => ({
  ...(await orig<typeof import("@/lib/crew/sources/web-discovery")>()),
  searchItems: async (_ctx: unknown, o: { prompt: string }) =>
    /New York City/.test(o.prompt)
      ? [{ name: "Park Slope Homes", website: "https://parkslopehomes.com" }]
      : [
          { name: "Acme Realty", website: "https://acmerealty.com", city: "Charlotte", state: "NC" },
          { name: "Best Roofs", website: "https://bestroofs.com", city: "Charlotte", state: "NC" },
        ],
}));

const assessment = (req: LlmRequest) => {
  const p = JSON.stringify(req);
  if (p.includes("Park Slope Homes")) return JSON.stringify({ sites: [{ i: 0, people: [{ name: "Maria Lopez", title: "Broker/Owner", email: "", phone: "" }], fit: 34, why: "Twelve agents who meet buyers in person.", hook: "Twelve agents in Park Slope.", opener: "Hi Maria, this is [your name] from SwiftCard. How do your twelve agents share their details at showings?", talking_point: "Matching cards and one lead inbox for the team." }] });
  return JSON.stringify({
    sites: [
      { i: 0, people: [{ name: "Jane Park", title: "Owner and Broker", email: "jane@acmerealty.com", phone: "" }], fit: 32, why: "A 14-agent team.", hook: "Second office in Ballantyne.", opener: "Congrats on the Ballantyne office.", talking_point: "" },
      { i: 1, people: [], fit: 0, why: "A roofing directory page.", hook: "", opener: "", talking_point: "" },
    ],
  });
};

beforeEach(() => {
  vi.stubEnv("CREW_ANTHROPIC_API_KEY", "test");
  vi.spyOn(dnsLookup, "mx").mockResolvedValue([{ exchange: "mx.example.com", priority: 10 }]);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("a Web Leads run", () => {
  it("saves one scored lead per fitting business, with the decision-maker, and stats that add up", async () => {
    const { ctx, store, claude } = await setup({ def: leadsWeb, script: (req) => assessment(req) });
    const r = await leadsWeb.run(ctx);
    expect(r.summary).toMatch(/saved 1 new businesses/);
    expect(r.summary).toContain("Funnel: search 2, 0 filtered, 2 tried, 2 readable, 1 poor fit, 1 saved.");
    expect(store.leads).toHaveLength(1);
    const [l] = store.leads;
    expect(l).toMatchObject({ name: "Jane Park", title: "Owner and Broker", email: "jane@acmerealty.com", email_status: "Domain OK", company_key: "acmerealty.com", why: "A 14-agent team.", hook: "Second office in Ballantyne.", message: "Congrats on the Ballantyne office." });
    expect(l.score).toBeGreaterThanOrEqual(80);
    expect(ctx.stats).toMatchObject({ leads_added: 1, usable_leads: 1, duplicates_rejected: 0, contacts_suppressed: 0, rejected_poor_fit: 1 });
    expect(claude.calls.filter((c) => JSON.stringify(c).includes("SITE #"))).toHaveLength(1); // one read for every site
    const [row] = leadRows(l, { approvals: [], leads: [], findings: [], people: [], facts: [], geoHistory: [], known: new Map(), blueskyLive: false });
    expect(row.cells).toMatchObject({ score: l.score, name: "Jane Park, Owner and Broker", email_status: "Domain OK", why: "A 14-agent team." });
  });
  it("the same business again is a duplicate, not a second lead", async () => {
    const { ctx, store } = await setup({ def: leadsWeb, script: (req) => assessment(req) });
    await leadsWeb.run(ctx);
    ctx.stats.duplicates_rejected = 0;
    await leadsWeb.run(ctx);
    expect(store.leads).toHaveLength(1);
    expect(ctx.stats.duplicates_rejected).toBe(1);
  });
});

describe("an Office run", () => {
  it("one call row with a call opener, even with no email", async () => {
    const { ctx, store } = await setup({ def: officeOutreach, script: (req) => assessment(req) });
    await officeOutreach.run(ctx);
    expect(store.leads).toHaveLength(1);
    expect(store.leads[0]).toMatchObject({ list: "office", name: "Maria Lopez", email: null, phone: "7185550142", message: expect.stringMatching(/^Hi Maria, this is \[your name\] from SwiftCard/) });
    expect(ctx.stats).toMatchObject({ leads_added: 1, usable_leads: 1 });
  });
});
