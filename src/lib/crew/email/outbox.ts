import { suppressionKeys } from "../approvals";
import { emailDailyCap, emailLive, emailMailbox, env } from "../env";
import { everContacted, normalizeHandle, personFor } from "../ledger";
import { logActivity } from "../sheets/activity";
import { leadKey } from "../sheets/keys";
import type { CrewStore } from "../store";
import type { Approval, Lead } from "../types";
import { stripEmDashes } from "../voice";
import { writingProblems } from "../writing-check";
import type { GmailTransport } from "./gmail";
import { EMAIL_RE, parseDraft } from "./message";
import type { EmailSend, EmailSendStore } from "./sends";

// ── The email outbox: what's ready, what went, what came back ──────────────
// Admin → Agents → Email. Office email drafts already arrive as approvals
// (office-outreach proposes them). A Web Lead carries its whole first email
// in the lead itself, so "Review as email" turns one lead into the same kind
// of approval, through the same checks propose() makes (suppression, the
// one-contact rule, the DM claim), so every email is sent from one place and
// one record. Nothing here sends: sending is decide("send_email").

export type LeadRow = Lead & { id: string; created_at: string };

export function emailConfig() {
  return {
    live: emailLive(),
    mailbox: emailMailbox(),
    fromName: env("CREW_EMAIL_FROM_NAME") ?? "Menash",
    dailyCap: emailDailyCap(),
    postalAddress: env("CREW_EMAIL_POSTAL_ADDRESS") ?? null,
  };
}

/** Email statuses whose domain can't take mail (leads/quality.ts). */
const UNDELIVERABLE = new Set(["No MX Record", "No Mail Server"]);

/** A lead whose own message is a whole email ("Subject: …") to an address that can take mail. */
export function leadEmailReady(l: LeadRow): boolean {
  return !!l.email && EMAIL_RE.test(l.email.trim()) && !UNDELIVERABLE.has(String(l.email_status ?? "")) && !l.region_restricted && !!parseDraft(String(l.message ?? ""));
}

/** Pending or approved email drafts, newest first. */
export async function emailDrafts(store: CrewStore, limit = 50): Promise<Approval[]> {
  const rows = await store.listApprovals({ status: ["pending", "approved"], limit: 300 });
  return rows.filter((a) => a.kind === "dm" && a.platform === "email" && typeof a.meta?.email === "string").slice(0, limit);
}

/** Web Leads with an email written and nobody contacted yet, that aren't drafts already. */
export async function readyLeads(store: CrewStore, drafts: Approval[], limit = 25): Promise<LeadRow[]> {
  const taken = new Set(drafts.map((a) => String(a.meta?.lead_id ?? "")).filter(Boolean));
  const out: LeadRow[] = [];
  for (const l of await store.listLeads("cold", 400)) {
    if (out.length >= limit) break;
    if (taken.has(l.id) || !leadEmailReady(l)) continue;
    const row = await store.getSheetRow(leadKey(l.id));
    if (row && !["New", "Queued"].includes(row.status)) continue;
    if (await store.isSuppressed(suppressionKeys("email", l.email!))) continue;
    out.push(l);
  }
  return out;
}

export type DraftResult = { ok: true; id: string; existed?: boolean } | { ok: false; message: string };

/** One Web Lead → a pending email draft for the owner to read, edit and send. */
export async function draftFromLead(store: CrewStore, leadId: string, by: string): Promise<DraftResult> {
  const l = await store.getLead(leadId);
  if (!l) return { ok: false, message: "That lead is gone." };
  if (!leadEmailReady(l)) return { ok: false, message: "This lead has no email to send (no address that takes mail, or no written email with a subject)." };
  const existing = (await emailDrafts(store, 300)).find((a) => a.meta?.lead_id === l.id);
  if (existing) return { ok: true, id: existing.id, existed: true };
  const row = await store.getSheetRow(leadKey(l.id));
  if (row && !["New", "Queued"].includes(row.status)) return { ok: false, message: `This lead is already marked ${row.status} in the Sheet.` };
  const email = normalizeHandle("email", l.email!);
  if (await store.isSuppressed(suppressionKeys("email", email))) return { ok: false, message: `${email} is on the suppression list.` };
  const personId = await personFor(store, "email", email, l.name);
  if (!personId) return { ok: false, message: "That address can't be used." };
  if (await everContacted(store, personId)) return { ok: false, message: "This person was already contacted." };

  const body = stripEmDashes(String(l.message).trim());
  const problems = writingProblems(body, { kind: "cold_email", platform: "email" });
  const who = [l.name, l.company].filter(Boolean).join(", ") || email;
  const ins = await store.insertApproval({
    agent_id: "leads-web",
    team: "leads",
    kind: "dm",
    title: `Email to ${who}`,
    summary: `${l.business_type ?? "Business"}${l.city ? ` in ${l.city}` : ""}. Read it, edit if you like, then Send.`,
    body,
    platform: "email",
    target_url: l.source_url,
    person_id: personId,
    meta: { email, name: l.name ?? null, company: l.company ?? null, lead_id: l.id, source_url: l.source_url, business_type: l.business_type ?? null, ...(problems.length ? { needs_review: true, writing_problems: problems } : {}) },
  });
  if ("conflict" in ins) return { ok: false, message: "There's already a draft for this lead." };
  if (!(await store.claimDm(personId, ins.id))) {
    await store.updateApproval(ins.id, { status: "expired", reject_reason: "already contacted (ledger)" });
    return { ok: false, message: "This person was already contacted." };
  }
  await logActivity(store, { agent_id: "leads-web", platform: "email", action: "draft", target: email, message: body, approved_by: by });
  return { ok: true, id: ins.id };
}

// ── Replies, bounces, follow-ups ────────────────────────────────────────────

const BOUNCER = /mailer-daemon|postmaster|mail delivery (subsystem|system)/i;
const addrOf = (from: string) => (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();

/** What a thread says: someone answered, it bounced, or nothing yet. */
export function readThread(messages: { from: string; labelIds: string[] }[], mailbox: string): "replied" | "bounced" | null {
  const theirs = messages.filter((m) => addrOf(m.from) !== mailbox.toLowerCase() && !m.labelIds.includes("SENT"));
  if (!theirs.length) return null;
  return theirs.every((m) => BOUNCER.test(m.from)) ? "bounced" : "replied";
}

/** Days with no answer before a sent email shows as "Follow up". */
export const FOLLOW_UP_DAYS = 4;

export function followUpDue(s: Pick<EmailSend, "status" | "reply_state" | "sent_at">, now: Date): boolean {
  return s.status === "sent" && !s.reply_state && !!s.sent_at && now.getTime() - new Date(s.sent_at).getTime() >= FOLLOW_UP_DAYS * 86_400_000;
}

/**
 * Look at the threads of recent sends (headers only) and record a reply or a
 * bounce. A bounce puts the address on the suppression list. At most `limit`
 * threads, each checked at most every 30 minutes. Returns what changed.
 */
export async function checkReplies(store: CrewStore, sends: EmailSendStore, gmail: GmailTransport, mailbox: string, now = new Date(), limit = 20): Promise<{ checked: number; replied: number; bounced: number }> {
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const before = new Date(now.getTime() - 30 * 60_000).toISOString();
  const out = { checked: 0, replied: 0, bounced: 0 };
  for (const s of await sends.awaitingReply(since, before, limit)) {
    if (!s.thread_id) continue;
    const msgs = await gmail.thread(s.thread_id);
    if (!msgs) break; // Gmail unavailable: try again later, change nothing.
    out.checked++;
    const state = readThread(msgs, mailbox);
    await sends.patch(s.id, { last_checked_at: now.toISOString(), ...(state ? { reply_state: state, replied_at: now.toISOString() } : {}) });
    if (state === "bounced") {
      out.bounced++;
      await store.addSuppression(s.to_email, "bounced (Gmail)", { source: "email", channel: "email" });
    } else if (state === "replied") out.replied++;
    if (state) await logActivity(store, { platform: "email", action: state === "bounced" ? "bounce" : "reply", target: s.to_email, message: s.subject, row_key: null });
  }
  return out;
}

/** The owner read a reply and they said no: every channel stops for them. */
export async function optOutAddress(store: CrewStore, email: string, by: string): Promise<boolean> {
  const e = normalizeHandle("email", email);
  if (!EMAIL_RE.test(e)) return false;
  await store.addSuppression(e, `not interested (email reply, ${by})`, { source: "email", channel: "email" });
  const pid = await personFor(store, "email", e, null);
  if (pid) await store.addTouch(pid, "email", "opted_out", null);
  await logActivity(store, { platform: "email", action: "suppressed", target: e, message: "Not interested (reply)", approved_by: by });
  return true;
}
