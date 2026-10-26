import type { Approval, SheetRow } from "../types";
import { PRIORITIES, type PipelineStatus, type TaskStatus } from "./spec";

// ── The Status word for a row ───────────────────────────────────────────────
// The database says what an item IS (pending, approved, done…); the Sheet
// shows a word the owner understands and can change. Owner-set words that
// the database has no equivalent for (Replied, Not Interested, Unsubscribed)
// stick: a sync never writes over them.

/** Owner words that stay once set, whatever the database says. */
export const STICKY: TaskStatus[] = ["Replied", "Not Interested", "Unsubscribed", "Completed"];

/** Words the owner may set that mean "it went out". */
export const SENT_WORDS: TaskStatus[] = ["Sent / Posted", "Completed", "Replied"];

export function statusForApproval(a: Approval, row?: Pick<SheetRow, "status"> | null): TaskStatus {
  if (row && (STICKY as string[]).includes(row.status)) return row.status as TaskStatus;
  if (a.meta?.error) return "Failed";
  switch (a.status) {
    case "pending":
      if (row && ["New", "Ready", "Needs Review"].includes(row.status)) return row.status as TaskStatus;
      return a.meta?.needs_review ? "Needs Review" : "Ready";
    case "approved":
      return "Approved";
    case "done":
      return ["reply", "comment", "dm", "connect_note", "post"].includes(a.kind) ? "Sent / Posted" : "Completed";
    case "rejected":
      return row && (["Skipped", "Not Interested", "Unsubscribed"] as string[]).includes(row.status) ? (row.status as TaskStatus) : "Skipped";
    case "expired":
      return "Expired";
  }
  return "New";
}

export function priorityOf(a: Pick<Approval, "kind" | "meta">): (typeof PRIORITIES)[number] {
  const sev = String(a.meta?.severity ?? "");
  if (sev === "critical" || sev === "high") return "High";
  if (sev === "low") return "Low";
  const score = Number(a.meta?.score ?? NaN);
  if (!Number.isNaN(score)) return score >= 0.8 ? "High" : score >= 0.65 ? "Medium" : "Low";
  return "Medium";
}

export const PRIORITY_RANK: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

/** The pipeline Stage for a person from their touches, unless the owner set one that sticks. */
export function stageForPerson(touches: { kind: string }[], row?: Pick<SheetRow, "status"> | null): PipelineStatus {
  if (row && (["Replied", "Meeting", "Customer", "Not Interested", "Unsubscribed", "Queued"] as string[]).includes(row.status)) return row.status as PipelineStatus;
  if (touches.some((t) => t.kind === "opted_out")) return "Not Interested";
  if (touches.some((t) => ["dm_sent", "connect_sent", "emailed", "called", "replied", "commented"].includes(t.kind))) return "Contacted";
  return "New";
}
