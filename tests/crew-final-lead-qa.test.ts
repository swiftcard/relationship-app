import { describe, expect, it, vi } from "vitest";
import { leadsFromSite, leadsWeb } from "@/lib/crew/agents/leads";
import { officeLeads } from "@/lib/crew/agents/office";
import { verifiedPeople } from "@/lib/crew/leads/public-contacts";
import { candidateBatch, completeCandidateBatch } from "@/lib/crew/leads/candidates";
import { buildContext } from "@/lib/crew/context";
import { setup } from "./crew-helpers";

const alice = { name: "Alice Park", title: "Owner", email: "bob@acme.com", phone: "2125550142" };
const pages = [{ url: "https://acme.com/team", html: '<article><h2>Alice Park</h2><p>Owner</p></article><article><h2>Bob Smith</h2><p>Agent</p>bob@acme.com (212) 555-0142</article><footer>info@acme.com</footer>' }];

describe("final release-blocker reproductions", () => {
  it("never attaches another agent's email or phone to the owner in the preceding card", () => {
    expect(verifiedPeople([alice], pages)).toMatchObject([{ name: "Alice Park", email: "", phone: "" }]);
    const [row] = leadsFromSite({ name: "Acme", website: "https://acme.com" }, pages, "real estate teams", { i: 0, people: [alice], fit: 30, why: "", hook: "", opener: "", talking_point: "" });
    expect(row.email).toBe("info@acme.com");
    expect(row.phone).toBeNull();
    const [office] = officeLeads({ name: "Acme", website: "https://acme.com", area: "NYC", type: "real estate teams", pages }, { people: [alice], talking_point: "", opener: "Hi Alice, how do you handle contacts?" });
    expect(office).toMatchObject({ name: null, email: "info@acme.com", message: null });
  });

  it("keeps selected candidates recoverable until processing succeeds", async () => {
    const { ctx, store } = await setup({ def: leadsWeb });
    const discover = vi.fn(async () => [{ name: "Acme", website: "https://acme.com", type: "real estate teams", area: "NYC" }]);
    await candidateBatch(ctx, 12, discover);
    // Simulate termination before the database save; a new run must not buy
    // the same discovery again or lose this otherwise valid business.
    const state = await store.getAgentState(leadsWeb.id);
    const next = await buildContext({ def: leadsWeb, state, store, providers: { claude: null, critic: null }, runId: null });
    expect(await candidateBatch(next, 12, discover)).toHaveLength(1);
    expect(discover).toHaveBeenCalledTimes(1);
  });

  it("does not start a paid extraction after the run's persistence cutoff", async () => {
    const { def, store, claude } = await setup({ def: leadsWeb });
    const ctx = await buildContext({ def, store, providers: { claude, critic: null }, runId: null, deadline: Date.now() + 5000 });
    await expect(ctx.llm.ask("extract", { system: "Read", prompt: "Business evidence", maxTokens: 400 })).rejects.toThrow(/time|deadline/i);
    expect(claude.calls).toHaveLength(0);
  });

  it("removes completed candidates while retaining unstarted ones without repurchasing discovery", async () => {
    const { ctx } = await setup({ def: leadsWeb });
    const discover = vi.fn(async () => ["acme", "next"].map((name) => ({ name, website: `https://${name}.com`, type: "real estate teams", area: "NYC" })));
    await candidateBatch(ctx, 12, discover);
    await completeCandidateBatch(ctx, ["https://acme.com"]);
    expect((await candidateBatch(ctx, 12, discover)).map((c) => c.name)).toEqual(["next"]);
    expect(discover).toHaveBeenCalledOnce();
  });

  it("bounds model and reviewer calls to the remaining time and rechecks every call", async () => {
    const { def, store, claude, critic } = await setup({ def: leadsWeb });
    const ctx = await buildContext({ def, store, providers: { claude, critic }, runId: null, deadline: Date.now() + 35_000 });
    await ctx.llm.ask("extract", { system: "Read", prompt: "Evidence", maxTokens: 400 });
    expect(claude.calls[0].timeoutMs).toBeGreaterThan(5000);
    expect(claude.calls[0].timeoutMs).toBeLessThanOrEqual(15_000);
    const review = vi.spyOn(critic, "critique");
    await ctx.llm.critique("Review", "Evidence", {});
    expect(review).toHaveBeenCalledWith("Review", "Evidence", {}, expect.any(Number));
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31_000);
    try {
      await expect(ctx.llm.ask("extract", { system: "Read", prompt: "Evidence" })).rejects.toThrow(/deadline/);
      await expect(ctx.llm.critique("Review", "Evidence", {})).rejects.toThrow(/deadline/);
      expect(claude.calls).toHaveLength(1);
      expect(review).toHaveBeenCalledOnce();
    } finally { clock.mockRestore(); }
  });
});
