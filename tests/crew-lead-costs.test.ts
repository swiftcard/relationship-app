import { afterEach, describe, expect, it, vi } from "vitest";
import { assessSites, assessPrompt, type SiteForAssess } from "@/lib/crew/leads/assess";
import { candidateBatch } from "@/lib/crew/leads/candidates";
import { publicPeople, verifiedPeople, withPublicRoutes } from "@/lib/crew/leads/public-contacts";
import { leadsFromSite, leadsWeb } from "@/lib/crew/agents/leads";
import { officeOutreach } from "@/lib/crew/agents/office";
import { costUsd, MODEL_ID } from "@/lib/crew/models";
import { BudgetStop } from "@/lib/crew/budget";
import { setup } from "./crew-helpers";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const site = (i: number, html = `info@company${i}.com`) : SiteForAssess => ({ name: `Company ${i}`, website: `https://company${i}.com`, type: "real estate teams", area: "Brooklyn", pages: [{ url: `https://company${i}.com/team`, html }] });
const personPage = `<h2>Jane Park</h2><p>Owner</p><a href="mailto:jane@company0.com">jane@company0.com</a><a href="tel:+17185550142">Call</a><script type="application/ld+json">{"@type":"Person","name":"Jane Park","jobTitle":"Owner","email":"jane@company0.com"}</script>`;

describe("lead cost and quality safeguards", () => {
  it("reuses unpaid-to-read leftovers before another paid discovery and filters saved companies across lists", async () => {
    const { ctx, store } = await setup({ def: officeOutreach });
    const discover = vi.fn(async () => Array.from({ length: 12 }, (_, i) => ({ ...site(i), pages: undefined })));
    const first = await candidateBatch(ctx, 8, discover);
    expect(first).toHaveLength(8);
    await store.insertLeads([{ list: "cold", company: "Company 8", company_key: "company8.com", email: "info@company8.com", source_platform: "web", source_url: "https://company8.com" }]);
    const second = await candidateBatch(ctx, 8, discover);
    expect(second.map((s) => s.name)).toEqual(["Company 9", "Company 10", "Company 11"]);
    expect(discover).toHaveBeenCalledTimes(1);
    expect(ctx.stats.duplicates_rejected).toBe(1);
    expect(ctx.stats.cached_candidates).toBe(3);
  });

  it("expires cached candidates at 90 days and suppresses repeats within search results", async () => {
    const { ctx, store } = await setup({ def: leadsWeb });
    await store.kvSet(`lead-candidates:v1:${ctx.def.id}`, { at: new Date(ctx.now().getTime() - 91 * 86400000).toISOString(), items: [{ ...site(99) }] });
    const discover = vi.fn(async () => [{ ...site(1) }, { ...site(1) }]);
    expect(await candidateBatch(ctx, 12, discover)).toHaveLength(1);
    expect(discover).toHaveBeenCalledOnce();
  });

  it("does not buy discovery when it would leave insufficient enrichment headroom", async () => {
    vi.stubEnv("CREW_ANTHROPIC_API_KEY", "test");
    const { ctx, store, claude } = await setup({ def: leadsWeb });
    await store.patchAgentState(leadsWeb.id, { daily_usd_cap: 0.05 });
    // Context's agent cap is a snapshot, as in a normal run.
    ctx.state.daily_usd_cap = 0.05;
    const options = { system: "Discover", prompt: "Find local teams", maxTokens: 2500, webSearch: { maxUses: 3 } };
    await ctx.llm.ask("discover", options); // Ordinary half-output admission fits; reserved admission does not.
    const before = claude.calls.length;
    await expect(ctx.llm.ask("discover", { ...options, reserveUsd: 0.015 })).rejects.toBeInstanceOf(BudgetStop);
    expect(claude.calls).toHaveLength(before);
  });

  it("batches six eligible records, skips contactless sites, and remaps per-batch indices", async () => {
    const { ctx, claude } = await setup({ def: leadsWeb, script: (req) => JSON.stringify({ sites: [...req.prompt.matchAll(/SITE #(\d+)/g)].map((m) => ({ i: Number(m[1]), people: [], fit: 20, why: "", hook: "", opener: "", talking_point: "" })) }) });
    const sites = Array.from({ length: 8 }, (_, i) => site(i));
    sites.splice(1, 0, site(99, "No contacts or business evidence"));
    const out = await assessSites(ctx, sites, { office: false });
    expect(out?.map((a) => a.i)).toEqual([0, 2, 3, 4, 5, 6, 7, 8]);
    expect(claude.calls).toHaveLength(2);
    expect(claude.calls.every((c) => c.model === MODEL_ID.haiku)).toBe(true);
    expect(ctx.stats.assessment_skipped_no_contact).toBe(1);
  });

  it("retains completed batches if the next enrichment is stopped", async () => {
    const { ctx } = await setup({ def: leadsWeb });
    vi.spyOn(ctx.llm, "askJson").mockResolvedValueOnce({ sites: [{ i: 0, people: [], fit: 22 }] }).mockRejectedValueOnce(new BudgetStop("cap"));
    expect(await assessSites(ctx, Array.from({ length: 7 }, (_, i) => site(i)), { office: false })).toMatchObject([{ i: 0, fit: 22 }]);
  });

  it("does not discard paid enrichment when a later batch has a provider outage", async () => {
    const { ctx } = await setup({ def: leadsWeb });
    const ask = vi.spyOn(ctx.llm, "askJson").mockResolvedValueOnce({ sites: [{ i: 0, people: [], fit: 22 }] }).mockRejectedValueOnce(new Error("provider timeout"));
    expect(await assessSites(ctx, Array.from({ length: 7 }, (_, i) => site(i)), { office: false })).toMatchObject([{ i: 0, fit: 22 }]);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid/duplicate model indices and malformed people without crossing records", async () => {
    const { ctx } = await setup({ def: leadsWeb });
    vi.spyOn(ctx.llm, "askJson").mockResolvedValue({ sites: [null, { i: -1, people: [], fit: 20 }, { i: 4, people: [], fit: 20 }, { i: 0, people: [null, { name: 7 }], fit: 25 }, { i: 0, people: [], fit: 0 }] });
    expect(await assessSites(ctx, [site(0)], { office: false })).toEqual([{ i: 0, people: [], fit: 25, why: "", hook: "", opener: "", talking_point: "" }]);
  });

  it("finds public names without AI, rejects hidden/invented roles, and preserves exact contact sources", async () => {
    const pages = site(0, personPage).pages;
    expect(publicPeople(pages)).toMatchObject([{ name: "Jane Park", title: "Owner", source: "https://company0.com/team" }]);
    const [lead] = leadsFromSite({ name: "Company 0", website: "https://company0.com" }, pages, "real estate teams");
    expect(lead).toMatchObject({ name: "Jane Park", email: "jane@company0.com", phone: "+17185550142", source_url: "https://company0.com/team" });
    expect(publicPeople(site(0, personPage.replace("<p>Owner</p>", "")).pages)).toEqual([]);
    expect(verifiedPeople([{ name: "Jane Park", title: "CEO", email: "", phone: "" }], pages)).toEqual([]);
    const { ctx, store } = await setup();
    vi.spyOn(store, "isSuppressed").mockImplementation(async (keys) => keys.includes("blocked@company0.com"));
    const sourced = await withPublicRoutes(ctx, lead, [...pages, { url: "https://company0.com/contact", html: "info@company0.com blocked@company0.com" }]);
    expect(sourced.notes).toContain("info@company0.com (https://company0.com/contact)");
    expect(sourced.notes).not.toContain("blocked@");
  });

  it("retains a second verified public professional on the same company row", async () => {
    const pages = [...site(0, personPage).pages, { url: "https://company0.com/team/ray", html: "Ray Ortiz, Managing Partner ray@company0.com. Jean Dupont, Director jean@company.de" }];
    const [lead] = leadsFromSite({ name: "Company 0", website: "https://company0.com" }, pages, "real estate teams");
    const { ctx, store } = await setup();
    const sourced = await withPublicRoutes(ctx, lead, pages, [{ name: "Ray Ortiz", title: "Managing Partner", email: "ray@company0.com", phone: "" }, { name: "Jean Dupont", title: "Director", email: "jean@company.de", phone: "" }]);
    expect(sourced.notes).toContain("Ray Ortiz, Managing Partner, ray@company0.com (https://company0.com/team/ray)");
    expect(sourced.notes).not.toContain("Jean Dupont");
    await store.insertLeads([sourced]);
    expect(store.leads).toHaveLength(1);
    expect(store.leads[0].email).toBe("jane@company0.com");
  });

  it("includes contact evidence beyond 2500 characters without buying a larger context", () => {
    const { prompt } = assessPrompt([site(0, `${"navigation ".repeat(500)} Jane Park, Owner jane@company0.com`)], { office: false });
    expect(prompt).toContain("Jane Park, Owner jane@company0.com");
    expect(prompt.length).toBeLessThan(5000);
  });

  it("quantifies only a fixed-yield forecast from recorded token usage, not claimed live savings", () => {
    // Read-only SQL snapshot, 2026-11-03 00:45 UTC: Office discover on Nov 2
    // 22:45:35 UTC; independent historical extract on Oct 21 20:15:51 UTC.
    // Deliberately keep all token/cache work unchanged when lowering searches.
    const usage = { input: 249, output: 942, cacheRead: 35427, cacheWrite: 9454, webSearches: 6 };
    const extract = { input: 11151, output: 1905, cacheRead: 0, cacheWrite: 566, webSearches: 0 };
    const enrichment = costUsd("anthropic", MODEL_ID.haiku, extract);
    const before = costUsd("anthropic", MODEL_ID.sonnet, usage) + enrichment;
    const after = costUsd("anthropic", MODEL_ID.sonnet, { ...usage, webSearches: 3 }) + enrichment;
    expect(before).toBeCloseTo(0.102776, 6);
    expect(after).toBeCloseTo(0.072776, 6);
    expect(before - after).toBeCloseTo(0.03, 6);
    // Two qualified leads is a scenario assumption, not the zero-lead live run.
    expect(after / 2).toBeCloseTo(0.036388, 6);
  });
});
