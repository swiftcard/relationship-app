import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { isRateLimited } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { officeSubUserBlockMessage } from "@/lib/office-roles";
import { checkPromoForPurchase, normalizePromoCode } from "@/lib/promo-check";
import { appleRedeemable } from "@/lib/apple-offer-codes";

// POST /api/promo/check — { code, plan, interval }
//
// The "Have a promo code?" box on the order page (/checkout). ASKS whether the
// code applies to this purchase and says what it gives — it records nothing and
// spends nothing; /api/stripe/checkout claims the code when the person actually
// continues to payment, under the same rules (lib/promo-check).
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Codes are short admin-typed strings, not secrets — cap the guessing.
  if (await isRateLimited(user ? `promo-check:${user.id}` : `promo-check-ip:${clientIp(req)}`, 20, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts — try again in a few minutes." }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const code = normalizePromoCode(body.code);
  if (!code) return NextResponse.json({ error: "Enter a code." }, { status: 400 });
  // No plan yet (the /welcome chooser's box): check everything but the fit,
  // which is settled when a plan is picked.
  const plan = body.plan === "office" ? "office" : body.plan === "pro" ? "pro" : null;
  const interval = body.interval === "annual" ? "annual" : "monthly";

  let accountPlan: string | null = null;
  if (user) {
    const blocked = await officeSubUserBlockMessage(user.id, {
      message: "Your plan comes with your team seat, so promo codes don't apply to your account. Ask your team admin about the team's plan.",
    });
    if (blocked) return NextResponse.json({ error: blocked }, { status: 403 });
    const { data: profile } = await getAdminSupabase().from("profiles").select("plan").eq("id", user.id).maybeSingle();
    accountPlan = (profile?.plan as string | null) ?? "free";
  }

  const result = await checkPromoForPurchase({ code, userId: user?.id ?? null, accountPlan, purchase: plan ? { plan, interval } : null });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason, ...(result.grant ? { grant: true } : {}) }, { status: 422 });
  }
  // For the iPhone app's Pro card: whether the code is for Pro at all, and
  // whether Apple can redeem it (the same string made as an Apple offer code,
  // lib/apple-offer-codes) — or it has to be used on swiftcard.me.
  const forPro = result.source === "stripe" || (result.promo.applies_to ?? "any") !== "office";
  const apple = result.source === "swiftcard" && appleRedeemable(result.promo);
  const annualOnly = result.source === "swiftcard" && result.promo.interval_target === "annual";
  return NextResponse.json({ ok: true, code, label: result.label, detail: result.detail, forPro, apple, annualOnly });
}
