import type { AgentDef } from "../agent-def";
import { missingEnv } from "../env";
import { reportHtml, teamStats, writeReport } from "../reports";
import { sendOwnerDigest } from "@/lib/owner-digest";
import type { TeamId } from "../types";

// ── One manager per team (Opus 5.5) ─────────────────────────────────────────
// Every morning it reads what its team did (counted in code), writes the
// report in plain words, saves it to the Agents tab and emails it.

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
    needs: ["CREW_ANTHROPIC_API_KEY"],
    maxPending: 3,
    purpose: `Writes the ${TEAM_NAME[team]} team's daily report in plain words and emails it to you.`,
    async run(ctx) {
      const { AGENTS } = await import("../registry");
      const stats = await teamStats(ctx.store, team, AGENTS, ctx.now(), (d) => missingEnv(d.needs));
      if (stats.runs.total === 0 && stats.inbox.new_items === 0 && stats.inbox.waiting_now === 0) {
        return { summary: "Nothing happened on this team yesterday, so no report.", status: "skipped" };
      }
      const body = await writeReport(ctx, stats, TEAM_NAME[team]);
      const id = await ctx.store.saveReport({ agent_id: ctx.def.id, team, day: stats.day, body, stats: stats as unknown as Record<string, unknown> });
      const sent = await sendOwnerDigest(`${TEAM_NAME[team]} daily report`, reportHtml(body));
      if (sent.ok) await ctx.store.markReportEmailed(id);
      ctx.stat("reports_written");
      return { summary: `Wrote the ${TEAM_NAME[team]} report${sent.ok ? " and emailed it" : " (email not sent: " + (sent.skipped ?? "send failed") + ")"}.` };
    },
  };
}
