import { getAdminSupabase } from "@/lib/supabase-admin";
import { isOptedOut, sendRawEmail, sendSms } from "@/lib/messaging";
import { INBOX_ADDRESS } from "@/lib/email-senders";
import { reportError } from "@/lib/report-error";
import { autoTextable } from "@/lib/sms-number";
import { buildDemoEmail, buildDemoText } from "./emails";
import { withinTextHours } from "./reminders";
import { reconcileWithCalendar } from "./service";
import { getBooking, REMINDER_KINDS, type DemoBooking, type DemoMessage } from "./store";

// ── Sending what is due ─────────────────────────────────────────────────────
// Every demo email and text is a demo_messages row. The clock (/api/demo/tick,
// every 5 minutes from pg_cron) and the booking request itself call drain().
//
// A row is CLAIMED before it is sent: one UPDATE that only matches while the
// row still has the attempt count we read, so two runs at once can never both
// send it. A claim older than 10 minutes (a run that died mid-send) can be
// taken again. Resend gets an idempotency key as a second guard.
//
// Before a reminder goes, the booking is checked: still confirmed, not yet
// started, and still the same in the owner's Google Calendar (deleted there,
// moved there, or declined by the guest all change what should be sent).

const STALE_CLAIM_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const BACKOFF_MIN = [5, 15, 60, 180];

const db = () => getAdminSupabase();

type Outcome = { sent: true; providerId: string | null } | { sent: false; skip: string } | { sent: false; retry: string };

async function claim(row: DemoMessage, now: Date): Promise<boolean> {
  const { data } = await db().from("demo_messages")
    .update({ claimed_at: now.toISOString(), attempts: row.attempts + 1 })
    .eq("id", row.id).eq("attempts", row.attempts).is("sent_at", null).is("skipped_reason", null)
    .select("id");
  return (data ?? []).length === 1;
}

async function deliver(row: DemoMessage, b: DemoBooking, now: Date): Promise<Outcome> {
  const isReminder = REMINDER_KINDS.includes(row.kind);
  if (isReminder || row.kind === "meet_link") {
    if (b.status !== "confirmed") return { sent: false, skip: "canceled" };
    if (new Date(b.starts_at).getTime() <= now.getTime()) return { sent: false, skip: "too_late" };
  }
  if (isReminder) {
    // The calendar may have changed since the booking: check before reminding.
    const fresh = await reconcileWithCalendar(b, now);
    if (fresh.status !== "confirmed") return { sent: false, skip: "canceled" };
    if (fresh.starts_at !== b.starts_at) return { sent: false, skip: "moved_in_calendar" };
    b = fresh;
  }

  if (row.channel === "sms") {
    if (!b.sms_opt_in || !autoTextable(b.phone)) return { sent: false, skip: "not_textable" };
    if (!withinTextHours(now, b.timezone)) return { sent: false, skip: "quiet_hours" };
    if (await isOptedOut("sms", b.phone)) return { sent: false, skip: "opted_out" };
    const r = await sendSms(b.phone, buildDemoText(b));
    if (r.status === "sent") return { sent: true, providerId: r.sid };
    if (r.status === "not_configured") return { sent: false, skip: "sms_not_configured" };
    return { sent: false, retry: `sms failed${r.code ? ` (${r.code})` : ""}` };
  }

  const mail = buildDemoEmail(row.kind, b);
  if (!mail) return { sent: false, skip: "nothing_to_send" };
  const toOwner = mail.audience === "owner";
  if (!toOwner && isReminder && (await isOptedOut("email", b.email))) return { sent: false, skip: "opted_out" };
  const status = await sendRawEmail({
    to: toOwner ? INBOX_ADDRESS : b.email,
    subject: mail.subject,
    html: mail.html,
    sender: "support",
    fromName: "SwiftCard Demos",
    // The owner's copy: a reply goes straight to the prospect.
    replyTo: toOwner ? b.email : null,
    personal: mail.personal,
    idempotencyKey: `demo/${b.id}/${row.kind}/${row.id}`,
  });
  if (status === "sent") return { sent: true, providerId: null };
  if (status === "not_configured") return { sent: false, skip: "email_not_configured" };
  return { sent: false, retry: "email failed" };
}

async function handle(row: DemoMessage, now: Date): Promise<"sent" | "skipped" | "retry" | "lost"> {
  if (!(await claim(row, now))) return "lost";
  const b = await getBooking(row.booking_id);
  let out: Outcome;
  if (!b) out = { sent: false, skip: "no_booking" };
  else {
    try {
      out = await deliver(row, b, now);
    } catch (e) {
      out = { sent: false, retry: e instanceof Error ? e.message : String(e) };
    }
  }
  if (out.sent) {
    await db().from("demo_messages").update({ sent_at: new Date().toISOString(), provider_id: out.providerId, last_error: null }).eq("id", row.id);
    return "sent";
  }
  if ("skip" in out) {
    await db().from("demo_messages").update({ skipped_reason: out.skip }).eq("id", row.id);
    return "skipped";
  }
  const attempts = row.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await db().from("demo_messages").update({ skipped_reason: "gave_up", last_error: out.retry.slice(0, 500) }).eq("id", row.id);
    await reportError("demo.message.gave_up", out.retry, { booking: row.booking_id, kind: row.kind });
    return "skipped";
  }
  const wait = BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] * 60_000;
  await db().from("demo_messages").update({
    claimed_at: null, last_error: out.retry.slice(0, 500), send_at: new Date(now.getTime() + wait).toISOString(),
  }).eq("id", row.id);
  return "retry";
}

export type DrainResult = { sent: number; skipped: number; retry: number };

/** Send everything due now (for one booking, or all of them). */
export async function drainDue({ now = new Date(), bookingId, limit = 40 }: { now?: Date; bookingId?: string; limit?: number } = {}): Promise<DrainResult> {
  const staleBefore = new Date(now.getTime() - STALE_CLAIM_MS).toISOString();
  let q = db().from("demo_messages").select("*")
    .is("sent_at", null).is("skipped_reason", null).lte("send_at", now.toISOString())
    .or(`claimed_at.is.null,claimed_at.lt.${staleBefore}`)
    .order("send_at").limit(limit);
  if (bookingId) q = q.eq("booking_id", bookingId);
  const { data, error } = await q;
  if (error) throw new Error(`demo_messages read failed: ${error.message}`);
  const result: DrainResult = { sent: 0, skipped: 0, retry: 0 };
  for (const row of (data ?? []) as DemoMessage[]) {
    const r = await handle(row, now);
    if (r === "sent") result.sent++;
    else if (r === "skipped") result.skipped++;
    else if (r === "retry") result.retry++;
  }
  return result;
}

/** Messages that should have gone 20+ minutes ago and haven't (the health check). */
export async function overdueCount(now = new Date()): Promise<number> {
  const { count } = await db().from("demo_messages").select("id", { count: "exact", head: true })
    .is("sent_at", null).is("skipped_reason", null).lt("send_at", new Date(now.getTime() - 20 * 60_000).toISOString());
  return count ?? 0;
}
