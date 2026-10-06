import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { claimPromoUse } from "@/lib/promo-claim";
import { isRateLimited } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { promoLabel, scopeLabel, durationLabel, promoScopeMessage, promoSeats, isGrantCode, type PromoRow } from "@/lib/promo";
import { PLAN_CHOSEN_KEY, sendWelcomeWhenCardLive } from "@/lib/welcome-email";
import { revalidateUserCards } from "@/lib/card-page-data";
import { provisionOfficeForOwner } from "@/lib/office-billing-sync";
import { officeSubUserBlockMessage } from "@/lib/office-roles";

// What the person is shown about a code — one shape for the signed-in
// redemption and the signed-out preview, so /pricing describes a code the same
// way whichever one it got.
//
// NOTE: stripe_coupon_id is deliberately NOT returned. It used to be, and the
// client then handed it to /api/stripe/checkout, which passed it straight to
// Stripe unvalidated — so a coupon id lifted from the URL of a shared checkout
// link applied to anyone's purchase, bypassing max_uses, expiry, plan_target
// and the per-user single-use rule. Checkout now takes the CODE and re-resolves
// it server-side; the client never sees a Stripe id.
function promoPayload(promo: PromoRow & Record<string, unknown>) {
  return {
    code: promo.code,
    description: promo.description,
    discount_type: promo.discount_type,
    discount_percent: promo.discount_percent,
    discount_amount: promo.discount_amount,
    free_days: promo.free_days ?? null,
    applies_to: promo.applies_to ?? "any",
    interval_target: promo.interval_target ?? "any",
    duration: promo.duration ?? "once",
    duration_months: promo.duration_months ?? null,
    // The Office seat count the code fixes — /pricing locks its seat picker.
    seats: promoSeats(promo),
    // What to show the person: "30% off Pro only · the first 3 months".
    label: promoLabel(promo),
    scope: scopeLabel(promo),
    scope_message: promoScopeMessage(promo),
    duration_label: durationLabel(promo),
  };
}

// POST /api/promo/redeem — user redeems a promo code
//
// Signed OUT it only PREVIEWS the code. /pricing is where codes are typed, and
// most people typing one there have no account yet: this route used to answer
// them 401 and /pricing printed "Unauthorized" under the box, so no new
// customer could ever use a code. Now a visitor sees what the code is worth,
// the code rides the URL through the card builder and signup, and
// /api/stripe/checkout records the redemption for the new account — under the
// same rules as below — at the moment they buy.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Promo codes are short admin-typed strings, not high-entropy tokens —
  // cap guesses per account, or per address for a visitor with no account.
  if (await isRateLimited(user ? `promo-redeem:${user.id}` : `promo-preview:${clientIp(req)}`, 10, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts — try again in a few minutes." }, { status: 429 });
  }

  const { code } = await req.json();
  if (!code) return NextResponse.json({ error: "code required" }, { status: 400 });

  const admin = getAdminSupabase();

  // Look up code
  const { data: promo, error: promoErr } = await admin
    .from("promo_codes")
    .select("*")
    .eq("code", code.toUpperCase().trim())
    .eq("active", true)
    .single();

  if (promoErr || !promo) {
    return NextResponse.json({ error: "Invalid or expired promo code" }, { status: 404 });
  }

  // Check expiry
  if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
    return NextResponse.json({ error: "This promo code has expired" }, { status: 410 });
  }

  // Check uses cap
  if (promo.max_uses !== null && promo.uses_count >= promo.max_uses) {
    return NextResponse.json({ error: "This promo code has reached its usage limit" }, { status: 410 });
  }

  if (!user) {
    // A grant code switches a plan on for an ACCOUNT, and there isn't one yet.
    if (isGrantCode(promo)) {
      return NextResponse.json(
        { error: "Create your free account first, then enter this code again to switch it on." },
        { status: 401 },
      );
    }
    // "Accounts that already subscribe" — a visitor with no account isn't one.
    if (promo.plan_target === "pro") {
      return NextResponse.json({ error: "This code is for accounts that already subscribe." }, { status: 403 });
    }
    return NextResponse.json({ success: true, preview: true, promo: promoPayload(promo) });
  }

  // A TEAM MEMBER's plan is their company's seat. A grant code here used to
  // provision them an office of their OWN (resolveOfficeContext checks
  // ownership first, so they became an "owner" with the Admin console and
  // billing), and when the grant lapsed the expiry cron dropped the seat their
  // company pays for to Free. Checked before anything is recorded, so a
  // refused code is still unused.
  const subUserBlock = await officeSubUserBlockMessage(user.id, {
    message: "Your plan comes with your team seat, so promo codes don't apply to your account. Ask your team admin about the team's plan.",
  });
  if (subUserBlock) return NextResponse.json({ error: subUserBlock }, { status: 403 });

  // Check if user already redeemed it
  const { data: existing } = await admin
    .from("promo_code_redemptions")
    .select("id")
    .eq("code_id", promo.id)
    .eq("user_id", user.id)
    .single();

  if (existing) {
    return NextResponse.json({ error: "You have already used this promo code" }, { status: 409 });
  }

  // Which plan/period the code is FOR — told here, where the code is typed,
  // so nobody carries a code to checkout only to watch it not apply.
  // (plan_target below is a different question: who may redeem.)

  // Check plan_target eligibility
  if (promo.plan_target !== "all") {
    const { data: profile } = await admin
      .from("profiles")
      .select("plan")
      .eq("id", user.id)
      .single();

    const plan = (profile as { plan?: string } | null)?.plan ?? "free";
    if (promo.plan_target === "free" && plan !== "free") {
      return NextResponse.json({ error: "This code is for accounts that aren't subscribed yet." }, { status: 403 });
    }
    if (promo.plan_target === "pro" && plan === "free") {
      return NextResponse.json({ error: "This code is for accounts that already subscribe." }, { status: 403 });
    }
  }

  // Record the redemption. The UNIQUE(code_id, user_id) constraint is the
  // authoritative single-use guard: even under concurrent requests only ONE
  // insert can succeed, so a code can never be redeemed twice by the same user
  // (the pre-check above is a fast path; this closes the race window).
  const { error: redeemErr } = await admin
    .from("promo_code_redemptions")
    .insert({ code_id: promo.id, user_id: user.id });

  if (redeemErr) {
    if (redeemErr.code === "23505") {
      // Unique violation → already redeemed. Never hand out the reward twice.
      return NextResponse.json({ error: "You have already used this promo code" }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not redeem this code. Please try again." }, { status: 500 });
  }

  // Only now — after the redemption is durably recorded — bump the usage count,
  // so a duplicate/failed attempt can never inflate it.
  // Atomically, and under the cap: a lost race for the last use undoes this
  // account's redemption instead of going past max_uses.
  if (!(await claimPromoUse(admin, promo.id as string))) {
    await admin.from("promo_code_redemptions").delete().eq("code_id", promo.id).eq("user_id", user.id);
    return NextResponse.json({ error: "This promo code has reached its usage limit" }, { status: 410 });
  }

  // ── A GRANT code opens the plan right here ────────────────────────────────
  // No Stripe, no card, no subscription: the account is switched to the plan
  // for free_days days and the daily cron (expireFreeMonths) puts it back on
  // Free when the time is up. This is the tester path — see lib/promo.
  if (isGrantCode(promo)) {
    const days = Number(promo.free_days) > 0 ? Number(promo.free_days) : 14;
    const wantsOffice = promo.applies_to === "office";

    const { data: prof } = await admin
      .from("profiles")
      .select("plan, plan_expires_at, customization, stripe_subscription_id")
      .eq("id", user.id)
      .maybeSingle();

    // Never touch a REAL subscriber: their plan is Stripe's to set, and writing
    // plan_expires_at onto a paying account would have the cron downgrade
    // someone who is still being charged.
    if (prof?.stripe_subscription_id) {
      return NextResponse.json(
        { error: "This code only works on an account with no subscription." },
        { status: 409 },
      );
    }

    // A grant is a gift: it can only ever be at least what they already had
    // (same rule as the referral month — an Office account must not be
    // demoted to Pro by collecting one).
    const plan = wantsOffice || prof?.plan === "enterprise" ? "enterprise" : "pro";
    // Extend rather than replace, so two codes in a row add up.
    const base = Math.max(Date.now(), prof?.plan_expires_at ? new Date(prof.plan_expires_at as string).getTime() : 0);
    const until = new Date(base + days * 86400000).toISOString();

    const cust = { ...((prof?.customization as Record<string, unknown> | null) ?? {}) };
    // The plan step is settled by this, exactly as paying settles it — without
    // it a brand-new account is asked to choose a plan again on its next load.
    cust[PLAN_CHOSEN_KEY] = plan;
    // Not a Stripe trial: these keys drive the "your trial ends / you'll be
    // charged" copy and the day-7 charge notice, and nothing here will charge.
    delete cust._trial;
    delete cust._trialEndsAt;
    delete cust._trialChargeCents;
    delete cust._trialChargeInterval;
    delete cust._trialChargeWarnedFor;

    await admin
      .from("profiles")
      .update({ plan, plan_expires_at: until, customization: cust })
      .eq("id", user.id);

    // An Office account with no office row has an empty admin console and no
    // seats — the webhook provisions one on a real purchase, so a granted
    // Office gets the same treatment. As many seats as the code was made for
    // (lib/promo promoSeats); a code that names none keeps the old five.
    if (plan === "enterprise") {
      try {
        await provisionOfficeForOwner(admin, user.id, promoSeats(promo) ?? 5);
      } catch (e) {
        console.error("[promo] office provision failed for grant:", e);
      }
    }

    // The plan is settled, so the account's cards go live now and the
    // "Your SwiftCard is live" email is finally true — exactly what the Stripe
    // webhook and the App Store sync do at this moment. Without it a granted
    // account never got its welcome email, while the "Your card is live!"
    // screen told them "We also sent you an email with your link".
    await revalidateUserCards(user.id);
    after(() => sendWelcomeWhenCardLive(user.id, user.email));

    return NextResponse.json({
      success: true,
      granted: { plan, days, until },
      promo: { code: promo.code, description: promo.description, label: promoLabel(promo) },
    });
  }

  // (Never the Stripe coupon id — see promoPayload.)
  return NextResponse.json({ success: true, promo: promoPayload(promo) });
}
