import type { AgentDef } from "./agent-def";
import { doorState, teamDoor, type DoorState } from "./doors";
import { ENV_HELP, crewHardDisabled, env, missingEnv } from "./env";
import { ADMIN_TEAMS, AGENTS } from "./registry";
import { GROUP_JOB, GROUP_NAME, agentName, agentStatus, type AgentStatus } from "./agent-status";
import { SCHEDULE_OVERRIDES_KEY, effectiveSchedule, nyDayStart, plainSchedule, type ScheduleOverrides } from "./schedule";
import { loadSheetAgents, type SheetAgentRow } from "./sheet-agents";
import { notHired } from "./staff";
import type { CrewStore, ReportRow, RunRow, UsageTotals } from "./store";
import { TIMELINE_DAYS, teamTimeline, type TimelineItem } from "./timeline";
import type { AgentState, Approval, EnvKey, Finding, Lead, Schedule, Settings, TeamId, TeamRow } from "./types";

// Everything the Agents tab shows, loaded in one place (server only). Since
// 2026-10-26 the tab shows the Watchdog as its group (ADMIN_TEAMS) plus one
// Start / Stop row per marketing, outreach and lead agent (sheet-agents.ts),
// whose work lands in the Google Sheet (src/lib/crew/sheets). Every other
// list here is filtered to the admin teams first.

export type AgentRow = {
  def: AgentDef;
  /** Plain name shown everywhere ("Reddit replies"). */
  name: string;
  state: AgentState;
  missing: EnvKey[];
  /** The schedule it runs on (yours, if you changed it) and that in words. */
  rule: Schedule;
  schedule: string;
  customSchedule: boolean;
  today: { usd: number; tokens: number };
  cap: number;
  lastRun: RunRow | null;
  /** Items from this agent waiting for you (to decide or to post). */
  waiting: number;
  door: DoorState;
  status: AgentStatus;
};

/** One group (team): its pause switch (the "door"), its agents and what waits for you. */
export type Room = {
  team: TeamId;
  name: string;
  job: string;
  door: DoorState;
  /** The team's own door, ignoring the whole-office lock (what one tap flips). */
  ownDoor: DoorState;
  /** The team's stored door row; null for the desk, which has no door. */
  row: TeamRow | null;
  manager: AgentRow | null;
  staff: AgentRow[];
  /** Folded away: agents that can never run, and extras that are off. */
  notHired: AgentRow[];
  pending: Approval[];
  approved: Approval[];
  usdToday: number;
  usdWeek: number;
  focus: { text: string; until: string | null; by: string | null } | null;
};

export const ROOM_TEAMS: TeamId[] = [...ADMIN_TEAMS];
/** The agents the admin page shows and counts. */
export const ADMIN_AGENTS = AGENTS.filter((d) => ADMIN_TEAMS.includes(d.team));
const ADMIN_IDS = new Set(ADMIN_AGENTS.map((d) => d.id));

export type Dashboard = {
  ready: boolean;
  hardDisabled: boolean;
  now: string;
  settings: Settings;
  agents: AgentRow[];
  rooms: Room[];
  inbox: Approval[];
  approved: Approval[];
  recentDone: Approval[];
  today: UsageTotals;
  week: UsageTotals;
  reports: ReportRow[];
  findings: Finding[];
  /** The open room's chat timeline (empty in the lobby and settings). */
  timeline: TimelineItem[];
  /** The home screen's three numbers. */
  summary: { running: number; doneToday: number; decidedToday: number; needsYou: number };
  /** Recent runs, newest first (for the task list). */
  runs: RunRow[];
  leads: { todayBySource: Record<string, number>; officeToday: Record<string, number>; recent: (Lead & { id: string; created_at: string })[]; office: (Lead & { id: string; created_at: string })[] };
  envNeeded: { key: EnvKey; help: string; agents: string[] }[];
  /** The SwiftCard Leads workbook, where every other agent's rows go (null until it exists). */
  sheetUrl: string | null;
  /** The Start / Stop list: every agent that works into the Sheet, named after its tab. */
  sheetAgents: SheetAgentRow[];
};

const blankState = (id: string): AgentState => ({ id, enabled: false, model_override: null, daily_usd_cap: null, config: {}, last_run_at: null, next_run_at: null, lease_until: null, status_note: null });

export async function loadDashboard(
  store: CrewStore,
  now = new Date(),
  o: { room?: TeamId | null } = {},
): Promise<Dashboard | { ready: false; envNeeded: Dashboard["envNeeded"] }> {
  const envNeeded = neededEnv(ADMIN_AGENTS);
  if (!(await store.ready())) return { ready: false, envNeeded };
  const dayStart = nyDayStart(now).toISOString();
  const weekStart = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const room = o.room ?? null;
  const ids = [...ADMIN_IDS];
  const [settings, states, teams, inbox, approved, recentDone, today, week, reportsAll, findingsAll, runsAll, todayBySource, officeToday, recent, office, overrides, runsTodayAll, decided, sheetId] = await Promise.all([
    store.getSettings(),
    store.listAgentStates(),
    store.listTeams(),
    store.listApprovals({ status: ["pending"], agentIds: ids, limit: 60 }),
    store.listApprovals({ status: ["approved"], agentIds: ids, limit: 60 }),
    store.listApprovals({ status: ["done", "rejected"], agentIds: ids, limit: 15 }),
    store.usageTotals(dayStart),
    store.usageTotals(weekStart),
    store.listReports(14),
    store.listFindings(["open", "proposed"], 30),
    store.recentRuns(null, 300),
    store.countLeadsSince(dayStart, "cold"),
    store.countLeadsSince(dayStart, "office"),
    store.listLeads("cold", 40),
    store.listLeads("office", 60),
    store.kvGet<ScheduleOverrides>(SCHEDULE_OVERRIDES_KEY).catch(() => null),
    store.runsSince(dayStart),
    store.listApprovals({ sinceIso: weekStart, agentIds: ids, limit: 300 }),
    store.kvGet<string>("sheet:id").catch(() => null),
  ]);
  const hardDisabledNow = crewHardDisabled();
  const sheetIdNow = env("CREW_SHEET_ID") || sheetId;
  const sheetAgents = await loadSheetAgents(store, { now, settings, hardDisabled: hardDisabledNow, states, runs: runsAll, overrides, sheetId: sheetIdNow, gids: await store.kvGet<Record<string, number>>("sheet:gids").catch(() => null) });
  const reports = reportsAll.filter((r) => ADMIN_IDS.has(r.agent_id));
  const findings = findingsAll.filter((f) => ADMIN_IDS.has(f.agent_id));
  const runs = runsAll.filter((r) => ADMIN_IDS.has(r.agent_id));
  const runsToday = runsTodayAll.filter((r) => ADMIN_IDS.has(r.agent_id));
  const sheetUrl = sheetIdNow ? `https://docs.google.com/spreadsheets/d/${sheetIdNow}/edit` : null;
  const byId = new Map(states.map((s) => [s.id, s]));
  const hardDisabled = hardDisabledNow;
  const doors = new Map(ROOM_TEAMS.map((team) => [team, doorState(team === "system" ? undefined : teams.find((t) => t.team === team), { team, settings, hardDisabled }, now)]));
  const waitingFor = (id: string) => inbox.filter((a) => a.agent_id === id).length + approved.filter((a) => a.agent_id === id).length;
  const agents: AgentRow[] = ADMIN_AGENTS.map((def) => {
    const state = byId.get(def.id) ?? blankState(def.id);
    const rule = effectiveSchedule(def, overrides);
    const missing = missingEnv(def.needs);
    const lastRun = runs.find((r) => r.agent_id === def.id) ?? null;
    const door = doors.get(def.team)!;
    const waiting = waitingFor(def.id);
    return {
      def,
      name: agentName(def),
      state,
      missing,
      rule,
      schedule: plainSchedule(rule),
      customSchedule: rule !== def.schedule,
      today: today.byAgent[def.id] ?? { usd: 0, tokens: 0 },
      cap: state.daily_usd_cap ?? def.dailyUsd,
      lastRun,
      waiting,
      door,
      status: agentStatus({ def, state, missing, door, now, lastRun, waiting, schedule: rule }),
    };
  });
  const teamOf = (a: Approval) => AGENTS.find((d) => d.id === a.agent_id)?.team ?? a.team;
  const rooms: Room[] = ROOM_TEAMS.map((team) => {
    const row = team === "system" ? null : (teams.find((t) => t.team === team) ?? null);
    const door = doors.get(team)!;
    const members = agents.filter((a) => a.def.team === team);
    const focusLive = row?.focus && (!row.focus_until || new Date(row.focus_until).getTime() > now.getTime());
    return {
      team,
      name: GROUP_NAME[team],
      job: GROUP_JOB[team],
      door,
      ownDoor: row ? teamDoor(row, now) : door,
      row,
      manager: members.find((m) => m.def.role === "manager") ?? null,
      staff: members.filter((m) => m.def.role !== "manager" && !notHired(m.def, m.state)),
      notHired: members.filter((m) => m.def.role !== "manager" && notHired(m.def, m.state)),
      pending: inbox.filter((a) => teamOf(a) === team),
      approved: approved.filter((a) => teamOf(a) === team),
      usdToday: today.byTeam[team]?.usd ?? 0,
      usdWeek: week.byTeam[team]?.usd ?? 0,
      focus: focusLive ? { text: row!.focus!, until: row!.focus_until, by: row!.focus_by } : null,
    };
  });

  let timeline: TimelineItem[] = [];
  if (room) {
    const since = new Date(now.getTime() - TIMELINE_DAYS * 86400_000).toISOString();
    const [chat, roomApprovals, roomReports] = await Promise.all([store.listChat(room, 60), store.listApprovals({ sinceIso: since, limit: 300 }), store.listReports(10, room)]);
    timeline = teamTimeline({ team: room, defs: ADMIN_AGENTS, chat, approvals: roomApprovals.filter((a) => ADMIN_IDS.has(a.agent_id)), reports: roomReports, runs, findings, now, plain: true });
  }

  const summary = {
    running: agents.filter((a) => a.status.kind === "running").length,
    doneToday: runsToday.filter((r) => r.status === "ok" && r.finished_at).length,
    decidedToday: decided.filter((a) => a.decided_at && a.decided_at >= dayStart && (a.status === "approved" || a.status === "done")).length,
    needsYou: inbox.length + approved.length + agents.filter((a) => a.status.kind === "failed").length,
  };

  return {
    ready: true,
    hardDisabled,
    now: now.toISOString(),
    settings,
    agents,
    rooms,
    inbox,
    approved,
    recentDone,
    today,
    week,
    reports,
    findings,
    timeline,
    summary,
    runs,
    leads: { todayBySource, officeToday, recent, office },
    envNeeded,
    sheetUrl,
    sheetAgents,
  };
}

function neededEnv(defs: AgentDef[]): Dashboard["envNeeded"] {
  const map = new Map<EnvKey, string[]>();
  for (const d of defs) for (const k of missingEnv(d.needs)) map.set(k, [...(map.get(k) ?? []), agentName(d)]);
  return [...map.entries()].map(([key, agents]) => ({ key, help: ENV_HELP[key], agents }));
}
