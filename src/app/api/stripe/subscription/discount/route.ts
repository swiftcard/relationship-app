import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { getStripe } from "@/lib/stripe";
import { getAccountEmail } from "@/lib/account-email";
import { officeSubUserBlockMessage, resolveBillingSubjectId } from "@/lib/office-roles";
import {
  discountRefusalFor,
  discountRefusalMessage,
  recordRetentionDiscount,
  retentionDiscountTakenBy,
} from "@/lib/retention-discount";

// The one-time retention offer: 50% off for the next 3 months. Self-provisioning
// so it works without any dashboard setup — we create a coupon with a fixed id
// the first time and reuse it thereafter. An explicit env override wins if set.
const RETENTION_COUPON_ID = "swiftcard-retain-50off-3mo";

async function ensureRetentionCoupon(): Promise<string | null> {
  const override = process.env.STRIPE_RETENTION_DISCOUNT_COUPON_ID;
  if (override) return override;
  const stripe = getStripe();
  try {
    await stripe.coupons.retrieve(RETENTION_COUPON_ID);
    return RETENTION_COUPON_ID;
  } catch {
    // Not found → create it with a fixed id (percent_off 50, repeating 3 months).
    try {
      const c = await stripe.coupons.create({
        id: RETENTION_COUPON_ID,
        percent_off: 50,
        duration: "repeating",
        duration_in_months: 3,
        name: "50% off for 3 months",
        metadata: { purpose: "retention" },
      });
      return c.id;
    } catch {
      // A concurrent create may have won the race — try one more retrieve.
      try {
        await stripe.coupons.retrieve(RETENTION_COUPON_ID);
        return RETENTION_COUPON_ID;
      } catch {
        return null;
      }
    }
  }
}

// POST /api/stripe/subscription/discount
// Accepts the retention offer once per customer. Applies the coupon to the live
// subscription and records _retentionUsed so it can't be claimed again.
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Office sub-users have no personal subscription to manage — billing is
  // the organization's. A delegated billing_admin passes through.
  const subBlocked = await officeSubUserBlockMessage(user.id, {
    unless: "manage_billing",
    message: "Billing for your account is managed by your organization.",
  });
  if (subBlocked) return NextResponse.json({ error: subBlocked }, { status: 403 });

  // A delegated billing_admin applies the offer to the OWNER's subscription.
  const subjectId = await resolveBillingSubjectId(user.id);

  const admin = getAdminSupabase();
  const { data: profile } = await admin
    .from("profiles")
    .select("plan, email, stripe_subscription_id, payment_fingerprint, customization")
    .eq("id", subjectId)
    .single();

  const cust = (profile?.customization as Record<string, unknown> | null) ?? {};
  if (cust._retentionUsed === true) {
    return NextResponse.json({ error: "This offer has already been used on your account." }, { status: 409 });
  }
  if (!profile?.stripe_subscription_id) {
    return NextResponse.json({ error: "No active subscription to apply the discount to." }, { status: 400 });
  }

  // Once per PERSON: the account flag above is gone after a purge; the email
  // and card ledger is not (lib/retention-discount).
  const accountEmail = await getAccountEmail(subjectId, (profile.email as string | null) ?? null);
  const fingerprint = (profile.payment_fingerprint as string | null) ?? null;
  if (await retentionDiscountTakenBy(accountEmail, fingerprint)) {
    return NextResponse.json({ error: "This offer has already been used." }, { status: 409 });
  }

  // Only where the coupon does what the offer says — active, monthly, and not
  // replacing a discount they already have (Stripe replaces the whole array).
  const stripe = getStripe();
  let sub: Stripe.Subscription;
  try {
    sub = await stripe.subscriptions.retrieve(profile.stripe_subscription_id as string);
  } catch {
    return NextResponse.json({ error: "Couldn't reach billing. Please try again." }, { status: 502 });
  }
  const refusal = discountRefusalFor(sub);
  if (refusal) return NextResponse.json({ error: discountRefusalMessage(refusal) }, { status: 409 });

  const couponId = await ensureRetentionCoupon();
  if (!couponId) return NextResponse.json({ error: "Discount is temporarily unavailable. Please try again." }, { status: 502 });

  try {
    // Applying the discount also clears any pending cancellation — accepting the
    // offer means the customer is staying.
    await stripe.subscriptions.update(profile.stripe_subscription_id as string, {
      discounts: [{ coupon: couponId }],
      cancel_at_period_end: false,
    }, {
      // A double-tap (or the delete flow and Billing racing) applies it once.
      idempotencyKey: `retention-discount:${profile.stripe_subscription_id}:${couponId}:${Math.floor(Date.now() / 60000)}`,
    });
  } catch {
    return NextResponse.json({ error: "Couldn't apply the discount. Please try again." }, { status: 502 });
  }
  await recordRetentionDiscount(accountEmail, fingerprint);

  const nextCust: Record<string, unknown> = { ...cust, _retentionUsed: true };
  delete nextCust._cancelAtPeriodEnd;
  delete nextCust._cancelAt;
  delete nextCust._cancelReason;
  await admin.from("profiles").update({ customization: nextCust }).eq("id", subjectId);

  return NextResponse.json({ ok: true });
}
