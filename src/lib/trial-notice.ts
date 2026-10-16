// ── The one notice a card trial owes the person paying ──────────────────────
//
// A Stripe Pro/Office trial ends by CHARGING the card on file. Visa and
// Mastercard both require a heads-up before that happens, and they want it at
// different moments:
//
//   Visa        at least 7 days before the first charge, and it must state the
//               AMOUNT, not just the date.
//   Mastercard  for trials longer than 7 days: between 3 and 7 days before the
//               trial ends.
//
// The windows overlap at exactly 7 days, so ONE email sent there satisfies
// both — which is also the fewest emails, the owner's standing preference.
// Stripe's own "trial ending" email used to cover the Visa side; it was turned
// off on 2026-09-22 (it was Stripe-branded and quoted a support address we
// don't use), so this is what replaces it.
//
// Landing on "exactly 7 days" needs a run more often than once a day, which is
// why api/billing/trial-notice is called hourly by GitHub Actions (Vercel's
// Hobby plan caps crons at two per project, once a day each — see
// push-catchup.yml for the same reasoning). The daily reminders cron calls this
// too, as a backstop: if the hourly schedule stalls, the notice still goes out
// a little late rather than not at all. Nobody is emailed twice: the send
// carries an idempotency key (Resend answers a repeat within 24 hours with the
// first email instead of a second), and `_trialChargeWarnedFor` is stamped once
// it has gone — only then, so a failed send is tried again next hour instead
// of being recorded as sent (audit B-22).
import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { TRIAL_CHARGE_CENTS_KEY, TRIAL_CHARGE_INTERVAL_KEY, TRIAL_ENDS_KEY } from "./billing-state";
import { getAccountEmail } from "./account-email";
import { greetingFirstName } from "./greeting-name";
import { trialChargeSoonEmail } from "./email-templates";
import { reportError } from "./report-error";
import { mergeCustomization } from "./customization-merge";
import { getStripe } from "./stripe";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Send when 7 days or less remain — the hourly caller means the first run that
 *  sees this is normally within an hour of the 7-day mark, satisfying Visa's
 *  "at least 7 days" and staying inside Mastercard's 3-to-7-day window. The
 *  extra hour of slack is what keeps a run that fires a few minutes late from
 *  pushing the notice a whole hour under 7 days. */
const NOTICE_WINDOW_MS = 7 * DAY_MS + HOUR_MS;

/** Below this, a late notice is worse than useless — it would land inside the
 *  window Mastercard calls too late (under 3 days) and Visa never accepted.
 *  It still goes out: an imperfect notice beats a surprise charge, and the
 *  alternative is a dispute we would lose. */
const LATE_MS = 3 * DAY_MS;

/** Is this trial due its notice right now? Pure, so the timing that Visa and
 *  Mastercard actually care about is testable without a database. */
export function trialNoticeDue(msLeft: number): boolean {
  return msLeft > 0 && msLeft <= NOTICE_WINDOW_MS;
}

export type TrialNoticeResult = { considered: number; sent: number; late: number };

/** One key per person per charge date: an extended trial is a new date and a
 *  new notice; the same date is the same email, however many runs ask. */
export function trialNoticeIdempotencyKey(userId: string, endsAt: string): string {
  return `trial-charge-notice/${userId}/${endsAt}`;
}

/** Our `_cancelAtPeriodEnd` is a copy of Stripe's, and a copy can be stale:
 *  someone who pressed "Keep subscription" while a webhook was missed still
 *  reads as cancelled here, and would be charged with no notice at all (audit
 *  B-22). So the few marked cancelled are asked of Stripe before being skipped.
 *  If Stripe can't be asked, our copy is all there is. */
async function stillCancelling(subId: string | null): Promise<boolean> {
  if (!subId) return true;
  try {
    const sub = await getStripe().subscriptions.retrieve(subId);
    return sub.status === "canceled" || sub.cancel_at_period_end === true || sub.cancel_at != null;
  } catch (e) {
    await reportError("trial-notice.cancel_check", e, { subId });
    return true;
  }
}

export async function sendTrialChargeNotices(
  supabase: SupabaseClient,
  resend: Resend,
  nowMs: number = Date.now(),
): Promise<TrialNoticeResult> {
  const result: TrialNoticeResult = { considered: 0, sent: 0, late: 0 };
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

  const { data: trials } = await supabase
    .from("profiles")
    .select("id, email, name, plan, customization, stripe_subscription_id")
    // Both paid plans: an Office trial converts by charging a card exactly like
    // a Pro one, and the card networks draw no distinction between them.
    .in("plan", ["pro", "enterprise"])
    .not("stripe_subscription_id", "is", null)
    .not(`customization->>${TRIAL_ENDS_KEY}`, "is", null);

  for (const u of trials ?? []) {
    const cust = (u.customization ?? {}) as Record<string, unknown>;
    const endsAt = typeof cust[TRIAL_ENDS_KEY] === "string" ? (cust[TRIAL_ENDS_KEY] as string) : null;
    if (!endsAt) continue;
    const endMs = new Date(endsAt).getTime();
    if (!Number.isFinite(endMs)) continue;
    const msLeft = endMs - nowMs;
    // Already charged (or the date is nonsense): nothing to warn about.
    if (msLeft <= 0) continue;
    if (!trialNoticeDue(msLeft)) continue;
    // Keyed to the DATE, not a boolean: a trial that gets extended is a new
    // charge date and deserves a fresh notice.
    if (cust._trialChargeWarnedFor === endsAt) continue;
    // Cancelled during the trial: nothing is going to be charged, and "your
    // subscription starts then on the card you added — $4.99" to someone who
    // just cancelled reads as if the cancel didn't work. Not stamped, so
    // pressing "Keep subscription" before the date still gets the notice.
    if (cust._cancelAtPeriodEnd === true && await stillCancelling((u.stripe_subscription_id as string | null) ?? null)) continue;

    result.considered += 1;
    if (msLeft < LATE_MS) result.late += 1;

    // NOT stamped yet. It used to be claimed here, before sending, so a send
    // that failed (a Resend outage) or never happened (no account email yet)
    // still read as "warned", and the trialist was charged with no notice.
    // The hourly route and the daily backstop can overlap; the idempotency
    // key on the send is what keeps that to one email.
    const to = await getAccountEmail(u.id as string, (u.email as string) ?? null);
    if (!to) continue;

    const cents = typeof cust[TRIAL_CHARGE_CENTS_KEY] === "number" ? (cust[TRIAL_CHARGE_CENTS_KEY] as number) : null;
    const intervalWord =
      typeof cust[TRIAL_CHARGE_INTERVAL_KEY] === "string" ? (cust[TRIAL_CHARGE_INTERVAL_KEY] as string) : undefined;

    // WHICH trial this is, from what they OWN — not profiles.plan. Someone
    // on a Pro trial who then joined a team has plan "enterprise" (their seat),
    // and this told them their "Office trial" was ending and their team would
    // be released. An Office trial is an office they own.
    const [{ data: owned }, { data: seat }] = await Promise.all([
      supabase.from("offices").select("id").eq("owner_id", u.id).limit(1).maybeSingle(),
      supabase.from("office_members").select("id").eq("user_id", u.id).eq("status", "active").limit(1).maybeSingle(),
    ]);
    const tpl = trialChargeSoonEmail({
      firstName: (await greetingFirstName(supabase, u.id as string, u.name as string | null)) || "there",
      // "Office", never the internal "enterprise" id — the product never uses
      // that word to a customer (same rule as receipts).
      planName: owned ? "Office" : "Pro",
      teamMember: !owned && !!seat,
      chargeDate: new Date(endMs).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
      amountCents: cents,
      intervalWord,
      manageUrl: `${appUrl}/settings/flows?billing=1`,
    });

    // Billing mail: sent regardless of marketing preferences. Someone who
    // muted product updates has not agreed to be charged without notice.
    const { data: sent, error: sendError } = await resend.emails
      .send({ ...tpl, to }, { idempotencyKey: trialNoticeIdempotencyKey(u.id as string, endsAt) })
      .catch((e: unknown) => ({ data: null, error: e instanceof Error ? e : new Error(String(e)) }));
    if (sendError || !sent?.id) {
      // Left unstamped: the next hourly run tries again.
      await reportError("trial-notice.email", sendError ?? "no id returned", { userId: u.id });
      continue;
    }
    result.sent += 1;
    // Merged, not a whole-blob write: this read of customization is from the
    // start of the run, and writing it back would undo anything changed since
    // (the audit's B-03 pattern).
    const stamped = await mergeCustomization(u.id as string, { set: { _trialChargeWarnedFor: endsAt }, remove: [] }, { admin: supabase })
      .catch(() => null);
    if (!stamped) {
      // The next run's send is answered by Resend's idempotency, not re-sent.
      await reportError("trial-notice.stamp", "could not record the notice as sent", { userId: u.id });
    }
    try {
      await supabase
        .from("email_logs")
        .insert({ user_id: u.id, email: to, type: "trial_charge_soon", subject: tpl.subject, resend_id: sent.id });
    } catch { /* logging is best-effort */ }
  }

  return result;
}
