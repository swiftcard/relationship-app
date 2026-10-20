import { describe, expect, it } from "vitest";
import { gradeLevel, numbersAreGrounded, readableEnough } from "@/lib/crew/readability";
import { templateReport, writeReport, type TeamStats } from "@/lib/crew/reports";
import { setup } from "./crew-helpers";

// Reports are written for a fifth-grader and cannot invent numbers.

const stats: TeamStats = {
  team: "replies",
  day: "2026-10-20",
  money: { spent_usd: 1.25, cache_share_pct: 40, by_agent: [] },
  runs: { total: 6, errors: 0, stopped_by_budget: 0 },
  inbox: { new_items: 4, waiting_now: 3, approved: 1, rejected: 0, posted_or_done: 0 },
  rejected_reasons: [],
  counts: { threads_read: 120 },
  agents_on: ["Reddit replies"],
  agents_needing_setup: [],
  savings: ["40% of what the models read came from the cache, which costs a tenth."],
};

describe("readability", () => {
  it("passes short plain sentences and fails dense ones", () => {
    expect(readableEnough("The team read 120 posts. It wrote 4 drafts. You have 3 to check.")).toBe(true);
    expect(gradeLevel("Comprehensive multidisciplinary optimization methodologies notwithstanding, organizational stakeholders necessitate considerable deliberation regarding implementation.")).toBeGreaterThan(5);
  });
  it("flags numbers the facts don't contain", () => {
    expect(numbersAreGrounded("We read 120 posts and spent $1.25.", stats).ok).toBe(true);
    expect(numbersAreGrounded("We read 500 posts.", stats)).toEqual({ ok: false, stray: ["500"] });
  });
  it("the plain template is itself readable and grounded", () => {
    const t = templateReport(stats, "Replies");
    expect(t).toContain("What I need from you");
    expect(numbersAreGrounded(t, stats).ok).toBe(true);
  });
});

describe("writeReport", () => {
  it("falls back to the template when the manager's text invents a number twice", async () => {
    const { ctx } = await setup({ script: () => "What happened\n- We read 9999 posts." });
    await ctx.store.patchAgentState(ctx.def.id, { enabled: true });
    const body = await writeReport(ctx, stats, "Replies");
    expect(body).not.toContain("9999");
    expect(body).toContain("Money used today");
  });
  it("keeps a good report", async () => {
    const good = "What happened\n- The team read 120 posts.\nWhat I need from you\n- Check 3 drafts.\nMoney used today\n- $1.25.\nHow I saved tokens\n- The cache helped.";
    const { ctx } = await setup({ script: () => good });
    expect(await writeReport(ctx, stats, "Replies")).toContain("The team read 120 posts.");
  });
});
