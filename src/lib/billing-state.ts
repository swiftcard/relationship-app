// ── What a person's Pro status IS, in words — one place ─────────────────────
//
// Pure (no I/O, no React) so the webhook, the billing API, BillingManager, the
// dashboard banner and the "Pro ended" panel all describe the same state the
// same way. Two surfaces disagreeing about when a trial ends, or whether a
// charge is coming, is how people get billed by surprise.

const DAY_MS = 86_400_000;

/** customization key: ISO time a Stripe trial converts to paid. Mirrored by the
 *  Stripe webhook so the dashboard never has to call Stripe to know it. */
export const TRIAL_ENDS_KEY = "_trialEndsAt";

/** customization keys: what the first charge after a trial will be. Mirrored
 *  by the Stripe webhook beside TRIAL_ENDS_KEY so the day-7 notice can quote
 *  the amount without a Stripe call per trial — and Visa's trial rules require
 *  that notice to carry the amount, not only the date. */
export const TRIAL_CHARGE_CENTS_KEY = "_trialChargeCents";
export const TRIAL_CHARGE_INTERVAL_KEY = "_trialChargeInterval";

/** customization key: Pro ended and the person has not yet chosen between
 *  subscribing and continuing on Free. Cleared by api/account/choose-plan and
 *  by any paid plan being provisioned. */
export const PRO_ENDED_PENDING_KEY = "_proEndedChoicePending";

/** customization key: at least one invoice on this account was actually PAID
 *  (amount > 0). Separates "a trial whose first charge failed" from "a paying
 *  customer whose renewal failed" — only the second gets the 7-day grace. */
export const EVER_PAID_KEY = "_everPaid";

export function daysUntil(iso: string | null | undefined, nowMs: number = Date.now()): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.ceil((t - nowMs) / DAY_MS));
}

export function formatBillingDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── Subscribing while the delete-flow gift is running ────────────────────────
//
// "Try Pro free for 30 days — on us" (lib/retention) is free Pro with no card.
// Someone who likes it and subscribes on day 5 used to be charged on day 5 —
// the 25 days they had been given were simply lost. Now the Stripe
// subscription starts in a trial that ends the moment the gift does, so the
// first charge lands on the day free Pro would have ended anyway.

/** Stripe Checkout refuses a trial_end under 48 hours away; one hour of margin. */
export const MIN_TRIAL_END_LEAD_MS = 49 * 60 * 60 * 1000;

/**
 * The ISO end of a delete-flow gift that is running right now, or null.
 * Only the gift: plan "pro", no subscription, not Apple, a future expiry, and
 * the grant recorded in customization._retention.
 */
export function retentionGiftEndsAt(
  p: { plan: string | null | undefined; planExpiresAt: string | null | undefined; hasSubscription: boolean; customization: Record<string, unknown> | null | undefined },
  nowMs: number = Date.now(),
): string | null {
  if (p.plan !== "pro" || p.hasSubscription || !p.planExpiresAt) return null;
  const cust = p.customization ?? {};
  if (cust._planSource === "apple") return null;
  const granted = (cust._retention as { grantedAt?: unknown } | undefined)?.grantedAt;
  if (typeof granted !== "string") return null;
  const t = Date.parse(p.planExpiresAt);
  return Number.isFinite(t) && t > nowMs ? new Date(t).toISOString() : null;
}

/**
 * Unix seconds for subscription_data.trial_end so billing starts when the gift
 * ends — or null when it ends too soon for Stripe to accept (then billing
 * simply starts today; at most two free days are given up).
 */
export function giftBridgeTrialEnd(giftEndsAt: string | null | undefined, nowMs: number = Date.now()): number | null {
  if (!giftEndsAt) return null;
  const t = Date.parse(giftEndsAt);
  if (!Number.isFinite(t) || t - nowMs < MIN_TRIAL_END_LEAD_MS) return null;
  return Math.floor(t / 1000);
}

/** A Stripe subscription's trial end as ISO, only while it is actually trialing. */
export function stripeTrialEndIso(sub: { status?: string | null; trial_end?: number | null }): string | null {
  if (sub.status !== "trialing" || !sub.trial_end) return null;
  return new Date(sub.trial_end * 1000).toISOString();
}

/** Did any of these invoices actually take money? A $0.00 trial-start invoice
 *  is "paid" in Stripe's terms and must not count. */
export function anyInvoiceActuallyPaid(invoices: { amount_paid?: number | null }[]): boolean {
  return invoices.some((i) => (i.amount_paid ?? 0) > 0);
}

/**
 * The trial status line. `native` drops the price (App Store 3.1.1 — the iOS
 * shell never quotes a price outside StoreKit's own sheet).
 */
export function trialStatusLine(opts: {
  trialEndsAt: string;
  amountCents?: number | null;
  native: boolean;
  nowMs?: number;
}): string {
  const days = daysUntil(opts.trialEndsAt, opts.nowMs);
  const left = days === 1 ? "1 day left" : `${days} days left`;
  const date = formatBillingDate(opts.trialEndsAt);
  if (opts.native || !opts.amountCents) return `Pro trial · ${left} · ends ${date}`;
  return `Pro trial · ${left} · first charge $${(opts.amountCents / 100).toFixed(2)} on ${date}`;
}

/** Notification copy when Pro ends and the account is now on Free. */
export function proEndedNotice(wasTrial: boolean, endedPlan?: string | null): { title: string; body: string } {
  // An Office owner was told "Your Pro plan has ended" — the wrong plan, and
  // not a word about the team they just lost.
  if (endedPlan === "enterprise") return officeEndedNotice(wasTrial);
  return {
    title: wasTrial ? "Your Pro trial has ended" : "Your Pro plan has ended",
    body: "Subscribe to keep all your cards and your Pro design, or continue on Free. Nothing has been deleted.",
  };
}

/**
 * Office ended on the OWNER's account (cancelled, or a granted Office ran
 * out). Says what happened to the team, and nothing that sells — no plan
 * price, no "subscribe", no "upgrade" — so the same words are right on the web
 * and inside the iPhone app.
 */
export function officeEndedNotice(wasTrial: boolean): { title: string; body: string } {
  return {
    title: wasTrial ? "Your Office trial has ended" : "Your Office plan has ended",
    body: "Your account is on the Free plan now. Your teammates keep their first card, without your company branding, and your team is saved for when you come back. Nothing has been deleted.",
  };
}

/** Accounts created on or after this moment must pass the plan step once
 *  (dashboard → /welcome until a plan is recorded). Earlier accounts were never
 *  asked and are left exactly as they are. */
export const PLAN_STEP_REQUIRED_SINCE = "2026-09-17T00:00:00Z";

// ── The free period, and where it is announced ───────────────────────────────
//
// Owner, 2026-10-02 (asked for more than once): a free period — the Pro trial,
// a friend's free month, a promo code, the delete-flow gift, an Office grant —
// is announced at the top of the dashboard ONLY on the account's first day.
// From then on the bubble is gone for good, and the days left live in
// Settings → Profile. One description of the period, read by both, so the two
// places can never disagree about what it is or when it ends.

export type FreePeriod = {
  /** "trial": a card-backed Stripe trial (it converts to paid unless cancelled).
   *  "grant": free time with nothing billing it (it ends on its own). */
  kind: "trial" | "grant";
  planName: "Pro" | "Office";
  /** ISO end of the free period. */
  endsAt: string;
  daysLeft: number;
  /** Said as a "trial" (a Stripe trial, or a legacy app trial) vs "free Pro". */
  isTrial: boolean;
  /** A Stripe trial cancelled before it converts: nothing will be charged. */
  canceled: boolean;
};

/**
 * The free period this account is in right now, or null. Apple-billed plans
 * are null: Apple never tells us when its intro trial ends, so there is no
 * date to show. A period that has run out is null too.
 */
export function freePeriodOf(
  p: {
    plan: string | null | undefined;
    planExpiresAt: string | null | undefined;
    hasSubscription: boolean;
    customization: Record<string, unknown> | null | undefined;
  },
  nowMs: number = Date.now(),
): FreePeriod | null {
  if (p.plan !== "pro" && p.plan !== "enterprise") return null;
  const cust = p.customization ?? {};
  if (cust._planSource === "apple") return null;
  const planName = p.plan === "enterprise" ? "Office" : "Pro";
  const trialEnds = typeof cust[TRIAL_ENDS_KEY] === "string" ? (cust[TRIAL_ENDS_KEY] as string) : null;
  const kind: FreePeriod["kind"] | null =
    p.hasSubscription && trialEnds ? "trial" : !p.hasSubscription && p.planExpiresAt ? "grant" : null;
  if (!kind) return null;
  const endsAt = (kind === "trial" ? trialEnds : p.planExpiresAt) as string;
  const daysLeft = daysUntil(endsAt, nowMs);
  if (daysLeft <= 0) return null;
  return {
    kind,
    planName,
    endsAt,
    daysLeft,
    isTrial: kind === "trial" || cust._trial === true,
    canceled: kind === "trial" && cust._cancelAtPeriodEnd === true,
  };
}

/** The dashboard's free-period bubble is for the account's first day only. */
export const TRIAL_BUBBLE_FIRST_DAY_MS = DAY_MS;

/** True only during the first 24 hours of the account's life. Unknown → false. */
export function showsTrialBubble(accountCreatedAt: string | null | undefined, nowMs: number = Date.now()): boolean {
  const t = accountCreatedAt ? Date.parse(accountCreatedAt) : NaN;
  if (!Number.isFinite(t)) return false;
  // A creation time a moment in the future (clock skew) is still day one.
  return nowMs - t < TRIAL_BUBBLE_FIRST_DAY_MS;
}
