import { agentName, agentStatus } from "../agent-status";
import { doorState } from "../doors";
import { crewHardDisabled, missingEnv } from "../env";
import { link, sheetUrl, type CellValue } from "../google/sheets";
import { AGENTS } from "../registry";
import { SCHEDULE_OVERRIDES_KEY, effectiveSchedule, nyDay, nyDayStart, plainSchedule, type ScheduleOverrides } from "../schedule";
import type { CrewStore, RunRow } from "../store";
import type { ActivityRow, Approval, SheetRow } from "../types";
import { controlDefs } from "./controls";
import { SHEET_AGENT_IDS } from "./registry";
import type { BuiltRow } from "./rows";
import { PRIORITY_RANK } from "./status";
import { ACTIVITY, ALL_LEADS, CONTROLS, INTENT, LEAD_COLUMNS, LEAD_TAB_BY_SOURCE, PERFORMANCE, QUEUE, SOURCE_STATS, SUPPRESSION, TOP50, tabsForAgent } from "./tabs";
import type { TabSpec } from "./spec";

// ── The tabs that are computed, not stored ──────────────────────────────────
// The Action Queue, Intent Leads, Top 50, Source Stats, Agent Performance,
// Activity Log, Controls, Suppression and the Dashboard are rebuilt from the
// database every sync. Their rows carry the Key of the source row where there
// is one, so a Status set on the queue is the same Status as on the agent's
// tab. No model is ever called to make these: it is all counting.

export type Derived = { tab: TabSpec; rows: CellValue[][] };

const OPEN_WORDS = new Set(["New", "Ready", "Needs Review", "Approved"]);

/** A link to the row's cell on its own tab, so the queue jumps to the source. */
export function rowLink(sheetId: string, gid: number | undefined, rowIndex: number | undefined, label: string): string {
  if (gid === undefined) return label;
  return link(`${sheetUrl(sheetId, gid)}${rowIndex ? `&range=A${rowIndex}` : ""}`, label);
}

export type Placement = { gid: Map<string, number>; rowOf: Map<string, number> };

export function queueRows(built: BuiltRow[], known: Map<string, SheetRow>, sheetId: string, place: Placement, limit = 300): CellValue[][] {
  const open = built
    .filter((r) => r.tab.group === "agent" && r.kind === "approval" && OPEN_WORDS.has(known.get(r.key)?.status ?? r.initialStatus))
    .sort((a, b) => a.rank - b.rank || (a.createdAt < b.createdAt ? -1 : 1))
    .slice(0, limit);
  return open.map((r) => {
    const c = r.cells;
    const status = known.get(r.key)?.status ?? r.initialStatus;
    const who = String(c.who ?? c.name ?? c.company ?? c.question ?? c.topic ?? c.org ?? c.competitor ?? c.page ?? "");
    const message = known.get(r.key)?.owner_cols.message ?? c.message ?? c.caption ?? c.fix ?? c.action ?? "";
    return [
      c.priority ?? "Medium",
      r.agent,
      platformOf(r),
      who,
      c.why ?? c.problem ?? c.opportunity ?? "",
      message,
      c.open ?? c.profile ?? c.asset ?? "",
      status,
      c.date_found ?? c.date_checked ?? c.date ?? "",
      rowLink(sheetId, place.gid.get(r.tab.name), place.rowOf.get(r.key), `${r.tab.name}${place.rowOf.get(r.key) ? ` row ${place.rowOf.get(r.key)}` : ""}`),
      r.key,
    ];
  });
}

function platformOf(r: BuiltRow): string {
  const map: Record<string, string> = {
    "reddit-reply": "Reddit",
    "reddit-dms": "Reddit",
    "instagram-linkedin-bio": "Instagram",
    "instagram-dms": "Instagram",
    "instagram-comments": "Instagram",
    "linkedin-comments": "LinkedIn",
    "linkedin-connections": "LinkedIn",
    quora: "Quora",
    bluesky: "Bluesky",
    threads: "Threads",
    facebook: "Facebook",
    indiehackers: "Indie Hackers",
    alignable: "Alignable",
    hackernews: "Hacker News",
    seo: "Website",
    geo: "AI search",
    social: "Social",
    blog: "Blog",
    partnerships: "Email",
    events: "In person",
    "competitor-intel": "Web",
    "office-prospects": "Email / Phone",
  };
  return map[r.tab.id] ?? r.tab.name;
}

export function intentRows(built: BuiltRow[], approvals: Approval[], known: Map<string, SheetRow>): CellValue[][] {
  const byId = new Map(approvals.map((a) => [a.id, a]));
  return built
    .filter((r) => r.kind === "approval" && r.tab.group === "agent")
    .filter((r) => {
      const a = byId.get(r.entityId);
      return a && (a.meta?.asks_for_tools === true || Number(a.meta?.score ?? 0) >= 0.8) && ["reply", "comment", "dm"].includes(a.kind);
    })
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 200)
    .map((r) => {
      const c = r.cells;
      const a = byId.get(r.entityId)!;
      return [c.priority ?? "Medium", platformOf(r), String(c.who ?? c.name ?? ""), c.post ?? c.question ?? c.topic ?? "", a.meta?.asks_for_tools ? `Asked for a tool. ${c.why ?? ""}` : (c.why ?? ""), known.get(r.key)?.owner_cols.message ?? a.body, c.open ?? "", known.get(r.key)?.status ?? r.initialStatus, c.date_found ?? "", r.key];
    });
}

/** The lead agents' own tabs (All Leads and Top 50 are built from them). */
export const LEAD_TAB_IDS = new Set(Object.values(LEAD_TAB_BY_SOURCE).map((t) => t.id));

function leadCells(r: BuiltRow, known: Map<string, SheetRow>): CellValue[] {
  return LEAD_COLUMNS.map((col) => (col.kind === "key" ? r.key : col.kind === "status" ? (known.get(r.key)?.status ?? r.initialStatus) : col.owner ? (known.get(r.key)?.owner_cols[col.key] ?? "") : (r.cells[col.key] ?? "")));
}

export function top50Rows(built: BuiltRow[], known: Map<string, SheetRow>, now: Date): CellValue[][] {
  const today = nyDay(now);
  const leads = built.filter((r) => LEAD_TAB_IDS.has(r.tab.id) && String(r.cells.date_found) === today);
  const score = (r: BuiltRow) => Number(r.cells.score ?? 0) || 0;
  return leads
    .sort((a, b) => score(b) - score(a))
    .slice(0, 50)
    .map((r) => leadCells(r, known));
}

/** All Leads: every lead agent's rows together, newest first. */
export function allLeadsRows(built: BuiltRow[], known: Map<string, SheetRow>, limit = 2900): CellValue[][] {
  return built
    .filter((r) => LEAD_TAB_IDS.has(r.tab.id))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, limit)
    .map((r) => leadCells(r, known));
}

export type Counts = { leadsToday: Record<string, number>; leads7d: Record<string, number>; leadsAll: Record<string, number> };

export function sourceStatsRows(o: { built: BuiltRow[]; known: Map<string, SheetRow>; approvals: Approval[]; counts: Counts; now: Date }): CellValue[][] {
  const week = new Date(o.now.getTime() - 7 * 86400_000).toISOString();
  const sources = new Set<string>([...Object.keys(o.counts.leadsAll), ...o.approvals.map((a) => a.platform ?? "web")]);
  const rows: CellValue[][] = [];
  for (const s of [...sources].sort()) {
    const drafts = o.approvals.filter((a) => (a.platform ?? "web") === s && a.created_at >= week);
    const sent = drafts.filter((a) => a.status === "done");
    const statuses = o.built.filter((r) => r.kind === "approval" && (o.approvals.find((a) => a.id === r.entityId)?.platform ?? "web") === s).map((r) => o.known.get(r.key)?.status ?? "");
    const replied = statuses.filter((x) => x === "Replied").length;
    const meetings = statuses.filter((x) => x === "Meeting").length;
    const customers = statuses.filter((x) => x === "Customer").length;
    rows.push([s, o.counts.leadsToday[s] ?? 0, o.counts.leads7d[s] ?? 0, o.counts.leadsAll[s] ?? 0, drafts.length, sent.length, replied, meetings, customers, sent.length ? `${Math.round((replied / sent.length) * 100)}%` : ""]);
  }
  return rows;
}

export async function performanceRows(o: { store: CrewStore; approvals: Approval[]; runs: RunRow[]; known: Map<string, SheetRow>; built: BuiltRow[]; now: Date; leads7dByAgent: Record<string, number> }): Promise<CellValue[][]> {
  const week = new Date(o.now.getTime() - 7 * 86400_000).toISOString();
  const [usage, states, teams, settings, overrides] = await Promise.all([o.store.usageTotals(week), o.store.listAgentStates(), o.store.listTeams(), o.store.getSettings(), o.store.kvGet<ScheduleOverrides>(SCHEDULE_OVERRIDES_KEY).catch(() => null)]);
  const byId = new Map(states.map((s) => [s.id, s]));
  const hard = crewHardDisabled();
  return AGENTS.filter((d) => SHEET_AGENT_IDS.has(d.id) && d.role === "worker").map((d) => {
    const state = byId.get(d.id) ?? { id: d.id, enabled: false, model_override: null, daily_usd_cap: null, config: {}, last_run_at: null, next_run_at: null, lease_until: null, status_note: null };
    const runs = o.runs.filter((r) => r.agent_id === d.id && r.started_at >= week);
    const lastOk = o.runs.filter((r) => r.agent_id === d.id && r.status === "ok" && r.finished_at).sort((a, b) => (a.finished_at! < b.finished_at! ? 1 : -1))[0];
    const mine = o.approvals.filter((a) => a.agent_id === d.id && a.created_at >= week);
    const keys = new Set(o.built.filter((r) => r.kind === "approval" && mine.some((a) => a.id === r.entityId)).map((r) => r.key));
    const statuses = [...keys].map((k) => o.known.get(k)?.status ?? "");
    const sent = mine.filter((a) => a.status === "done").length;
    const replied = statuses.filter((s) => s === "Replied").length;
    const meetings = statuses.filter((s) => s === "Meeting").length;
    const customers = statuses.filter((s) => s === "Customer").length;
    const cost = usage.byAgent[d.id]?.usd ?? 0;
    const leads = o.leads7dByAgent[d.id] ?? 0;
    const door = doorState(teams.find((t) => t.team === d.team), { team: d.team, settings, hardDisabled: hard }, o.now);
    const st = agentStatus({ def: d, state, missing: missingEnv(d.needs), door, now: o.now, lastRun: o.runs.find((r) => r.agent_id === d.id) ?? null, waiting: statuses.filter((s) => OPEN_WORDS.has(s)).length, schedule: effectiveSchedule(d, overrides) });
    const tab = tabsForAgent(d.id)[0] ?? null;
    return [agentName(d), tab?.name ?? (d.team === "leads" ? "All Leads" : ""), st.word, leads, mine.length, sent, replied, replied, meetings, customers, sent ? `${Math.round((replied / sent) * 100)}%` : "", Math.round(cost * 100) / 100, leads ? Math.round((cost / leads) * 1000) / 1000 : "", runs.filter((r) => r.status === "error").length, lastOk?.finished_at ? nyStamp(lastOk.finished_at) : "never"];
  });
}

export function activityRows(rows: ActivityRow[]): CellValue[][] {
  return rows.map((a) => [nyStamp(a.at), a.agent_id ? agentName(AGENTS.find((d) => d.id === a.agent_id) ?? { id: a.agent_id, name: a.agent_id, team: "system", role: "worker" }) : "", a.platform ?? "", a.simulated ? `${a.action} (simulated)` : a.action, a.target ?? "", a.message ?? "", a.result, a.error ?? "", a.row_key ?? "", a.approved_by ?? ""]);
}

export async function controlsRows(store: CrewStore): Promise<CellValue[][]> {
  const controls = await store.getControls();
  const out: CellValue[][] = [];
  for (const d of controlDefs()) {
    const v = await d.get(store);
    const changed = controls[`${d.key}:changed`];
    out.push([d.label, d.show(v), d.what, d.allowed, changed ? String(changed) : "", d.key]);
  }
  return out;
}

export async function suppressionRows(store: CrewStore): Promise<CellValue[][]> {
  return (await store.listSuppression(2000)).map((s) => [s.value, s.channel, s.reason, s.source, s.added_at ? nyStamp(s.added_at) : ""]);
}

export function nyStamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** The Dashboard: a two-column overview plus the top actions and the agents' states. */
export async function dashboardCells(o: { store: CrewStore; sheetId: string; built: BuiltRow[]; known: Map<string, SheetRow>; approvals: Approval[]; runs: RunRow[]; activity: ActivityRow[]; counts: Counts; now: Date; place: Placement; queue: CellValue[][]; dryRun: boolean; paused: boolean; errors: string[] }): Promise<CellValue[][]> {
  const day = nyDayStart(o.now).toISOString();
  const week = new Date(o.now.getTime() - 7 * 86400_000).toISOString();
  const [usageToday, usageWeek, states] = await Promise.all([o.store.usageTotals(day), o.store.usageTotals(week), o.store.listAgentStates()]);
  const statusOf = (r: BuiltRow) => o.known.get(r.key)?.status ?? r.initialStatus;
  const ready = o.built.filter((r) => r.kind === "approval" && r.tab.group === "agent" && OPEN_WORDS.has(statusOf(r)));
  const n = (tab: string) => ready.filter((r) => r.tab.id === tab).length;
  const messages = ready.filter((r) => ["reddit-dms", "instagram-dms", "instagram-linkedin-bio", "linkedin", "alignable", "office-prospects"].includes(r.tab.id)).length;
  const sent = o.activity.filter((a) => ["sent", "post", "publish"].includes(a.action) && a.result === "ok").length;
  const allStatuses = [...o.known.values()].map((r) => r.status);
  const failed = AGENTS.filter((d) => SHEET_AGENT_IDS.has(d.id)).filter((d) => {
    const last = o.runs.find((r) => r.agent_id === d.id);
    return last?.status === "error" || states.find((s) => s.id === d.id)?.status_note?.startsWith("Last run failed");
  });
  const leadsToday = Object.values(o.counts.leadsToday).reduce((a, b) => a + b, 0);
  const line = (k: string, v: CellValue, note = ""): CellValue[] => [k, v, note];
  const rows: CellValue[][] = [
    ["SwiftCard Leads: your marketing and outreach headquarters", "", `Updated ${nyStamp(o.now.toISOString())} (New York)`],
    [o.paused ? "ALL AGENTS ARE PAUSED (Controls → Pause all agents)" : o.dryRun ? "Dry run is ON: nothing real goes out until Controls → Dry run = No" : "Live: approved items can go out", "", ""],
    [],
    ["Today", "", ""],
    line("New leads found today", leadsToday, "All Leads / Today - Top 50"),
    line("Tasks ready for you", ready.length, "Today - Action Queue"),
    line("Messages ready to send", messages, "DMs, emails and connection notes"),
    line("Reddit replies ready", n("reddit-reply"), "Reddit Reply"),
    line("Instagram messages ready", n("instagram-dms") + n("instagram-linkedin-bio"), "Instagram DMs / Instagram LinkedIn Bio"),
    line("Outreach emails sent (7 days)", sent, "Activity Log (cold email ships in the next release)"),
    line("Positive replies (you marked Replied)", allStatuses.filter((s) => s === "Replied").length, "Pipeline"),
    line("Meetings booked", allStatuses.filter((s) => s === "Meeting").length, "Meetings"),
    line("New customers (you marked Customer)", allStatuses.filter((s) => s === "Customer").length, "Pipeline"),
    line("Agent failures", failed.length, failed.map((d) => agentName(d)).join(", ")),
    line("AI spend today / 7 days", `$${usageToday.total.usd.toFixed(2)} / $${usageWeek.total.usd.toFixed(2)}`, "Agent Performance"),
    line("Sync problems", o.errors.length, o.errors.slice(0, 2).join(" | ")),
    [],
    ["Do these first", "", ""],
    ...o.queue.slice(0, 7).map((q) => [`${q[0]}: ${q[1]}`, `${q[3]}`, q[9]]),
    ...(o.queue.length === 0 ? [["Nothing waiting. The agents add rows as they find things.", "", ""]] : []),
    [],
    ["Agents", "State", "Next run"],
  ];
  const overrides = (await o.store.kvGet<ScheduleOverrides>(SCHEDULE_OVERRIDES_KEY).catch(() => null)) ?? {};
  for (const d of AGENTS.filter((x) => SHEET_AGENT_IDS.has(x.id) && x.role === "worker" && !x.locked)) {
    const st = states.find((s) => s.id === d.id);
    const last = o.runs.find((r) => r.agent_id === d.id);
    const word = !st?.enabled ? "Off" : last?.status === "error" ? "Failed" : o.paused ? "Paused" : missingEnv(d.needs).length ? "Needs setup" : "On";
    rows.push([agentName(d), word, st?.enabled ? plainSchedule(effectiveSchedule(d, overrides)) : "Turn on in Controls"]);
  }
  rows.push([], ["Open a tab from the bottom of the screen. Start with Today - Action Queue.", "", ""]);
  return rows;
}

export { QUEUE, INTENT, TOP50, ALL_LEADS, SOURCE_STATS, PERFORMANCE, ACTIVITY, CONTROLS, SUPPRESSION, PRIORITY_RANK };
