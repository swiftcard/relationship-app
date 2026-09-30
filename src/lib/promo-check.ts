import type Stripe from "stripe";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { getStripe } from "@/lib/stripe";
import { isPaidPlan } from "@/lib/plan";
import {
  PICK_PLAN_BELOW, durationLabel, isFreeDays, isGrantCode, promoFitsPurchase, promoLabel, promoScopeMessage, type PromoRow,
} from "@/lib/promo";

// ── Does this code apply to THIS purchase, for THIS account? ────────────────
//
// One answer for the two places that need it: the "Have a promo code?" box on
// the order page (/api/promo/check — asks, spends nothing) and the checkout
// route (/api/stripe/checkout — asks, then spends it). They used to judge a code
// separately, and checkout's judgement was silent: a code that didn't apply was
// dropped and the person paid full price, having been shown a discount.
//
// Every code is entered in SwiftCard's own box. Stripe's page can't take them
// all — a "free time" code is a trial, which Stripe coupons cannot express, so
// it never existed in Stripe (owner report 2026-09-23: MENASH100 "doesn't work
// in Stripe"). Codes made directly in the Stripe dashboard are still honoured:
// looked up by their string and applied as a Stripe promotion code.

export type PromoPurchase = { plan: "pro" | "office"; interval: "monthly" | "annual" };

type DbPromo = PromoRow & { id: string } & Record<string, unknown>;

export type PromoCheck =
  | {
      ok: true;
      source: "swiftcard";
      promo: DbPromo;
      /** This account's existing, unspent claim on the code, if any. */
      redemption: { id: string; consumed_at: string | null } | null;
      freeDays: number | null;
      couponId: string | null;
      label: string;
      detail: string;
    }
  | { ok: true; source: "stripe"; promotionCodeId: string; label: string; detail: string }
  | { ok: false; reason: string; grant?: boolean };

const NOT_FOUND = "That code isn't valid. Check the spelling — it may also have ended.";

export function normalizePromoCode(code: unknown): string {
  return typeof code === "string" ? code.toUpperCase().trim() : "";
}

export async function checkPromoForPurchase(input: {
  code: string;
  userId: string | null;
  /** profiles.plan of the buyer; null for a visitor with no account. */
  accountPlan: string | null;
  /** null while the plan is still being chosen (the /welcome chooser's box):
   *  the code is checked for everything but its fit, which the checkout
   *  route settles — under this same function — once a plan is picked. */
  purchase: PromoPurchase | null;
}): Promise<PromoCheck> {
  const code = normalizePromoCode(input.code);
  if (!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(code)) return { ok: false, reason: NOT_FOUND };

  const admin = getAdminSupabase();
  const { data: row } = await admin.from("promo_codes").select("*").eq("code", code).eq("active", true).maybeSingle();
  if (!row) return checkStripeOnlyCode(code);
  const promo = row as DbPromo;

  if (isGrantCode(promo)) {
    const plan = promo.applies_to === "office" ? "Office" : "Pro";
    return { ok: false, grant: true, reason: `This code switches ${plan} on for free — no payment needed.` };
  }
  if (promo.expires_at && new Date(promo.expires_at as string) <= new Date()) {
    return { ok: false, reason: "This promo code has expired." };
  }
  if (input.purchase && !promoFitsPurchase(promo, input.purchase)) return { ok: false, reason: promoScopeMessage(promo) };

  let redemption: { id: string; consumed_at: string | null } | null = null;
  if (input.userId) {
    const { data: r } = await admin
      .from("promo_code_redemptions")
      .select("id, consumed_at")
      .eq("code_id", promo.id)
      .eq("user_id", input.userId)
      .maybeSingle();
    if (r?.consumed_at) return { ok: false, reason: "You've already used this code." };
    // Claimed earlier (typed on /pricing, then Stripe was closed) but never
    // spent: it is still theirs, and the cap and audience were checked then.
    redemption = r ? { id: r.id as string, consumed_at: null } : null;
  }
  if (!redemption) {
    const max = promo.max_uses as number | null;
    if (max != null && ((promo.uses_count as number | null) ?? 0) >= max) {
      return { ok: false, reason: "This code has reached its usage limit." };
    }
    const target = (promo.plan_target as string | null) ?? "all";
    const paid = isPaidPlan(input.accountPlan);
    if (target === "free" && paid) return { ok: false, reason: "This code is for accounts that aren't subscribed yet." };
    if (target === "pro" && !paid) return { ok: false, reason: "This code is for accounts that already subscribe." };
  }

  const freeTime = promo.discount_type === "free_time";
  const freeDays = freeTime && isFreeDays(Number(promo.free_days)) ? Number(promo.free_days) : null;
  const couponId = !freeTime && typeof promo.stripe_coupon_id === "string" && promo.stripe_coupon_id ? promo.stripe_coupon_id : null;
  // A money-off code whose Stripe coupon was never made can't take anything
  // off. Say so, instead of quietly charging full price.
  if (freeTime ? !freeDays : !couponId) {
    return { ok: false, reason: "This code isn't set up for payments yet. Please contact support." };
  }
  // With no plan picked yet, a scoped code says which plan it is for, so the
  // person picks that one instead of finding out at payment.
  const scoped = (promo.applies_to ?? "any") !== "any" || (promo.interval_target ?? "any") !== "any";
  return {
    ok: true, source: "swiftcard", promo, redemption, freeDays, couponId,
    label: promoLabel(promo),
    detail: !input.purchase && scoped
      ? `${promoScopeMessage(promo)} ${PICK_PLAN_BELOW}`
      : freeTime ? "Free days are added before your first payment." : durationLabel(promo),
  };
}

// A code made directly in the Stripe dashboard (not in Admin → Marketing).
async function checkStripeOnlyCode(code: string): Promise<PromoCheck> {
  let pc: Stripe.PromotionCode | undefined;
  try {
    const list = await getStripe().promotionCodes.list({ code, active: true, limit: 1, expand: ["data.promotion.coupon"] });
    pc = list.data[0];
  } catch {
    return { ok: false, reason: NOT_FOUND };
  }
  if (!pc) return { ok: false, reason: NOT_FOUND };
  if (pc.expires_at && pc.expires_at * 1000 <= Date.now()) return { ok: false, reason: "This promo code has expired." };
  if (pc.max_redemptions != null && pc.times_redeemed >= pc.max_redemptions) {
    return { ok: false, reason: "This code has reached its usage limit." };
  }
  const coupon = typeof pc.promotion?.coupon === "object" ? pc.promotion.coupon : null;
  if (!coupon || !coupon.valid) return { ok: false, reason: "This promo code has expired." };
  const label = coupon.percent_off
    ? `${coupon.percent_off}% off`
    : coupon.amount_off
      ? `$${(coupon.amount_off / 100).toFixed(coupon.amount_off % 100 ? 2 : 0)} off`
      : "Discount";
  const detail = coupon.duration === "forever"
    ? "every payment"
    : coupon.duration === "repeating" && coupon.duration_in_months
      ? `the first ${coupon.duration_in_months} month${coupon.duration_in_months === 1 ? "" : "s"}`
      : "the first payment";
  return { ok: true, source: "stripe", promotionCodeId: pc.id, label, detail };
}
