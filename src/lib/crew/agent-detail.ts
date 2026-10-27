import { plainResult, scrub } from "./agent-status";
import { loadDashboard, type AgentRow, type Dashboard } from "./dashboard";
import type { CrewStore, ReportRow, RunRow } from "./store";
import type { Approval, ApprovalKind } from "./types";

// ── One agent's page: what it did this week, what it made, the raw records ──
// Built from what is already stored (runs, drafts, reports). Server only.

export const DETAIL_DAYS = 7;

export type Activity = { key: string; at: string; tone: "ok" | "info" | "warn" | "bad"; text: string; href?: string };
export type Output = { key: string; label: string; note: string; href: string | null };

export type AgentDetail = {
  dash: Dashboard;
  row: AgentRow;
  activity: Activity[];
  outputs: Output[];
  runs: RunRow[];
  approvals: Approval[];
  report: ReportRow | null;
};

const WHAT: Record<ApprovalKind, string> = {
  reply: "a reply",
  comment: "a comment",
  dm: "a message",
  connect_note: "a connection note",
  post: "a social post",
  blog_post: "a blog post",
  code_fix: "a fix for the website",
  email_list_export: "a lead list",
  spend: "a spending request",
  ask: "a question for you",
};

function short(s: string, n = 110) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function activityFor(runs: RunRow[], approvals: Approval[], sinceIso: string): Activity[] {
  const items: Activity[] = [];
  for (const r of runs) {
    if (r.started_at < sinceIso) continue;
    const tone = r.status === "error" ? "bad" : r.status === "budget" || r.status === "locked" ? "warn" : "ok";
    items.push({ key: `r-${r.id}`, at: r.finished_at ?? r.started_at, tone, text: plainResult(r) });
  }
  for (const a of approvals) {
    const title = short(scrub(a.title));
    if (a.created_at >= sinceIso) items.push({ key: `a-${a.id}`, at: a.created_at, tone: "info", text: `Drafted ${WHAT[a.kind] ?? "something"}: ${title}`, href: a.status === "pending" || a.status === "approved" ? `#a-${a.id}` : undefined });
    if (a.decided_at && a.decided_at >= sinceIso && a.status !== "expired") {
      const why = a.reject_reason && a.reject_reason !== "no reason given" ? ` (${a.reject_reason.toLowerCase()})` : "";
      items.push({ key: `d-${a.id}`, at: a.decided_at, tone: a.status === "rejected" ? "warn" : "ok", text: a.status === "rejected" ? `You rejected it${why}: ${title}` : `You approved: ${title}` });
    }
    if (a.done_at && a.done_at >= sinceIso && a.status === "done") items.push({ key: `p-${a.id}`, at: a.done_at, tone: "ok", text: `Done: ${title}` });
    if (typeof a.meta?.error === "string") items.push({ key: `e-${a.id}`, at: a.decided_at ?? a.created_at, tone: "bad", text: `Approved, but it couldn't be carried out: ${short(scrub(a.meta.error as string))}` });
  }
  return items.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
}

export function outputsFor(row: AgentRow, approvals: Approval[]): Output[] {
  const out: Output[] = [];
  for (const a of approvals) {
    const result = (a.meta?.result ?? {}) as { pr_url?: string | null; url?: string | null; run_url?: string | null };
    const label = short(scrub(a.title), 90);
    if (result.pr_url) out.push({ key: `pr-${a.id}`, label, note: "Fix ready for review", href: result.pr_url });
    else if (result.url) out.push({ key: `url-${a.id}`, label, note: "Published", href: result.url });
    else if (a.status === "done") out.push({ key: `done-${a.id}`, label, note: "Posted", href: a.target_url });
    else if (a.status === "approved") out.push({ key: `ok-${a.id}`, label, note: "Approved, waiting for you to post", href: `#a-${a.id}` });
  }
  return out;
}

export async function loadAgentDetail(store: CrewStore, id: string, now = new Date()): Promise<AgentDetail | { ready: false } | null> {
  const dash = await loadDashboard(store, now);
  if (!dash.ready) return { ready: false };
  const d = dash as Dashboard;
  const row = d.agents.find((a) => a.def.id === id);
  if (!row) return null;
  const since = new Date(now.getTime() - DETAIL_DAYS * 86400_000).toISOString();
  const [runs, approvals, reports] = await Promise.all([store.recentRuns(id, 60), store.listApprovals({ agentId: id, sinceIso: since, limit: 100 }), store.listReports(30, row.def.team)]);
  return {
    dash: d,
    row: { ...row, lastRun: runs[0] ?? row.lastRun },
    activity: activityFor(runs, approvals, since),
    outputs: outputsFor(row, approvals),
    runs,
    approvals,
    report: reports.find((r) => r.agent_id === id) ?? null,
  };
}
