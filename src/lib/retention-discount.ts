import { planFromPriceId, type BillingInterval, type BillingPlan } from "@/lib/subscription";
import { ledgerAdd, ledgerHas } from "@/lib/trial-ledger";

// ── When the 50%-off retention coupon can actually be honoured ───────────────
//
// One coupon (api/stripe/subscription/discount) serves two doors: the Billing
// cancel flow and the delete-account flow. Both ask THIS module, so the offer
// is shown exactly where applying it will work and do what it says:
//
//   • active only — a trial has no invoice to halve yet, and a past-due or
//     cancelled subscription is not one we can save with a discount.
//   • monthly only — the coupon is "repeating, 3 months". On a yearly price it
//     starts its 3-month clock now and lapses long before the renewal, so the
//     customer would be promised half off and receive nothing.
//   • never on top of another discount — Stripe REPLACES the discounts array,
//     so applying it silently deletes a code they already have (which may be
//     better, or permanent).
//   • once per PERSON — the email and the card go in the purge-proof ledger,
//     so delete → wait out the purge → sign up again gets nothing new.

export type DiscountRefusal = "not_active" | "annual" | "already_discounted" | "unknown_price";

type SubLike = {
  status?: string | null;
  discounts?: unknown[] | null;
  items?: { data?: { price?: { id?: string | null } | null }[] } | null;
};

type PriceMap = (priceId: string | null | undefined) => { plan: BillingPlan; interval: BillingInterval } | null;

/** Why the coupon can't go on this subscription, or null when it can. Pure. */
export function discountRefusalFor(sub: SubLike, mapPrice: PriceMap = planFromPriceId): DiscountRefusal | null {
  if (sub.status !== "active") return "not_active";
  if ((sub.discounts?.length ?? 0) > 0) return "already_discounted";
  const mapped = mapPrice(sub.items?.data?.[0]?.price?.id ?? null);
  if (!mapped) return "unknown_price";
  if (mapped.interval !== "monthly") return "annual";
  return null;
}

export function discountRefusalMessage(r: DiscountRefusal): string {
  switch (r) {
    case "not_active":
      return "This offer is for an active subscription.";
    case "annual":
      return "This offer is for monthly plans.";
    case "already_discounted":
      return "Your subscription already has a discount.";
    default:
      return "This offer isn't available on your subscription.";
  }
}

/** Has this person (email or card) taken the 50% offer on any account, ever? */
export async function retentionDiscountTakenBy(email: string | null | undefined, cardFingerprint: string | null | undefined): Promise<boolean> {
  const [byEmail, byCard] = await Promise.all([
    ledgerHas("email_retention_discount", email),
    ledgerHas("card_retention_discount", cardFingerprint),
  ]);
  return byEmail || byCard;
}

/** Remember that this person took it. Idempotent; never throws. */
export async function recordRetentionDiscount(email: string | null | undefined, cardFingerprint: string | null | undefined): Promise<void> {
  await Promise.all([
    ledgerAdd("email_retention_discount", email),
    ledgerAdd("card_retention_discount", cardFingerprint),
  ]);
}
