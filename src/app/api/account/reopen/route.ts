import { NextResponse } from "next/server";
import { deletionGraceOver } from "@/lib/deletion-grace";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { revalidateUserCards } from "@/lib/card-page-data";
import { deletedPlanOf, reopenPatch } from "@/lib/account-reopen";
import { isApplePaid } from "@/lib/iap-entitlement";
import { isPaidPlan } from "@/lib/plan";
import { rcProActive } from "@/lib/revenuecat-rest";
import { writeCustomizationChanges } from "@/lib/customization-merge";


export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminSupabase();
  const { data: profile } = await admin
    .from("profiles")
    .select("plan_expires_at, stripe_subscription_id, customization")
    .eq("id", user.id)
    .single();
  if (!profile) return NextResponse.json({ error: "No account" }, { status: 404 });

  const customization = (profile.customization as Record<string, unknown> | null) ?? {};
  const deletion = customization._deletion as { at?: string } | undefined;

  if (!customization._deleted) {
    return NextResponse.json({ ok: true }); // not deleted — nothing to do
  }

  // Enforce the 1-month reopen window.
  const at = deletion?.at ? new Date(deletion.at).getTime() : 0;
  const expired = !at || deletionGraceOver(at);
  if (expired) {
    return NextResponse.json({ error: "expired", message: "This account can no longer be reopened." }, { status: 410 });
  }

  // Restore the account. Its cards and contacts were kept, so they come back
  // as they were, and so does the plan it is still owed (lib/account-reopen): an
  // App Store subscription Apple kept billing, free Pro days still left, or a
  // subscription whose cancellation failed. RevenueCat is only asked about an
  // account that was paid through Apple.
  const appleActive =
    isApplePaid(customization) && isPaidPlan(deletedPlanOf(customization)) ? await rcProActive(user.id) : null;
  const patch = reopenPatch({
    customization,
    planExpiresAt: (profile.plan_expires_at as string | null) ?? null,
    hasSubscription: !!profile.stripe_subscription_id,
    appleActive,
  });
  // The plan first, then the flag that hides the account. If the second write
  // fails, the account is still marked deleted, and pressing Reopen again
  // works it out again from the same facts.
  if (Object.keys(patch.columns).length) {
    const { error } = await admin.from("profiles").update(patch.columns).eq("id", user.id);
    if (error) return NextResponse.json({ error: "Couldn't reopen your account. Please try again." }, { status: 500 });
  }
  // Only the keys that changed: _deleted/_deletion off, plus the plan's own
  // keys. A whole-object write would erase anything written in between.
  const merged = await writeCustomizationChanges(user.id, customization, patch.customization);
  if (merged === null) return NextResponse.json({ error: "Couldn't reopen your account. Please try again." }, { status: 500 });
  // The public card pages come back now, not a minute later.
  await revalidateUserCards(user.id);

  return NextResponse.json({ ok: true, restored: patch.restored });
}
