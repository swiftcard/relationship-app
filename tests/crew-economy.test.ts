import { afterEach, describe, expect, it, vi } from "vitest";
import { pickTier } from "@/lib/crew/budget";
import { routeTier } from "@/lib/crew/context";
import { debate } from "@/lib/crew/debate";
import { requestParams, supportsFallback } from "@/lib/crew/llm/anthropic";
import { costUsd, MODEL_ID } from "@/lib/crew/models";
import { managerAgent } from "@/lib/crew/agents/manager";
import { instagramComments, redditReplies } from "@/lib/crew/agents/replies";
import { AGENTS } from "@/lib/crew/registry";
import { DEFAULT_SETTINGS } from "@/lib/crew/store";
import { reportFindings } from "@/lib/crew/watch/findings";
import { FULL, fakeAgent, setup } from "./crew-helpers";

// Economy mode (the default while SwiftCard has no users): Haiku for sorting
// and short comments, a free Watchdog and free manager reports, Sonnet
// tie-breaks, no ChatGPT second opinion unless switched on, $2/day cap.

afterEach(() => vi.unstubAllEnvs());

describe("defaults", () => {
  it("start cheap: economy on, second opinion off, $2 a day", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ economy: true, second_opinion: false, daily_usd_cap: 2 });
  });
});

describe("which model a call uses", () => {
  it("routes sorting work to Haiku only in economy, and never web search", () => {
    expect(routeTier({ agentTier: "sonnet", purpose: "score", economy: true, webSearch: false })).toBe("haiku");
    expect(routeTier({ agentTier: "sonnet", purpose: "score", economy: false, webSearch: false })).toBe("sonnet");
    expect(routeTier({ agentTier: "sonnet", purpose: "draft", economy: true, webSearch: false })).toBe("sonnet");
    expect(routeTier({ agentTier: "haiku", purpose: "discover", economy: true, webSearch: true })).toBe("sonnet");
    expect(routeTier({ asked: "opus", agentTier: "sonnet", purpose: "tiebreak", economy: true, webSearch: false })).toBe("sonnet");
    expect(routeTier({ asked: "opus", agentTier: "sonnet", purpose: "tiebreak", economy: false, webSearch: false })).toBe("opus");
  });

  it("an agent's calls really go out on those models", async () => {
    const { ctx, claude } = await setup({ def: fakeAgent({ economyTier: "haiku" }) });
    await ctx.llm.ask("score", { system: "s", prompt: "p" });
    await ctx.llm.ask("draft", { system: "s", prompt: "p" });
    await ctx.llm.ask("discover", { system: "s", prompt: "p", webSearch: { maxUses: 1 } });
    expect(claude.calls.map((c) => c.model)).toEqual([MODEL_ID.haiku, MODEL_ID.haiku, MODEL_ID.sonnet]);
  });

  it("comment agents use Haiku in economy and Sonnet when it's off; replies and DMs stay on Sonnet", async () => {
    expect((await setup({ def: instagramComments })).ctx.tier).toBe("haiku");
    expect((await setup({ def: instagramComments, settings: FULL })).ctx.tier).toBe("sonnet");
    expect((await setup({ def: redditReplies })).ctx.tier).toBe("sonnet");
    for (const a of AGENTS.filter((x) => x.approvalKind === "dm" || x.approvalKind === "connect_note" || x.approvalKind === "blog_post")) expect(a.economyTier ?? a.tier, a.id).toBe("sonnet");
  });

  it("rejected Haiku drafts step up to Sonnet, then back", () => {
    expect(pickTier("haiku", null, ["rejected", "rejected", "approved", "rejected"]).tier).toBe("sonnet");
    expect(pickTier("haiku", null, ["approved", "approved", "done"]).tier).toBe("haiku");
  });

  it("Haiku 5.5 calls carry no server-side fallback (it has none); the others keep it", () => {
    expect(supportsFallback(MODEL_ID.haiku)).toBe(false);
    for (const t of ["sonnet", "opus", "fable"] as const) expect(supportsFallback(MODEL_ID[t])).toBe(true);
    const p = requestParams({ model: MODEL_ID.haiku, system: "s", prompt: "p", maxTokens: 100, effort: "low" }) as Record<string, unknown>;
    expect(p).not.toHaveProperty("fallbacks");
    expect(p).not.toHaveProperty("betas");
  });

  it("Haiku is priced at $0.10 / $0.50 per million tokens", () => {
    expect(costUsd("anthropic", MODEL_ID.haiku, { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0, webSearches: 0 })).toBeCloseTo(0.6, 6);
  });
});

describe("second opinion switch", () => {
  it("off (the default): no ChatGPT call, and the card says you're the reviewer", async () => {
    const { ctx, critic } = await setup();
    const r = await debate(ctx, { kind: "reply", draft: "x".repeat(400), brief: "b", rules: "r", revise: async () => "y" });
    expect(critic.calls).toHaveLength(0);
    expect(r.record).toMatchObject({ skipped: true, reason: "off" });
    expect(r.record.line).toMatch(/Second opinion is off/);
  });
});

describe("free Watchdog and free reports", () => {
  it("in economy a new problem becomes a card with no model call", async () => {
    const { ctx, claude, store } = await setup({ def: fakeAgent({ id: "watch-x", team: "watchdog", approvalKind: "code_fix" }) });
    const r = await reportFindings(ctx, [{ fingerprint: "b1", kind: "bug", source: "error_events", title: "api:/cards: boom", detail: { message: "boom" } }]);
    expect(r).toEqual({ fresh: 1, proposed: 1 });
    expect(claude.calls).toHaveLength(0);
    expect(store.approvals[0]).toMatchObject({ kind: "code_fix", title: "Fix: api:/cards: boom" });
    expect(store.approvals[0].summary).toMatch(/^The site hit an error\./);
  });

  it("Watchdog agents and managers can be switched on with no Anthropic key", () => {
    for (const a of AGENTS.filter((x) => x.team === "watchdog" || x.role === "manager")) {
      expect(a.needs, a.id).not.toContain("CREW_ANTHROPIC_API_KEY");
      if (!a.locked) expect(a.freeInEconomy, a.id).toBe(true);
    }
  });

  it("a manager in economy writes the plain report from the counts, no model call", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const mgr = managerAgent("replies");
    const { ctx, claude, store } = await setup({ def: mgr });
    const run = await store.startRun("replies-reddit");
    await store.finishRun(run, "ok", "drafted 2", { drafts_made: 2 });
    const r = await mgr.run(ctx);
    expect(r.summary).toMatch(/Wrote the Replies report/);
    expect(claude.calls).toHaveLength(0);
    expect(store.reports[0].body).toContain("What I need from you");
  });
});
