import { FREE_MONTH_DAYS } from "@/lib/plan";
import { MIN_TRIAL_END_LEAD_MS } from "@/lib/billing-state";

// ── Stretching a Pro trial to a full month ───────────────────────────────────
//
// Owner, 2026-10-02: someone on the 14-day Pro trial who tries to leave —
// "Delete account", or cancelling in Billing — is offered free Pro until a
// month from the day the trial STARTED. Day 7 of the trial: free until day 30.
// Day 13: the same day 30. The end date is fixed to the trial's start, never
// counted from today, so asking late earns nothing extra.
//
// Only a card-backed Stripe trial can be stretched: moving its trial_end moves
// the first charge. An Apple intro-offer trial belongs to Apple — its length is
// set in App Store Connect and nothing we hold can change it.
//
// Once per PERSON, and the same once as the Free plan's delete-flow gift: the
// account records it in customization._retention and the email goes into the
// purge-proof `email_retention` ledger (lib/trial-ledger). Trial + stretch is
// the one free month anyone gets, never a month on top of a month.

/** A trial is stretched to this many days from its start. */
export const TRIAL_EXTENSION_TOTAL_DAYS = FREE_MONTH_DAYS;

/** Subscription metadata stamped when a trial is stretched — a second record
 *  that lives on Stripe's side, so the offer can never come back for this
 *  subscription even if the account's own record were lost. */
export const TRIAL_EXTENDED_META_KEY = "retention_trial_extended_at";

const DAY_MS = 86_400_000;

type ExtendableSub = {
  status?: string | null;
  trial_start?: number | null;
  trial_end?: number | null;
  cancel_at_period_end?: boolean | null;
  metadata?: Record<string, string> | null;
};

export type TrialExtension = {
  /** ISO: the new trial end — the trial's start + 30 days. */
  until: string;
  /** The same moment as Unix seconds, for Stripe's trial_end. */
  untilUnix: number;
  /** ISO: when the trial ends today, before the stretch. */
  currentEnd: string;
  /** Days added to the trial (16 for a standard 14-day trial). */
  extraDays: number;
};

/**
 * What stretching this subscription's trial would do, or null when it can't
 * be stretched. Pure — the caller adds who the PERSON is (plan, Apple, the
 * ledger); this answers only for the subscription:
 *
 *   • trialing, with both trial dates known and the end still ahead
 *   • not already cancelled — accepting re-enables billing, and doing that to
 *     someone who already chose to cancel would be a charge they turned down
 *   • never stretched before (metadata stamp)
 *   • the new end at least a full day past the current one: a promo trial that
 *     already runs a month or longer has nothing to gain
 */
export function trialExtensionFor(sub: ExtendableSub, nowMs: number = Date.now()): TrialExtension | null {
  if (sub.status !== "trialing") return null;
  if (!sub.trial_start || !sub.trial_end) return null;
  if (sub.cancel_at_period_end) return null;
  if (sub.metadata?.[TRIAL_EXTENDED_META_KEY]) return null;
  const endMs = sub.trial_end * 1000;
  if (endMs <= nowMs) return null;
  const untilUnix = sub.trial_start + TRIAL_EXTENSION_TOTAL_DAYS * 86_400;
  const untilMs = untilUnix * 1000;
  if (untilMs - endMs < DAY_MS) return null;
  // Stripe needs a trial end comfortably in the future. A standard trial
  // stretched from any day of it is always ~16+ days out; this only guards a
  // nonsense start date.
  if (untilMs - nowMs < MIN_TRIAL_END_LEAD_MS) return null;
  return {
    until: new Date(untilMs).toISOString(),
    untilUnix,
    currentEnd: new Date(endMs).toISOString(),
    extraDays: Math.round((untilMs - endMs) / DAY_MS),
  };
}
