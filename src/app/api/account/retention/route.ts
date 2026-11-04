import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { getOwnerUsernames, publicCardSlug } from "@/lib/owner-usernames";
import { isRateLimited } from "@/lib/rate-limit";
import { reportError } from "@/lib/report-error";
import { alertRetention } from "@/lib/retention-alert";
import { ledgerAdd, ledgerHas, trialHistoryFor } from "@/lib/trial-ledger";
import { TRIAL_ENDS_KEY } from "@/lib/billing-state";
import { getStripe } from "@/lib/stripe";
import { discountRefusalFor, retentionDiscountTakenBy } from "@/lib/retention-discount";
import { trialExtensionOfferFor, type TrialExtensionOffer } from "@/lib/trial-extension-server";
import {
  RETENTION_GRANT_DAYS,
  RETENTION_DISCOUNT_MONTHS,
  RETENTION_DISCOUNT_PERCENT,
  type AccountFacts,
} from "@/lib/retention";
import { eligibilityOf, planOf, retentionOf, sourceOf, type Cust } from "@/lib/retention-eligibility";

// ── The save sequence behind "Delete account" ────────────────────────────────
//
// GET  → what this account is (plan, who bills it), what it would lose in its
//        own numbers, and which offers it is actually eligible for.
// POST → one of: "survey" (record the answers), "grant" (30 free days of Pro),
//        "discount" (50% off the next 3 invoices), "downgrade" (Pro → Free,
//        billing stops, nothing destroyed), "quiet" (all email off),
//        "extend" (a card trial runs on free to a full month from its start).
//
// Every offer is ONE PER ACCOUNT, FOREVER, recorded in customization._retention
// before the reward is handed out. Otherwise the flow is a vending machine:
// open the delete dialog, take the free month, close it, repeat. The flag is
// written on the same row the reward is written to, so there is no window where
// a reward exists without the record of it.
//
// The survey is stored whether or not the account is ever deleted — a person
// who takes an offer and stays has told us the most valuable thing in here.
//
// WHO may be offered WHAT is decided in lib/retention-eligibility (pure, and
// tested per account type); this route only gathers the facts it needs.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

// Trial history for the grant rules: whether this person has had a Pro trial
// (account marker or email ledger), whether their email already took the grant
// — or the 50% offer — on any account, and whether a card-backed trial is
// running now.
async function trialFactsFor(userId: string, email: string | null | undefined, cust: Cust) {
  const history = await trialHistoryFor(userId, email);
  const [trialByEmail, grantLedgerUsed, discountLedgerUsed] = await Promise.all([
    ledgerHas("email_trial", email),
    ledgerHas("email_retention", email),
    ledgerHas("email_retention_discount", email),
  ]);
  return {
    hadTrial: !!history.proTrialStartedAt || trialByEmail,
    grantLedgerUsed,
    discountLedgerUsed,
    trialing: typeof cust[TRIAL_ENDS_KEY] === "string",
  };
}

// The trial stretch, asked of the live subscription — the same question the
// extend-trial route asks right before applying it. Any failure is "no offer".
async function extensionFor(
  subId: string,
  plan: string | null,
  cust: Cust,
  email: string | null | undefined,
): Promise<TrialExtensionOffer | null> {
  try {
    const sub = await getStripe().subscriptions.retrieve(subId);
    return await trialExtensionOfferFor({ plan, cust, sub, email });
  } catch {
    return null;
  }
}

// The 50% offer against the live subscription (active, monthly, no discount
// already on it) and the person (never taken on any account). Any failure is
// "no offer" — never an offer we then can't apply.
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
  const rec = retentionOf(cust);
  // Stripe is asked only when nothing free has already ruled the 50% out (an
  // individual Stripe Pro, never discounted, not trialling) — so Free, Apple,
  // Office and repeat visits never cost a Stripe call — and alongside the trial
  // look-up rather than after it.
  const discountWorthChecking =
    profile.plan === "pro" && source === "stripe" && !!subId &&
    !rec.discountedAt && cust._retentionUsed !== true && typeof cust[TRIAL_ENDS_KEY] !== "string";
  // The trial stretch is asked only of an individual Stripe Pro that is on a
  // card trial and has never had retention time — never alongside the 50%
  // look-up, which a trial rules out, so this is still at most one Stripe call.
  const trialEndsAt = typeof cust[TRIAL_ENDS_KEY] === "string" ? (cust[TRIAL_ENDS_KEY] as string) : null;
  const extendWorthChecking =
    profile.plan === "pro" && source === "stripe" && !!subId &&
    !!trialEndsAt && !rec.grantedAt && !rec.trialExtendedAt;
  const [trialFacts, discountOk, extension] = await Promise.all([
    trialFactsFor(user.id, user.email, cust),
    discountWorthChecking
      ? discountOkFor(subId as string, user.email, (profile.payment_fingerprint as string | null) ?? null)
      : null,
    extendWorthChecking ? extensionFor(subId as string, profile.plan as string | null, cust, user.email) : null,
  ]);
  const elig = eligibilityOf({
    plan,
    rawPlan: (profile.plan as string | null) ?? null,
    source,
    rec,
    planExpiresAt,
    subId,
    retentionUsed: cust._retentionUsed,
    ...trialFacts,
    accountCreatedAt: user.created_at ?? null,
    discountOk,
    extension,
    trialEndsAt,
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
  if (!action || !["survey", "grant", "discount", "downgrade", "quiet", "extend"].includes(action)) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const admin = getAdminSupabase();
  const { data: profile } = await admin
    .from("profiles")
    .select("plan, plan_expires_at, stripe_subscription_id, pro_trial_started_at, customization")
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
    // The subscription and once-per-person checks belong to the discount route,
    // which makes them itself right before applying the coupon — asking Stripe
    // here as well would only double the wait on "Apply 50% off".
    discountOk: action === "discount" ? true : null,
    // Same reasoning: the extend-trial route checks the live subscription and
    // the ledger itself, immediately before moving the trial end.
    extendOk: action === "extend" ? true : null,
    trialEndsAt: typeof cust[TRIAL_ENDS_KEY] === "string" ? (cust[TRIAL_ENDS_KEY] as string) : null,
  });

  // The reason they gave at step 1-2, so an alert carries WHY, not just WHAT.
  const lastSurvey = (rec.surveys ?? [])[(rec.surveys ?? []).length - 1];
  const saved = (outcome: "grant" | "discount" | "downgrade" | "quiet" | "extend") =>
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

  // ── A card trial stretched to a full month ────────────────────────────────
  if (action === "extend") {
    if (!elig.extend || !subId) {
      return NextResponse.json({ error: "This offer isn't available on your account." }, { status: 409 });
    }
    // THE SAME OFFER Billing's cancel flow makes, applied by the same route:
    // it owns the Stripe call, the once-per-person ledger and the account's
    // trialExtendedAt record. Called in-process, like the discount above.
    const { POST: extend } = await import("@/app/api/stripe/subscription/extend-trial/route");
    const res = await extend();
    const data = (await res.json().catch(() => ({}))) as { error?: string; until?: string; extraDays?: number };
    if (!res.ok) {
      if (res.status !== 409) await reportError("retention.extend-failed", new Error(data.error ?? `status ${res.status}`), { userId: user.id });
      return NextResponse.json({ error: data.error || "Couldn't extend your trial right now. Please try again." }, { status: res.status });
    }
    // Re-read: the extend route just rewrote customization (trialExtendedAt,
    // the new trial end) — writing back the copy read above would undo it.
    const { data: fresh } = await admin.from("profiles").select("customization").eq("id", user.id).maybeSingle();
    const freshCust = (fresh?.customization as Cust | null) ?? {};
    await admin
      .from("profiles")
      .update({
        customization: {
          ...freshCust,
          _retention: { ...retentionOf(freshCust), savedBy: "extend", savedAt: new Date().toISOString() },
        },
      })
      .eq("id", user.id);
    await saved("extend");
    return NextResponse.json({ ok: true, until: data.until ?? null, extraDays: data.extraDays ?? null });
  }

  // ── Go quiet: every SwiftCard email off, account untouched ────────────────
  // BOTH opt-out flags (supabase/email-preference-center.sql: every write path
  // sets both — older senders read marketing_emails, newer ones
  // marketing_opt_out, and an opt-out that lands in only one of them is one we
  // fail to honour).
  // Receipts are left alone. A Free account is never charged, so switching
  // them off silenced nothing today — but the flag outlived the moment, and
  // the receipts of someone who later subscribed were skipped without a word
  // (the webhook honours receipt_emails). Silencing a payer's receipts is
  // hiding their own money from them.
  const { error } = await admin
    .from("email_preferences")
    .upsert(
      { user_id: user.id, marketing_emails: false, marketing_opt_out: true, updated_at: new Date().toISOString() },
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
