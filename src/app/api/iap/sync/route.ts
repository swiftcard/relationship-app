import { NextResponse, after } from "next/server";
import { revalidateUserCards } from "@/lib/card-page-data";
import { sendWelcomeWhenCardLive, PLAN_CHOSEN_KEY } from "@/lib/welcome-email";
import { isOfficePlan } from "@/lib/plan";
import { appleGrantPatch, sandboxEventAllowed } from "@/lib/iap-entitlement";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { IAP_ENTITLEMENT } from "@/lib/iap-shared";
import { recordProTrialStarted } from "@/lib/trial-ledger";
import { mergeCustomization, writeCustomizationChanges } from "@/lib/customization-merge";

// ── Instant entitlement sync after an in-app purchase ───────────────────────
//
// The client calls this the moment StoreKit confirms a purchase, so Pro
// unlocks before the user's thumb leaves the button. The RevenueCat WEBHOOK
// (api/iap/revenuecat) is the durable source of truth; this is the low-latency
// mirror of it, and it re-verifies with RevenueCat's REST API rather than
// trusting the client's word — a spoofed fetch to this route grants nothing.
//
// Requires REVENUECAT_SECRET_KEY (the sk_ key, server-only). Without it this
// is a no-op and the webhook alone drives the plan — slower, still correct.

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // When the grant can't be applied right now (no server key, RevenueCat
  // down, a sandbox buyer not on the allow-list), the purchase still HAPPENED
  // in front of them. Record that a plan was chosen, so the dashboard stops
  // sending them back to "choose your plan" in a loop while the webhook
  // catches up (2026-09-16 audit). This grants nothing: the plan stays as it
  // is until RevenueCat confirms, and an account that has chosen a plan
  // without paying is exactly a Free account — which anyone can choose.
  const skipped = async (reason: string) => {
    try {
      const admin = getAdminSupabase();
      const { data: p } = await admin.from("profiles").select("customization").eq("id", user.id).maybeSingle();
      const cust = { ...((p?.customization as Record<string, unknown> | null) ?? {}) };
      if (!cust[PLAN_CHOSEN_KEY]) {
        await mergeCustomization(user.id, { set: { [PLAN_CHOSEN_KEY]: "pro_pending" }, remove: [] });
        await revalidateUserCards(user.id);
      }
    } catch { /* best-effort */ }
    return NextResponse.json({ ok: true, skipped: reason });
  };

  const secret = process.env.REVENUECAT_SECRET_KEY;
  if (!secret) return skipped("not_configured");

  let active = false;
  let introTrial = false;
  try {
    const r = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(user.id)}`, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
    });
    if (!r.ok) return skipped("rc_error");
    const d = await r.json();
    const ent = d?.subscriber?.entitlements?.[IAP_ENTITLEMENT];
    active = !!ent && (!ent.expires_date || new Date(ent.expires_date).getTime() > Date.now());
    // Same sandbox rule as the webhook: a $0 sandbox purchase (sandbox Apple ID
    // on the production build) unlocks Pro only for the review/test accounts.
    const backing = ent && d?.subscriber?.subscriptions?.[ent.product_identifier];
    introTrial = backing?.period_type === "trial";
    if (active && backing?.is_sandbox && !sandboxEventAllowed(user.email)) {
      return skipped("sandbox_not_allowed");
    }
  } catch {
    return skipped("rc_unreachable");
  }

  // The client only calls this once StoreKit itself reports the entitlement
  // active (purchaseIap / restoreIap), so "not active" here is RevenueCat's
  // REST view lagging the purchase — the same situation as the skips above,
  // and it gets the same treatment. Answering a bare "none" left a buyer whose
  // four polls all lagged with no plan recorded: "Your card is live!", then the
  // dashboard sent them back to Choose your plan. Still grants nothing.
  if (!active) return skipped("not_active_yet");

  const admin = getAdminSupabase();
  const { data: profile } = await admin
    .from("profiles")
    .select("plan, customization, office_id")
    .eq("id", user.id)
    .single();
  // Same rule as decideRcEvent: Apple only sells Pro, so an OFFICE plan (the
  // higher, Stripe-billed tier) is never overwritten by this grant.
  if (isOfficePlan(profile?.plan) || profile?.office_id) return NextResponse.json({ ok: true, applied: "none" });
  const customization = { ...((profile?.customization as Record<string, unknown> | null) ?? {}) };
  // The plan columns, then only the customization keys the grant changed
  // (lib/customization-merge, audit B-03).
  const grant = appleGrantPatch(customization);
  await admin
    .from("profiles")
    .update({ plan: grant.plan, plan_expires_at: grant.plan_expires_at })
    .eq("id", user.id);
  await writeCustomizationChanges(user.id, profile?.customization as Record<string, unknown> | null, grant.customization);
  // Same trial record as the RevenueCat webhook — whichever lands first.
  if (introTrial) await recordProTrialStarted(user.id, user.email ?? null);
  // Buying Pro in the app IS the plan choice: the cards go live now and the
  // "Your SwiftCard is live" email is finally true (it never went out for an
  // Apple purchase before).
  await revalidateUserCards(user.id);
  after(() => sendWelcomeWhenCardLive(user.id, user.email));
  return NextResponse.json({ ok: true, applied: "grant" });
}
