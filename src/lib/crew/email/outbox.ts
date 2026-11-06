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

/** A lead with an address that can take mail and something specific to say: a whole email ("Subject: …"), or the one-line opener older runs wrote. */
export function leadEmailReady(l: LeadRow): boolean {
  return !!l.email && EMAIL_RE.test(l.email.trim()) && !UNDELIVERABLE.has(String(l.email_status ?? "")) && !l.region_restricted && !!leadEmailBody(l);
}

/** True when the lead carries only an opener line and the email around it is the starter below. */
export function isStarter(l: Pick<LeadRow, "message">): boolean {
  return !parseDraft(String(l.message ?? "")) && !!String(l.message ?? "").trim();
}

/**
 * The email a lead becomes. A whole email written from their site is used as
 * it is. A lead from before 2026-11-04 carries only one opener sentence (a
 * checked, specific detail from their site); it goes inside a short starter
 * in the founder voice, under the writing check's 80-word cold email limit,
 * which the owner reads and edits before Send. No AI
 * call, no invented detail: the only specific line is the one the site backed.
 */
export function leadEmailBody(l: Pick<LeadRow, "message" | "name" | "company">): string | null {
  const msg = String(l.message ?? "").trim();
  if (!msg) return null;
  if (parseDraft(msg)) return stripEmDashes(msg);
  const opener = stripEmDashes(msg.replace(/\s+/g, " "));
  if (opener.split(" ").length < 5) return null;
  const first = String(l.name ?? "").trim().split(/\s+/)[0] ?? "";
  const company = String(l.company ?? "").trim();
  const subject = `Subject: ${company ? `Cards for ${company}` : "Cards for your team"}`;
  // Older runs wrote a whole short note ("Hi Dora, I saw … Could I show you?"):
  // keep it as written, greeting on its own line, signed.
  const note = /^(hi|hello|hey)\b[^,]{0,40},\s*/i.exec(opener);
  if (note) return [subject, "", note[0].trim(), "", opener.slice(note[0].length).trim(), "", "Menash"].join("\n");
  return [
    subject,
    "",
    ...(first ? [`Hi ${first},`, ""] : []),
    opener,
    "",
    "I'm Menash, one of the two founders of SwiftCard. We make digital business cards your team can share with a tap or a QR code, so the people you meet save your details in one step.",
    "",
    "I'd be happy to make a sample card with your branding so you can see it. Want me to send one over?",
    "",
    "Menash",
  ].join("\n");
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
  if (!leadEmailReady(l)) return { ok: false, message: "This lead has no email to send (no address that takes mail, or nothing specific from their site to write from)." };
  const existing = (await emailDrafts(store, 300)).find((a) => a.meta?.lead_id === l.id);
  if (existing) return { ok: true, id: existing.id, existed: true };
  const row = await store.getSheetRow(leadKey(l.id));
  if (row && !["New", "Queued"].includes(row.status)) return { ok: false, message: `This lead is already marked ${row.status} in the Sheet.` };
  const email = normalizeHandle("email", l.email!);
  if (await store.isSuppressed(suppressionKeys("email", email))) return { ok: false, message: `${email} is on the suppression list.` };
  const personId = await personFor(store, "email", email, l.name);
  if (!personId) return { ok: false, message: "That address can't be used." };
  if (await everContacted(store, personId)) return { ok: false, message: "This person was already contacted." };

  const body = leadEmailBody(l)!;
  const problems = writingProblems(body, { kind: "cold_email", platform: "email" });
  const who = [l.name, l.company].filter(Boolean).join(", ") || email;
  const ins = await store.insertApproval({
    agent_id: "leads-web",
    team: "leads",
    kind: "dm",
    title: `Email to ${who}`,
    summary: `${l.business_type ?? "Business"}${l.city ? ` in ${l.city}` : ""}. ${isStarter(l) ? "A starter around the one detail from their site: make it sound like you, then Send." : "Read it, edit if you like, then Send."}`,
    body,
    platform: "email",
    target_url: l.source_url,
    person_id: personId,
    meta: { email, name: l.name ?? null, company: l.company ?? null, lead_id: l.id, source_url: l.source_url, business_type: l.business_type ?? null, ...(isStarter(l) ? { starter: true } : {}), ...(problems.length ? { needs_review: true, writing_problems: problems } : {}) },
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
/** A subject that asks to stop: the List-Unsubscribe mailto sends "unsubscribe"; people write "remove me", "stop". */
export const UNSUBSCRIBE_SUBJECT = /^\s*(re:\s*)*(unsubscribe|remove me|please remove|stop emailing|stop)\b/i;
const AUTO_REPLY = /^\s*(automatic reply|auto(matic)?[- ]?(reply|response)|out of (the )?office|ooo\b|autoreply|auto:)/i;
export const addrOf = (from: string) => (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();

/** What a thread says: they asked to stop, someone answered, it bounced, or nothing yet. */
export function readThread(messages: { from: string; subject?: string; labelIds: string[] }[], mailbox: string): "replied" | "bounced" | "unsubscribed" | null {
  // An out-of-office auto reply isn't an answer: the email still needs a follow up.
  const theirs = messages.filter((m) => addrOf(m.from) !== mailbox.toLowerCase() && !m.labelIds.includes("SENT") && !AUTO_REPLY.test(m.subject ?? ""));
  if (!theirs.length) return null;
  if (theirs.every((m) => BOUNCER.test(m.from))) return "bounced";
  return theirs.some((m) => UNSUBSCRIBE_SUBJECT.test(m.subject ?? "")) ? "unsubscribed" : "replied";
}

/** Days with no answer before a sent email shows as "Follow up". */
export const FOLLOW_UP_DAYS = 4;

export function followUpDue(s: Pick<EmailSend, "status" | "reply_state" | "sent_at">, now: Date): boolean {
  return s.status === "sent" && !s.reply_state && !!s.sent_at && now.getTime() - new Date(s.sent_at).getTime() >= FOLLOW_UP_DAYS * 86_400_000;
}

/**
 * Look at the threads of recent sends (headers only) and record a reply, a
 * bounce or a request to stop. A bounce puts the address on the suppression
 * list; "unsubscribe" (in the thread or as a new email) opts them out of
 * every channel. At most `limit`
 * threads, each checked at most every 30 minutes. Returns what changed.
 */
export async function checkReplies(store: CrewStore, sends: EmailSendStore, gmail: GmailTransport, mailbox: string, now = new Date(), limit = 20): Promise<{ checked: number; replied: number; bounced: number; unsubscribed: number }> {
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const before = new Date(now.getTime() - 30 * 60_000).toISOString();
  const out = { checked: 0, replied: 0, bounced: 0, unsubscribed: 0 };
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
    } else if (state === "unsubscribed") {
      out.unsubscribed++;
      await optOutAddress(store, s.to_email, "their reply");
    } else if (state === "replied") out.replied++;
    if (state) await logActivity(store, { platform: "email", action: state === "bounced" ? "bounce" : state === "unsubscribed" ? "unsubscribe" : "reply", target: s.to_email, message: s.subject, row_key: null });
  }
  // The inbox, headers only, for what lands outside a thread:
  //   • "unsubscribe" as a new email (the List-Unsubscribe button)
  //   • a bounce from another mail server (X-Failed-Recipients names the address)
  //   • a reply whose In-Reply-To / References names one of our Message-IDs
  const inbox = await gmail.inbox(50);
  if (inbox?.length) {
    const sent = (await sends.list(300)).filter((r) => r.status === "sent");
    const byMid = new Map(sent.map((r) => [r.message_id_header.trim(), r]));
    for (const m of inbox) {
      const from = addrOf(m.from);
      if (from === mailbox.toLowerCase()) continue;
      for (const bad of (m.failedRecipients ?? "").split(/[,\s]+/).map((x) => addrOf(x)).filter((x) => EMAIL_RE.test(x))) {
        const rows = sent.filter((r) => r.to_email.toLowerCase() === bad && r.reply_state !== "bounced");
        if (!rows.length) continue;
        await store.addSuppression(bad, "bounced (Gmail)", { source: "email", channel: "email" });
        for (const r of rows) await sends.patch(r.id, { reply_state: "bounced", replied_at: now.toISOString() });
        out.bounced++;
        await logActivity(store, { platform: "email", action: "bounce", target: bad, message: m.subject ?? null });
      }
      if (UNSUBSCRIBE_SUBJECT.test(m.subject ?? "") && EMAIL_RE.test(from) && !(await store.isSuppressed([from]))) {
        await optOutAddress(store, from, "unsubscribe email");
        out.unsubscribed++;
        for (const r of await sends.liveForAddress(from)) if (!r.reply_state || r.reply_state === "replied") await sends.patch(r.id, { reply_state: "unsubscribed", replied_at: now.toISOString() });
        continue;
      }
      if (BOUNCER.test(m.from) || AUTO_REPLY.test(m.subject ?? "")) continue;
      const ids = `${m.inReplyTo ?? ""} ${m.references ?? ""}`.match(/<[^>]+>/g) ?? [];
      for (const id of ids) {
        const r = byMid.get(id.trim());
        if (r && !r.reply_state) {
          await sends.patch(r.id, { reply_state: "replied", replied_at: now.toISOString() });
          r.reply_state = "replied";
          out.replied++;
          await logActivity(store, { platform: "email", action: "reply", target: r.to_email, message: r.subject, row_key: null });
        }
      }
    }
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
