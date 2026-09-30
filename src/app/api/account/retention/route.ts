import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { getOwnerUsernames, publicCardSlug } from "@/lib/owner-usernames";
import { isRateLimited } from "@/lib/rate-limit";
import { isPaidPlan } from "@/lib/plan";
import { isApplePaid } from "@/lib/iap-entitlement";
import { reportError } from "@/lib/report-error";
import { alertRetention } from "@/lib/retention-alert";
import { ledgerAdd, ledgerHas, trialHistoryFor } from "@/lib/trial-ledger";
import { TRIAL_ENDS_KEY } from "@/lib/billing-state";
import { getStripe } from "@/lib/stripe";
import { discountRefusalFor, retentionDiscountTakenBy } from "@/lib/retention-discount";
import {
  RETENTION_GRANT_DAYS,
  RETENTION_GRANT_DAYS_AFTER_TRIAL,
  RETENTION_DISCOUNT_MONTHS,
  RETENTION_DISCOUNT_PERCENT,
  type AccountFacts,
  type Eligibility,
  type PlanSource,
  type RetentionPlan,
} from "@/lib/retention";

// ── The save sequence behind "Delete account" ────────────────────────────────
//
// GET  → what this account is (plan, who bills it), what it would lose in its
//        own numbers, and which offers it is actually eligible for.
// POST → one of: "survey" (record the answers), "grant" (30 free days of Pro),
//        "discount" (50% off the next 3 invoices), "downgrade" (Pro → Free,
//        billing stops, nothing destroyed), "quiet" (all email off).
//
// Every offer is ONE PER ACCOUNT, FOREVER, recorded in customization._retention
// before the reward is handed out. Otherwise the flow is a vending machine:
// open the delete dialog, take the free month, close it, repeat. The flag is
// written on the same row the reward is written to, so there is no window where
// a reward exists without the record of it.
//
// The survey is stored whether or not the account is ever deleted — a person
// who takes an offer and stays has told us the most valuable thing in here.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

type Cust = Record<string, unknown>;
type RetentionRecord = {
  /** Every survey answer, newest last. */
  surveys?: { reason: string; comment: string; plan: string; at: string }[];
  /** ISO timestamp of the one grant/discount this account has taken. */
  grantedAt?: string;
  discountedAt?: string;
  /** What the account chose in the end, for the admin funnel. */
  savedBy?: string;
  savedAt?: string;
};

function retentionOf(cust: Cust): RetentionRecord {
  return (cust._retention as RetentionRecord | undefined) ?? {};
}

// Trial history for the grant rules: whether this person has had a Pro trial
// (account marker or email ledger), whether their email already took the grant
// on any account, and whether a card-backed trial is running now.
async function trialFactsFor(userId: string, email: string | null | undefined, cust: Cust) {
  const history = await trialHistoryFor(userId, email);
  const [trialByEmail, grantLedgerUsed] = await Promise.all([
    ledgerHas("email_trial", email),
    ledgerHas("email_retention", email),
  ]);
  return {
    hadTrial: !!history.proTrialStartedAt || trialByEmail,
    grantLedgerUsed,
    trialing: typeof cust[TRIAL_ENDS_KEY] === "string",
  };
}

function planOf(plan: string | null | undefined): RetentionPlan {
  return isPaidPlan(plan) ? "pro" : "free";
}

function sourceOf(plan: string | null | undefined, cust: Cust, subId: string | null, planExpiresAt: string | null): PlanSource {
  if (!isPaidPlan(plan)) return null;
  if (isApplePaid(cust)) return "apple";
  if (subId) return "stripe";
  // Free Pro with an end date and nothing billing it (this flow's gift, a
  // referral month). Office grants keep the generic wording — "your free Pro"
  // would be the wrong plan's name.
  return plan === "pro" && planExpiresAt ? "grant" : null;
}

const GRANT_MIN_ACCOUNT_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function accountOldEnough(createdAt: string | null | undefined): boolean {
  const t = createdAt ? Date.parse(createdAt) : NaN;
  return Number.isFinite(t) && Date.now() - t >= GRANT_MIN_ACCOUNT_AGE_MS;
}

function eligibilityOf(opts: {
  plan: RetentionPlan;
  /** The stored plan string — "pro" and "enterprise" are NOT interchangeable here. */
  rawPlan: string | null;
  source: PlanSource;
  rec: RetentionRecord;
  planExpiresAt: string | null;
  subId: string | null;
  /** customization._retentionUsed — set by the Billing cancel-flow offer. */
  retentionUsed: unknown;
  /** This account or email has had a Pro trial (Stripe or Apple). */
  hadTrial?: boolean;
  /** This email already took the grant on some account (purge-proof ledger). */
  grantLedgerUsed?: boolean;
  /** A card-backed trial is running right now (mirrored trial end). */
  trialing?: boolean;
  /** auth.users.created_at — the free month is a save for real customers. */
  accountCreatedAt?: string | null;
  /**
   * The 50% offer checked against the live subscription and the person:
   * null = not looked up (not an individual Stripe Pro), which offers nothing.
   * See lib/retention-discount.
   */
  discountOk?: boolean | null;
}): Eligibility {
  const { plan, rawPlan, source, rec, planExpiresAt, subId, retentionUsed } = opts;
  // An Office/enterprise subscription is a seat-billed team plan: its price is
  // recomputed from the seat count by office-billing-sync, and /account/downgrade
  // refuses it outright. Discounting or self-cancelling one from a personal
  // delete dialog would either be undone by the next seat sync or strand a team,
  // so the money offers are for an INDIVIDUAL Pro subscription only.
  const individualPro = plan === "pro" && rawPlan === "pro" && source === "stripe" && !!subId;
  return {
    // A Free account that has never taken retention time and is not already
    // sitting on a grant (an unexpired trial/free month) — handing 30 days to
    // someone who already has 20 left reads as a trick.
    // Not on a brand-new account: sign up, POST {action:"grant"}, and a month
    // of Pro (with its paid AI features) came free with no card, once per
    // throwaway email (security audit 2026-09-24). Someone who has used
    // SwiftCard for two weeks is the customer this offer is for.
    grant: plan === "free" && !rec.grantedAt && !planExpiresAt && !opts.grantLedgerUsed && accountOldEnough(opts.accountCreatedAt),
    // Someone who has had a 14-day trial gets the rest of 30, not 30 more.
    grantDays: opts.hadTrial ? RETENTION_GRANT_DAYS_AFTER_TRIAL : RETENTION_GRANT_DAYS,
    // Only a real Stripe subscription can be discounted. Apple bills Apple.
    // `_retentionUsed` is the SHARED once-per-customer flag: the same 50%/3mo
    // offer is made when cancelling a subscription in Billing, and taking it
    // there must close it here too.
    // Not during a free trial: there is no invoice yet to take 50% off, and
    // cancelling the trial (downgrade) is the honest save there.
    // And only where the coupon does what the offer says, for a person who has
    // never had it on any account: active + monthly + no discount already on
    // the subscription + not in the ledger (`discountOk`, fails closed).
    discount: individualPro && !rec.discountedAt && retentionUsed !== true && !opts.trialing && opts.discountOk === true,
    downgrade: individualPro,
  };
}

// The 50% offer against the live subscription (active, monthly, no discount
// already on it) and the person (never taken on any account). Asked only for an
// individual Stripe Pro, so Free, Apple and Office never cost a Stripe call.
// Any failure is "no offer" — never an offer we then can't apply.
async function discountOkFor(subId: string, email: string | null | undefined, fingerprint: string | null): Promise<boolean> {
  try {
    const sub = await getStripe().subscriptions.retrieve(subId);
    if (discountRefusalFor(sub)) return false;
    return !(await retentionDiscountTakenBy(email, fingerprint));
  } catch {
    return false;
  }
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminSupabase();
  const { data: profile } = await admin
    .from("profiles")
    .select("plan, plan_expires_at, stripe_subscription_id, payment_fingerprint, customization, created_at")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) return NextResponse.json({ error: "No account" }, { status: 404 });

  const cust = (profile.customization as Cust | null) ?? {};
  const plan = planOf(profile.plan as string | null);
  const subId = (profile.stripe_subscription_id as string | null) ?? null;
  const planExpiresAt = (profile.plan_expires_at as string | null) ?? null;
  const source = sourceOf(profile.plan as string | null, cust, subId, planExpiresAt);
  const elig = eligibilityOf({
    plan,
    rawPlan: (profile.plan as string | null) ?? null,
    source,
    rec: retentionOf(cust),
    planExpiresAt,
    subId,
    retentionUsed: cust._retentionUsed,
    ...(await trialFactsFor(user.id, user.email, cust)),
    accountCreatedAt: user.created_at ?? null,
    discountOk:
      profile.plan === "pro" && source === "stripe" && subId
        ? await discountOkFor(subId, user.email, (profile.payment_fingerprint as string | null) ?? null)
        : null,
  });

  // Their own numbers for the "what you lose" step. Counted with head:true so
  // this stays three cheap COUNT queries even on a large account.
  const owned = await getOwnerUsernames(user.id);
  const [{ count: contacts }, { count: views }, { data: cards }, slug] = await Promise.all([
    admin.from("leads").select("id", { count: "exact", head: true }).in("card_owner", owned),
    admin.from("card_views").select("id", { count: "exact", head: true }).in("username", owned),
    admin.from("cards").select("id").eq("user_id", user.id),
    publicCardSlug(user.id),
  ]);

  const facts: AccountFacts = {
    contacts: contacts ?? 0,
    views: views ?? 0,
    cards: cards?.length ?? 0,
    cardUrl: slug ? `${APP_URL.replace(/^https?:\/\//, "")}/${slug}` : null,
    since: (profile.created_at as string | null) ?? null,
    // Filled in by the caller, which already resolves office context for the
    // page; kept in the type so the component has one shape to render.
    isOfficeOwner: false,
    // When free Pro with nothing billing it ends — the keep step names the day.
    proEndsAt: source === "grant" ? planExpiresAt : null,
  };

  return NextResponse.json({ plan, source, eligibility: elig, facts });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Same shape of throttle as the delete route it sits in front of.
  if (await isRateLimited(`retention:${user.id}`, 20, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests — please wait a moment and try again." }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as { action?: string; reason?: string; comment?: string };
  const action = body.action;
  if (!action || !["survey", "grant", "discount", "downgrade", "quiet"].includes(action)) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const admin = getAdminSupabase();
  const { data: profile } = await admin
    .from("profiles")
    .select("plan, plan_expires_at, stripe_subscription_id, payment_fingerprint, pro_trial_started_at, customization")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) return NextResponse.json({ error: "No account" }, { status: 404 });

  const cust = (profile.customization as Cust | null) ?? {};
  const rec = retentionOf(cust);
  const plan = planOf(profile.plan as string | null);
  const subId = (profile.stripe_subscription_id as string | null) ?? null;
  const planExpiresAt = (profile.plan_expires_at as string | null) ?? null;
  const source = sourceOf(profile.plan as string | null, cust, subId, planExpiresAt);
  const elig = eligibilityOf({
    plan,
    rawPlan: (profile.plan as string | null) ?? null,
    source,
    rec,
    planExpiresAt,
    subId,
    retentionUsed: cust._retentionUsed,
    ...(await trialFactsFor(user.id, user.email, cust)),
    accountCreatedAt: user.created_at ?? null,
    // Only the discount action needs the Stripe look-up; the discount route
    // repeats every one of these checks before it touches the subscription.
    discountOk:
      action === "discount" && profile.plan === "pro" && source === "stripe" && subId
        ? await discountOkFor(subId, user.email, (profile.payment_fingerprint as string | null) ?? null)
        : null,
  });

  // The reason they gave at step 1-2, so an alert carries WHY, not just WHAT.
  const lastSurvey = (rec.surveys ?? [])[(rec.surveys ?? []).length - 1];
  const saved = (outcome: "grant" | "discount" | "downgrade" | "quiet") =>
    alertRetention({
      userId: user.id,
      email: user.email ?? null,
      plan: (profile.plan as string | null) ?? null,
      outcome,
      reason: lastSurvey?.reason ?? null,
      comment: lastSurvey?.comment ?? null,
    });

  // ── Record the answers ────────────────────────────────────────────────────
  if (action === "survey") {
    const reason = typeof body.reason === "string" ? body.reason.slice(0, 200) : "";
    const comment = typeof body.comment === "string" ? body.comment.slice(0, 1000) : "";
    if (!reason) return NextResponse.json({ error: "reason required" }, { status: 400 });
    const surveys = [...(rec.surveys ?? []), { reason, comment, plan, at: new Date().toISOString() }].slice(-10);
    await admin
      .from("profiles")
      .update({ customization: { ...cust, _retention: { ...rec, surveys } } })
      .eq("id", user.id);
    return NextResponse.json({ ok: true });
  }

  // ── 30 days of Pro, free, no card ─────────────────────────────────────────
  if (action === "grant") {
    if (!elig.grant) return NextResponse.json({ error: "This offer isn't available on your account." }, { status: 409 });
    const days = elig.grantDays ?? RETENTION_GRANT_DAYS;
    const expires = new Date(Date.now() + days * 86400000).toISOString();
    const now = new Date().toISOString();
    // plan + expiry + the one-per-account flag in a SINGLE write: a partial
    // apply here would either give Pro with no record (repeatable) or record a
    // gift that was never given.
    //
    // The gift IS this person's free Pro period (owner, 2026-09-16: trial +
    // gift = 30 days, never more). Stamping pro_trial_started_at in the same
    // write is what makes that true everywhere else: Stripe checkout offers no
    // 14-day trial on top, the iPhone app serves the no-trial offer, and a
    // checkout started DURING the gift bills from the day it ends instead
    // (lib/billing-state giftBridgeTrialEnd). Never overwrites an earlier stamp.
    const { error } = await admin
      .from("profiles")
      .update({
        plan: "pro",
        plan_expires_at: expires,
        ...(profile.pro_trial_started_at ? {} : { pro_trial_started_at: now }),
        customization: {
          ...cust,
          _retention: { ...rec, grantedAt: now, savedBy: "grant", savedAt: now },
        },
      })
      .eq("id", user.id);
    if (error) return NextResponse.json({ error: "Couldn't start your free month. Please try again." }, { status: 500 });
    // Once per PERSON: the account record above is gone after purge, these are
    // not — no second gift, and no Stripe or Apple trial on a new account.
    await ledgerAdd("email_retention", user.email);
    await ledgerAdd("email_trial", user.email);
    await saved("grant");
    return NextResponse.json({ ok: true, days, until: expires });
  }

  // ── 50% off the next 3 invoices ───────────────────────────────────────────
  if (action === "discount") {
    if (!elig.discount || !subId) {
      return NextResponse.json({ error: "This offer isn't available on your account." }, { status: 409 });
    }
    // THE SAME OFFER the cancel-subscription flow makes, applied by the same
    // route — not a second discount of our own. That route owns the coupon
    // (one fixed, self-provisioning id), the once-per-customer `_retentionUsed`
    // flag, and the rule that accepting clears a pending cancellation. Minting
    // a separate coupon here would have let one subscriber take 50% off in
    // Billing and 50% off again on the way to Delete — and Stripe REPLACES the
    // discount array, so the second one would silently overwrite the first.
    const { POST: discount } = await import("@/app/api/stripe/subscription/discount/route");
    const res = await discount();
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status !== 409) await reportError("retention.discount-failed", new Error(data.error ?? `status ${res.status}`), { userId: user.id });
      return NextResponse.json({ error: data.error || "Couldn't apply the discount right now. Please try again." }, { status: res.status });
    }
    // Recorded only after Stripe accepted it — a flag written ahead of a failed
    // apply would burn the one offer this account gets and hand them nothing.
    // Re-read first: the discount route just rewrote customization (the
    // _retentionUsed flag and the cleared cancellation), and writing back the
    // copy read above would undo all of it.
    const { data: fresh } = await admin.from("profiles").select("customization").eq("id", user.id).maybeSingle();
    const freshCust = (fresh?.customization as Cust | null) ?? {};
    await admin
      .from("profiles")
      .update({
        customization: {
          ...freshCust,
          _retention: {
            ...retentionOf(freshCust),
            discountedAt: new Date().toISOString(),
            savedBy: "discount",
            savedAt: new Date().toISOString(),
          },
        },
      })
      .eq("id", user.id);
    await saved("discount");
    return NextResponse.json({ ok: true, percent: RETENTION_DISCOUNT_PERCENT, months: RETENTION_DISCOUNT_MONTHS });
  }

  // ── Switch to Free instead of deleting ────────────────────────────────────
  if (action === "downgrade") {
    if (!elig.downgrade) return NextResponse.json({ error: "There's no subscription to cancel." }, { status: 409 });
    // The existing downgrade route owns this: it cancels in Stripe FIRST and
    // refuses to flip the plan if the cancel fails, so an account can never
    // read as Free while the card is still being charged. Duplicating that
    // ordering here is how the two drift apart. Called as a function rather
    // than fetched over HTTP — it reads the same request cookies we were
    // called with, and a serverless function calling itself by URL is a hop
    // that can fail for reasons this one cannot.
    const { POST: downgrade } = await import("@/app/api/account/downgrade/route");
    const res = await downgrade();
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return NextResponse.json({ error: data.error || "Couldn't cancel your subscription. Please try again." }, { status: 502 });
    }
    // Re-read: the downgrade route rewrote customization, so the copy held in
    // `cust` above is stale and writing it back would resurrect what it cleared.
    const { data: fresh } = await admin.from("profiles").select("customization").eq("id", user.id).maybeSingle();
    const freshCust = (fresh?.customization as Cust | null) ?? {};
    await admin
      .from("profiles")
      .update({
        customization: {
          ...freshCust,
          _retention: { ...retentionOf(freshCust), savedBy: "downgrade", savedAt: new Date().toISOString() },
        },
      })
      .eq("id", user.id);
    await saved("downgrade");
    return NextResponse.json({ ok: true });
  }

  // ── Go quiet: every SwiftCard email off, account untouched ────────────────
  // Receipts are switched off only for an account that isn't being charged.
  // Silencing a paying subscriber's payment receipts is not a kindness — it is
  // hiding their own money from them.
  const { error } = await admin
    .from("email_preferences")
    .upsert(
      { user_id: user.id, marketing_emails: false, ...(plan === "free" ? { receipt_emails: false } : {}) },
      { onConflict: "user_id" },
    );
  if (error) return NextResponse.json({ error: "Couldn't update your email settings. Please try again." }, { status: 500 });
  await admin
    .from("profiles")
    .update({
      customization: { ...cust, _retention: { ...rec, savedBy: "quiet", savedAt: new Date().toISOString() } },
    })
    .eq("id", user.id);
  await saved("quiet");
  return NextResponse.json({ ok: true });
}
