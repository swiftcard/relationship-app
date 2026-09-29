import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { isProTrialEligible } from "@/lib/trial-eligibility";
import { trialHistoryFor } from "@/lib/trial-ledger";
import { getOfficeSubUserContext } from "@/lib/office-roles";

// Whether this SwiftCard ACCOUNT may still get a free Pro trial, for the iOS
// paywall (lib/iap). Apple decides intro-offer eligibility per Apple ID; this
// is the per-account half of the rule: one free Pro period per person — the
// 14-day trial OR a friend's referral month, never both, never twice
// (owner, 2026-09-17). The same helper the Stripe checkout enforces with.
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // No account yet → nothing on record.
  if (!user) return NextResponse.json({ eligible: true });
  // A team member is never sold a plan — their seat is the plan. Backstop for
  // any paywall that asks: Apple purchases can't be refused server-side, so
  // "not eligible" here is one more thing keeping a trial offer off their screen.
  // `teamMember` lets /pricing send them to their dashboard instead of reading
  // "not eligible" as "you already had your trial — billing starts today".
  if (await getOfficeSubUserContext(user.id)) {
    return NextResponse.json({ eligible: false, teamMember: true }, { headers: { "Cache-Control": "no-store" } });
  }
  const { data: profile } = await getAdminSupabase()
    .from("profiles")
    .select("plan, stripe_customer_id, stripe_subscription_id, plan_expires_at, customization")
    .eq("id", user.id)
    .maybeSingle();
  const eligible = await isProTrialEligible(
    (profile?.stripe_customer_id as string | null) ?? null,
    undefined,
    await trialHistoryFor(user.id, user.email),
  );
  // The plan the account is on, for /pricing: an Office account must not be
  // sold Pro as if it were new (buying it would swap Office for Pro), and a
  // paying account's own plan reads "Your current plan", not a purchase.
  // `onGrant` = free days that end on their own (no subscription, not Apple) —
  // the same test /upgrade uses — so a granted Pro can still subscribe to keep it.
  const plan = (profile?.plan as string | null) ?? "free";
  const onGrant =
    !!profile?.plan_expires_at &&
    !profile?.stripe_subscription_id &&
    (profile?.customization as { _planSource?: string } | null)?._planSource !== "apple";
  return NextResponse.json({ eligible, plan, onGrant }, { headers: { "Cache-Control": "no-store" } });
}
