import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";

/**
 * The card a new subscription was set up with, as Stripe's fingerprint — the
 * same physical card gives the same value on any account. Read only from
 * sub.default_payment_method, it came back null for every trial in production
 * (0 `card` rows in trial_ledger, audit B-13): Checkout can leave the card on
 * the customer's invoice settings, on the subscription's setup intent, or just
 * attached to the customer. Null left the one-trial-per-card rule, the
 * referral same-card check and the per-card retention rule all switched off.
 * Each place is asked in turn; a failed lookup moves on, never fails the event.
 */
export async function cardFingerprintFor(sub: Stripe.Subscription): Promise<string | null> {
  const fp = (pm: string | Stripe.PaymentMethod | null | undefined) =>
    pm && typeof pm !== "string" ? pm.card?.fingerprint ?? null : null;
  const direct = fp(sub.default_payment_method);
  if (direct) return direct;
  const stripe = getStripe();
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (customerId) {
    try {
      const c = await stripe.customers.retrieve(customerId, { expand: ["invoice_settings.default_payment_method"] });
      const viaCustomer = "deleted" in c && c.deleted ? null : fp(c.invoice_settings?.default_payment_method);
      if (viaCustomer) return viaCustomer;
    } catch { /* next place */ }
  }
  const setup = sub.pending_setup_intent;
  if (setup) {
    try {
      const si = await stripe.setupIntents.retrieve(typeof setup === "string" ? setup : setup.id, { expand: ["payment_method"] });
      const viaSetup = fp(si.payment_method);
      if (viaSetup) return viaSetup;
    } catch { /* next place */ }
  }
  if (customerId) {
    try {
      const cards = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 });
      return cards.data[0]?.card?.fingerprint ?? null;
    } catch { /* nothing more to ask */ }
  }
  return null;
}
