import { isPaidPlan } from "@/lib/plan";
import { isApplePaid } from "@/lib/iap-entitlement";
import type { TrialExtensionOffer } from "@/lib/trial-extension-server";
import {
  RETENTION_GRANT_DAYS,
  RETENTION_GRANT_DAYS_AFTER_TRIAL,
  type Eligibility,
  type PlanSource,
  type RetentionPlan,
} from "@/lib/retention";

// ── Who may be offered what, in the delete-account flow ──────────────────────
//
// Pure: the route (api/account/retention) gathers the facts — the profile row,
// the ledger, the live Stripe subscription — and this decides. It lives here,
// not in the route, so every account type can be tested as behaviour rather
// than as a pattern in the route's source, and so GET (what the dialog shows)
// and POST (what the server will honour) can never ask different questions.

export type Cust = Record<string, unknown>;

export type RetentionRecord = {
  /** Every survey answer, newest last. */
  surveys?: { reason: string; comment: string; plan: string; at: string }[];
  /** ISO timestamp of the one grant/discount this account has taken. */
  grantedAt?: string;
  discountedAt?: string;
  /** ISO timestamp the card trial was stretched (api/stripe/subscription/extend-trial). */
  trialExtendedAt?: string;
  /** What the account chose in the end, for the admin funnel. */
  savedBy?: string;
  savedAt?: string;
};

export function retentionOf(cust: Cust): RetentionRecord {
  return (cust._retention as RetentionRecord | undefined) ?? {};
}

export function planOf(plan: string | null | undefined): RetentionPlan {
  return isPaidPlan(plan) ? "pro" : "free";
}

export function sourceOf(plan: string | null | undefined, cust: Cust, subId: string | null, planExpiresAt: string | null): PlanSource {
  if (!isPaidPlan(plan)) return null;
  if (isApplePaid(cust)) return "apple";
  if (subId) return "stripe";
  // Free Pro with an end date and nothing billing it (this flow's gift, a
  // referral month). Office grants keep the generic wording — "your free Pro"
  // would be the wrong plan's name.
  return plan === "pro" && planExpiresAt ? "grant" : null;
}

export const GRANT_MIN_ACCOUNT_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export function accountOldEnough(createdAt: string | null | undefined, nowMs: number = Date.now()): boolean {
  const t = createdAt ? Date.parse(createdAt) : NaN;
  return Number.isFinite(t) && nowMs - t >= GRANT_MIN_ACCOUNT_AGE_MS;
}

export function eligibilityOf(opts: {
  plan: RetentionPlan;
  /** The stored plan string — "pro" and "enterprise" are NOT interchangeable here. */
  rawPlan: string | null;
  source: PlanSource;
  rec: RetentionRecord;
  planExpiresAt: string | null;
  subId: string | null;
  /** customization._retentionUsed — set by the Billing cancel-flow offer. */
  retentionUsed: unknown;
  /** This account or email has had a Pro trial (Stripe or Apple). */
  hadTrial?: boolean;
  /** This email already took the grant on some account (purge-proof ledger). */
  grantLedgerUsed?: boolean;
  /** This email already took the 50% offer on some account (purge-proof ledger). */
  discountLedgerUsed?: boolean;
  /** A card-backed trial is running right now (mirrored trial end). */
  trialing?: boolean;
  /** auth.users.created_at — the free month is a save for real customers. */
  accountCreatedAt?: string | null;
  /**
   * The 50% offer checked against the live subscription and the person:
   * null = not looked up (not an individual Stripe Pro), which offers nothing.
   * See lib/retention-discount.
   */
  discountOk?: boolean | null;
  /**
   * The trial stretch this account could take (lib/trial-extension-server),
   * checked against the live subscription: null = none, or not looked up.
   */
  extension?: TrialExtensionOffer | null;
  /** POST only: the extend-trial route makes the live checks itself (see discountOk). */
  extendOk?: boolean | null;
  /** When the card-backed trial ends now, for the keep step's wording. */
  trialEndsAt?: string | null;
  /** Clock, for tests. */
  nowMs?: number;
}): Eligibility {
  const { plan, rawPlan, source, rec, planExpiresAt, subId, retentionUsed } = opts;
  // An Office/enterprise subscription is a seat-billed team plan: its price is
  // recomputed from the seat count by office-billing-sync, and /account/downgrade
  // refuses it outright. Discounting or self-cancelling one from a personal
  // delete dialog would either be undone by the next seat sync or strand a team,
  // so the money offers are for an INDIVIDUAL Pro subscription only.
  const individualPro = plan === "pro" && rawPlan === "pro" && source === "stripe" && !!subId;
  // ONE PROMOTION PER PERSON, EVER (owner, 2026-11-04): someone who has had
  // 50% off — here, in Billing's cancel flow, or on an older account under the
  // same email — is never offered the free month afterwards. Without this, a
  // subscriber could take the discount, drop to Free, open Delete again and be
  // handed a month of Pro on top.
  const hadDiscount = !!rec.discountedAt || retentionUsed === true || opts.discountLedgerUsed === true;
  return {
    // A Free account that has never taken retention time and is not already
    // sitting on a grant (an unexpired trial/free month) — handing 30 days to
    // someone who already has 20 left reads as a trick.
    // Not on a brand-new account: sign up, POST {action:"grant"}, and a month
    // of Pro (with its paid AI features) came free with no card, once per
    // throwaway email (security audit 2026-09-24). Someone who has used
    // SwiftCard for two weeks is the customer this offer is for.
    grant: plan === "free" && !rec.grantedAt && !rec.trialExtendedAt && !hadDiscount && !planExpiresAt && !opts.grantLedgerUsed && accountOldEnough(opts.accountCreatedAt, opts.nowMs),
    // Someone who has had a 14-day trial gets the rest of 30, not 30 more.
    grantDays: opts.hadTrial ? RETENTION_GRANT_DAYS_AFTER_TRIAL : RETENTION_GRANT_DAYS,
    // Only a real Stripe subscription can be discounted. Apple bills Apple.
    // `_retentionUsed` is the SHARED once-per-customer flag: the same 50%/3mo
    // offer is made when cancelling a subscription in Billing, and taking it
    // there must close it here too.
    // Not during a free trial: there is no invoice yet to take 50% off, and
    // cancelling the trial (downgrade) is the honest save there.
    // And only where the coupon does what the offer says, for a person who has
    // never had it on any account: active + monthly + no discount already on
    // the subscription + not in the ledger (`discountOk`, fails closed).
    discount: individualPro && !rec.discountedAt && retentionUsed !== true && !opts.trialing && opts.discountOk === true,
    downgrade: individualPro,
    // A card trial stretched to a month from its start. Its own once-only
    // record on the account, plus the free-time ledger it shares with
    // `grant` — one free month per person, whichever door it came through.
    extend: individualPro && (!!opts.extension || opts.extendOk === true) && !rec.grantedAt && !rec.trialExtendedAt,
    extendUntil: opts.extension?.until ?? null,
    extendDays: opts.extension?.extraDays,
    trialEndsAt: individualPro ? opts.trialEndsAt ?? null : null,
    chargeCents: opts.extension?.chargeCents ?? null,
    chargeInterval: opts.extension?.chargeInterval ?? null,
  };
}
