import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { getStripe, subscriptionPeriodEndIso } from "@/lib/stripe";
import type Stripe from "stripe";
import { officeSubUserBlockMessage, resolveBillingSubjectId } from "@/lib/office-roles";
import { mergeCustomization } from "@/lib/customization-merge";

// POST /api/stripe/subscription/keep
// Reverses a scheduled cancellation: clears cancel_at_period_end so the plan
// stays active and renews normally on the same date. Idempotent — calling it on
// a subscription that isn't scheduled to cancel just confirms it's active.
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Office sub-users have no personal subscription to manage — billing is
  // the organization's. A delegated billing_admin passes through.
  const subBlocked = await officeSubUserBlockMessage(user.id, {
    unless: "manage_billing",
    allowIfOwnSubscription: true,
    message: "Billing for your account is managed by your organization.",
  });
  if (subBlocked) return NextResponse.json({ error: subBlocked }, { status: 403 });

  // A delegated billing_admin reactivates the OWNER's subscription, not their own.
  const subjectId = await resolveBillingSubjectId(user.id);

  const admin = getAdminSupabase();
  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_subscription_id, customization")
    .eq("id", subjectId)
    .single();

  if (!profile?.stripe_subscription_id) {
    return NextResponse.json({ error: "No subscription found." }, { status: 400 });
  }

  let renewalAt: string | null = null;
  try {
    const sub = (await getStripe().subscriptions.update(profile.stripe_subscription_id, {
      cancel_at_period_end: false,
    })) as Stripe.Subscription;
    renewalAt = subscriptionPeriodEndIso(sub);
  } catch {
    return NextResponse.json({ error: "Couldn't reactivate the subscription. Please try again." }, { status: 502 });
  }

  // Clear the mirrored scheduled-cancel state.
  // Only these keys (lib/customization-merge, audit B-03).
  await mergeCustomization(subjectId, { set: {}, remove: ["_cancelAtPeriodEnd", "_cancelAt", "_cancelReason"] });

  return NextResponse.json({ ok: true, renewalAt });
}
