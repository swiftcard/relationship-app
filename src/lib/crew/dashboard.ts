import type { AgentDef } from "./agent-def";
import { doorState, teamDoor, type DoorState } from "./doors";
import { ENV_HELP, crewHardDisabled, missingEnv } from "./env";
import { AGENTS } from "./registry";
import { describeSchedule, nyDayStart } from "./schedule";
import { ROOM_JOB, ROOM_NAME, notHired, staffFor, staffStatus, type Person, type StaffStatus } from "./staff";
import { DOOR_TEAMS, type CrewStore, type ReportRow, type RunRow, type UsageTotals } from "./store";
import { TIMELINE_DAYS, teamTimeline, type TimelineItem } from "./timeline";
import type { AgentState, Approval, EnvKey, Finding, Lead, Settings, TeamId, TeamRow } from "./types";

// Everything the Agents tab (the office) shows, loaded in one place (server only).

export type AgentRow = {
  def: AgentDef;
  state: AgentState;
  missing: EnvKey[];
  schedule: string;
  today: { usd: number; tokens: number };
  cap: number;
  lastRun: RunRow | null;
};

/** One agent as a member of staff. */
export type StaffRow = AgentRow & { person: Person; status: StaffStatus };

/** One room of the office: a team, its door, its people and what waits for you. */
export type Room = {
  team: TeamId;
  name: string;
  job: string;
  door: DoorState;
  /** The team's own door, ignoring the whole-office lock (what one tap flips). */
  ownDoor: DoorState;
  /** The team's stored door row; null for the desk, which has no door. */
  row: TeamRow | null;
  manager: StaffRow | null;
  staff: StaffRow[];
  notHired: StaffRow[];
  pending: Approval[];
  approved: Approval[];
  usdToday: number;
  usdWeek: number;
  focus: { text: string; until: string | null; by: string | null } | null;
};

export const ROOM_TEAMS: TeamId[] = [...DOOR_TEAMS, "system"];

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
  leads: { todayBySource: Record<string, number>; officeToday: Record<string, number>; recent: (Lead & { id: string; created_at: string })[]; office: (Lead & { id: string; created_at: string })[] };
  envNeeded: { key: EnvKey; help: string; agents: string[] }[];
};

const blankState = (id: string): AgentState => ({ id, enabled: false, model_override: null, daily_usd_cap: null, config: {}, last_run_at: null, next_run_at: null, lease_until: null, status_note: null });

export async function loadDashboard(
  store: CrewStore,
  now = new Date(),
  o: { room?: TeamId | null } = {},
): Promise<Dashboard | { ready: false; envNeeded: Dashboard["envNeeded"] }> {
  const envNeeded = neededEnv(AGENTS);
  if (!(await store.ready())) return { ready: false, envNeeded };
  const dayStart = nyDayStart(now).toISOString();
  const weekStart = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const room = o.room ?? null;
  const [settings, states, teams, inbox, approved, recentDone, today, week, reports, findings, runs, todayBySource, officeToday, recent, office] = await Promise.all([
    store.getSettings(),
    store.listAgentStates(),
    store.listTeams(),
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
    const state = byId.get(def.id) ?? blankState(def.id);
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
  const hardDisabled = crewHardDisabled();
  const teamOf = (a: Approval) => AGENTS.find((d) => d.id === a.agent_id)?.team ?? a.team;
  const rooms: Room[] = ROOM_TEAMS.map((team) => {
    const row = team === "system" ? null : (teams.find((t) => t.team === team) ?? null);
    const door = doorState(row ?? undefined, { team, settings, hardDisabled }, now);
    const members: StaffRow[] = agents
      .filter((a) => a.def.team === team)
      .map((a) => ({ ...a, person: staffFor(a.def), status: staffStatus({ def: a.def, state: a.state, missing: a.missing, door, now }) }));
    const focusLive = row?.focus && (!row.focus_until || new Date(row.focus_until).getTime() > now.getTime());
    return {
      team,
      name: ROOM_NAME[team],
      job: ROOM_JOB[team],
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
    timeline = teamTimeline({ team: room, defs: AGENTS, chat, approvals: roomApprovals, reports: roomReports, runs, findings, now });
  }

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
    leads: { todayBySource, officeToday, recent, office },
    envNeeded,
  };
}

function neededEnv(defs: AgentDef[]): Dashboard["envNeeded"] {
  const map = new Map<EnvKey, string[]>();
  for (const d of defs) for (const k of missingEnv(d.needs)) map.set(k, [...(map.get(k) ?? []), d.name]);
  return [...map.entries()].map(([key, agents]) => ({ key, help: ENV_HELP[key], agents }));
}
