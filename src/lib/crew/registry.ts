import type { AgentDef } from "./agent-def";
import { managerAgent } from "./agents/manager";
import { CONTACT } from "./agents/contact";
import { scanCostWatch } from "./agents/deferred";
import { LEADS } from "./agents/leads";
import { OFFICE } from "./agents/office";
import { REPLIES } from "./agents/replies";
import { SHEET_AGENTS } from "./agents/sheet-sync";
import { watchBugs } from "./agents/watch-bugs";
import { watchApp, watchFlows, watchProbe, watchSpeed, watchUi } from "./agents/watch-ingested";
import { watchPayments, watchRevenue } from "./agents/watch-payments";
import { watchSecurity } from "./agents/watch-security";
import { isAdminTeam } from "./teams";
import type { TeamId } from "./types";

// ── Every agent in the system ───────────────────────────────────────────────
// One entry per agent in the plan (docs/plans/agent-system.md, section C).
// All of them start OFF; the owner starts each one on the admin Agents tab
// (Start / Stop). The Sheet keepers are
// infrastructure and always on. Only the Watchdog has a manager (its daily
// report and chat); the marketing teams' managers, the planning agent that
// combined their reports and the practice agent were retired 2026-10-27,
// when the admin rooms they reported into were replaced by the Sheet.

const WATCHDOG: AgentDef[] = [watchBugs, watchSpeed, watchSecurity, watchApp, watchUi, watchFlows, watchProbe, watchPayments, watchRevenue, scanCostWatch];

// The Blog Writer, SEO, GEO, Social Media, Competitor Intel, Events and
// Partnerships agents were removed 2026-10-29 (owner): the Sheet is only for
// messages to people (Name, Message, Link), and none of them wrote one.
export const AGENTS: AgentDef[] = withManagers([...WATCHDOG, ...REPLIES, ...CONTACT, ...LEADS, ...OFFICE, ...SHEET_AGENTS]);

/** The teams the admin page shows as groups. Everything else is started and stopped one by one and works into the Google Sheet. */
export { ADMIN_TEAMS } from "./teams";

export const TEAMS: TeamId[] = ["watchdog", "replies", "contact", "leads", "office", "marketing", "system"];

export function agentById(id: string): AgentDef | undefined {
  return AGENTS.find((a) => a.id === id);
}

/** The admin page's teams get a manager (the Watchdog's daily report and chat); registered here so the list stays in one place. */
export function withManagers(workers: AgentDef[]): AgentDef[] {
  const teams = [...new Set(workers.filter((w) => isAdminTeam(w.team)).map((w) => w.team))];
  return [...workers, ...teams.map((t) => managerAgent(t))];
}
