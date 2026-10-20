import Stripe from "stripe";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { isPaidPlan } from "@/lib/plan";
import { env } from "../env";

// Read-only Stripe access for the payments pair, with a RESTRICTED read-only
// key (CREW_STRIPE_READ_KEY), never the app's secret key: an agent bug can
// look, it cannot charge, refund or cancel.

export function stripeReader(): Stripe | null {
  const key = env("CREW_STRIPE_READ_KEY");
  return key ? new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000 }) : null;
}

export type PaymentIssue = { key: string; kind: "failed_payment" | "past_due" | "trial_no_card" | "plan_drift_paid_but_free" | "plan_drift_free_but_paid"; title: string; detail: Record<string, unknown> };

const usd = (cents: number | null | undefined) => `$${((cents ?? 0) / 100).toFixed(2)}`;
const dash = (path: string) => `https://dashboard.stripe.com/${path}`;

export async function failedPayments(stripe: Stripe, now: Date): Promise<PaymentIssue[]> {
  const out: PaymentIssue[] = [];
  const since = Math.floor(now.getTime() / 1000) - 7 * 86400;
  for await (const inv of stripe.invoices.list({ status: "open", created: { gte: since }, limit: 100 })) {
    if ((inv.attempt_count ?? 0) < 1) continue;
    out.push({ key: `inv:${inv.id}`, kind: "failed_payment", title: `A ${usd(inv.amount_due)} payment failed (try ${inv.attempt_count})`, detail: { invoice: inv.id, link: dash(`invoices/${inv.id}`), next_try: inv.next_payment_attempt ?? null } });
    if (out.length >= 50) break;
  }
  for await (const sub of stripe.subscriptions.list({ status: "past_due", limit: 100 })) {
    out.push({ key: `pastdue:${sub.id}`, kind: "past_due", title: "A subscription is past due", detail: { subscription: sub.id, link: dash(`subscriptions/${sub.id}`) } });
    if (out.length >= 80) break;
  }
  return out;
}

export async function revenueChecks(stripe: Stripe, now: Date): Promise<{ issues: PaymentIssue[]; counts: Record<string, number> }> {
  const issues: PaymentIssue[] = [];
  const counts: Record<string, number> = { trialing: 0, active: 0, trials_ending_48h: 0 };
  const soon = Math.floor(now.getTime() / 1000) + 48 * 3600;
  const activeSubs = new Set<string>();
  for await (const sub of stripe.subscriptions.list({ status: "trialing", limit: 100, expand: ["data.customer"] })) {
    counts.trialing++;
    if (sub.trial_end && sub.trial_end <= soon) {
      counts.trials_ending_48h++;
      const cust = typeof sub.customer === "object" && !("deleted" in sub.customer && sub.customer.deleted) ? (sub.customer as Stripe.Customer) : null;
      const hasCard = !!sub.default_payment_method || !!cust?.invoice_settings?.default_payment_method || !!cust?.default_source;
      if (!hasCard) issues.push({ key: `trialcard:${sub.id}`, kind: "trial_no_card", title: "A free trial ends within 2 days and there is no card on file", detail: { subscription: sub.id, trial_end: new Date(sub.trial_end * 1000).toISOString(), link: dash(`subscriptions/${sub.id}`) } });
    }
    if (counts.trialing > 2000) break;
  }
  for await (const sub of stripe.subscriptions.list({ status: "active", limit: 100 })) {
    counts.active++;
    activeSubs.add(sub.id);
    if (counts.active > 5000) break;
  }
  // Drift: the app's plan vs what Stripe says. Read-only on our side too.
  const { data } = await getAdminSupabase().from("profiles").select("id, plan, stripe_subscription_id").not("stripe_subscription_id", "is", null).limit(5000);
  for (const p of data ?? []) {
    const sid = String(p.stripe_subscription_id);
    const paidInApp = isPaidPlan(p.plan as string);
    if (activeSubs.has(sid) && !paidInApp) issues.push({ key: `drift1:${sid}`, kind: "plan_drift_paid_but_free", title: "Someone is paying in Stripe but the app shows them on Free", detail: { subscription: sid, link: dash(`subscriptions/${sid}`) } });
  }
  counts.referral_pro = await countReferralPro();
  return { issues, counts };
}

async function countReferralPro(): Promise<number> {
  const { count } = await getAdminSupabase().from("profiles").select("id", { count: "exact", head: true }).not("referred_by", "is", null).in("plan", ["pro", "enterprise"]);
  return count ?? 0;
}
