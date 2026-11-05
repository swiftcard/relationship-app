import { randomUUID } from "node:crypto";

// ── The send record (supabase/crew-email.sql → crew_email_sends) ────────────
// One row per approved email draft. claim() is the lock: it succeeds once
// for a new draft, or moves a failed / simulated / checked-unknown row back
// to "sending", and refuses everything else. MemoryEmailSends mirrors the
// SQL's unique keys for the tests; SupabaseEmailSends is the real one.

export type SendStatus = "sending" | "sent" | "failed" | "unknown" | "simulated";

export type EmailSend = {
  id: string;
  created_at: string;
  updated_at: string;
  approval_id: string;
  lead_id: string | null;
  to_email: string;
  from_email: string;
  subject: string;
  body_sha: string;
  message_id_header: string;
  status: SendStatus;
  attempts: number;
  error: string | null;
  gmail_id: string | null;
  thread_id: string | null;
  approved_by: string;
  sent_at: string | null;
  reply_state: "replied" | "bounced" | "unsubscribed" | null;
  replied_at: string | null;
  last_checked_at: string | null;
};

export type NewSend = Pick<EmailSend, "approval_id" | "lead_id" | "to_email" | "from_email" | "subject" | "body_sha" | "message_id_header" | "approved_by"> & { status: "sending" | "simulated" };

/** What a retry may start from. "unknown" only after the Sent folder said it isn't there. */
export const RETRYABLE: SendStatus[] = ["failed", "simulated"];
/** Statuses that hold the address (one live first email per address). */
export const LIVE: SendStatus[] = ["sending", "sent", "unknown"];

export type ClaimResult = { ok: true; row: EmailSend } | { ok: false; reason: "taken" | "address_taken"; row?: EmailSend | null };

export interface EmailSendStore {
  ready(): Promise<boolean>;
  get(approvalId: string): Promise<EmailSend | null>;
  /** Insert a new row, or move an existing `from`-status row to the new status. Atomic. */
  claim(n: NewSend, from: SendStatus[]): Promise<ClaimResult>;
  patch(id: string, p: Partial<Omit<EmailSend, "id" | "approval_id" | "created_at">>): Promise<void>;
  /**
   * Compare-and-set: apply `p` only if the row still has the status and
   * updated_at it had when it was read. False when another request moved it
   * first (a double-click on Retry), so only one request ever acts on it.
   */
  transition(id: string, seen: Pick<EmailSend, "status" | "updated_at">, p: Partial<Omit<EmailSend, "id" | "approval_id" | "created_at">>): Promise<boolean>;
  /** Rows that hold `to` (any approval), for the one-per-address rule. */
  liveForAddress(to: string): Promise<EmailSend[]>;
  /** How many really left (or may have) since `sinceIso` (by sent_at, else the claim time), in total or to one domain. */
  countSince(sinceIso: string, domain?: string): Promise<number>;
  list(limit: number): Promise<EmailSend[]>;
  /** Sent, no reply seen yet, newest first, last checked before `checkedBefore`. */
  awaitingReply(sinceIso: string, checkedBefore: string, limit: number): Promise<EmailSend[]>;
}

const lc = (s: string) => s.trim().toLowerCase();
const domainOf = (s: string) => lc(s).split("@")[1] ?? "";

export class MemoryEmailSends implements EmailSendStore {
  rows: EmailSend[] = [];
  clock: () => Date = () => new Date();
  async ready() {
    return true;
  }
  async get(approvalId: string) {
    return this.rows.find((r) => r.approval_id === approvalId) ?? null;
  }
  async claim(n: NewSend, from: SendStatus[]): Promise<ClaimResult> {
    const now = this.clock().toISOString();
    const existing = this.rows.find((r) => r.approval_id === n.approval_id);
    if (n.status === "sending" && this.rows.some((r) => r.approval_id !== n.approval_id && lc(r.to_email) === lc(n.to_email) && LIVE.includes(r.status))) return { ok: false, reason: "address_taken" };
    if (existing) {
      if (!from.includes(existing.status)) return { ok: false, reason: "taken", row: existing };
      Object.assign(existing, { ...n, status: n.status, attempts: existing.attempts + (n.status === "sending" ? 1 : 0), error: null, updated_at: now });
      return { ok: true, row: { ...existing } };
    }
    const row: EmailSend = { id: randomUUID(), created_at: now, updated_at: now, ...n, attempts: n.status === "sending" ? 1 : 0, error: null, gmail_id: null, thread_id: null, sent_at: null, reply_state: null, replied_at: null, last_checked_at: null };
    this.rows.push(row);
    return { ok: true, row: { ...row } };
  }
  async patch(id: string, p: Partial<EmailSend>) {
    const r = this.rows.find((x) => x.id === id);
    if (r) Object.assign(r, p, { updated_at: this.clock().toISOString() });
  }
  async transition(id: string, seen: Pick<EmailSend, "status" | "updated_at">, p: Partial<EmailSend>) {
    const r = this.rows.find((x) => x.id === id);
    if (!r || r.status !== seen.status || r.updated_at !== seen.updated_at) return false;
    let next = this.clock().toISOString();
    if (next === r.updated_at) next = new Date(Date.parse(next) + 1).toISOString();
    Object.assign(r, p, { updated_at: next });
    return true;
  }
  async liveForAddress(to: string) {
    return this.rows.filter((r) => lc(r.to_email) === lc(to) && LIVE.includes(r.status));
  }
  async countSince(sinceIso: string, domain?: string) {
    return this.rows.filter((r) => LIVE.includes(r.status) && (r.sent_at ?? r.updated_at) >= sinceIso && (!domain || domainOf(r.to_email) === lc(domain))).length;
  }
  async list(limit: number) {
    return [...this.rows].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, limit);
  }
  async awaitingReply(sinceIso: string, checkedBefore: string, limit: number) {
    return this.rows
      .filter((r) => r.status === "sent" && !r.reply_state && (r.sent_at ?? "") >= sinceIso && (!r.last_checked_at || r.last_checked_at < checkedBefore))
      .sort((a, b) => (b.sent_at ?? "").localeCompare(a.sent_at ?? ""))
      .slice(0, limit);
  }
}
