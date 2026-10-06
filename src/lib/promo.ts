import { PLAN_LIMITS } from "./plan";

// ── Promo codes: one vocabulary, shared by every surface ────────────────────
// The admin form, the admin API, /api/promo/redeem and /api/stripe/checkout all
// read this file — so an offer can never be built in the UI that the server
// won't honour, or honoured in a way the UI never described.
//
// A code answers five questions:
//   1. WHAT does it give?      percent off · amount off · free time
//   2. HOW LONG does it last?  first payment · N months · forever   (money off)
//   3. WHICH PLAN is it for?   Pro · Office · either
//   4. WHICH BILLING PERIOD?   monthly · annual · either
//   5. WHO may redeem it?      anyone · new accounts · existing paid accounts
// plus the limits that already existed: total redemptions and an expiry date,
// and — on an Office-only code — how many SEATS it is for (see promoSeats).
//
// Why free time is DAYS, not months: Stripe coupons can only express whole
// months (duration_in_months), so "one week free" is impossible as a coupon.
// Free time is therefore a TRIAL (subscription_data.trial_period_days), which
// takes an exact day count.
//
// The trade-off: a trial can't be typed on Stripe's own checkout page (Stripe
// promotion codes resolve to coupons, not trials), so a free-time code must be
// entered in the SwiftCard promo box on /pricing, which round-trips through
// /api/promo/redeem. Money-off codes work in both places.

/** Added to a scoped code's detail when it is checked before a plan is picked
 *  (lib/promo-check). The app's box (PromoCodeBox `website`) drops it: there
 *  the plan is picked on swiftcard.me, not below. */
export const PICK_PLAN_BELOW = "Choose that plan below.";

export const FREE_PERIODS = [
  { days: 7, label: "One week" },
  { days: 14, label: "Two weeks" },
  { days: 30, label: "One month" },
  { days: 60, label: "Two months" },
  { days: 90, label: "Three months" },
] as const;

/** The widest free period a code may hand out. Beyond this it is not a promo. */
export const MAX_FREE_DAYS = 365;

export type FreeDays = number;

/** Any whole number of days from 1 to MAX_FREE_DAYS (the presets are shortcuts). */
export function isFreeDays(v: unknown): v is FreeDays {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_FREE_DAYS;
}

/** "One month" for 30, else a plain day count. */
export function freeDaysLabel(days: number | null | undefined): string {
  if (days == null) return "";
  return FREE_PERIODS.find((p) => p.days === days)?.label ?? `${days} days`;
}

// "grant" is the odd one out and deliberately so: it is the TESTER code. The
// other three are offers a customer redeems on the way to paying — they end up
// as a Stripe coupon or a trial on a real subscription, and every one of them
// still collects a card. A grant never touches Stripe: redeeming it switches
// the account to the plan for `free_days` days, with no card and no
// subscription, and the daily cron drops it back to Free when the time is up
// (lib/referral-server expireFreeMonths, the same path a referral month uses).
// It exists so the owner can open any plan on a throwaway account and look at
// the product, without a test subscription appearing in live Stripe.
//
// `applies_to` says WHICH plan it opens ("pro" or "office"); "any" grants Pro.
export type DiscountType = "percent" | "fixed" | "free_time" | "grant";

export function isDiscountType(v: unknown): v is DiscountType {
  return v === "percent" || v === "fixed" || v === "free_time" || v === "grant";
}

/** A code that opens a plan outright rather than discounting a purchase. */
export function isGrantCode(promo: { discount_type?: string | null }): boolean {
  return promo.discount_type === "grant";
}

// ── 3. Which plan the code is FOR ───────────────────────────────────────────
// This is the question the admin form never asked (owner, 2026-09-17: "what am
// I creating it for, the pro plan or the office plan?"). It is enforced in
// three places: the Stripe coupon is restricted to that plan's products, the
// redeem route refuses the code with a plain reason, and checkout drops it if
// the plan being bought doesn't match.
export const APPLIES_TO = [
  { id: "any", label: "Pro or Office" },
  { id: "pro", label: "Pro only" },
  { id: "office", label: "Office only" },
] as const;
export type AppliesTo = (typeof APPLIES_TO)[number]["id"];
export function isAppliesTo(v: unknown): v is AppliesTo {
  return v === "any" || v === "pro" || v === "office";
}

// ── 4. Which billing period ─────────────────────────────────────────────────
export const INTERVAL_TARGETS = [
  { id: "any", label: "Monthly or annual" },
  { id: "monthly", label: "Monthly only" },
  { id: "annual", label: "Annual only" },
] as const;
export type IntervalTarget = (typeof INTERVAL_TARGETS)[number]["id"];
export function isIntervalTarget(v: unknown): v is IntervalTarget {
  return v === "any" || v === "monthly" || v === "annual";
}

// ── 2. How long money off lasts (Stripe coupon duration) ────────────────────
export const DURATIONS = [
  { id: "once", label: "First payment only" },
  { id: "repeating", label: "For several months" },
  { id: "forever", label: "For as long as they stay subscribed" },
] as const;
export type PromoDuration = (typeof DURATIONS)[number]["id"];
export function isPromoDuration(v: unknown): v is PromoDuration {
  return v === "once" || v === "repeating" || v === "forever";
}
export const MAX_DURATION_MONTHS = 36;

// ── 5. Who may redeem ───────────────────────────────────────────────────────
// Stored in the legacy `plan_target` column, whose values have always been
// about the REDEEMER's current plan ("free" = accounts not paying yet).
export const AUDIENCES = [
  { id: "free", label: "New accounts only (not paying yet)" },
  { id: "pro", label: "Accounts already paying" },
  { id: "all", label: "Anyone" },
] as const;
export type Audience = (typeof AUDIENCES)[number]["id"];
export function isAudience(v: unknown): v is Audience {
  return v === "free" || v === "pro" || v === "all";
}

// ── 6. How many seats (Office only) ─────────────────────────────────────────
// The usual Office deal is a whole team at once — "a month free for the admin
// and their 14 teammates" (owner, 2026-10-06). Only the admin types the code,
// so the code carries the team's size: an Office order it is used on is FIXED
// at that many seats (the order pages lock their seat picker to it, and
// /api/stripe/checkout refuses any other count), and a free-Office grant opens
// an office of that size. NULL = the code says nothing about seats; the admin
// chooses as before. After subscribing they can still add seats in Settings.
export const MAX_PROMO_SEATS = 1000;

export function isPromoSeats(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= PLAN_LIMITS.OFFICE_MIN_SEATS && v <= MAX_PROMO_SEATS;
}

/** The seat count this code fixes, or null. Only an Office-only code fixes one. */
export function promoSeats(promo: { applies_to?: string | null; seats?: number | null }): number | null {
  if (promo.applies_to !== "office" || promo.seats == null) return null;
  const n = Number(promo.seats);
  return isPromoSeats(n) ? n : null;
}

/** "15 seats — you + 14 teammates". The person buying holds seat 1. */
export function seatsLabel(seats: number): string {
  const others = seats - 1;
  return `${seats} seats — you + ${others} teammate${others === 1 ? "" : "s"}`;
}

/** Why an Office order with a different seat count can't use the code. */
export function promoSeatsMessage(seats: number): string {
  return `This code is for exactly ${seatsLabel(seats)}.`;
}

export type PromoRow = {
  code?: string | null;
  discount_type?: string | null;
  discount_percent?: number | null;
  discount_amount?: number | null;
  free_days?: number | null;
  duration?: string | null;
  duration_months?: number | null;
  applies_to?: string | null;
  interval_target?: string | null;
  plan_target?: string | null;
  max_uses?: number | null;
  expires_at?: string | null;
  seats?: number | null;
};

/** What the customer is told they're getting ("30% off", "One month free"). */
export function promoLabel(promo: PromoRow): string {
  if (promo.discount_type === "grant") {
    const plan = promo.applies_to === "office" ? "Office" : "Pro";
    return `${plan} free for ${freeDaysLabel(promo.free_days ?? 14).toLowerCase()}`;
  }
  if (promo.discount_type === "free_time" && promo.free_days) {
    return `${freeDaysLabel(promo.free_days)} free`;
  }
  if (promo.discount_percent) return `${promo.discount_percent}% off`;
  if (promo.discount_amount) return `$${(promo.discount_amount / 100).toFixed(2)} off`;
  return "Discount applied";
}

/** How long money off runs, in words. Empty for free-time codes. */
export function durationLabel(promo: PromoRow): string {
  if (promo.discount_type === "free_time" || promo.discount_type === "grant") return "";
  const d = promo.duration ?? "once";
  if (d === "forever") return "every payment";
  if (d === "repeating") {
    const m = promo.duration_months ?? 1;
    return `the first ${m} month${m === 1 ? "" : "s"}`;
  }
  return "the first payment";
}

/** The plan + billing period a code is for, in words ("Pro, annual only"). */
export function scopeLabel(promo: PromoRow): string {
  const plan = APPLIES_TO.find((p) => p.id === (promo.applies_to ?? "any"))?.label ?? "Pro or Office";
  const interval = promo.interval_target ?? "any";
  if (interval === "any") return plan;
  return `${plan}, ${interval === "annual" ? "annual" : "monthly"} only`;
}

/** One sentence describing the whole offer — the admin list and the preview. */
export function describePromo(promo: PromoRow): string {
  const parts = [promoLabel(promo), `on ${scopeLabel(promo).toLowerCase()}`];
  const dur = durationLabel(promo);
  if (dur) parts.push(`· ${dur}`);
  const seats = promoSeats(promo);
  if (seats) parts.push(`· ${seats} seats`);
  const who = AUDIENCES.find((a) => a.id === (promo.plan_target ?? "free"))?.label;
  if (who && promo.plan_target !== "all") parts.push(`· ${who.toLowerCase()}`);
  if (promo.max_uses) parts.push(`· ${promo.max_uses} redemptions`);
  return parts.join(" ");
}

/**
 * Does this code apply to the plan + billing period being bought?
 *
 * The ONE rule, used by checkout (drop the discount) and by redeem (refuse with
 * a reason), so a code can never look redeemable and then quietly not apply.
 */
export function promoFitsPurchase(
  promo: PromoRow,
  purchase: { plan: "pro" | "office"; interval: "monthly" | "annual" },
): boolean {
  const applies = promo.applies_to ?? "any";
  if (applies !== "any" && applies !== purchase.plan) return false;
  const interval = promo.interval_target ?? "any";
  if (interval !== "any" && interval !== purchase.interval) return false;
  return true;
}

/** Why a code doesn't fit, for the message shown to the person redeeming it. */
export function promoScopeMessage(promo: PromoRow): string {
  const applies = promo.applies_to ?? "any";
  const interval = promo.interval_target ?? "any";
  const plan = applies === "pro" ? "the Pro plan" : applies === "office" ? "the Office plan" : "Pro or Office";
  if (interval === "any") return `This code is for ${plan}.`;
  return `This code is for ${plan}, billed ${interval === "annual" ? "annually" : "monthly"}.`;
}
