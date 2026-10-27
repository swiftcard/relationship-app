import type { AgentDef } from "../agent-def";
import { missingEnv } from "../env";
import { reportHtml, teamStats, templateReport, writeReport } from "../reports";
import { sendOwnerDigest } from "@/lib/owner-digest";
import type { TeamId } from "../types";

// ── A team manager (Opus 5.5; free in economy mode) ─────────────────────────
// One per admin group (registry.withManagers; since 2026-10-27 only the
// Watchdog: the marketing agents report through the Sheet). Every morning it
// reads what its team did (counted in code), writes the report in plain
// words, saves it to the Agents tab and emails it. In economy mode the report
// is the plain template built from the same counts, no AI.

export const TEAM_NAME: Record<TeamId, string> = {
  system: "System",
  watchdog: "Watchdog",
  replies: "Replies",
  contact: "Contact",
  leads: "Email leads",
  office: "Office outreach",
  marketing: "Marketing",
};

export function managerAgent(team: TeamId, o?: { hour?: number; minute?: number }): AgentDef {
  return {
    id: `${team}-manager`,
    name: `${TEAM_NAME[team]} manager`,
    team,
    role: "manager",
    tier: "opus",
    schedule: { kind: "daily", hour: o?.hour ?? 7, minute: o?.minute ?? 0 },
    dailyUsd: 0.5,
    // Economy mode (or no Claude key) writes the report from the counted facts
    // with no AI, so a manager costs nothing.
    needs: [],
    freeInEconomy: true,
    maxPending: 3,
    purpose: `Writes the ${TEAM_NAME[team]} team's daily report in plain words and emails it to you.`,
    async run(ctx) {
      const { AGENTS } = await import("../registry");
      const stats = await teamStats(ctx.store, team, AGENTS, ctx.now(), (d) => missingEnv(d.needs));
      if (stats.runs.total === 0 && stats.inbox.new_items === 0 && stats.inbox.waiting_now === 0) {
        return { summary: "Nothing happened on this team yesterday, so no report.", status: "skipped" };
      }
      const body = ctx.settings.economy || !ctx.llm.hasClaude ? templateReport(stats, TEAM_NAME[team]) : await writeReport(ctx, stats, TEAM_NAME[team]);
      if (ctx.settings.economy || !ctx.llm.hasClaude) ctx.stat("no_llm_needed");
      const id = await ctx.store.saveReport({ agent_id: ctx.def.id, team, day: stats.day, body, stats: stats as unknown as Record<string, unknown> });
      const sent = await sendOwnerDigest(`${TEAM_NAME[team]} daily report`, reportHtml(body, team));
      if (sent.ok) await ctx.store.markReportEmailed(id);
      ctx.stat("reports_written");
      return { summary: `Wrote the ${TEAM_NAME[team]} report${sent.ok ? " and emailed it" : " (email not sent: " + (sent.skipped ?? "send failed") + ")"}.` };
    },
  };
}
