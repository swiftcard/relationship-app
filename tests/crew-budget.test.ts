import { afterEach, describe, expect, it, vi } from "vitest";
import { BudgetStop, checkBudget, pickTier } from "@/lib/crew/budget";
import { costUsd } from "@/lib/crew/models";
import { DEFAULT_SETTINGS } from "@/lib/crew/store";
import type { AgentState } from "@/lib/crew/types";
import { setup } from "./crew-helpers";

// Budgets are checked BEFORE a model call; the kill switch and CREW_DISABLED
// stop everything; the cheapest model is used until drafts keep getting
// rejected.

const state = (o: Partial<AgentState> = {}): AgentState => ({ id: "a", enabled: true, model_override: null, daily_usd_cap: null, config: {}, last_run_at: null, next_run_at: null, lease_until: null, status_note: null, ...o });
const totals = (agent = 0, team = 0, total = 0) => ({ total: { usd: total, tokens: 0, cacheRead: 0, input: 0 }, byAgent: { a: { usd: agent, tokens: 0 } }, byTeam: { replies: { usd: team, tokens: 0 } } });
const agent = { id: "a", team: "replies" as const, dailyUsd: 1 };

afterEach(() => vi.unstubAllEnvs());

describe("checkBudget", () => {
  it("passes under every cap", () => {
    expect(checkBudget({ hardDisabled: false, settings: DEFAULT_SETTINGS, state: state(), agent, totals: totals(0.1, 0.1, 0.1), estUsd: 0.05 }).ok).toBe(true);
  });
  it("CREW_DISABLED and the kill switch stop everything", () => {
    expect(checkBudget({ hardDisabled: true, settings: DEFAULT_SETTINGS, state: state(), agent, totals: totals(), estUsd: 0 }).ok).toBe(false);
    expect(checkBudget({ hardDisabled: false, settings: { ...DEFAULT_SETTINGS, kill_all: true }, state: state(), agent, totals: totals(), estUsd: 0 }).ok).toBe(false);
  });
  it("a switched-off agent cannot spend", () => {
    expect(checkBudget({ hardDisabled: false, settings: DEFAULT_SETTINGS, state: state({ enabled: false }), agent, totals: totals(), estUsd: 0 }).ok).toBe(false);
  });
  it("agent cap (default and override), team cap and global cap each stop a call that would cross them", () => {
    expect(checkBudget({ hardDisabled: false, settings: DEFAULT_SETTINGS, state: state(), agent, totals: totals(0.98, 0, 0), estUsd: 0.05 }).ok).toBe(false);
    expect(checkBudget({ hardDisabled: false, settings: DEFAULT_SETTINGS, state: state({ daily_usd_cap: 5 }), agent, totals: totals(0.98, 0, 0), estUsd: 0.05 }).ok).toBe(true);
    expect(checkBudget({ hardDisabled: false, settings: { ...DEFAULT_SETTINGS, team_caps: { replies: { usd: 0.5 } } }, state: state(), agent, totals: totals(0, 0.49, 0), estUsd: 0.05 }).ok).toBe(false);
    expect(checkBudget({ hardDisabled: false, settings: DEFAULT_SETTINGS, state: state(), agent, totals: totals(0, 0, 7.99), estUsd: 0.05 }).ok).toBe(false);
  });
});

describe("router enforces the budget before calling the model", () => {
  it("stops with BudgetStop and makes no model call once the agent's cap is spent", async () => {
    const { ctx, store, claude } = await setup();
    await store.recordUsage({ run_id: null, agent_id: "t-agent", team: "replies", provider: "anthropic", model: "claude-sonnet-5-5", purpose: "x", input_tokens: 0, output_tokens: 0, cache_read: 0, cache_write: 0, web_searches: 0, batch: false, cost_usd: 1 });
    await expect(ctx.llm.ask("draft", { system: "s", prompt: "p" })).rejects.toBeInstanceOf(BudgetStop);
    expect(claude.calls).toHaveLength(0);
  });
  it("CREW_DISABLED=1 stops the call", async () => {
    vi.stubEnv("CREW_DISABLED", "1");
    const { ctx, claude } = await setup();
    await expect(ctx.llm.ask("draft", { system: "s", prompt: "p" })).rejects.toBeInstanceOf(BudgetStop);
    expect(claude.calls).toHaveLength(0);
  });
  it("records every call's usage with a cost", async () => {
    const { ctx, store } = await setup();
    await ctx.llm.ask("draft", { system: "system", prompt: "prompt" });
    expect(store.usage).toHaveLength(1);
    expect(store.usage[0].cost_usd).toBeGreaterThan(0);
    expect(store.usage[0].model).toBe("claude-sonnet-5-5");
  });
});

describe("cost math", () => {
  it("prices Sonnet 5.5 at $2/$10 per MTok, batches at half, web search at 1 cent", () => {
    expect(costUsd("anthropic", "claude-sonnet-5-5", { input: 1_000_000, output: 100_000, cacheRead: 0, cacheWrite: 0, webSearches: 0 })).toBeCloseTo(3, 6);
    expect(costUsd("anthropic", "claude-sonnet-5-5", { input: 1_000_000, output: 100_000, cacheRead: 0, cacheWrite: 0, webSearches: 0 }, { batch: true })).toBeCloseTo(1.5, 6);
    expect(costUsd("anthropic", "claude-opus-5-5", { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 0, webSearches: 2 })).toBeCloseTo(0.22, 6);
    expect(costUsd("anthropic", "claude-fable-5-1", { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0, webSearches: 0 })).toBeCloseTo(60, 6);
  });
});

describe("cheapest model that gets approved", () => {
  it("escalates to Opus after 3 rejections in the last 5, and comes back after 3 approvals in a row", () => {
    expect(pickTier("sonnet", null, ["rejected", "approved", "rejected", "done", "rejected"]).tier).toBe("opus");
    expect(pickTier("sonnet", null, ["rejected", "rejected", "approved"]).tier).toBe("sonnet");
    expect(pickTier("sonnet", null, ["approved", "done", "approved", "rejected", "rejected"]).tier).toBe("sonnet");
    expect(pickTier("sonnet", "fable", []).tier).toBe("fable");
    expect(pickTier("opus", null, ["rejected", "rejected", "rejected"]).tier).toBe("opus");
  });
});
