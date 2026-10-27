import { afterEach, describe, expect, it, vi } from "vitest";
import { tickAuthorized } from "@/lib/crew/auth";
import { decide } from "@/lib/crew/decide";
import { FakeClaude, FakeCritic } from "@/lib/crew/llm/fake";
import { testAgent } from "./crew-practice-agent";
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
    expect((await runTick({ store, providers: { claude: null, critic: null }, agents: [busy] })).stopped).toMatch(/office is locked/);
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

describe("tick and the office doors", () => {
  const WED_2PM = () => new Date("2026-10-21T18:00:00Z");
  const providers = { claude: null, critic: null };

  it("a locked door holds its workers; opening it lets the overdue ones run", async () => {
    const store = new MemoryStore();
    const worker = fakeAgent({ id: "w", team: "watchdog" });
    const other = fakeAgent({ id: "o", team: "contact" });
    for (const id of ["w", "o"]) await store.patchAgentState(id, { enabled: true });
    await store.patchTeam("watchdog", { door_open: false });
    const r = await runTick({ store, providers, agents: [worker, other], now: WED_2PM });
    expect(r.ran.map((x) => x.agent)).toEqual(["o"]);
    expect(r.skipped).toEqual([{ agent: "w", why: "door locked" }]);
    // The skip writes nothing on the agent: its next run time stays due.
    expect((await store.getAgentState("w")).next_run_at).toBeNull();

    await store.patchTeam("watchdog", { door_open: true });
    expect((await runTick({ store, providers, agents: [worker], now: WED_2PM })).ran.map((x) => x.agent)).toEqual(["w"]);
  });

  it("a manager still writes its morning report behind a locked door", async () => {
    const store = new MemoryStore();
    const mgr = fakeAgent({ id: "replies-mgr", team: "replies", role: "manager" });
    await store.patchAgentState(mgr.id, { enabled: true });
    await store.patchTeam("replies", { door_open: false });
    expect((await runTick({ store, providers, agents: [mgr], now: WED_2PM })).ran.map((x) => x.agent)).toEqual(["replies-mgr"]);
  });

  it("respects opening hours and a manager's pause", async () => {
    const store = new MemoryStore();
    const w = fakeAgent({ id: "w", team: "watchdog" });
    await store.patchAgentState("w", { enabled: true });
    await store.patchTeam("watchdog", { hours: { days: [1, 2, 3, 4, 5], open: 540, close: 1080 } });
    const night = () => new Date("2026-10-22T02:00:00Z"); // Wed 10pm
    expect((await runTick({ store, providers, agents: [w], now: night })).skipped).toEqual([{ agent: "w", why: "door locked" }]);

    await store.patchAgentState("w", { paused_until: "2026-10-22T03:59:00Z" });
    expect((await runTick({ store, providers, agents: [w], now: WED_2PM })).skipped[0].why).toMatch(/^paused until/);
    // Once the pause is over the shift runs.
    expect((await runTick({ store, providers, agents: [w], now: () => new Date("2026-10-22T14:00:00Z") })).ran).toHaveLength(1);
  });

  it("a door locked mid-shift stops the agent at its next model call", async () => {
    const store = new MemoryStore();
    const w = fakeAgent({
      id: "w",
      team: "watchdog",
      run: async (ctx) => {
        await ctx.store.patchTeam("watchdog", { door_open: false });
        await ctx.llm.ask("draft", { system: "s", prompt: "p" });
        return { summary: "should not get here" };
      },
    });
    await store.patchAgentState("w", { enabled: true });
    const claude = new FakeClaude();
    const r = await runTick({ store, providers: { claude, critic: null }, agents: [w], now: WED_2PM });
    expect(r.ran[0]).toMatchObject({ status: "locked", summary: "Stopped: door locked." });
    expect(claude.calls).toHaveLength(0);
    expect((await store.getAgentState("w")).lease_until).toBeNull();
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
