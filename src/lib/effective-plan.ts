import { isPaidPlan } from "@/lib/plan";
import { isApplePaid } from "@/lib/iap-entitlement";

// ── The plan an account has RIGHT NOW, not at the last cron run ──────────────
//
// Timed grants (a free month, a retention month, a referral reward, an admin
// comp, the app-level trial) are `plan = "pro"` plus `plan_expires_at`, and
// only the once-a-day expireFreeMonths job (lib/referral-server.ts) turns them
// back into Free. Until it ran, an expired grant still saw every place name —
// up to a day of Pro for nothing (2026-10-06 final analytics review).
//
// This mirrors that job's rules exactly, so the read-time answer is always the
// answer the job is about to write:
//   • a real subscriber (Stripe subscription or Apple-paid) is never expired by
//     a stale grant date — the job only clears the date for them;
//   • anything else whose date has passed is Free.
//
// Callers MUST select `plan_expires_at`, `stripe_subscription_id` and
// `customization` alongside `plan`. Without the subscription columns a paying
// subscriber with a stale date would read as Free — withholding from a payer,
// which is recoverable, but still wrong.

export type PlanRow = {
  plan?: string | null;
  plan_expires_at?: string | null;
  stripe_subscription_id?: string | null;
  customization?: unknown;
} | null | undefined;

export function effectivePlan(row: PlanRow): string | null {
  const plan = row?.plan ?? null;
  if (!row || !isPaidPlan(plan)) return plan;
  const expires = row.plan_expires_at;
  if (!expires) return plan;
  if (row.stripe_subscription_id || isApplePaid(row.customization)) return plan;
  const t = new Date(expires).getTime();
  return Number.isFinite(t) && t <= Date.now() ? "free" : plan;
}

/** Paid (Pro or Office) right now, with an expired timed grant counted as Free. */
export function isPaidProfile(row: PlanRow): boolean {
  return isPaidPlan(effectivePlan(row));
}

/** The columns effectivePlan needs, for a `.select(...)` string. */
export const PLAN_COLUMNS = "plan, plan_expires_at, stripe_subscription_id, customization";
