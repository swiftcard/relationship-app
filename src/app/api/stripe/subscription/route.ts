import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { getStripe, subscriptionPeriodEnd } from "@/lib/stripe";
import { planFromPriceId } from "@/lib/subscription";
import { PLAN_LIMITS } from "@/lib/plan";
import { getOfficeSeatUsage } from "@/lib/office-seats";
import type Stripe from "stripe";
import { officeSubUserBlockMessage, getOfficeSubUserContext, roleHasCapability, resolveBillingSubjectId } from "@/lib/office-roles";
import { stripeTrialEndIso } from "@/lib/billing-state";
import { discountRefusalFor, retentionDiscountTakenBy } from "@/lib/retention-discount";
import { getAccountEmail } from "@/lib/account-email";

// GET /api/stripe/subscription — the read model the billing UI renders from.
// Reads the profile, and (when there's a live Stripe subscription) the
// authoritative subscription object, so the UI always reflects the true state
// right after an action, not just the webhook-synced DB snapshot.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Office sub-users have no personal subscription to manage — billing is
  // the organization's. A delegated billing_admin passes through, and so does a
  // sub-user who still holds their OWN Stripe subscription from before they
  // joined: the cancel/keep/portal routes already allow them (billing audit
  // #6A), but this read model didn't — so the UI could never show them the
  // subscription they were still paying for, let alone the cancel button.
  const subBlocked = await officeSubUserBlockMessage(user.id, {
    unless: "manage_billing",
    allowIfOwnSubscription: true,
    message: "Billing for your account is managed by your organization.",
  });
  if (subBlocked) return NextResponse.json({ error: subBlocked }, { status: 403 });

  // When that own-subscription exception is what let the caller in, the UI must
  // render a trimmed personal-sub view (their sub + cancel), not the full plan
  // manager — they're on a team seat; switching plans or buying seats is not
  // theirs to do here.
  const subUserCtx = await getOfficeSubUserContext(user.id);
  const personalSubOnly = !!subUserCtx && !roleHasCapability(subUserCtx.role, "manage_billing");

  // THE SAME SUBJECT THE WRITES ACT ON. This used to read `user.id` while
  // cancel, change-plan, discount, keep and preview all resolved through
  // resolveBillingSubjectId — which returns the OWNER's id for a delegated
  // billing_admin. A billing_admin who also held a personal subscription was
  // therefore shown their own plan and, on pressing Cancel, would have
  // cancelled the ORGANISATION's. You may only act on what you were shown.
  const subjectId = await resolveBillingSubjectId(user.id);
  const managingOrgBilling = subjectId !== user.id;

  const admin = getAdminSupabase();
  const { data: profile } = await admin
    .from("profiles")
    .select("plan, email, stripe_customer_id, stripe_subscription_id, plan_expires_at, payment_fingerprint, customization")
    .eq("id", subjectId)
    .single();

  const cust = (profile?.customization as Record<string, unknown> | null) ?? {};
  const dbPlan = (profile?.plan as string) ?? "free";
  const uiPlan = dbPlan === "enterprise" ? "office" : dbPlan; // present Office by its product name

  const base = {
    plan: uiPlan as "free" | "pro" | "office",
    // Which billing source backs the plan ("apple" = bought via IAP in the iOS
    // shell). The shell's billing panel routes "manage" on this: Apple subs are
    // managed in the App Store, never the Stripe portal.
    planSource: (cust._planSource === "apple" ? "apple" : cust._planSource === "stripe" ? "stripe" : null) as
      | "apple" | "stripe" | null,
    interval: null as "monthly" | "annual" | null,
    status: null as string | null,
    seats: null as number | null,
    activeMembers: null as number | null,
    pendingInvites: null as number | null,
    ownerSeats: 1,
    scheduledSeats: null as number | null,
    scheduledSeatsAt: null as string | null,
    minSeats: PLAN_LIMITS.OFFICE_MIN_SEATS,
    currentPeriodEnd: null as string | null,
    // Card-backed trial: when it converts to paid (null unless status is trialing).
    trialEnd: null as string | null,
    // A free-Pro grant with no subscription behind it (referral or retention
    // days): when it ends. Lets billing say so instead of "Renews" with no date.
    grantEndsAt:
      !profile?.stripe_subscription_id && cust._planSource !== "apple" && dbPlan !== "free" && typeof profile?.plan_expires_at === "string"
        ? (profile.plan_expires_at as string)
        : null,
    cancelAtPeriodEnd: false,
    renewalCents: null as number | null,
    retentionUsed: cust._retentionUsed === true,
    // Whether the 50%-off offer can go on this subscription (lib/retention-
    // discount): active, monthly, no discount already on it. False until the
    // live subscription below says otherwise.
    discountOfferable: false,
    paymentFailed: typeof cust._paymentFailedAt === "string",
    hasStripeSubscription: !!profile?.stripe_subscription_id,
    hasCustomer: !!profile?.stripe_customer_id,
    personalSubOnly,
    // Whose subscription this payload describes. True when a delegated
    // billing_admin is looking at the ORGANISATION's, so the UI can name it
    // instead of letting them believe it is their own.
    managingOrgBilling,
  };

  if (!profile?.stripe_subscription_id) {
    return NextResponse.json(base);
  }

  // Has this PERSON already had the 50% offer, on any account? Started now so
  // it runs alongside the Stripe call below rather than after it; skipped when
  // the account flag already answers it. Never rejects (the ledger fails open).
  const discountTaken: Promise<boolean> = base.retentionUsed
    ? Promise.resolve(true)
    : getAccountEmail(subjectId, (profile.email as string | null) ?? null)
        .then((email) => retentionDiscountTakenBy(email, (profile.payment_fingerprint as string | null) ?? null))
        .catch(() => true);

  // Pull the live subscription so period-end / cancel-scheduled / seats are exact.
  try {
    const sub = (await getStripe().subscriptions.retrieve(profile.stripe_subscription_id)) as Stripe.Subscription;
    const item = sub.items.data[0];
    const priceId = item?.price?.id;
    const mapped = planFromPriceId(priceId);
    const periodEndUnix = subscriptionPeriodEnd(sub);

    if (mapped) { base.plan = mapped.plan; base.interval = mapped.interval; }
    base.status = sub.status;
    base.trialEnd = stripeTrialEndIso(sub);
    // …and this PERSON has never taken it, on any account (the route checks
    // the same ledger — showing an offer it would refuse is a broken promise).
    base.discountOfferable = discountRefusalFor(sub) === null && !(await discountTaken);
    base.cancelAtPeriodEnd = sub.cancel_at_period_end === true;
    base.currentPeriodEnd = periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null;
    base.seats = mapped?.plan === "office" ? (item?.quantity ?? null) : null;
    const unit = item?.price?.unit_amount ?? null;
    base.renewalCents = unit != null ? unit * (item?.quantity ?? 1) : null;

    if (mapped?.plan === "office") {
      // subjectId, not user.id — the office belongs to whoever holds the
      // subscription this payload describes. With the caller's id here, a
      // delegated billing_admin saw the org's plan and price but no seat
      // counts at all, because they do not own the office row.
      const { data: office } = await admin
        .from("offices")
        .select("id, scheduled_seats, scheduled_seats_at")
        .eq("owner_id", subjectId)
        .maybeSingle();
      if (office) {
        // Same accounting as the invite/seat routes — getOfficeSeatUsage drops
        // EXPIRED pending invites, which no longer reserve a seat. Counting them
        // here (as a raw status='pending' count once did) inflated "used" in the
        // billing UI, which both hid available seats and raised the floor on a
        // seat reduction the server would actually have allowed.
        const usage = await getOfficeSeatUsage(office.id as string, base.seats ?? PLAN_LIMITS.OFFICE_MIN_SEATS);
        base.activeMembers = usage.active;
        base.pendingInvites = usage.pending;
        base.scheduledSeats = (office as { scheduled_seats?: number | null }).scheduled_seats ?? null;
        base.scheduledSeatsAt = (office as { scheduled_seats_at?: string | null }).scheduled_seats_at ?? null;
      }
    }
  } catch {
    // Stripe unreachable / sub deleted — fall back to the DB snapshot so the UI
    // still renders something coherent.
    base.cancelAtPeriodEnd = cust._cancelAtPeriodEnd === true;
    base.currentPeriodEnd = typeof cust._cancelAt === "string" ? (cust._cancelAt as string) : null;
  }

  return NextResponse.json(base);
}
