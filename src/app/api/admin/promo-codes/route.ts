import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { requireAdmin } from "@/lib/admin";
import {
  MAX_FREE_DAYS, isFreeDays, isDiscountType, isAppliesTo, isIntervalTarget,
  isPromoDuration, isAudience, MAX_DURATION_MONTHS, type AppliesTo, type IntervalTarget,
} from "@/lib/promo";
import { appleOfferPlan, deactivateAppleOffer, mirrorPromoToApple } from "@/lib/apple-offer-codes";

// The Stripe PRODUCTS behind each plan, so a coupon can be restricted to the
// plan it was created for. Without this, a code typed on Stripe's own checkout
// page (allow_promotion_codes) applies to whatever is in the basket — an
// "Office launch" code would happily take 50% off a Pro subscription.
async function productIdsFor(applies: AppliesTo, interval: IntervalTarget): Promise<string[]> {
  if (applies === "any" && interval === "any") return [];
  const ids = [
    { plan: "pro" as const, interval: "monthly" as const, price: process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID || process.env.STRIPE_PRICE_ID },
    { plan: "pro" as const, interval: "annual" as const, price: process.env.NEXT_PUBLIC_STRIPE_ANNUAL_PRICE_ID },
    { plan: "office" as const, interval: "monthly" as const, price: process.env.NEXT_PUBLIC_STRIPE_ENTERPRISE_PRICE_ID },
    { plan: "office" as const, interval: "annual" as const, price: process.env.NEXT_PUBLIC_STRIPE_ENTERPRISE_ANNUAL_PRICE_ID },
  ].filter((r) => r.price && (applies === "any" || r.plan === applies));
  if (!ids.length) return [];
  const { getStripe } = await import("@/lib/stripe");
  const stripe = getStripe();
  const products = new Set<string>();
  for (const row of ids) {
    const price = await stripe.prices.retrieve(row.price as string);
    const product = typeof price.product === "string" ? price.product : price.product?.id;
    if (product) products.add(product);
  }
  // Monthly and annual usually share ONE product, so a per-interval coupon
  // restriction is not possible at Stripe. The plan restriction still is, and
  // the interval is enforced by our own checkout + redeem routes.
  return [...products];
}

// POST /api/admin/promo-codes — create a new promo code
export async function POST(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const {
    code,
    description,
    discount_percent,
    discount_type = "free_time",
    discount_amount,
    free_days,
    max_uses,
    expires_at,
    plan_target = "free",
    stripe_coupon_id,
    applies_to = "any",
    interval_target = "any",
    duration = "once",
    duration_months,
  } = body;

  if (!code) return NextResponse.json({ error: "code is required" }, { status: 400 });
  if (!isDiscountType(discount_type)) {
    return NextResponse.json({ error: "Unknown discount type." }, { status: 400 });
  }
  if (!isAppliesTo(applies_to)) return NextResponse.json({ error: "Pick the plan this code is for." }, { status: 400 });
  if (!isIntervalTarget(interval_target)) return NextResponse.json({ error: "Pick the billing period this code is for." }, { status: 400 });
  if (!isAudience(plan_target)) return NextResponse.json({ error: "Pick who can redeem this code." }, { status: 400 });
  if (!isPromoDuration(duration)) return NextResponse.json({ error: "Pick how long the discount lasts." }, { status: 400 });
  if (duration === "repeating" && !(Number(duration_months) >= 1 && Number(duration_months) <= MAX_DURATION_MONTHS)) {
    return NextResponse.json({ error: `A repeating discount runs for 1–${MAX_DURATION_MONTHS} months.` }, { status: 400 });
  }
  if (max_uses != null && max_uses !== "" && !(Number(max_uses) >= 1 && Number(max_uses) <= 100000)) {
    return NextResponse.json({ error: "Total redemptions must be 1 or more." }, { status: 400 });
  }
  if (expires_at && Number.isNaN(new Date(expires_at).getTime())) {
    return NextResponse.json({ error: "That expiry date isn't a real date." }, { status: 400 });
  }
  if (expires_at && new Date(expires_at) <= new Date()) {
    return NextResponse.json({ error: "That expiry date is in the past." }, { status: 400 });
  }
  // A code is typed by a person: keep it to letters, numbers, dashes.
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{1,39}$/.test(String(code).trim())) {
    return NextResponse.json({ error: "Codes can use letters, numbers and dashes (2–40 characters)." }, { status: 400 });
  }

  const isFreeTime = discount_type === "free_time";

  // ── Validate the offer BEFORE anything is created ───────────────────────────
  // A typo'd value (150%, negative, a 9-month "free trial") must never persist
  // locally even when Stripe rejects it — that leaves an over-generous or broken
  // code sitting in promo_codes looking legitimate.
  if (isFreeTime) {
    if (!isFreeDays(Number(free_days))) {
      return NextResponse.json(
        { error: `Free time must be a whole number of days, 1–${MAX_FREE_DAYS}.` },
        { status: 400 },
      );
    }
  } else {
    if (!discount_percent && !discount_amount) {
      return NextResponse.json({ error: "discount_percent or discount_amount required" }, { status: 400 });
    }
    if (discount_percent != null && !(Number(discount_percent) > 0 && Number(discount_percent) <= 100)) {
      return NextResponse.json({ error: "discount_percent must be between 1 and 100" }, { status: 400 });
    }
    if (discount_amount != null && !(Number(discount_amount) > 0 && Number(discount_amount) <= 100_00)) {
      return NextResponse.json({ error: "discount_amount must be 1–10000 cents ($100 max)" }, { status: 400 });
    }
  }

  const cleanCode = String(code).toUpperCase().trim();

  // Codes are typed by people and matched exactly — a second row with the same
  // string would make "which one applies?" luck of the draw.
  {
    const { data: clash } = await getAdminSupabase()
      .from("promo_codes").select("id, active").eq("code", cleanCode).maybeSingle();
    if (clash) {
      return NextResponse.json(
        { error: clash.active ? "That code already exists." : "That code exists already (deactivated). Pick another string — reusing it would let past redeemers back in." },
        { status: 409 },
      );
    }
  }

  // ── Make the code real in Stripe ────────────────────────────────────────────
  // percent/fixed → a Stripe coupon + promotion code, so it can also be typed on
  // Stripe's own checkout page (allow_promotion_codes).
  //
  // free_time → NO coupon. Free time is a trial (trial_period_days), and Stripe
  // coupons can't express it: their duration is whole months only, so "one week
  // free" is not a coupon anyone can build. The checkout route resolves the code
  // to a trial instead. That also means a free-time code can't be typed on
  // Stripe's page — it's redeemed in the SwiftCard promo box on /pricing, which
  // is where the plan/expiry/usage rules can actually be enforced.
  let couponId: string | null = stripe_coupon_id ?? null;
  let stripeWarning: string | null = null;
  if (!isFreeTime && !couponId) {
    try {
      const { getStripe } = await import("@/lib/stripe");
      const stripe = getStripe();
      // The coupon carries the offer AND its plan restriction; the promotion
      // code carries the string people type, its cap and its expiry.
      const products = await productIdsFor(applies_to, interval_target);
      const coupon = await stripe.coupons.create({
        name: `SwiftCard ${cleanCode}`,
        duration,
        ...(duration === "repeating" ? { duration_in_months: Number(duration_months) } : {}),
        ...(products.length ? { applies_to: { products } } : {}),
        ...(discount_type === "fixed" && discount_amount
          ? { amount_off: Number(discount_amount), currency: "usd" }
          : { percent_off: Number(discount_percent) }),
      });
      await stripe.promotionCodes.create({
        promotion: { type: "coupon", coupon: coupon.id },
        code: cleanCode,
        ...(max_uses ? { max_redemptions: Number(max_uses) } : {}),
        ...(expires_at ? { expires_at: Math.floor(new Date(expires_at).getTime() / 1000) } : {}),
        // "New accounts only" is enforced on Stripe's own page too — otherwise a
        // code meant for new customers works there for anyone.
        ...(plan_target === "free" ? { restrictions: { first_time_transaction: true } } : {}),
      });
      couponId = coupon.id;
    } catch (e) {
      // Still save the code, but be honest that it isn't redeemable at checkout.
      stripeWarning = `Code saved, but Stripe rejected it (${e instanceof Error ? e.message : e}) — it won't work at checkout.`;
    }
  }

  const admin = getAdminSupabase();
  const row = {
    code: cleanCode,
    description,
    discount_percent: isFreeTime ? null : (discount_percent ? Number(discount_percent) : null),
    discount_type,
    discount_amount: isFreeTime ? null : (discount_amount ? Number(discount_amount) : null),
    free_days: isFreeTime ? Number(free_days) : null,
    max_uses: max_uses ? Number(max_uses) : null,
    expires_at: expires_at || null,
    plan_target,
    stripe_coupon_id: couponId,
    applies_to,
    interval_target,
    duration: isFreeTime ? "once" : duration,
    duration_months: !isFreeTime && duration === "repeating" ? Number(duration_months) : null,
  };
  let { data, error } = await admin.from("promo_codes").insert(row).select().single();

  // The four targeting columns arrive in supabase/promo-targeting.sql. Before
  // it runs, save what the old schema holds rather than refusing the code, and
  // say plainly which part isn't being enforced yet.
  if (error && /applies_to|interval_target|duration_months|duration|column/i.test(error.message)) {
    const { applies_to: _a, interval_target: _i, duration: _d, duration_months: _m, ...legacy } = row;
    void _a; void _i; void _d; void _m;
    ({ data, error } = await admin.from("promo_codes").insert(legacy).select().single());
    if (!error) {
      stripeWarning = "Saved, but the plan/billing-period options need supabase/promo-targeting.sql run first (Supabase → SQL Editor). Until then this code works on any plan.";
    }
  }

  if (error) {
    // The free_days column + the widened discount_type CHECK arrive in
    // supabase/promo-free-time.sql. Say so rather than surfacing raw Postgres.
    if (isFreeTime && /free_days|discount_type|check constraint/i.test(error.message)) {
      return NextResponse.json(
        { error: "Free-time codes need the promo-free-time.sql migration run first (Supabase → SQL Editor)." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // ── And on Apple, for the iPhone app ────────────────────────────────────────
  // A free-time Pro code is also made as an Apple offer code with the same
  // string, so it works on the Apple-billed subscription the app sells
  // (lib/apple-offer-codes). A failure doesn't block the code — the daily
  // cron retries it, and until then the app sends the code to swiftcard.me.
  let appleWarning: string | null = null;
  if (data && appleOfferPlan(data)) {
    const apple = await mirrorPromoToApple(data);
    if (!apple.ok) appleWarning = `Saved, but not on Apple yet (${apple.error}). In the iPhone app this code is used on swiftcard.me until it is; it's retried daily.`;
  }
  return NextResponse.json({ promo: data, stripeWarning, appleWarning });
}

// GET /api/admin/promo-codes — list ACTIVE promo codes (the working set the
// admin can send/manage). Deactivated codes live in the log endpoint.
export async function GET() {
  if (!await requireAdmin()) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = getAdminSupabase();
  const { data, error } = await admin
    .from("promo_codes")
    .select("*")
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ codes: data });
}

// DELETE /api/admin/promo-codes?id=<id> — deactivate a promo code EVERYWHERE.
//
// This is deliberately a SOFT delete (active=false), not a row delete:
// - every redemption path filters on active=true (redeem, checkout resolve),
//   so the code stops working for everyone the moment this lands;
// - promo_code_redemptions has ON DELETE CASCADE — a hard delete would wipe
//   who used the code AND drop the single-use guard, so recreating the same
//   string would let past redeemers use it again;
// - the row is the promo log ("what we sent, when, how long it was active").
export async function DELETE(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const admin = getAdminSupabase();

  // Kill the code on Stripe's own checkout page too. allow_promotion_codes
  // means a code typed at Stripe bypasses our DB entirely, so EVERY matching
  // active promotion code must be turned off — and a failure is reported, not
  // swallowed (a silently-still-working "deleted" code is the worst outcome).
  let stripeWarning: string | null = null;
  const { data: promo } = await admin.from("promo_codes").select("*").eq("id", id).maybeSingle();
  if (!promo) return NextResponse.json({ error: "Promo code not found" }, { status: 404 });

  // …and on Apple, where the iPhone app redeems it (lib/apple-offer-codes).
  // Otherwise a deactivated code kept working in the App Store.
  const appleError = await deactivateAppleOffer(promo.apple_offer_code_id as string | null | undefined);
  if (appleError) {
    stripeWarning = `Deactivated in SwiftCard, but Apple's copy is still on (${appleError}).`;
  }
  try {
    const { getStripe } = await import("@/lib/stripe");
    const stripe = getStripe();
    const list = await stripe.promotionCodes.list({ code: promo.code as string, limit: 100 });
    for (const pc of list.data) {
      if (pc.active) await stripe.promotionCodes.update(pc.id, { active: false });
    }
  } catch (e) {
    stripeWarning = [stripeWarning, `Deactivated in SwiftCard, but Stripe cleanup failed (${e instanceof Error ? e.message : e}). If this code has a Stripe coupon, disable it in the Stripe dashboard too.`].filter(Boolean).join(" ");
  }

  // Stamp when it was turned off (for the "how long was it active" log).
  // deactivated_at arrives with supabase/promo-deactivated-at.sql — fall back
  // to just active=false if the column isn't there yet.
  let { error } = await admin
    .from("promo_codes")
    .update({ active: false, deactivated_at: new Date().toISOString() })
    .eq("id", id);
  if (error && /deactivated_at/i.test(error.message)) {
    ({ error } = await admin.from("promo_codes").update({ active: false }).eq("id", id));
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, stripeWarning });
}
