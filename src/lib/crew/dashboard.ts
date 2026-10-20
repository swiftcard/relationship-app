import type { AgentDef } from "./agent-def";
import { ENV_HELP, crewHardDisabled, missingEnv } from "./env";
import { AGENTS } from "./registry";
import { describeSchedule, nyDayStart } from "./schedule";
import type { CrewStore, ReportRow, RunRow, UsageTotals } from "./store";
import type { AgentState, Approval, EnvKey, Finding, Lead, Settings } from "./types";

// Everything the Agents tab shows, loaded in one place (server only).

export type AgentRow = {
  def: AgentDef;
  state: AgentState;
  missing: EnvKey[];
  schedule: string;
  today: { usd: number; tokens: number };
  cap: number;
  lastRun: RunRow | null;
};

export type Dashboard = {
  ready: boolean;
  hardDisabled: boolean;
  settings: Settings;
  agents: AgentRow[];
  inbox: Approval[];
  approved: Approval[];
  recentDone: Approval[];
  today: UsageTotals;
  week: UsageTotals;
  reports: ReportRow[];
  findings: Finding[];
  leads: { todayBySource: Record<string, number>; officeToday: Record<string, number>; recent: (Lead & { id: string; created_at: string })[]; office: (Lead & { id: string; created_at: string })[] };
  envNeeded: { key: EnvKey; help: string; agents: string[] }[];
};

export async function loadDashboard(store: CrewStore, now = new Date()): Promise<Dashboard | { ready: false; envNeeded: Dashboard["envNeeded"] }> {
  const envNeeded = neededEnv(AGENTS);
  if (!(await store.ready())) return { ready: false, envNeeded };
  const dayStart = nyDayStart(now).toISOString();
  const weekStart = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const [settings, states, inbox, approved, recentDone, today, week, reports, findings, runs, todayBySource, officeToday, recent, office] = await Promise.all([
    store.getSettings(),
    store.listAgentStates(),
    store.listApprovals({ status: ["pending"], limit: 60 }),
    store.listApprovals({ status: ["approved"], limit: 60 }),
    store.listApprovals({ status: ["done", "rejected"], limit: 15 }),
    store.usageTotals(dayStart),
    store.usageTotals(weekStart),
    store.listReports(14),
    store.listFindings(["open", "proposed"], 30),
    store.recentRuns(null, 300),
    store.countLeadsSince(dayStart, "cold"),
    store.countLeadsSince(dayStart, "office"),
    store.listLeads("cold", 40),
    store.listLeads("office", 60),
  ]);
  const byId = new Map(states.map((s) => [s.id, s]));
  const agents: AgentRow[] = AGENTS.map((def) => {
    const state = byId.get(def.id) ?? { id: def.id, enabled: false, model_override: null, daily_usd_cap: null, config: {}, last_run_at: null, next_run_at: null, lease_until: null, status_note: null };
    return {
      def,
      state,
      missing: missingEnv(def.needs),
      schedule: describeSchedule(def.schedule),
      today: today.byAgent[def.id] ?? { usd: 0, tokens: 0 },
      cap: state.daily_usd_cap ?? def.dailyUsd,
      lastRun: runs.find((r) => r.agent_id === def.id) ?? null,
    };
  });
  return { ready: true, hardDisabled: crewHardDisabled(), settings, agents, inbox, approved, recentDone, today, week, reports, findings, leads: { todayBySource, officeToday, recent, office }, envNeeded };
}

function neededEnv(defs: AgentDef[]): Dashboard["envNeeded"] {
  const map = new Map<EnvKey, string[]>();
  for (const d of defs) for (const k of missingEnv(d.needs)) map.set(k, [...(map.get(k) ?? []), d.name]);
  return [...map.entries()].map(([key, agents]) => ({ key, help: ENV_HELP[key], agents }));
}
