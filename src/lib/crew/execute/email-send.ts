import { suppressionKeys } from "../approvals";
import { normalizeHandle } from "../ledger";
import { logActivity } from "../sheets/activity";
import { approvalKey } from "../sheets/keys";
import type { CrewStore } from "../store";
import type { Approval } from "../types";
import type { GmailTransport } from "../email/gmail";
import { buildRaw, draftProblems, EMAIL_RE, finalText, newMessageId, parseDraft, sha, unsubscribeMailto } from "../email/message";
import { RETRYABLE, type EmailSendStore } from "../email/sends";
import type { ExecResult } from "./index";

// ── An approved email → sent from the SwiftCard mailbox ────────────────────
// Reached only from decide() (action "send_email"), which only the admin's
// Approve route calls, behind requireAdmin. The Sheet can approve a draft but
// can never send one (tests/crew-email-send pins that).
//
// In order, every one of these refuses before Gmail is touched:
//   1. it is an approved email draft with a real address
//   2. the office isn't locked (kill switch)
//   3. the address and its @domain aren't on the suppression list, and the
//      person hasn't opted out or been contacted by anything else
//   4. the draft has a subject and reads like an email (draftProblems)
//   5. this draft was never sent; a send with no answer is looked up in the
//      Sent folder by its Message-ID before a retry may go
//   6. dry run (CREW_EMAIL_LIVE unset): recorded as simulated, nothing sent
//   7. the mailbox is connected as the configured address
//   8. the 24-hour cap and one-per-domain-per-day are not reached
//   9. the claim on the send row wins (one row per draft, one live email
//      per address, atomic in SQL), and only then Gmail is called once.

export type EmailConfig = {
  live: boolean;
  mailbox: string;
  fromName: string;
  dailyCap: number;
  postalAddress: string | null;
};

export type EmailDeps = { sends: EmailSendStore; gmail: GmailTransport; config: EmailConfig };

/** An email draft the sender can act on: a DM on the email platform, addressed. */
export function isEmailDraft(a: Pick<Approval, "kind" | "platform" | "meta">): boolean {
  return a.kind === "dm" && a.platform === "email" && typeof a.meta?.email === "string" && EMAIL_RE.test(String(a.meta.email).trim());
}

const DAY_MS = 86_400_000;
/** A claim with no outcome this long is treated as "no answer" and checked in Sent. */
export const STUCK_MS = 2 * 60_000;

export async function sendApprovedEmail(store: CrewStore, deps: EmailDeps, a: Approval, by: string, now = new Date()): Promise<ExecResult> {
  const { sends, gmail, config } = deps;
  if (a.status !== "approved") return { ok: false, message: "Not approved." };
  if (!isEmailDraft(a)) return { ok: false, message: "This isn't an email draft with an address." };
  // The address as written goes on the email (jane+sales@ stays jane+sales@);
  // the normalized one is only for the suppression list and the ledger.
  const to = String(a.meta.email).trim().toLowerCase();
  const norm = normalizeHandle("email", to);
  const domain = to.split("@")[1] ?? "";

  if ((await store.getSettings()).kill_all) return { ok: false, message: "The office is locked (Stop everything). Nothing was sent." };
  if (await store.isSuppressed(suppressionKeys("email", norm))) return { ok: false, message: `${to} is on the suppression list. Nothing was sent.` };
  if (a.person_id) {
    const touches = await store.touchesFor(a.person_id);
    if (touches.some((t) => t.kind === "opted_out")) return { ok: false, message: "This person opted out. Nothing was sent." };
  }

  const problems = draftProblems(a.body, to);
  if (problems.length) return { ok: false, message: `Fix the draft first: ${problems.join("; ")}.` };
  const draft = parseDraft(a.body)!;
  const text = finalText(draft, config.postalAddress);

  // ── Has this draft been sent already? ───────────────────────────────────
  const prior = await sends.get(a.id);
  const from = [...RETRYABLE];
  if (prior?.status === "sent") return { ok: true, message: `Already sent to ${prior.to_email}. Not sent again.`, result: { gmail_id: prior.gmail_id, thread_id: prior.thread_id } };
  if (prior && (prior.status === "sending" || prior.status === "unknown")) {
    // Give a send with no answer time to appear in Sent before deciding it never went.
    if (now.getTime() - new Date(prior.updated_at).getTime() < STUCK_MS) return { ok: false, message: prior.status === "sending" ? "This email is being sent right now. Refresh in a minute." : "Gmail didn't answer a moment ago. Wait two minutes, then retry; it checks your Sent folder first." };
    // Look back to well before the first try, so a slow-to-appear send is still found.
    const found = await gmail.findSent(prior.message_id_header, new Date(Date.parse(prior.created_at) - 10 * 60_000).toISOString());
    if (found === "unavailable") {
      await sends.transition(prior.id, prior, { status: "unknown", error: "Gmail didn't answer; it may have been sent. Checked again on the next try." });
      return { ok: false, message: "Gmail didn't answer, so it may have gone out. Not resent. Try again in a few minutes; it checks your Sent folder first." };
    }
    if (found) {
      await sends.transition(prior.id, prior, { status: "sent", gmail_id: found.id, thread_id: found.threadId, sent_at: prior.sent_at ?? now.toISOString(), error: null });
      return { ok: true, message: `It had gone out already (found in Sent). Not sent again.`, result: { gmail_id: found.id, thread_id: found.threadId } };
    }
    // Not in Sent: it never went. Only the request that wins this move may send.
    if (!(await sends.transition(prior.id, prior, { status: "failed", error: "Not found in Sent after no answer from Gmail." }))) return { ok: false, message: "This email is already being retried. Refresh in a minute." };
    from.push("failed");
  }

  // One first email per address, across every draft.
  // (The ledger catches the rest: jane+sales@ and jane@ are one person there.)
  const others = [...(await sends.liveForAddress(to)), ...(norm !== to ? await sends.liveForAddress(norm) : [])].filter((r) => r.approval_id !== a.id);
  if (others.length) return { ok: false, message: `${to} was already emailed from SwiftCard. Not sent again.` };
  if (a.person_id) {
    const touches = await store.touchesFor(a.person_id);
    if (touches.some((t) => !["lead_listed", "dm_drafted"].includes(t.kind))) return { ok: false, message: "Someone already contacted this person another way. Nothing was sent." };
  }

  const base = {
    approval_id: a.id,
    lead_id: typeof a.meta.lead_id === "string" ? a.meta.lead_id : null,
    to_email: to,
    from_email: config.mailbox,
    subject: draft.subject,
    body_sha: sha(text),
    message_id_header: newMessageId(config.mailbox.split("@")[1] ?? "swiftcard.me"),
    approved_by: by,
  };
  const log = (result: "ok" | "failed" | "simulated", error: string | null = null) =>
    logActivity(store, { agent_id: a.agent_id, platform: "email", action: "email", target: to, message: `${draft.subject}\n\n${text}`, result, error, row_key: approvalKey(a.id), approved_by: by, simulated: result === "simulated" });

  // ── Dry run: record what would have gone, send nothing ──────────────────
  if (!config.live) {
    const c = await sends.claim({ ...base, status: "simulated" }, [...from, "simulated"]);
    if (!c.ok) return { ok: false, message: "Couldn't record the dry run (it was already being sent)." };
    await log("simulated");
    return { ok: true, simulated: true, message: `Dry run: this would have gone to ${to} from ${config.mailbox}. Nothing was sent.` };
  }

  // ── Live ────────────────────────────────────────────────────────────────
  if (!config.postalAddress) return { ok: false, message: "Set CREW_EMAIL_POSTAL_ADDRESS first (US law wants a postal address in outreach email). Nothing was sent." };
  const acct = await gmail.account();
  if (!acct.ok) return { ok: false, message: acct.reason === "not_connected" ? "Connect the SwiftCard mailbox first. Nothing was sent." : `The mailbox connection needs attention (${acct.reason}). Nothing was sent.` };
  if (acct.email !== config.mailbox) return { ok: false, message: `The mailbox is connected as ${acct.email}, not ${config.mailbox}. Nothing was sent.` };
  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const used = await sends.countSince(since);
  if (used >= config.dailyCap) return { ok: false, message: `Today's limit is reached (${config.dailyCap} emails in 24 hours). Nothing was sent; try tomorrow.` };
  if ((await sends.countSince(since, domain)) >= 1) return { ok: false, message: `Someone at ${domain} was emailed in the last 24 hours. One per company a day; try tomorrow.` };

  const claim = await sends.claim({ ...base, status: "sending" }, from);
  if (!claim.ok) return { ok: false, message: claim.reason === "address_taken" ? `${to} was already emailed from SwiftCard. Not sent again.` : "This email is already being sent or was sent. Not sent again." };
  // The counts above are check-then-act; two Sends at once could both pass.
  // Count again now that this claim is on record (it counts itself): over the
  // line means let go and send nothing. Two racers may both let go; neither sends.
  if ((await sends.countSince(since)) > config.dailyCap || (await sends.countSince(since, domain)) > 1) {
    await sends.patch(claim.row.id, { status: "failed", error: "Another send took the last slot at the same moment. Nothing was sent; retry later." });
    return { ok: false, message: "Another email went at the same moment and took today's slot. Nothing was sent; retry later." };
  }

  let raw: string;
  try {
    raw = buildRaw({ from: config.mailbox, fromName: config.fromName, to, subject: draft.subject, text, messageId: base.message_id_header, unsubscribe: unsubscribeMailto(config.mailbox) });
  } catch (e) {
    await sends.patch(claim.row.id, { status: "failed", error: e instanceof Error ? e.message : String(e) });
    return { ok: false, message: "The email couldn't be put together. Nothing was sent." };
  }
  const out = await gmail.send(raw);
  if (out.ok) {
    await sends.patch(claim.row.id, { status: "sent", gmail_id: out.id, thread_id: out.threadId, sent_at: now.toISOString(), error: null });
    await log("ok");
    return { ok: true, message: `Sent to ${to} from ${config.mailbox}.`, result: { gmail_id: out.id, thread_id: out.threadId, to } };
  }
  await sends.patch(claim.row.id, { status: out.definite ? "failed" : "unknown", error: out.message });
  await log("failed", out.message);
  return {
    ok: false,
    message: out.definite ? `Gmail refused it: ${out.message}. Nothing was sent; you can retry.` : "No answer from Gmail, so it may have gone out. Not marked sent. Retry checks your Sent folder first, so it can't go twice.",
  };
}
