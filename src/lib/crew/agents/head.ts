import type { AgentDef } from "../agent-def";
import { propose } from "../approvals";
import { reportHtml } from "../reports";
import { readableEnough } from "../readability";
import { nyDay } from "../schedule";
import { sendOwnerDigest } from "@/lib/owner-digest";

// ── The head agent ("the mastermind", Fable 5.1) ────────────────────────────
// Optional and OFF by default. After the managers report, it reads all of
// them and writes one plan for tomorrow plus at most three asks. Each ask is
// an inbox card; approving one only records the decision for the managers.
// Budget: $1/day, its own cap.

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["plan", "asks"],
  properties: {
    plan: { type: "string" },
    asks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "why"],
        properties: { title: { type: "string" }, why: { type: "string" } },
      },
    },
  },
} as const;

export const headAgent: AgentDef = {
  id: "head",
  name: "Head agent",
  team: "system",
  role: "head",
  tier: "fable",
  schedule: { kind: "daily", hour: 7, minute: 45 },
  dailyUsd: 1,
  needs: ["CREW_ANTHROPIC_API_KEY"],
  maxPending: 3,
  purpose: "Reads every manager's report and writes one plan for tomorrow, with up to 3 questions for you.",
  approvalKind: "ask",
  async run(ctx) {
    const today = nyDay(ctx.now());
    const reports = (await ctx.store.listReports(20)).filter((r) => r.day === today && r.agent_id.endsWith("-manager"));
    if (reports.length < 2) return { summary: "Fewer than two manager reports today, so nothing to combine.", status: "skipped" };
    const out = await ctx.llm.askJson<{ plan: string; asks: { title: string; why: string }[] }>("plan", {
      effort: "high",
      maxTokens: 6000,
      schema: SCHEMA as unknown as Record<string, unknown>,
      system:
        "You oversee several small teams of AI agents for a tiny company. Read the managers' reports. Write the plan for tomorrow in 3 to 6 short lines a 10-year-old could read, starting each with '- '. Then list at most 3 things you need the owners to decide, each one short. Use only facts from the reports. Prefer spending less over doing more.",
      prompt: reports.map((r) => `=== ${r.agent_id} ===\n${r.body}`).join("\n\n"),
    });
    if (!out) return { summary: "The plan could not be written.", status: "skipped" };
    const body = `The plan for tomorrow\n${out.plan}`;
    if (!readableEnough(out.plan)) ctx.log("plan read above grade 5");
    await ctx.store.saveReport({ agent_id: ctx.def.id, team: "system", day: today, body, stats: { reports: reports.length } });
    await sendOwnerDigest("The plan for tomorrow", reportHtml(body, "desk"));
    let asked = 0;
    for (const a of out.asks.slice(0, 3)) {
      const r = await propose(ctx, { kind: "ask", title: a.title, summary: a.why, body: "" });
      if (r.ok) asked++;
    }
    ctx.stat("asks", asked);
    return { summary: `Wrote tomorrow's plan from ${reports.length} reports and asked ${asked} questions.` };
  },
};
