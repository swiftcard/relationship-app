import { IAP_PRODUCT_ANNUAL, IAP_PRODUCT_MONTHLY } from "@/lib/iap-shared";
import { TRIAL_DAYS } from "@/lib/plan";
import type { PromoRow } from "@/lib/promo";

// ── Which SwiftCard codes Apple can take, and what each one is on Apple ──────
//
// The client-safe half of lib/apple-offer-codes (no key, no network, no
// Supabase): the admin page uses it to say, before a code is created, where
// it will work — and the list uses it to label every code honestly as
// "on Stripe and Apple", "Apple pending" or "website only". Everything that
// talks to App Store Connect stays in lib/apple-offer-codes.

/** Apple's free-trial steps, by the day count SwiftCard stores. */
export const APPLE_DURATIONS: Record<number, string> = {
  14: "TWO_WEEKS",
  30: "ONE_MONTH",
  60: "TWO_MONTHS",
  90: "THREE_MONTHS",
  180: "SIX_MONTHS",
  365: "ONE_YEAR",
};

/**
 * Apple's bounds on a custom code's redemption count, found by probing the
 * live API on 2026-10-08: 250 and 150,000 were refused ("The given number of
 * codes N is invalid"), 500 through 25,000 accepted. A SwiftCard cap under
 * 500 is therefore enforced by US, not Apple: each Apple redemption is
 * recorded by the RevenueCat webhook and the Apple copy is turned off the
 * moment the cap is reached (lib/apple-offer-codes recordAppleRedemption).
 */
export const APPLE_CODES_MIN = 500;
export const APPLE_CODES_MAX = 25000;
/** An uncapped SwiftCard code gets this many Apple redemptions per batch. */
export const APPLE_CODES_DEFAULT = 10000;

export type AppleOfferPlan = {
  productId: string;
  duration: string;
  customerEligibilities: string[];
};

type PromoLike = PromoRow & { active?: boolean | null };

/**
 * Can this code exist on Apple, and as what? Null when it can't — the app
 * then hands the code to swiftcard.me.
 *
 * Under 14 days is left out on purpose: Apple REPLACES the 14-day trial with
 * the code's offer, and the website never lets a code shorten the trial
 * (checkout takes the longer of the two). The plain Pro button already gives
 * more than a one-week code would.
 */
export function appleOfferPlan(promo: PromoLike): AppleOfferPlan | null {
  if (promo.active === false) return null;
  if (promo.discount_type !== "free_time") return null;
  const applies = promo.applies_to ?? "any";
  if (applies !== "any" && applies !== "pro") return null;
  const days = Number(promo.free_days);
  if (!(days >= TRIAL_DAYS)) return null;
  const duration = APPLE_DURATIONS[days];
  if (!duration) return null;
  if (promo.expires_at && new Date(promo.expires_at) <= new Date()) return null;
  // Apple custom codes are letters and numbers only.
  if (!/^[A-Z0-9]{1,64}$/.test(String(promo.code ?? ""))) return null;
  const productId = promo.interval_target === "annual" ? IAP_PRODUCT_ANNUAL : IAP_PRODUCT_MONTHLY;
  // Who may redeem, in Apple's terms. "New accounts" are people not paying:
  // never subscribed (NEW) or no longer subscribed (EXPIRED).
  const target = promo.plan_target ?? "free";
  const customerEligibilities =
    target === "pro" ? ["EXISTING"] : target === "all" ? ["NEW", "EXISTING", "EXPIRED"] : ["NEW", "EXPIRED"];
  return { productId, duration, customerEligibilities };
}

/**
 * Why a code can't be on Apple, in the admin's words — or null when it can.
 * Mirrors appleOfferPlan's checks one for one, so the two never disagree.
 */
export function appleWebOnlyReason(promo: PromoLike): string | null {
  if (appleOfferPlan(promo)) return null;
  if (promo.discount_type === "grant") return "A free-plan code switches the plan on with no subscription — Apple has nothing to bill, so it's used on swiftcard.me.";
  if (promo.discount_type !== "free_time") return "Apple's offer codes can't take money off (each price would need its own Apple price point) — used on swiftcard.me.";
  if ((promo.applies_to ?? "any") === "office") return "Office isn't sold in the iPhone app — used on swiftcard.me.";
  const days = Number(promo.free_days);
  if (!(days >= TRIAL_DAYS)) return `Apple would REPLACE the ${TRIAL_DAYS}-day trial with this shorter one — used on swiftcard.me, where the longer of the two applies.`;
  if (!APPLE_DURATIONS[days]) return `Apple's free periods are fixed steps (${Object.keys(APPLE_DURATIONS).join("/")} days) — used on swiftcard.me.`;
  if (promo.expires_at && new Date(promo.expires_at) <= new Date()) return "Expired.";
  if (!/^[A-Z0-9]{1,64}$/.test(String(promo.code ?? ""))) return "Apple codes are letters and numbers only (no dashes) — used on swiftcard.me.";
  return "Not a code Apple can take.";
}

/** True once a capped code has no redemptions left (website + Apple combined). */
export function promoUsedUp(promo: { max_uses?: number | null; uses_count?: number | null }): boolean {
  return promo.max_uses != null && Number(promo.max_uses) - Number(promo.uses_count ?? 0) <= 0;
}

/** The redemption count Apple is given for a code: its remaining uses, inside Apple's bounds. */
export function appleCodeCount(promo: { max_uses?: number | null; uses_count?: number | null }): number {
  if (promo.max_uses == null) return APPLE_CODES_DEFAULT;
  const remaining = Number(promo.max_uses) - Number(promo.uses_count ?? 0);
  return Math.min(APPLE_CODES_MAX, Math.max(APPLE_CODES_MIN, remaining));
}

export type AppleCodeStatus =
  /** Made on Apple — the iPhone app redeems it through Apple's sheet. */
  | { state: "live"; detail: string }
  /** Apple should have it but doesn't yet; the daily cron retries. */
  | { state: "pending"; detail: string }
  /** Was on Apple, turned off (cap reached). */
  | { state: "off"; detail: string }
  /** Can't be on Apple by design; in the app the code opens swiftcard.me. */
  | { state: "web_only"; detail: string };

/** Where a saved code stands on Apple, for the admin list and the create form. */
export function appleCodeStatus(promo: PromoLike & { apple_offer_code_id?: string | null; apple_offer_error?: string | null; uses_count?: number | null; max_uses?: number | null }): AppleCodeStatus {
  const reason = appleWebOnlyReason(promo);
  if (reason) return { state: "web_only", detail: reason };
  const onApple = typeof promo.apple_offer_code_id === "string" && !!promo.apple_offer_code_id;
  if (onApple && promoUsedUp(promo)) {
    return { state: "off", detail: "All redemptions used — turned off on Apple too." };
  }
  if (onApple) {
    return { state: "live", detail: "Made as an Apple offer code with this same string: in the iPhone app it's redeemed on Apple's own sheet against the Apple-billed Pro." };
  }
  return {
    state: "pending",
    detail: promo.apple_offer_error
      ? `Not on Apple yet — ${promo.apple_offer_error} Retried every day; in the iPhone app the code opens swiftcard.me until then.`
      : "Not on Apple yet — retried every day; in the iPhone app the code opens swiftcard.me until then.",
  };
}
