import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { getStripe, subscriptionPeriodEndIso } from "@/lib/stripe";
import type Stripe from "stripe";
import { officeSubUserBlockMessage, resolveBillingSubjectId } from "@/lib/office-roles";
import { mergeCustomization } from "@/lib/customization-merge";
import { cancelKey, notifyAdmin } from "@/lib/admin-notify";
import { getAccountEmail } from "@/lib/account-email";
import { accountKind } from "@/lib/admin-data/accounts";
import { reasonText } from "@/app/admin/_ui/reasons";

// POST /api/stripe/subscription/cancel
// Schedules the paid plan to end at the period boundary (cancel_at_period_end),
// so paid features stay active until the displayed billing-period end. Records
// the (optional) reason. Does NOT downgrade now — the webhook flips the account
// to Free when Stripe actually ends the subscription at the period end.
export async function POST(req: NextRequest) {
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

  // A delegated billing_admin cancels the OWNER's subscription, not their own.
  const subjectId = await resolveBillingSubjectId(user.id);

  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 120) : "";
  const comment = typeof body.comment === "string" ? body.comment.slice(0, 1000) : "";

  const admin = getAdminSupabase();
  const { data: profile } = await admin
    .from("profiles")
    .select("plan, stripe_subscription_id, customization")
    .eq("id", subjectId)
    .single();

  if (!profile?.stripe_subscription_id) {
    return NextResponse.json({ error: "No active paid subscription to cancel." }, { status: 400 });
  }

  let periodEnd: string | null = null;
  try {
    const sub = (await getStripe().subscriptions.update(profile.stripe_subscription_id, {
      cancel_at_period_end: true,
      cancellation_details: reason ? { comment: `${reason}${comment ? ` — ${comment}` : ""}`.slice(0, 500) } : undefined,
    })) as Stripe.Subscription;
    periodEnd = subscriptionPeriodEndIso(sub);
  } catch {
    return NextResponse.json({ error: "Couldn't schedule the cancellation. Please try again." }, { status: 502 });
  }

  // Mirror the scheduled-cancel state so the UI shows "cancels on <date>" and the
  // Keep Subscription button without a Stripe round-trip. plan_expires_at is left
  // untouched (that field means app-grant expiry; a real subscriber keeps access
  // via plan + stripe_subscription_id until the webhook deletes it at period end).
  // Only these keys (lib/customization-merge, audit B-03): the webhook this
  // cancel fires writes its own mirror of the same state alongside.
  await mergeCustomization(subjectId, {
    set: { _cancelAtPeriodEnd: true, _cancelAt: periodEnd, _cancelReason: reason || null },
    remove: [],
  });

  // The admin's notification center: the reason in the words they tapped.
  // The webhook this fires uses the same key, so it's one notification.
  const email = await getAccountEmail(subjectId, user.email ?? null);
  if (email && accountKind(email) === "customer") {
    const plan = profile.plan === "enterprise" ? "Office" : "Pro";
    const ends = periodEnd ? new Date(periodEnd).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "long", day: "numeric", year: "numeric" }) : null;
    await notifyAdmin({
      kind: "leaving",
      title: "A customer is cancelling",
      body: `${email}'s ${plan} ends${ends ? ` ${ends}` : " at the end of the period"}. Why: "${reasonText(reason, profile.plan as string | null)}"${comment ? ` In their words: "${comment}"` : ""}`,
      href: `/admin/users/${subjectId}`,
      dedupeKey: cancelKey(profile.stripe_subscription_id as string),
      meta: { reason: reason || null },
    });
  }

  return NextResponse.json({ ok: true, cancelAt: periodEnd });
}
