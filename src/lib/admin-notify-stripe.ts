import type Stripe from "stripe";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { getAccountEmail } from "@/lib/account-email";
import { planFromPriceId } from "@/lib/subscription";
import { EVER_PAID_KEY, TRIAL_ENDS_KEY } from "@/lib/billing-state";
import { accountKind } from "@/lib/admin-data/accounts";
import { cancelKey, dollars, notifyAdmin, type AdminNotification } from "@/lib/admin-notify";

// ── Money, for the admin's notification center ──────────────────────────────
// The Stripe webhook calls notifyAdminOfStripeEvent once per event, BEFORE it
// processes it — so "first payment" can still see that the account had never
// paid (the webhook sets that flag a moment later). One notification per
// Stripe event id; a redelivery is a no-op. Test-mode events and our own or
// QA's accounts are never news. Refunds and disputes need those two events
// switched on for the endpoint in Stripe (charge.refunded,
// charge.dispute.created); until then they simply never arrive.

export type PayerProfile = { id: string; plan: string | null; customization: Record<string, unknown> | null; email: string | null };

const planName = (priceId: string | null | undefined, fallback: string | null) => {
  const p = planFromPriceId(priceId);
  if (p) return `${p.plan === "office" ? "Office" : "Pro"} · ${p.interval}`;
  return fallback === "enterprise" ? "Office" : fallback === "pro" ? "Pro" : "their plan";
};

const longDate = (unix: number | null | undefined) =>
  unix ? new Date(unix * 1000).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "long", day: "numeric", year: "numeric" }) : null;

/** The pure decision: which notification, if any, this event is. */
export function stripeNotification(event: Stripe.Event, who: PayerProfile | null): AdminNotification | null {
  if (event.livemode === false) return null;
  if (who?.email && accountKind(who.email) !== "customer") return null;
  const name = who?.email ?? "A customer";
  const href = who ? `/admin/users/${who.id}` : "/admin/analytics?tab=revenue";
  const base = { kind: "money" as const, href, dedupeKey: `stripe:${event.id}`, meta: { event: event.type, stripeId: (event.data.object as { id?: string }).id ?? null } };
  const cust = who?.customization ?? {};

  switch (event.type) {
    case "invoice.payment_succeeded": {
      const inv = event.data.object as Stripe.Invoice;
      if ((inv.amount_paid ?? 0) <= 0 || cust[EVER_PAID_KEY] === true) return null;
      const price = inv.lines?.data?.[0]?.pricing?.price_details?.price;
      const plan = planName(typeof price === "string" ? price : price?.id, who?.plan ?? null);
      const fromTrial = typeof cust[TRIAL_ENDS_KEY] === "string";
      return { ...base, title: fromTrial ? "A free trial turned into a payment" : "New paying customer", body: `${name} paid ${dollars(inv.amount_paid)} for ${plan}.` };
    }
    case "invoice.payment_failed": {
      const inv = event.data.object as Stripe.Invoice;
      if ((inv.amount_due ?? 0) <= 0) return null;
      return { ...base, severity: "urgent", title: "A payment failed", body: `${name}: ${dollars(inv.amount_due)} didn't go through. Stripe is retrying, and they've been emailed.` };
    }
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const prev = (event.data.previous_attributes ?? {}) as Partial<Stripe.Subscription>;
      const nowCancelling = sub.cancel_at_period_end === true || !!sub.cancel_at;
      const wasCancelling = prev.cancel_at_period_end === undefined && prev.cancel_at === undefined
        ? nowCancelling // the change was something else
        : prev.cancel_at_period_end === true || !!prev.cancel_at;
      if (!nowCancelling || wasCancelling) return null;
      const ends = longDate(sub.cancel_at ?? sub.items?.data?.[0]?.current_period_end);
      const plan = planName(sub.items?.data?.[0]?.price?.id, who?.plan ?? null);
      const why = sub.cancellation_details?.comment;
      // Usually the cancel flow got here first with the reason in words; this
      // one covers a cancellation made in Stripe itself.
      return { ...base, kind: "leaving", dedupeKey: cancelKey(sub.id, new Date(event.created * 1000)), title: "A customer is cancelling", body: `${name}'s ${plan} ends${ends ? ` ${ends}` : " at the end of the period"}.${why ? ` They said: "${why}"` : ""}` };
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const plan = planName(sub.items?.data?.[0]?.price?.id, who?.plan ?? null);
      const neverPaid = cust[EVER_PAID_KEY] !== true;
      return neverPaid && sub.trial_end
        ? { ...base, title: "A free trial ended without paying", body: `${name}'s ${plan} trial is over.` }
        : { ...base, title: "A subscription ended", body: `${name} is no longer paying for ${plan}.` };
    }
    case "charge.refunded": {
      const ch = event.data.object as Stripe.Charge;
      return { ...base, title: "A refund went out", body: `${dollars(ch.amount_refunded)} back to ${name}.` };
    }
    case "charge.dispute.created": {
      const d = event.data.object as Stripe.Dispute;
      const by = longDate(d.evidence_details?.due_by);
      return {
        ...base, severity: "urgent", href: "/admin/analytics?tab=revenue",
        title: "A payment was disputed",
        body: `${dollars(d.amount)} — reason: ${String(d.reason).replace(/_/g, " ")}. Answer it in Stripe${by ? ` by ${by}` : ""}, or it's lost.`,
        meta: { ...base.meta, stripeUrl: `https://dashboard.stripe.com/disputes/${d.id}` },
      };
    }
    default:
      return null;
  }
}

function customerOf(event: Stripe.Event): string | null {
  const o = event.data.object as { customer?: string | { id: string } | null };
  const c = o.customer;
  return typeof c === "string" ? c : c?.id ?? null;
}

/** Look up who it is, decide, write. Never throws: a notification must never cost a payment. */
const NOTIFY_TYPES = new Set(["invoice.payment_succeeded", "invoice.payment_failed", "customer.subscription.updated", "customer.subscription.deleted", "charge.refunded", "charge.dispute.created"]);

export async function notifyAdminOfStripeEvent(event: Stripe.Event): Promise<void> {
  try {
    if (event.livemode === false || !NOTIFY_TYPES.has(event.type)) return;
    const customer = customerOf(event);
    let who: PayerProfile | null = null;
    if (customer) {
      const { data } = await getAdminSupabase().from("profiles").select("id, plan, customization").eq("stripe_customer_id", customer).maybeSingle();
      if (data) {
        const invoiceEmail = (event.data.object as { customer_email?: string | null }).customer_email ?? null;
        who = { id: data.id as string, plan: (data.plan as string | null) ?? null, customization: (data.customization as Record<string, unknown> | null) ?? null, email: await getAccountEmail(data.id as string, invoiceEmail) };
      }
    }
    const n = stripeNotification(event, who);
    if (n) await notifyAdmin(n);
  } catch (e) {
    console.error("[admin-notify] stripe", event.type, e instanceof Error ? e.message : e);
  }
}
