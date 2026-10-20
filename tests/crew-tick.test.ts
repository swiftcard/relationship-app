import { afterEach, describe, expect, it, vi } from "vitest";
import { tickAuthorized } from "@/lib/crew/auth";
import { decide } from "@/lib/crew/decide";
import { FakeClaude, FakeCritic } from "@/lib/crew/llm/fake";
import { testAgent } from "@/lib/crew/agents/test-agent";
import { MemoryStore } from "@/lib/crew/store-memory";
import { runTick } from "@/lib/crew/tick";
import { fakeAgent } from "./crew-helpers";

// The whole loop with fake models: tick → test agent → draft → second opinion
// → ledger → inbox → Approve → "I posted it".

afterEach(() => vi.unstubAllEnvs());

describe("tick", () => {
  it("runs the test agent end to end", async () => {
    vi.stubEnv("CREW_ANTHROPIC_API_KEY", "test");
    const store = new MemoryStore();
    await store.updateSettings({ economy: false, second_opinion: true });
    await store.patchAgentState(testAgent.id, { enabled: true });
    const claude = new FakeClaude(() => "Two apps is overkill for that. A card with a built-in link page covers both, and SwiftCard does that.");
    const report = await runTick({ store, providers: { claude, critic: new FakeCritic(["agree"]) }, agents: [testAgent] });
    expect(report.ran).toEqual([{ agent: "system-test", status: "ok", summary: "Put one practice draft in the inbox." }]);
    const [a] = store.approvals;
    expect(a.status).toBe("pending");
    expect(a.debate?.outcome).toBe("agreed");
    expect(a.body).toContain("(I work on SwiftCard, so I'm biased.)");
    expect(store.usage.length).toBeGreaterThanOrEqual(2); // draft + critique
    expect(store.usage.some((u) => u.provider === "openai")).toBe(true);

    expect((await decide(store, a.id, { action: "approve", by: "owner" })).ok).toBe(true);
    expect((await decide(store, a.id, { action: "posted", by: "owner" })).ok).toBe(true);
    expect((await store.getApproval(a.id))!.status).toBe("done");

    // Not due again for a day, so a second tick does nothing.
    const again = await runTick({ store, providers: { claude, critic: new FakeCritic() }, agents: [testAgent] });
    expect(again.ran).toEqual([]);
  });

  it("skips agents that are off, missing keys, or leased; stops on the kill switch", async () => {
    const store = new MemoryStore();
    const off = fakeAgent({ id: "off" });
    const needy = fakeAgent({ id: "needy", needs: ["CREW_STRIPE_READ_KEY"] });
    const busy = fakeAgent({ id: "busy" });
    await store.patchAgentState("needy", { enabled: true });
    await store.patchAgentState("busy", { enabled: true, lease_until: new Date(Date.now() + 60_000).toISOString() });
    const r = await runTick({ store, providers: { claude: null, critic: null }, agents: [off, needy, busy] });
    expect(r.ran).toEqual([]);
    expect(r.skipped.map((s) => s.agent)).toEqual(["needy", "busy"]);
    expect((await store.getAgentState("needy")).status_note).toBe("Needs: CREW_STRIPE_READ_KEY");

    await store.updateSettings({ kill_all: true });
    expect((await runTick({ store, providers: { claude: null, critic: null }, agents: [busy] })).stopped).toMatch(/red switch/);
  });

  it("a budget stop is recorded as 'budget', not an error, and the lease is released", async () => {
    const store = new MemoryStore();
    const spender = fakeAgent({ id: "spender", run: async (ctx) => (await ctx.llm.ask("x", { system: "s", prompt: "p" }), { summary: "spent" }) });
    await store.patchAgentState("spender", { enabled: true });
    await store.updateSettings({ daily_usd_cap: 0 });
    const r = await runTick({ store, providers: { claude: new FakeClaude(), critic: null }, agents: [spender] });
    expect(r.ran[0].status).toBe("budget");
    expect((await store.getAgentState("spender")).lease_until).toBeNull();
  });

  it("not set up yet → says so and runs nothing", async () => {
    const store = new MemoryStore();
    store.isReady = false;
    expect(await runTick({ store, providers: { claude: null, critic: null } })).toMatchObject({ ready: false, ran: [] });
  });
});

describe("tick auth", () => {
  it("fails closed without a secret and rejects a wrong one", () => {
    vi.stubEnv("CREW_TICK_SECRET", "");
    expect(tickAuthorized("Bearer ")).toBe(false);
    vi.stubEnv("CREW_TICK_SECRET", "s3cret-value");
    expect(tickAuthorized("Bearer s3cret-value")).toBe(true);
    expect(tickAuthorized("Bearer s3cret-valuX")).toBe(false);
    expect(tickAuthorized(null)).toBe(false);
  });
});
