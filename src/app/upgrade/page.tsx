import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import UpgradeClient from "./UpgradeClient";
import { isPaidPlan } from "@/lib/plan";
import { isProTrialEligible } from "@/lib/trial-eligibility";
import { trialHistoryFor } from "@/lib/trial-ledger";
import { findPendingInviteForEmail } from "@/lib/pending-invite";
import { resolveOfficeContext, canSeeBilling } from "@/lib/office-roles";

export const metadata = { title: "Upgrade — SwiftCard" };

// The IN-PRODUCT upgrade screen, for someone already using SwiftCard on Free.
//
// Deliberately not /pricing: someone inside the product has already chosen
// SwiftCard, so the Free column they're already on isn't shown. The 14-day Pro
// trial IS offered here (owner decision, Aug 2026 — it previously was a
// marketing-site-only acquisition offer): every Pro entry point carries the
// same trial for FIRST-TIME subscribers. Eligibility is resolved server-side
// against Stripe's own subscription history — the same check the checkout API
// enforces — so a user who has ever subscribed before sees the honest
// start-and-pay button instead of a trial promise checkout would not honor.
export default async function UpgradePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/upgrade");

  const { data: profile } = await getAdminSupabase()
    .from("profiles")
    .select("plan, stripe_customer_id, stripe_subscription_id, plan_expires_at, customization")
    .eq("id", user.id)
    .maybeSingle();

  // Already paying → nothing to sell. Billing settings is where they change or
  // cancel a plan they already have.
  const plan = (profile?.plan as string) ?? "free";
  // A free-Pro GRANT (referral or retention days: an expiry, no subscription,
  // not Apple) is not paying — it ends on its own. Bouncing it to billing made
  // "Keep Pro" a loop with no way to actually subscribe.
  const onGrant =
    !!profile?.plan_expires_at &&
    !profile?.stripe_subscription_id &&
    (profile?.customization as { _planSource?: string } | null)?._planSource !== "apple";
  if (isPaidPlan(plan) && !onGrant) {
    // A team member's plan is their company's: there is no Billing section to
    // send them to (unless they still hold a personal subscription), so an old
    // "upgrade" link lands them on their dashboard, not an empty Settings page.
    const office = await resolveOfficeContext(user.id).catch(() => null);
    if (!canSeeBilling(office, profile?.stripe_subscription_id as string | null)) redirect("/dashboard");
    redirect("/settings/flows?billing=1#billing");
  }

  // Invited to a team: their seat is the plan, so there is nothing to sell.
  // An invitee with a Free card who built another through the site's builder
  // hit the one-card cap on claim and was sent HERE, to pay — the one thing a
  // team member is never asked to do. Join instead; accepting turns the card
  // they already have into their company card.
  if (!isPaidPlan(plan)) {
    const invite = await findPendingInviteForEmail(user.email, user.id);
    if (invite) redirect(`/join/${encodeURIComponent(invite.token)}`);
  }

  const trialEligible = await isProTrialEligible(
    profile?.stripe_customer_id as string | null,
    undefined,
    await trialHistoryFor(user.id, user.email),
  );

  return (
    <main className="min-h-screen bg-gray-950 px-5 py-12">
      {/* Arriving from a blocked card claim is a jarring jump unless we say why —
          and, crucially, that their card wasn't thrown away.

          `card-limit` is the same wall reached from the other side: a signed-in
          Free account at the cap, bounced here either by the builder's create
          call or by the guard on /cards/new?add=1. Both used to arrive with no
          `from` at all, so this banner never rendered and the person met a price
          grid with nothing explaining it (audit 2026-09-29). */}
      {(from === "claim" || from === "card-limit") && (
        <div className="max-w-4xl mx-auto mb-6">
          <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 px-4 py-3.5">
            <p className="text-amber-300 text-sm font-semibold">
              {from === "claim" ? "Your card is saved — Free covers one card" : "Free covers one card"}
            </p>
            <p className="text-amber-200/70 text-xs mt-0.5 leading-relaxed">
              {from === "claim"
                ? "You already have a card on this account. Nothing was lost: the one you just built is still here waiting, and it goes live as soon as you upgrade."
                : "You already have a card on this account, and Free includes one. Upgrade and you can add as many as you like — nothing you have built is affected either way."}
            </p>
          </div>
        </div>
      )}
      <UpgradeClient trialEligible={trialEligible} />
    </main>
  );
}
