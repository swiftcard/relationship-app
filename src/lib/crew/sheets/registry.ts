import { AGENTS } from "../registry";
import { ALL_TABS, tabsForAgent } from "./tabs";

// ── Which agents live in the Sheet ──────────────────────────────────────────
// Everything that is not the Watchdog: the marketing, outreach and lead
// agents (workers and their managers) are run from the Google Sheet; the
// Watchdog stays on the admin page. The Sheet sync agents themselves are
// infrastructure and sit in neither list.

export const SHEET_TEAMS = new Set(["replies", "contact", "leads", "office", "marketing", "system"]);

/** Agents whose on/off switch and output live in the Sheet. */
export const SHEET_AGENT_IDS = new Set(AGENTS.filter((d) => SHEET_TEAMS.has(d.team) && !d.id.startsWith("sheet-")).map((d) => d.id));

/** Worker agents that produce rows and therefore must have a tab (pinned by tests/crew-sheets). */
export const TAB_WORKER_IDS = AGENTS.filter((d) => SHEET_AGENT_IDS.has(d.id) && d.role === "worker" && d.approvalKind !== undefined && !d.locked && d.team !== "system").map((d) => d.id);

export function tabForAgent(agentId: string): string | null {
  return tabsForAgent(agentId)[0]?.id ?? null;
}

export { ALL_TABS };
