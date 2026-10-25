import { plainResult, scrub } from "./agent-status";
import type { AgentRow, Dashboard } from "./dashboard";
import type { RunRow } from "./store";
import type { Approval } from "./types";

// ── The task list: Waiting on me / Up next / Done / Failed ──────────────────
// Read from what the dashboard already loaded. Pure, so tests pin it.

export type TaskFilter = "waiting" | "next" | "done" | "failed";
export const TASK_FILTERS: { id: TaskFilter; label: string }[] = [
  { id: "waiting", label: "Waiting on me" },
  { id: "next", label: "Up next" },
  { id: "done", label: "Done" },
  { id: "failed", label: "Failed" },
];

export function resolveFilter(f: string | undefined | null): TaskFilter {
  return TASK_FILTERS.some((x) => x.id === f) ? (f as TaskFilter) : "waiting";
}

export type DoneTask = { key: string; at: string; agent: AgentRow | null; text: string };
export type Tasks = {
  waiting: Approval[];
  next: AgentRow[];
  done: DoneTask[];
  failed: { agent: AgentRow; run: RunRow | null }[];
};

const DONE_MAX = 40;

export function buildTasks(d: Dashboard): Tasks {
  const byId = new Map(d.agents.map((a) => [a.def.id, a]));
  const waiting = [...d.inbox, ...d.approved].sort((x, y) => (x.created_at < y.created_at ? 1 : -1));

  // Up next: agents that will run on their own, soonest first; "when you hand it something" last.
  const runnable = d.agents.filter((a) => a.state.enabled && ["scheduled", "needs_you", "running"].includes(a.status.kind));
  const at = (a: AgentRow) => (a.rule.kind === "on_input" ? Infinity : a.state.next_run_at ? new Date(a.state.next_run_at).getTime() : 0);
  const next = [...runnable].sort((x, y) => at(x) - at(y));

  const done: DoneTask[] = [
    ...d.runs.filter((r) => r.status === "ok" && r.finished_at).map((r) => ({ key: `r-${r.id}`, at: r.finished_at!, agent: byId.get(r.agent_id) ?? null, text: plainResult(r) })),
    ...d.recentDone.filter((a) => a.status === "done" && a.done_at).map((a) => ({ key: `a-${a.id}`, at: a.done_at!, agent: byId.get(a.agent_id) ?? null, text: `Done: ${scrub(a.title)}` })),
  ]
    .sort((x, y) => (x.at < y.at ? 1 : -1))
    .slice(0, DONE_MAX);

  const failed = d.agents.filter((a) => a.status.kind === "failed").map((agent) => ({ agent, run: agent.lastRun }));
  return { waiting, next, done, failed };
}
