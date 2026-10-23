import type { AgentDef } from "./agent-def";
import { staffFor, type Person } from "./staff";
import type { ReportRow, RunRow } from "./store";
import type { Approval, ApprovalKind, ChatMessage, Finding, TeamId } from "./types";

// ── A team's chat: everything that happened, as one timeline ────────────────
// Merged at read time from what is already stored (the chat, drafts and your
// decisions, reports, problems), so no agent writes to the chat. Routine runs
// stay out: the Watchdog runs every 15 minutes and would drown the room.

export const TIMELINE_DAYS = 7;
export const TIMELINE_MAX = 80;
/** A manager reply still "pending" after this long never came back. */
export const CHAT_STALE_MS = 5 * 60_000;

export type TimelineItem = {
  key: string;
  at: string;
  kind: "owner" | "manager" | "system" | "event" | "report" | "alert";
  who: (Person & { team: TeamId }) | null;
  body: string;
  /** "#a-<id>" for a draft that still waits above the chat. */
  href?: string;
  status?: "pending" | "failed";
};

const WHAT: Record<ApprovalKind, string> = {
  reply: "a reply",
  comment: "a comment",
  dm: "a message",
  connect_note: "a connection note",
  post: "a social post",
  blog_post: "a blog post",
  code_fix: "a fix",
  email_list_export: "a lead list",
  spend: "a spending request",
  ask: "a question",
};

export function teamTimeline(o: {
  team: TeamId;
  defs: AgentDef[];
  chat: ChatMessage[];
  approvals: Approval[];
  reports: ReportRow[];
  runs: RunRow[];
  findings: Finding[];
  now: Date;
}): TimelineItem[] {
  const since = new Date(o.now.getTime() - TIMELINE_DAYS * 86400_000).toISOString();
  const byId = new Map(o.defs.map((d) => [d.id, d]));
  const person = (agentId: string) => {
    const d = byId.get(agentId);
    return d ? { ...staffFor(d), team: d.team } : null;
  };
  const manager = person(`${o.team}-manager`);
  const mine = (agentId: string) => byId.get(agentId)?.team === o.team;
  const items: TimelineItem[] = [];

  for (const m of o.chat) {
    if (m.team !== o.team || m.created_at < since) continue;
    const stale = m.status === "pending" && o.now.getTime() - new Date(m.created_at).getTime() > CHAT_STALE_MS;
    items.push({
      key: `c-${m.id}`,
      at: m.created_at,
      kind: m.author,
      who: m.author === "manager" ? manager : null,
      body: stale ? "No answer came back. Ask me again." : m.body,
      status: stale || m.status === "failed" ? "failed" : m.status === "pending" ? "pending" : undefined,
    });
  }

  for (const a of o.approvals) {
    if (!mine(a.agent_id)) continue;
    const who = person(a.agent_id);
    const name = who?.first ?? "Someone";
    const title = a.title.length > 120 ? `${a.title.slice(0, 117)}…` : a.title;
    if (a.created_at >= since) {
      const waiting = a.status === "pending" || a.status === "approved";
      items.push({ key: `a-${a.id}`, at: a.created_at, kind: "event", who, body: `${name} drafted ${WHAT[a.kind] ?? "something"}: ${title}`, href: waiting ? `#a-${a.id}` : undefined });
    }
    if (a.decided_at && a.decided_at >= since && a.status !== "expired") {
      const verdict = a.status === "rejected" ? `You rejected ${name}'s draft${a.reject_reason && a.reject_reason !== "no reason given" ? ` (${a.reject_reason.toLowerCase()})` : ""}.` : `You approved ${name}'s draft.`;
      items.push({ key: `d-${a.id}`, at: a.decided_at, kind: "event", who: null, body: verdict });
    }
    if (a.done_at && a.done_at >= since && a.status === "done") items.push({ key: `p-${a.id}`, at: a.done_at, kind: "event", who: null, body: `Done: ${title}` });
  }

  for (const r of o.reports) {
    if (r.team !== o.team || r.created_at < since) continue;
    items.push({ key: `r-${r.id}`, at: r.created_at, kind: "report", who: person(r.agent_id), body: r.body });
  }

  for (const r of o.runs) {
    if (!mine(r.agent_id) || r.started_at < since || !["error", "budget", "locked"].includes(r.status)) continue;
    const who = person(r.agent_id);
    const why = r.status === "budget" ? "hit a money limit" : r.status === "locked" ? "stopped when the door locked" : "ran into a problem";
    items.push({ key: `u-${r.id}`, at: r.finished_at ?? r.started_at, kind: "alert", who, body: `${who?.first ?? "A shift"} ${why}: ${r.summary ?? r.error ?? r.status}` });
  }

  for (const f of o.findings) {
    if (!mine(f.agent_id) || f.last_seen < since) continue;
    const who = person(f.agent_id);
    items.push({ key: `f-${f.id}`, at: f.last_seen, kind: "alert", who, body: `${who?.first ?? "The Watchdog"} found: ${f.title}${f.count > 1 ? ` (seen ${f.count} times)` : ""}` });
  }

  return items.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0)).slice(-TIMELINE_MAX);
}
