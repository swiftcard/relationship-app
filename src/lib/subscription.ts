import { PLAN_PRICES } from "@/lib/plan";

// ── Central Stripe price ↔ plan mapping ───────────────────────────────────────
// Price IDs live only in env vars. Every route that needs to know "what plan is
// this price?" or "what price do I switch this subscription to?" used to inline
// its own env lookups, which is exactly how the enterprise-ANNUAL price got
// mis-classified as Pro in the webhook. This module is the ONE place that maps
// between our plan model and Stripe prices so that can't drift again.

export type BillingPlan = "pro" | "office"; // "office" == DB plan value "enterprise"
export type BillingInterval = "monthly" | "annual";

// DB stores the Office plan as "enterprise" for historical reasons.
export const DB_PLAN: Record<BillingPlan, "pro" | "enterprise"> = {
  pro: "pro",
  office: "enterprise",
};

type PriceEntry = { id: string; plan: BillingPlan; interval: BillingInterval; cents: number };

// Built once from env. A missing env var simply omits that price (the entry is
// filtered out) rather than crashing — callers handle "price not configured".
function buildPrices(): PriceEntry[] {
  const raw: Array<[string | undefined, BillingPlan, BillingInterval, number]> = [
    [process.env.STRIPE_PRICE_ID, "pro", "monthly", PLAN_PRICES.PRO_MONTHLY_CENTS],
    [process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID, "pro", "monthly", PLAN_PRICES.PRO_MONTHLY_CENTS],
    [process.env.NEXT_PUBLIC_STRIPE_ANNUAL_PRICE_ID, "pro", "annual", PLAN_PRICES.PRO_ANNUAL_CENTS],
    [process.env.NEXT_PUBLIC_STRIPE_ENTERPRISE_PRICE_ID, "office", "monthly", PLAN_PRICES.OFFICE_MONTHLY_PER_SEAT_CENTS],
    [process.env.NEXT_PUBLIC_STRIPE_ENTERPRISE_ANNUAL_PRICE_ID, "office", "annual", PLAN_PRICES.OFFICE_ANNUAL_PER_SEAT_CENTS],
  ];
  return raw.filter(([id]) => !!id).map(([id, plan, interval, cents]) => ({ id: id as string, plan, interval, cents }));
}

// Pure so the mapping can be unit-tested against an explicit price list.
export function planForPriceId(priceId: string | null | undefined, prices: PriceEntry[]): { plan: BillingPlan; interval: BillingInterval } | null {
  if (!priceId) return null;
  const hit = prices.find((p) => p.id === priceId);
  return hit ? { plan: hit.plan, interval: hit.interval } : null;
}

export function priceIdFor(plan: BillingPlan, interval: BillingInterval, prices: PriceEntry[]): string | null {
  return prices.find((p) => p.plan === plan && p.interval === interval)?.id ?? null;
}

// ── Runtime (env-backed) convenience wrappers ─────────────────────────────────
// Which plan (pro/office) + interval a live Stripe price ID represents. Matches
// BOTH monthly and annual for each plan — fixing the old bug where only the
// monthly Office price was recognised and annual Office was treated as Pro.
export function planFromPriceId(priceId: string | null | undefined): { plan: BillingPlan; interval: BillingInterval } | null {
  return planForPriceId(priceId, buildPrices());
}

export function priceIdForPlan(plan: BillingPlan, interval: BillingInterval): string | null {
  return priceIdFor(plan, interval, buildPrices());
}

// ── Upgrade vs downgrade ─────────────────────────────────────────────────────
// Drives WHEN money moves: an upgrade is invoiced immediately (the customer gets
// the bigger plan now, so they pay for it now — otherwise they'd have Office
// free until their next billing date). A downgrade or a lateral move is left to
// ride on the next invoice as a credit, so we never owe a cash refund.
//
// Office outranks Pro. Within the same plan, annual outranks monthly (a bigger
// upfront commitment). An unknown current plan is treated as an upgrade —
// charging now is the safe direction: it can't hand out free access, and the
// amount is always Stripe's own proration, never something we invented.
const PLAN_RANK: Record<BillingPlan, number> = { pro: 1, office: 2 };
const INTERVAL_RANK: Record<BillingInterval, number> = { monthly: 1, annual: 2 };

export function isUpgrade(
  current: { plan: BillingPlan; interval: BillingInterval } | null | undefined,
  target: { plan: BillingPlan; interval: BillingInterval },
): boolean {
  if (!current) return true;
  if (PLAN_RANK[target.plan] !== PLAN_RANK[current.plan]) {
    return PLAN_RANK[target.plan] > PLAN_RANK[current.plan];
  }
  return INTERVAL_RANK[target.interval] > INTERVAL_RANK[current.interval];
}
