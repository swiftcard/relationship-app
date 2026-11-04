import { isPaidPlan } from "@/lib/plan";
import { appleGrantPatch, isApplePaid } from "@/lib/iap-entitlement";
import { PRO_ENDED_PENDING_KEY, TRIAL_ENDS_KEY } from "@/lib/billing-state";

// ── Reopening a deleted account: what comes back ─────────────────────────────
//
// Deleting sets plan "free" (api/account/delete) and remembers the plan it had
// in customization._deletion.plan. Reopening used to lift only the _deleted
// flag, so the account always came back on Free, which wasn't true for
// everyone:
//
//   • An APP STORE subscriber. We can't cancel Apple's billing, and the delete
//     screen says so. They kept paying and came back to Free.
//   • FREE PRO TIME (the delete flow's gift, a referral month). The days left
//     were simply lost.
//   • A website subscription whose cancellation FAILED at deletion. It is still
//     billing, and the daily sweep stops retrying once the account is open again.
//
// Each of those gets its plan back. A website subscription that WAS cancelled
// at deletion stays cancelled. The delete screen said "any subscription is
// canceled", and that's true. That account comes back on Free like any Pro
// that ended: the dashboard's "Keep Pro → / Continue on Free" panel, and none
// of the old subscription's mirrors (a trial end, a scheduled cancel) left
// behind. The webhook normally clears those, but it finds the account by
// subscription id, which deletion had already cleared.
//
// Pure, so every case is testable. The route supplies RevenueCat's answer.

export type ReopenFacts = {
  customization: Record<string, unknown>;
  planExpiresAt: string | null;
  /** profiles.stripe_subscription_id is still set — the cancel at deletion failed. */
  hasSubscription: boolean;
  /** RevenueCat: Pro entitlement active now (true), not (false), can't tell (null). */
  appleActive: boolean | null;
  nowMs?: number;
};

export type ReopenResult = {
  /** profiles columns to write; empty when the plan stays as it is (Free). */
  columns: { plan?: string; plan_expires_at?: null };
  /** The customization to write back (via writeCustomizationChanges). */
  customization: Record<string, unknown>;
  /** What was given back, for the response and the tests. */
  restored: "apple" | "subscription" | "grant" | null;
};

/** The plan the account had when it was deleted, or null. */
export function deletedPlanOf(customization: Record<string, unknown>): string | null {
  const plan = (customization._deletion as { plan?: unknown } | undefined)?.plan;
  return typeof plan === "string" ? plan : null;
}

export function reopenPatch(f: ReopenFacts): ReopenResult {
  const now = f.nowMs ?? Date.now();
  const cust: Record<string, unknown> = { ...f.customization };
  const deletedPlan = deletedPlanOf(cust);
  delete cust._deleted;
  delete cust._deletion;
  const wasPaid = isPaidPlan(deletedPlan);

  // Apple bills Apple: give Pro back only when RevenueCat says it is still
  // active. "Can't tell" stays Free. The app's own sync (api/iap/sync) or the
  // next RevenueCat event grants it, so nobody gets Pro on a guess.
  if (wasPaid && isApplePaid(cust)) {
    if (f.appleActive !== true) return { columns: {}, customization: cust, restored: null };
    const p = appleGrantPatch(cust);
    return { columns: { plan: p.plan, plan_expires_at: p.plan_expires_at }, customization: p.customization, restored: "apple" };
  }

  // The cancel at deletion failed, so they are still being charged. They get
  // what they pay for, and the webhook keeps the plan in step from here.
  if (wasPaid && f.hasSubscription && deletedPlan) {
    return { columns: { plan: deletedPlan }, customization: cust, restored: "subscription" };
  }

  // Free Pro time with days still left on it.
  const expires = f.planExpiresAt ? Date.parse(f.planExpiresAt) : NaN;
  if (deletedPlan === "pro" && !f.hasSubscription && Number.isFinite(expires) && expires > now) {
    return { columns: { plan: "pro" }, customization: cust, restored: "grant" };
  }

  // A paid plan that ended at deletion: back on Free, with nothing left over.
  if (wasPaid) {
    delete cust._cancelAtPeriodEnd;
    delete cust._cancelAt;
    delete cust._cancelReason;
    delete cust[TRIAL_ENDS_KEY];
    // Like every Pro that ends: the dashboard's Pro-ended panel (which card
    // stays live, when there is more than one). Not for Office: its owner's
    // team was released at deletion, and the panel's wording is Pro's.
    if (deletedPlan === "pro") cust[PRO_ENDED_PENDING_KEY] = true;
  }
  return { columns: {}, customization: cust, restored: null };
}
