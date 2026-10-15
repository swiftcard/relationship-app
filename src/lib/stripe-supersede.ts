import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";

// ── Two subscriptions for one account: which one stays, and the money ────────
//
// A completed checkout can find the account already holding another live
// subscription: two tabs both paid, a delivery retried hours later, or an old
// subscription left behind. The webhook used to cancel whichever one the
// database held, outright: no proration, no refund (audit B-15). A buyer who
// paid twice was charged twice, and a retried old event could cancel the plan
// the customer had just bought.
//
// The rules now:
//   • the NEWER subscription stays, whichever event is being processed;
//   • a duplicate (bought within a day of the one that stays) is cancelled and
//     every payment on it refunded in full: the customer meant to buy once;
//   • an older subscription being replaced is cancelled with its unused time
//     credited to the account, when its last invoice was actually paid. An
//     unpaid one is cancelled plainly, so a period nobody paid for never turns
//     into credit.

export const DUPLICATE_WINDOW_SECONDS = 24 * 60 * 60;
const LIVE = new Set(["active", "trialing", "past_due", "unpaid", "incomplete", "paused"]);

/** Which of two subscriptions survives: the newer one. Ties go to the incoming one. */
export function survivingSubscription(prior: { created: number }, incoming: { created: number }): "prior" | "incoming" {
  return incoming.created >= prior.created ? "incoming" : "prior";
}

/** Bought within a day of the one that stays: the same purchase made twice. */
export function isDuplicatePurchase(cancelled: { created: number }, survivor: { created: number }): boolean {
  return Math.abs(survivor.created - cancelled.created) < DUPLICATE_WINDOW_SECONDS;
}

export function isLiveSubscription(sub: { status: string }): boolean {
  return LIVE.has(sub.status);
}

/**
 * Cancel `sub` because `survivor` replaces it, settling the money by the rules
 * above. Returns what was refunded, in cents (0 when it was credited or
 * nothing had been paid). Throws when Stripe refuses, so the caller can report
 * the account as holding two live subscriptions.
 */
export async function cancelReplacedSubscription(
  sub: Stripe.Subscription,
  survivor: Stripe.Subscription,
): Promise<{ refundedCents: number; mode: "refunded" | "credited" | "cancelled" }> {
  const stripe = getStripe();
  if (!isLiveSubscription(sub)) return { refundedCents: 0, mode: "cancelled" };

  if (isDuplicatePurchase(sub, survivor)) {
    await stripe.subscriptions.cancel(sub.id, {}, { idempotencyKey: `supersede-cancel:${sub.id}` });
    let refundedCents = 0;
    for await (const inv of stripe.invoices.list({ subscription: sub.id, status: "paid", limit: 100 })) {
      const refundable = Math.max(0, (inv.amount_paid ?? 0) - (inv.post_payment_credit_notes_amount ?? 0));
      if (refundable <= 0 || !inv.id) continue;
      await stripe.creditNotes.create(
        {
          invoice: inv.id,
          amount: refundable,
          refund_amount: refundable,
          reason: "duplicate",
          memo: "Duplicate purchase: you were charged twice, so this one is refunded in full.",
        },
        { idempotencyKey: `supersede-refund:${inv.id}` },
      );
      refundedCents += refundable;
    }
    return { refundedCents, mode: "refunded" };
  }

  const latest = typeof sub.latest_invoice === "string"
    ? await stripe.invoices.retrieve(sub.latest_invoice)
    : sub.latest_invoice;
  const paid = latest?.status === "paid";
  await stripe.subscriptions.cancel(
    sub.id,
    paid ? { prorate: true, invoice_now: true } : {},
    { idempotencyKey: `supersede-cancel:${sub.id}` },
  );
  return { refundedCents: 0, mode: paid ? "credited" : "cancelled" };
}
