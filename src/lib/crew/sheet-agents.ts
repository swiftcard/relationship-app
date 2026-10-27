import type { AgentDef } from "./agent-def";
import { plainNeeds, type Tone } from "./agent-status";
import { missingEnv } from "./env";
import { AGENTS } from "./registry";
import { effectiveSchedule, nyDayStart, plainSchedule, type ScheduleOverrides } from "./schedule";
import { AGENT_TABS, LEAD_TAB_BY_SOURCE } from "./sheets/tabs";
import type { CrewStore, RunRow } from "./store";
import type { AgentState, Settings } from "./types";

// ── The Start / Stop list on the admin Agents tab ───────────────────────────
// One row per agent that works into the SwiftCard Leads sheet, named after
// its tab: what it finds, whether it is going, how many rows it added today,
// and one button. Start = on and working now (then every 15 minutes until
// today's ceiling, every day, until Stop). Stop = off at its next step. The
// Sheet's Controls tab flips the same switch. Server only.

export type SheetAgentKind = "running" | "working" | "done_today" | "stopped" | "paused" | "failed" | "setup";

export type SheetAgentRow = {
  id: string;
  /** The agent's tab name, which is its name everywhere. */
  name: string;
  purpose: string;
  kind: SheetAgentKind;
  word: string;
  tone: Tone;
  line: string;
  addedToday: number;
  /** How it runs while on, in words ("All the time", "Every day at 9:00am", "When you paste something"). */
  pace: string;
  tabUrl: string | null;
  running: boolean;
  canStart: boolean;
};

const WORD: Record<SheetAgentKind, { word: string; tone: Tone }> = {
  running: { word: "Running", tone: "green" },
  working: { word: "Working now", tone: "blue" },
  done_today: { word: "Done for today", tone: "green" },
  stopped: { word: "Stopped", tone: "gray" },
  paused: { word: "Paused", tone: "amber" },
  failed: { word: "Failed", tone: "red" },
  setup: { word: "Needs setup", tone: "gray" },
};

/** Every agent that has a tab, in the workbook's tab order. */
export function sheetAgentDefs(): { def: AgentDef; tab: string }[] {
  return AGENT_TABS.filter((t) => t.layout === "rows")
    .flatMap((t) => t.agents.map((id) => ({ def: AGENTS.find((d) => d.id === id), tab: t.name })))
    .filter((x): x is { def: AgentDef; tab: string } => !!x.def && !x.def.locked);
}

export function sheetAgentState(o: { def: AgentDef; state: AgentState | undefined; lastRun: RunRow | null; now: Date; settings: Settings; hardDisabled: boolean }): { kind: SheetAgentKind; line: string } {
  const missing = missingEnv(o.def.needs);
  const st = o.state;
  if (missing.length) return { kind: "setup", line: `Needs ${plainNeeds(missing)} before it can start.` };
  if (!st?.enabled) return { kind: "stopped", line: "Press Start and it begins right away." };
  if (o.settings.kill_all || o.hardDisabled) return { kind: "paused", line: "All agents are paused. Tap Resume all agents at the top." };
  if (st.lease_until && new Date(st.lease_until).getTime() > o.now.getTime()) return { kind: "working", line: "Looking for new rows right now." };
  if (o.lastRun?.status === "error" || st.status_note?.startsWith("Last run failed")) return { kind: "failed", line: "The last run didn't finish. Press Start to try again." };
  if (o.lastRun?.summary?.startsWith("Done for today")) return { kind: "done_today", line: "Reached today's limit. It starts again tomorrow by itself." };
  return { kind: "running", line: "Keeps adding rows until you press Stop." };
}

export async function loadSheetAgents(store: CrewStore, o: { now: Date; settings: Settings; hardDisabled: boolean; states: AgentState[]; overrides: ScheduleOverrides | null; sheetId: string | null; gids: Record<string, number> | null }): Promise<SheetAgentRow[]> {
  const defs = sheetAgentDefs();
  const day = nyDayStart(o.now).toISOString();
  // Each agent's own last run (one small read each): a shared "latest 300 runs" would be all continuous finders.
  const [approvals, coldToday, officeToday, lastRuns] = await Promise.all([
    store.listApprovals({ sinceIso: day, agentIds: defs.map((d) => d.def.id), limit: 5000 }),
    store.countLeadsSince(day, "cold"),
    store.countLeadsSince(day, "office"),
    Promise.all(defs.map((d) => store.recentRuns(d.def.id, 1).then((r) => r[0] ?? null))),
  ]);
  const byState = new Map(o.states.map((s) => [s.id, s]));
  const leadSource = Object.fromEntries(Object.entries(LEAD_TAB_BY_SOURCE).map(([src, t]) => [t.agents[0], src]));
  return defs.map(({ def, tab }, i) => {
    const lastRun = lastRuns[i];
    const { kind, line } = sheetAgentState({ def, state: byState.get(def.id), lastRun, now: o.now, settings: o.settings, hardDisabled: o.hardDisabled });
    const drafts = approvals.filter((a) => a.agent_id === def.id).length;
    const added = leadSource[def.id] ? (coldToday[leadSource[def.id]] ?? 0) : def.id === "office-outreach" ? Object.values(officeToday).reduce((a, b) => a + b, 0) + drafts : drafts;
    const rule = effectiveSchedule(def, o.overrides);
    const pace = rule.kind === "on_input" ? "When you paste something in" : rule.kind === "every" && rule.minutes <= 30 ? "All the time, up to today's limit" : plainSchedule(rule);
    const gid = o.gids?.[tab];
    return {
      id: def.id,
      name: tab,
      purpose: def.purpose,
      kind,
      ...WORD[kind],
      line,
      addedToday: added,
      pace,
      tabUrl: o.sheetId ? `https://docs.google.com/spreadsheets/d/${o.sheetId}/edit${gid !== undefined ? `#gid=${gid}` : ""}` : null,
      running: !!byState.get(def.id)?.enabled,
      canStart: kind !== "setup",
    };
  });
}
