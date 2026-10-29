import type Stripe from "stripe";
import { getStripe, subscriptionPeriodEnd } from "@/lib/stripe";
import { configuredPrices, planFromPriceId } from "@/lib/subscription";
import { getAdminSupabase } from "@/lib/supabase-admin";
import type { Account } from "./accounts";
import { startOfNyDay, nyDayKey } from "./time";

// ── Money, read from Stripe itself ──────────────────────────────────────────
// The admin's revenue was `count(profiles with a subscription id) × $4.99`
// (or $3.99): a free trial counted as a paying customer at full price, an
// annual plan was priced monthly, an Office team of 8 was one seat, a 50%-off
// coupon was ignored. On 2026-10-28 that read "$14.97/mo from 3 paying" when
// all three were trials or unpaid. Every money number now comes from the
// subscriptions themselves: status, price, interval, quantity and discounts.

export type SubLite = {
  id: string;
  customerId: string;
  userId: string | null;
  status: Stripe.Subscription.Status;
  created: number;
  canceledAt: number | null;
  endedAt: number | null;
  cancelAtPeriodEnd: boolean;
  trialEnd: number | null;
  periodEnd: number | null;
  items: { priceId: string; unitAmount: number; quantity: number; interval: "day" | "week" | "month" | "year"; intervalCount: number }[];
  discounts: { percentOff: number | null; amountOff: number | null; duration: "forever" | "once" | "repeating"; end: number | null }[];
  livemode: boolean;
};

/** Turn a Stripe subscription into the fields the admin uses. */
export function toLite(s: Stripe.Subscription): SubLite {
  const discounts = (s.discounts ?? []).flatMap((d) => {
    if (typeof d === "string") return [];
    const c = d.source?.coupon;
    if (!c || typeof c === "string") return [];
    return [{ percentOff: c.percent_off ?? null, amountOff: c.amount_off ?? null, duration: c.duration, end: d.end ?? null }];
  });
  return {
    id: s.id,
    customerId: typeof s.customer === "string" ? s.customer : s.customer.id,
    userId: (s.metadata?.user_id as string | undefined) ?? null,
    status: s.status,
    created: s.created,
    canceledAt: s.canceled_at ?? null,
    endedAt: s.ended_at ?? null,
    cancelAtPeriodEnd: s.cancel_at_period_end,
    trialEnd: s.trial_end ?? null,
    periodEnd: subscriptionPeriodEnd(s) ?? null,
    items: (s.items?.data ?? []).map((it) => ({
      priceId: it.price.id,
      unitAmount: it.price.unit_amount ?? 0,
      quantity: it.quantity ?? 1,
      interval: it.price.recurring?.interval ?? "month",
      intervalCount: it.price.recurring?.interval_count ?? 1,
    })),
    discounts,
    livemode: s.livemode,
  };
}

const MONTHS_PER: Record<SubLite["items"][number]["interval"], number> = { day: 1 / 30, week: 7 / 30, month: 1, year: 12 };

/**
 * What this subscription brings in per month, in cents, after its recurring
 * discounts. A one-off ("once") coupon is not recurring revenue, so it's left
 * out; a "repeating" one counts until it ends.
 */
export function monthlyCents(sub: SubLite, nowSec = Math.floor(Date.now() / 1000)): number {
  let total = 0;
  for (const it of sub.items) {
    const months = MONTHS_PER[it.interval] * Math.max(1, it.intervalCount);
    total += (it.unitAmount * it.quantity) / months;
  }
  let monthly = total;
  for (const d of sub.discounts) {
    if (d.duration === "once") continue;
    if (d.duration === "repeating" && d.end && d.end <= nowSec) continue;
    if (d.percentOff) monthly *= 1 - d.percentOff / 100;
    if (d.amountOff) {
      // amount_off comes off each invoice; spread it over the billing period.
      const it = sub.items[0];
      const months = it ? MONTHS_PER[it.interval] * Math.max(1, it.intervalCount) : 1;
      monthly -= d.amountOff / months;
    }
  }
  return Math.max(0, Math.round(monthly));
}

export type RevenueSummary = {
  mrrCents: number;
  arrCents: number;
  /** Of mrrCents, owed by subscriptions whose last charge failed. */
  atRiskCents: number;
  paying: number;
  payingPro: number;
  payingOffice: number;
  officeSeats: number;
  trials: { active: number; endingIn7Days: number; convertsToCents: number; cancelling: number };
  cancelling: number;
  pastDue: number;
  newThisMonth: { count: number; cents: number };
  lostThisMonth: { count: number; cents: number };
  /** Subscriptions on accounts that aren't customers (ours, QA), left out of everything above. */
  excludedInternal: number;
};

/**
 * The revenue picture from a list of subscriptions. Only `customerIds`'
 * subscriptions count (internal and test accounts are left out); a
 * subscription whose account can't be matched is counted (money is money).
 */
export function summarize(subs: SubLite[], opts: { nonCustomerUserIds: Set<string>; nonCustomerCustomerIds?: Set<string>; everPaidUserIds?: Set<string>; now?: Date }): RevenueSummary {
  const now = opts.now ?? new Date();
  const nowSec = Math.floor(now.getTime() / 1000);
  // The 1st of this month, New York time.
  const monthStartSec = Math.floor(startOfNyDay(Number(nyDayKey(now).slice(8, 10)) - 1, now).getTime() / 1000);
  const out: RevenueSummary = {
    mrrCents: 0, arrCents: 0, atRiskCents: 0, paying: 0, payingPro: 0, payingOffice: 0, officeSeats: 0,
    trials: { active: 0, endingIn7Days: 0, convertsToCents: 0, cancelling: 0 },
    cancelling: 0, pastDue: 0,
    newThisMonth: { count: 0, cents: 0 }, lostThisMonth: { count: 0, cents: 0 },
    excludedInternal: 0,
  };
  const payingCustomers = new Set<string>();
  for (const s of subs) {
    // Ours by the account id the checkout tagged it with, or — for older
    // subscriptions that carry no tag — by the Stripe customer on our account.
    if ((s.userId && opts.nonCustomerUserIds.has(s.userId)) || opts.nonCustomerCustomerIds?.has(s.customerId)) { out.excludedInternal++; continue; }
    const cents = monthlyCents(s, nowSec);
    const plan = planFromPriceId(s.items[0]?.priceId)?.plan ?? "pro";
    if (s.status === "active" || s.status === "past_due") {
      if (cents > 0) {
        out.mrrCents += cents;
        if (!payingCustomers.has(s.customerId)) {
          payingCustomers.add(s.customerId);
          if (plan === "office") out.payingOffice++; else out.payingPro++;
        }
        if (plan === "office") out.officeSeats += s.items.reduce((n, it) => n + it.quantity, 0);
      }
      if (s.status === "past_due") { out.pastDue++; out.atRiskCents += cents; }
      if (s.cancelAtPeriodEnd) out.cancelling++;
      if (s.created >= monthStartSec && cents > 0) { out.newThisMonth.count++; out.newThisMonth.cents += cents; }
    } else if (s.status === "trialing") {
      out.trials.active++;
      out.trials.convertsToCents += s.cancelAtPeriodEnd ? 0 : cents;
      if (s.cancelAtPeriodEnd) out.trials.cancelling++;
      if (s.trialEnd && s.trialEnd - nowSec <= 7 * 86_400) out.trials.endingIn7Days++;
    } else if (s.status === "canceled") {
      const at = s.endedAt ?? s.canceledAt;
      // Only a subscription that had been paying counts as lost revenue: a
      // trial that ended (or whose first charge failed) never was revenue.
      const everPaid = s.userId ? opts.everPaidUserIds?.has(s.userId) ?? false : s.trialEnd === null;
      if (at && at >= monthStartSec && everPaid) { out.lostThisMonth.count++; out.lostThisMonth.cents += cents; }
    }
  }
  out.paying = payingCustomers.size;
  out.arrCents = out.mrrCents * 12;
  return out;
}

// ── Reading Stripe ──────────────────────────────────────────────────────────

let cache: { at: number; subs: SubLite[] } | null = null;
const CACHE_MS = 5 * 60_000;

/** Every subscription in Stripe (all statuses), cached for five minutes. */
export async function listSubscriptions(force = false): Promise<SubLite[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.subs;
  const stripe = getStripe();
  const subs: SubLite[] = [];
  let starting_after: string | undefined;
  // The coupon behind each discount, so a recurring 50%-off is taken off. If
  // Stripe ever refuses that deep an expansion, read without it rather than
  // show no revenue at all (the discount is then left out, never invented).
  let expand = ["data.items.data.price", "data.discounts.source.coupon"];
  for (let page = 0; page < 100; page++) {
    let res: Stripe.ApiList<Stripe.Subscription>;
    try {
      res = await stripe.subscriptions.list({ status: "all", limit: 100, starting_after, expand });
    } catch (e) {
      if (expand.length === 2 && /expand/i.test(e instanceof Error ? e.message : "")) {
        expand = ["data.items.data.price", "data.discounts"];
        page--;
        continue;
      }
      throw e;
    }
    subs.push(...res.data.map(toLite));
    if (!res.has_more || !res.data.length) break;
    starting_after = res.data[res.data.length - 1].id;
  }
  cache = { at: Date.now(), subs };
  return subs;
}

/** One subscription, live — for a customer's page. */
export async function getSubscription(id: string): Promise<SubLite | null> {
  try {
    const stripe = getStripe();
    const s = await stripe.subscriptions.retrieve(id, { expand: ["items.data.price", "discounts.source.coupon"] })
      .catch(() => stripe.subscriptions.retrieve(id, { expand: ["items.data.price", "discounts"] }));
    return toLite(s);
  } catch {
    return null;
  }
}

export type RevenueResult =
  | { available: true; summary: RevenueSummary; mode: "live" | "test" }
  | { available: false; reason: string };

/** The revenue summary for the admin, or why it can't be read. */
export async function revenue(accounts: Account[]): Promise<RevenueResult> {
  if (!process.env.STRIPE_SECRET_KEY) return { available: false, reason: "STRIPE_SECRET_KEY is not set." };
  try {
    const subs = await listSubscriptions();
    const ours = accounts.filter((a) => a.kind !== "customer");
    const nonCustomerUserIds = new Set(ours.map((a) => a.id));
    const nonCustomerCustomerIds = new Set(ours.map((a) => a.stripeCustomerId).filter((c): c is string => !!c));
    const everPaidUserIds = new Set(accounts.filter((a) => a.billing.everPaid).map((a) => a.id));
    return { available: true, summary: summarize(subs, { nonCustomerUserIds, nonCustomerCustomerIds, everPaidUserIds }), mode: keyMode() };
  } catch (e) {
    return { available: false, reason: `Stripe didn't answer: ${e instanceof Error ? e.message : "unknown error"}` };
  }
}

function keyMode(): "live" | "test" {
  return /^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY ?? "") ? "live" : "test";
}

// ── Is Stripe connected? ────────────────────────────────────────────────────

export const REQUIRED_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
] as const;

export type ConnectionCheck = { label: string; ok: boolean; detail: string };

/** Each thing the site needs from Stripe, checked against Stripe itself. */
export async function stripeConnection(accounts: Account[]): Promise<{ ok: boolean; mode: "live" | "test" | null; checks: ConnectionCheck[] }> {
  const checks: ConnectionCheck[] = [];
  if (!process.env.STRIPE_SECRET_KEY) {
    return { ok: false, mode: null, checks: [{ label: "Secret key", ok: false, detail: "STRIPE_SECRET_KEY is not set in Vercel." }] };
  }
  const mode = keyMode();
  checks.push({ label: "Secret key", ok: mode === "live", detail: mode === "live" ? "Live key: real customers, real money." : "A TEST key is set in production — no real payments are being taken." });
  const stripe = getStripe();

  try {
    const hooks = await stripe.webhookEndpoints.list({ limit: 100 });
    const ours = hooks.data.filter((h) => /swiftcard\.me\/api\/stripe\/webhook/.test(h.url));
    const enabled = ours.find((h) => h.status === "enabled");
    if (!enabled) {
      checks.push({ label: "Webhook", ok: false, detail: ours.length ? "The swiftcard.me webhook is disabled in Stripe." : "No webhook points at swiftcard.me/api/stripe/webhook." });
    } else {
      const events = new Set(enabled.enabled_events);
      const missing = REQUIRED_WEBHOOK_EVENTS.filter((e) => !events.has("*") && !events.has(e));
      checks.push({ label: "Webhook", ok: missing.length === 0, detail: missing.length ? `Enabled, but not sending: ${missing.join(", ")}.` : "Enabled and sending every event the site needs." });
    }
  } catch (e) {
    checks.push({ label: "Webhook", ok: false, detail: `Couldn't read webhooks: ${e instanceof Error ? e.message : "error"}` });
  }

  const prices = configuredPrices();
  const priceProblems: string[] = [];
  for (const p of prices) {
    try {
      const live = await stripe.prices.retrieve(p.id);
      if (!live.active) priceProblems.push(`${p.plan} ${p.interval} is archived`);
      else if (live.unit_amount !== p.cents) priceProblems.push(`${p.plan} ${p.interval} charges ${live.unit_amount} cents, the site says ${p.cents}`);
    } catch {
      priceProblems.push(`${p.plan} ${p.interval} price not found`);
    }
  }
  checks.push({
    label: "Prices",
    ok: prices.length > 0 && priceProblems.length === 0,
    detail: prices.length === 0 ? "No price ids are set." : priceProblems.length ? priceProblems.join("; ") + "." : `${prices.length} prices, each matches what the site charges.`,
  });

  try {
    const { data } = await getAdminSupabase().from("stripe_events").select("created_at").order("created_at", { ascending: false }).limit(1);
    const last = data?.[0]?.created_at as string | undefined;
    const ageH = last ? (Date.now() - Date.parse(last)) / 3_600_000 : Infinity;
    checks.push({ label: "Webhook deliveries", ok: ageH < 24 * 14, detail: last ? `Last event received ${new Date(last).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} (New York).` : "No webhook event has ever been received." });
  } catch {
    checks.push({ label: "Webhook deliveries", ok: false, detail: "Couldn't read the delivery log." });
  }

  try {
    const subs = await listSubscriptions();
    const live = new Map(subs.filter((s) => s.status !== "canceled" && s.status !== "incomplete_expired").map((s) => [s.id, s]));
    const byUser = new Map(accounts.map((a) => [a.id, a]));
    const drift: string[] = [];
    for (const a of accounts) {
      if (a.deleted || !a.stripeSubscriptionId) continue;
      const s = live.get(a.stripeSubscriptionId);
      if (!s && a.effectivePlan !== "free") drift.push(`${a.email ?? a.id} is on ${a.effectivePlan} with no live subscription`);
    }
    for (const s of live.values()) {
      if ((s.status === "active" || s.status === "trialing") && s.userId && byUser.get(s.userId)?.effectivePlan === "free") {
        drift.push(`${byUser.get(s.userId)?.email ?? s.userId} pays in Stripe but is on Free here`);
      }
    }
    checks.push({ label: "Stripe and accounts agree", ok: drift.length === 0, detail: drift.length ? drift.slice(0, 5).join("; ") + (drift.length > 5 ? `; and ${drift.length - 5} more.` : ".") : "Every subscription matches the account it belongs to." });
  } catch (e) {
    checks.push({ label: "Stripe and accounts agree", ok: false, detail: `Couldn't list subscriptions: ${e instanceof Error ? e.message : "error"}` });
  }

  return { ok: checks.every((c) => c.ok), mode, checks };
}

let healthCache: { at: number; value: { configured: boolean; ok: boolean; reason: string } } | null = null;

/**
 * For /api/health: configured and reachable, with no business data. Cached
 * for five minutes and given three seconds, so Stripe being slow can never
 * make the site's own health check slow.
 */
export async function stripeHealth(): Promise<{ configured: boolean; ok: boolean; reason: string }> {
  if (!process.env.STRIPE_SECRET_KEY) return { configured: false, ok: false, reason: "not_configured" };
  if (healthCache && Date.now() - healthCache.at < 5 * 60_000) return healthCache.value;
  let value: { configured: boolean; ok: boolean; reason: string };
  try {
    await Promise.race([
      getStripe().prices.list({ limit: 1 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
    ]);
    value = { configured: true, ok: true, reason: keyMode() };
  } catch (e) {
    value = { configured: true, ok: false, reason: e instanceof Error ? e.message.slice(0, 80) : "error" };
  }
  healthCache = { at: Date.now(), value };
  return value;
}
