import type { AgentDef } from "./agent-def";
import { headAgent } from "./agents/head";
import { managerAgent } from "./agents/manager";
import { competitorWatch } from "./agents/competitor-watch";
import { scanCostWatch } from "./agents/deferred";
import { REPLIES } from "./agents/replies";
import { testAgent } from "./agents/test-agent";
import { watchBugs } from "./agents/watch-bugs";
import { watchApp, watchFlows, watchProbe, watchSpeed, watchUi } from "./agents/watch-ingested";
import { watchPayments, watchRevenue } from "./agents/watch-payments";
import { watchSecurity } from "./agents/watch-security";
import type { TeamId } from "./types";

// ── Every agent in the system ───────────────────────────────────────────────
// One entry per agent in the plan (docs/plans/agent-system.md, section C).
// All of them start OFF; the owner switches each on in the Agents tab.

const WATCHDOG: AgentDef[] = [watchBugs, watchSpeed, watchSecurity, watchApp, watchUi, watchFlows, watchProbe, watchPayments, watchRevenue, scanCostWatch];

export const AGENTS: AgentDef[] = withManagers([...WATCHDOG, ...REPLIES, competitorWatch, testAgent, headAgent]);

export const TEAMS: TeamId[] = ["watchdog", "replies", "contact", "leads", "office", "marketing", "system"];

export function agentById(id: string): AgentDef | undefined {
  return AGENTS.find((a) => a.id === id);
}

/** Teams that have workers get a manager; registered here so the list stays in one place. */
export function withManagers(workers: AgentDef[]): AgentDef[] {
  const teams = [...new Set(workers.filter((w) => w.team !== "system").map((w) => w.team))];
  return [...workers, ...teams.map((t) => managerAgent(t))];
}
