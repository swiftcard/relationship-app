import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { getStripe } from "@/lib/stripe";
import { getAccountEmail } from "@/lib/account-email";
import { officeSubUserBlockMessage } from "@/lib/office-roles";
import { ledgerAdd } from "@/lib/trial-ledger";
import { TRIAL_ENDS_KEY } from "@/lib/billing-state";
import { TRIAL_EXTENDED_META_KEY } from "@/lib/trial-extension";
import { trialExtensionOfferFor } from "@/lib/trial-extension-server";

// POST /api/stripe/subscription/extend-trial
// The trial-stretch retention offer (lib/trial-extension): a 14-day Pro trial
// runs on, free, until a month from the day it started, and the first charge
// moves with it. Once per person. Called by Billing's cancel flow directly and
// by the delete flow in-process (api/account/retention), so both doors apply
// exactly the same thing.
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Office members have no personal trial to stretch — billing is the
  // organization's, and an Office subscription is never offered this.
  const subBlocked = await officeSubUserBlockMessage(user.id, {
    unless: "manage_billing",
    message: "Billing for your account is managed by your organization.",
  });
  if (subBlocked) return NextResponse.json({ error: subBlocked }, { status: 403 });

  const admin = getAdminSupabase();
  const { data: profile } = await admin
    .from("profiles")
    .select("plan, email, stripe_subscription_id, customization")
    .eq("id", user.id)
    .single();
  const subId = (profile?.stripe_subscription_id as string | null) ?? null;
  if (!profile || !subId) {
    return NextResponse.json({ error: "There's no trial on this account to extend." }, { status: 409 });
  }

  const cust = (profile.customization as Record<string, unknown> | null) ?? {};
  const stripe = getStripe();
  const [email, sub] = await Promise.all([
    getAccountEmail(user.id, (profile.email as string | null) ?? null),
    stripe.subscriptions.retrieve(subId).catch(() => null),
  ]);
  if (!sub) return NextResponse.json({ error: "Couldn't reach billing. Please try again." }, { status: 502 });

  const offer = await trialExtensionOfferFor({ plan: profile.plan as string | null, cust, sub, email });
  if (!offer) {
    return NextResponse.json({ error: "This offer isn't available on your account." }, { status: 409 });
  }

  const now = new Date().toISOString();
  try {
    // Accepting means staying: any scheduled cancel is lifted (none can be
    // pending — trialExtensionFor refuses a cancelled trial — but the flag is
    // set explicitly so the subscription's state is never left to chance).
    // No proration: nothing has been charged, the charge simply moves.
    await stripe.subscriptions.update(subId, {
      trial_end: offer.untilUnix,
      cancel_at_period_end: false,
      proration_behavior: "none",
      // Deterministic (the new end, not "now"): a racing second call must send
      // identical parameters, or Stripe rejects the reused idempotency key.
      metadata: { [TRIAL_EXTENDED_META_KEY]: offer.until },
    }, {
      // A double tap, or Billing and the delete flow racing, stretches it once.
      idempotencyKey: `trial-extend:${subId}:${offer.untilUnix}`,
    });
  } catch {
    return NextResponse.json({ error: "Couldn't extend your trial. Please try again." }, { status: 502 });
  }

  // Recorded only after Stripe accepted it. The ledger is what keeps it once
  // per PERSON after a delete and a new sign-up — and it is the same ledger
  // entry the Free plan's gift checks, so nobody gets both.
  await ledgerAdd("email_retention", email);

  // Re-read: the webhook for this very update may already have rewritten
  // customization, and the copy read above would undo it.
  const { data: fresh } = await admin.from("profiles").select("customization").eq("id", user.id).maybeSingle();
  const nextCust: Record<string, unknown> = { ...((fresh?.customization as Record<string, unknown> | null) ?? cust) };
  const rec = (nextCust._retention as Record<string, unknown> | undefined) ?? {};
  nextCust._retention = { ...rec, trialExtendedAt: now };
  // The new date at once, so the dashboard banner and the day-7 charge notice
  // (keyed to this date) don't wait on the webhook to catch up.
  nextCust[TRIAL_ENDS_KEY] = offer.until;
  delete nextCust._cancelAtPeriodEnd;
  delete nextCust._cancelAt;
  delete nextCust._cancelReason;
  await admin.from("profiles").update({ customization: nextCust }).eq("id", user.id);

  return NextResponse.json({ ok: true, until: offer.until, extraDays: offer.extraDays });
}
