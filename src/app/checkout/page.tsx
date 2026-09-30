import { Suspense } from "react";
import CheckoutClient from "./CheckoutClient";
import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { getOfficeSubUserContext } from "@/lib/office-roles";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { isProTrialEligible } from "@/lib/trial-eligibility";
import { trialHistoryFor } from "@/lib/trial-ledger";
import { giftBridgeTrialEnd, retentionGiftEndsAt } from "@/lib/billing-state";

// The single confirmation step between picking a plan and Stripe. It preserves
// the exact selection (plan, interval, seats) in the URL so it survives login,
// signup, OAuth, email verification, refresh, back/forward, and a canceled or
// failed checkout — the user never has to re-choose (spec §1). It shows the
// required pre-payment order summary, then continues to Stripe. A logged-out
// visitor is sent through account creation and auto-resumed here afterward.
//
// Trial eligibility is resolved HERE, with the same helper and history the
// checkout API enforces with, so the order summary can never promise a free
// trial the Stripe session will not create (a returning person, a second
// account, an email that has trialled before). Signed out → eligible, the
// same default the API applies to a brand-new account.
export const dynamic = "force-dynamic";

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { plan: wanted } = await searchParams;
  // A team member has nothing to buy here — their plan is the office's.
  {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user && (await getOfficeSubUserContext(user.id))) redirect("/dashboard");
  }
  let trialEligible = true;
  // On Office — however the account got it (Stripe, a grant, set by hand) — and
  // asking for Pro. Office already includes all of Pro, and with no Stripe
  // subscription to switch, checkout would have sold Pro as a NEW purchase and
  // the webhook would then have swapped the account from Office to Pro (owner,
  // 2026-09-28). A Stripe-billed Office still gets the priced "Switch to Pro".
  let officeCoversPro = false;
  // On the delete-flow gift: the SAME rule the checkout API applies
  // (lib/billing-state), so the summary says "free until {date}" exactly when
  // the Stripe session will trial to that date — and never offers a trial on top.
  let giftUntil: string | null = null;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await getAdminSupabase()
        .from("profiles")
        .select("plan, plan_expires_at, stripe_customer_id, stripe_subscription_id, customization")
        .eq("id", user.id)
        .maybeSingle();
      officeCoversPro = wanted !== "office" && profile?.plan === "enterprise" && !profile?.stripe_subscription_id;
      trialEligible = await isProTrialEligible(
        (profile?.stripe_customer_id as string | null) ?? null,
        undefined,
        await trialHistoryFor(user.id, user.email),
      );
      const giftEndsAt = retentionGiftEndsAt({
        plan: (profile?.plan as string | null) ?? null,
        planExpiresAt: (profile?.plan_expires_at as string | null) ?? null,
        hasSubscription: !!profile?.stripe_subscription_id,
        customization: (profile?.customization as Record<string, unknown> | null) ?? null,
      });
      if (giftEndsAt) {
        trialEligible = false;
        if (giftBridgeTrialEnd(giftEndsAt)) giftUntil = giftEndsAt;
      }
    }
  } catch {
    // Fail open, like the helper itself: the API still decides the session.
  }

  return (
    <main className="sc-app min-h-screen bg-gray-950 flex items-center justify-center px-5 py-12">
      <Suspense fallback={<div className="text-gray-500 text-sm">Loading…</div>}>
        <CheckoutClient trialEligible={trialEligible} officeCoversPro={officeCoversPro} giftUntil={giftUntil} />
      </Suspense>
    </main>
  );
}
