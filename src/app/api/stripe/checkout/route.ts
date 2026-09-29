import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { isShellRequest } from "@/lib/shell-request";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { claimPromoUse } from "@/lib/promo-claim";
import { getAccountEmail } from "@/lib/account-email";
import { getStripe } from "@/lib/stripe";
import { PLAN_LIMITS, PLAN_PRICES, TRIAL_DAYS, isPaidPlan } from "@/lib/plan";
import { checkPromoForPurchase } from "@/lib/promo-check";
import { recordServerEvent } from "@/lib/server-events";
import { PLAN_CHOSEN_KEY } from "@/lib/welcome-email";
import { priceIdForPlan, type BillingInterval } from "@/lib/subscription";
import { officeSubUserBlockMessage } from "@/lib/office-roles";
import { isProTrialEligible } from "@/lib/trial-eligibility";
import { trialHistoryFor } from "@/lib/trial-ledger";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

// The Stripe prices we actually sell. Anything else is rejected so a crafted
// request can't check out against an arbitrary/mispriced Price.
const PRO_PRICE_IDS = [
  process.env.STRIPE_PRICE_ID,
  process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID,
  process.env.NEXT_PUBLIC_STRIPE_ANNUAL_PRICE_ID,
].filter(Boolean) as string[];
const OFFICE_PRICE_IDS = [
  process.env.NEXT_PUBLIC_STRIPE_ENTERPRISE_PRICE_ID,
  process.env.NEXT_PUBLIC_STRIPE_ENTERPRISE_ANNUAL_PRICE_ID,
].filter(Boolean) as string[];

// Expected unit_amount (cents) per configured price ID, so a Stripe Product
// mispriced in the dashboard (typo, forgot to update it, wrong catalog) can
// never silently charge someone something other than what /pricing showed them.
const EXPECTED_CENTS: Record<string, number> = {};
if (process.env.STRIPE_PRICE_ID) EXPECTED_CENTS[process.env.STRIPE_PRICE_ID] = PLAN_PRICES.PRO_MONTHLY_CENTS;
if (process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID) EXPECTED_CENTS[process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID] = PLAN_PRICES.PRO_MONTHLY_CENTS;
if (process.env.NEXT_PUBLIC_STRIPE_ANNUAL_PRICE_ID) EXPECTED_CENTS[process.env.NEXT_PUBLIC_STRIPE_ANNUAL_PRICE_ID] = PLAN_PRICES.PRO_ANNUAL_CENTS;
if (process.env.NEXT_PUBLIC_STRIPE_ENTERPRISE_PRICE_ID) EXPECTED_CENTS[process.env.NEXT_PUBLIC_STRIPE_ENTERPRISE_PRICE_ID] = PLAN_PRICES.OFFICE_MONTHLY_PER_SEAT_CENTS;
if (process.env.NEXT_PUBLIC_STRIPE_ENTERPRISE_ANNUAL_PRICE_ID) EXPECTED_CENTS[process.env.NEXT_PUBLIC_STRIPE_ENTERPRISE_ANNUAL_PRICE_ID] = PLAN_PRICES.OFFICE_ANNUAL_PER_SEAT_CENTS;

export async function POST(req: NextRequest) {
  // The shell sells via In-App Purchase only (3.1.1); the client gates are
  // belt, this is braces.
  if (isShellRequest(req)) return NextResponse.json({ error: "Not available in the app" }, { status: 403 });
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Office sub-users have no personal subscription to buy — billing is the
    // organization's. This includes a delegated billing_admin: their
    // manage_billing is for the TEAM's seats (Settings → Plan and billing),
    // and this route would have started a personal plan on their own profile.
    const subBlocked = await officeSubUserBlockMessage(user.id, {
      message: "Billing for your account is managed by your organization.",
    });
    if (subBlocked) return NextResponse.json({ error: subBlocked }, { status: 403 });

    const { data: profile } = await supabase
      .from("profiles")
      .select("email, username, plan, stripe_customer_id, stripe_subscription_id, customization")
      .eq("id", user.id)
      .single();

    if (!profile) return NextResponse.json({ error: "No profile" }, { status: 404 });

    // Duplicate-subscription guard: a paying customer must NOT start a second
    // checkout (that would create a duplicate subscription / double charge).
    // Send them to Billing to CHANGE their plan instead.
    if (isPaidPlan(profile.plan) && profile.stripe_subscription_id) {
      return NextResponse.json(
        { error: "already_subscribed", message: "You already have an active subscription. Change your plan in Settings → Plan and billing.", redirect: "/settings/flows?billing=1" },
        { status: 409 }
      );
    }

    const body = await req.json().catch(() => ({}));

    // ── Promo resolution (server-side, never the client's word) ───────────────
    // This used to read `couponId` straight out of the request body and hand it
    // to Stripe. Nothing checked it against promo_codes — and the id was visible
    // in the URL (/checkout?coupon=…), so anyone could lift one from a shared
    // link and apply it to their own purchase. Every guard the promo system has
    // (max_uses, expires_at, plan_target, one-redemption-per-user) was
    // bypassable; they only ever gated the /pricing box, not the charge.
    //
    // Now the client sends the CODE and the server re-derives everything. The
    // authoritative check is that THIS user holds a redemption row for it, which
    // /api/promo/redeem creates behind a UNIQUE(code_id, user_id) constraint.
    const promoCode: string | undefined =
      typeof body.promoCode === "string" && body.promoCode.trim()
        ? body.promoCode.toUpperCase().trim()
        : undefined;

    let couponId: string | undefined;
    // A code made in the Stripe dashboard rather than Admin → Marketing.
    let promotionCodeId: string | undefined;
    let promoFreeDays: number | undefined;
    // Carried into the Checkout Session metadata so the webhook can mark this
    // redemption spent once the customer actually completes checkout.
    let promoRedemptionId: string | null = null;
    // Resolve the price from EITHER an explicit priceId (legacy callers) OR a
    // {plan, interval} pair resolved server-side (the unified /checkout flow), so
    // the price↔plan mapping lives in one place (lib/subscription) and can't drift.
    const interval: BillingInterval = body.interval === "annual" ? "annual" : "monthly";
    let priceId: string;
    if (typeof body.priceId === "string" && body.priceId) {
      priceId = body.priceId;
    } else if (body.plan === "pro" || body.plan === "office") {
      const resolved = priceIdForPlan(body.plan, interval);
      if (!resolved) return NextResponse.json({ error: "That plan isn't available right now." }, { status: 400 });
      priceId = resolved;
    } else {
      priceId = process.env.STRIPE_PRICE_ID!;
    }

    // Only sell prices we actually offer.
    const isOffice = OFFICE_PRICE_IDS.includes(priceId);
    const isPro = PRO_PRICE_IDS.includes(priceId);
    if (!isOffice && !isPro) {
      return NextResponse.json({ error: "Unknown plan price." }, { status: 400 });
    }

    // ── Pro already paid for through the App Store ───────────────────────────
    // The guard above only knows Stripe subscriptions. An Apple subscriber has
    // no stripe_subscription_id, so /pricing → checkout sold them a SECOND,
    // Stripe-billed plan while Apple kept renewing Pro — and nothing told them
    // to cancel Apple.
    //   • Pro again: a pure duplicate. Refused.
    //   • Office: a real upgrade Apple can't sell (it has no team plans), so it
    //     is allowed — but only after the order page has told them that Office
    //     includes everything in Pro and that the Apple subscription is theirs
    //     to cancel (acknowledgeApple). We can't cancel an Apple subscription.
    const appleBacked =
      isPaidPlan(profile.plan) &&
      !profile.stripe_subscription_id &&
      ((profile.customization as Record<string, unknown> | null)?._planSource === "apple");
    if (appleBacked && isPro) {
      return NextResponse.json(
        { error: "already_subscribed", message: "You already have Pro through the App Store. Manage it in your Apple subscription settings.", redirect: "/settings/flows?billing=1" },
        { status: 409 },
      );
    }
    // ── Office without a Stripe subscription, buying Pro ─────────────────────
    // (A grant, or set by hand.) The guard at the top only sees Stripe
    // subscriptions, so this sold Pro as a new purchase, and the webhook then
    // wrote plan = "pro" — swapping the account OUT of Office (owner,
    // 2026-09-28). Office already includes all of Pro: nothing to sell.
    if (profile.plan === "enterprise" && !profile.stripe_subscription_id && isPro) {
      return NextResponse.json(
        { error: "Your account is on Office, which already includes everything in Pro.", officeCoversPro: true },
        { status: 409 },
      );
    }
    if (appleBacked && isOffice && body.acknowledgeApple !== true) {
      return NextResponse.json(
        {
          error: "apple_subscriber",
          appleSubscriber: true,
          message: "You pay for Pro through the App Store. Office includes everything in Pro, so once your team is set up, turn off auto-renew for SwiftCard Pro in your iPhone's Settings → your name → Subscriptions — otherwise Apple keeps billing you for Pro as well.",
        },
        { status: 409 },
      );
    }

    // Seats: Office is per-seat with a minimum; Pro is always a single seat.
    const requestedQty = typeof body.quantity === "number" ? Math.floor(body.quantity)
      : typeof body.seats === "number" ? Math.floor(body.seats) : 1;
    let quantity = 1;
    if (isOffice) {
      if (requestedQty < PLAN_LIMITS.OFFICE_MIN_SEATS) {
        return NextResponse.json(
          { error: `The Office plan requires at least ${PLAN_LIMITS.OFFICE_MIN_SEATS} seats.` },
          { status: 400 }
        );
      }
      quantity = requestedQty;
    }

    // The promo is resolved HERE, after the plan and billing period are known:
    // a code carries the plan it is for, so it cannot be judged before then.
    //
    // NOT SILENT ANY MORE. A code that didn't apply used to be dropped and the
    // purchase went ahead at full price — after /pricing or the order page had
    // shown the discount. Now the order page is told why (409 promoUnusable)
    // and offers "Continue without the code". Same rules as the box on that
    // page, from one place (lib/promo-check).
    if (promoCode) {
      const check = await checkPromoForPurchase({
        code: promoCode,
        userId: user.id,
        accountPlan: (profile.plan as string | null) ?? "free",
        purchase: { plan: isOffice ? "office" : "pro", interval },
      });
      if (!check.ok) {
        return NextResponse.json({ error: check.reason, promoUnusable: true, ...(check.grant ? { grant: true } : {}) }, { status: 409 });
      }
      if (check.source === "stripe") {
        // Made in the Stripe dashboard: Stripe itself enforces its rules.
        promotionCodeId = check.promotionCodeId;
      } else {
        // Claim it for this account now — the authoritative single-use guard
        // is UNIQUE(code_id, user_id) — unless they already hold an unspent
        // claim (typed on /pricing, then left Stripe without paying). The cap
        // and audience were checked above for a new claim.
        let redemption = check.redemption;
        if (!redemption) {
          const admin = getAdminSupabase();
          const { data: inserted } = await admin
            .from("promo_code_redemptions")
            .insert({ code_id: check.promo.id, user_id: user.id })
            .select("id, consumed_at")
            .maybeSingle();
          if (inserted) {
            // Atomic, under the cap (lib/promo-claim); losing the race for
            // the last use undoes the claim rather than exceeding max_uses.
            if (await claimPromoUse(admin, check.promo.id as string)) {
              redemption = { id: inserted.id as string, consumed_at: null };
            } else {
              await admin.from("promo_code_redemptions").delete().eq("id", inserted.id);
            }
          }
        }
        if (!redemption) {
          return NextResponse.json({ error: "We couldn't apply that code just now. Try again, or continue without it.", promoUnusable: true }, { status: 409 });
        }
        // consumed_at is marked by the webhook when checkout completes, so one
        // claim pays out once — a code can't be re-applied on every re-subscribe.
        promoRedemptionId = redemption.id;
        if (check.freeDays) promoFreeDays = check.freeDays;
        else if (check.couponId) couponId = check.couponId;
      }
    }

    const stripe = getStripe();

    // ── The webhook gap: a checkout that already went through ────────────────
    // The paid-plan guard above reads `plan` / `stripe_subscription_id`, which
    // only exist once Stripe's webhook has run — seconds after payment, longer
    // on a slow delivery. A second checkout in that gap (another tab, Back from
    // "Setting up…", a double-tapped plan button on a different page) created a
    // SECOND subscription, and the webhook then cancelled the first outright:
    // no proration, no refund — a no-trial buyer paid twice. So ask Stripe
    // directly: did this account complete a subscription checkout in the last
    // hour that is still alive? If so, send them to wait for it instead.
    try {
      const accountEmail = await getAccountEmail(user.id, profile.email as string | null);
      const recent = await stripe.checkout.sessions.list({
        status: "complete",
        created: { gte: Math.floor(Date.now() / 1000) - 3600 },
        limit: 10,
        ...(profile.stripe_customer_id
          ? { customer: profile.stripe_customer_id as string }
          : accountEmail ? { customer_details: { email: accountEmail } } : {}),
      });
      for (const s of recent.data) {
        if (s.client_reference_id !== user.id || s.mode !== "subscription" || !s.subscription) continue;
        const sub = typeof s.subscription === "string" ? await stripe.subscriptions.retrieve(s.subscription) : s.subscription;
        if (["active", "trialing", "past_due", "incomplete"].includes(sub.status)) {
          return NextResponse.json(
            {
              error: "already_subscribed",
              message: "Your subscription is already going through — one moment while we set it up.",
              redirect: `/checkout/success?plan=${(s.metadata?.seats ? "office" : "pro")}&session_id=${s.id}`,
            },
            { status: 409 },
          );
        }
      }
    } catch (e) {
      // Never block a purchase on this lookup; the webhook's supersede logic is
      // still there behind it.
      console.error("[checkout] recent-session check failed:", e instanceof Error ? e.message : e);
    }

    // Opt-in Pro trial (TRIAL_DAYS) for FIRST-TIME subscribers only. The card is
    // collected at checkout and Stripe bills automatically when the trial ends
    // unless they cancel. Eligibility lives in lib/trial-eligibility — the SAME
    // helper the /upgrade page uses to decide whether to advertise the trial —
    // so the promise on the button and the session created here cannot drift:
    // a customer who has ever had a subscription (active, canceled, or
    // trialing) gets no second trial.
    //
    // `trial: false` opts OUT (the ineligible-user path on /upgrade sends it so
    // its "billing starts today" copy matches the session). Only ever narrows —
    // a client asking for a trial it isn't entitled to is still refused by the
    // eligibility check, so this flag can't be abused to mint one.
    const trialAllowed = body.trial !== false;
    let trialDays: number | undefined;
    if (
      isPro &&
      trialAllowed &&
      (await isProTrialEligible(
        profile.stripe_customer_id as string | null,
        stripe,
        await trialHistoryFor(user.id, user.email),
      ))
    ) {
      trialDays = TRIAL_DAYS;
    }

    // ── Free-time promo → a trial, not a coupon ──────────────────────────────
    // "One week free" cannot be a Stripe coupon (coupon duration is whole months
    // only), so a free-time code buys trial days instead. It applies to BOTH Pro
    // and Office — an Office buyer given a free month should get one.
    //
    // It overrides the standard 14-day Pro trial rather than stacking: the two
    // are the same mechanism, and Stripe takes a single trial_period_days. Max()
    // so a code can only ever be at least as good as what they'd have had — a
    // one-week code must never quietly shorten someone's 14-day trial.
    if (promoFreeDays) {
      trialDays = Math.max(trialDays ?? 0, promoFreeDays);
    }

    // Verify the real Stripe Price still matches what /pricing shows before
    // charging anyone — catches a mispriced or archived Product in the dashboard.
    const expectedCents = EXPECTED_CENTS[priceId];
    if (expectedCents !== undefined) {
      const price = await stripe.prices.retrieve(priceId);
      if (!price.active || price.currency !== "usd" || price.unit_amount !== expectedCents) {
        console.error("Stripe price mismatch:", { priceId, expectedCents, unitAmount: price.unit_amount, currency: price.currency, active: price.active });
        return NextResponse.json({ error: "This plan's price is temporarily unavailable. Please try again shortly or contact support." }, { status: 409 });
      }
    }

    // Post-payment landing. A caller may pass an explicit same-origin successPath
    // (the legacy /welcome flow does); otherwise route through /checkout/success,
    // which enforces card creation before the dashboard/office (spec §3).
    const planKey = isOffice ? "office" : "pro";
    const rawSuccess = typeof body.successPath === "string" ? body.successPath : "";
    const successPath =
      rawSuccess.startsWith("/") && !rawSuccess.startsWith("//") && /^\/[a-zA-Z0-9?=&_.\-/]*$/.test(rawSuccess)
        ? rawSuccess
        : `/checkout/success?plan=${planKey}`;
    // Cancel returns to the checkout page with the SAME selection preserved, so a
    // canceled/abandoned checkout can be retried without re-choosing (spec §1).
    // A brand-new account paying from /welcome goes BACK to /welcome on cancel:
    // its card isn't live yet, and /checkout ("Review your order", no Free
    // option) stranded it there (2026-09-16 website audit).
    // Both carry the selection (plan, interval, seats, promo): /welcome used to
    // get a bare ?canceled=1 and reopened on a reset chooser — Pro tab on a
    // phone, 2 seats, monthly, promo gone — for someone who had picked Office.
    const selection = `plan=${planKey}&interval=${interval}${isOffice ? `&seats=${quantity}` : ""}${promoCode && /^[A-Z0-9_-]{1,40}$/.test(promoCode) ? `&promo=${promoCode}` : ""}`;
    const cancelPath = successPath.startsWith("/welcome")
      ? `/welcome?${selection}&canceled=1`
      : `/checkout?${selection}&canceled=1`;

    // Reuse the existing Stripe customer so re-subscribing doesn't create
    // duplicates — and re-sync its email to the AUTH signup email, since a
    // customer created earlier while profiles.email held a card contact address
    // would otherwise show the wrong email on Stripe's portal/invoices forever.
    if (profile.stripe_customer_id) {
      const authEmail = await getAccountEmail(user.id, profile.email as string | null);
      if (authEmail) {
        try { await stripe.customers.update(profile.stripe_customer_id as string, { email: authEmail }); }
        catch { /* never block checkout on the email sync */ }
      }
    }

    const session = await stripe.checkout.sessions.create({
      client_reference_id: user.id,
      // A NEW customer is registered under the account's AUTH email — the
      // address they signed up with — never profiles.email, which drifts to
      // the card's public contact email (see lib/account-email).
      ...(profile.stripe_customer_id
        ? { customer: profile.stripe_customer_id as string }
        : { customer_email: await getAccountEmail(user.id, profile.email as string | null) ?? undefined }),
      line_items: [{ price: priceId, quantity }],
      mode: "subscription",
      // First-time Pro subscribers start with a free trial, then auto-bill.
      // payment_method_collection "always" is Stripe's subscription-mode
      // default, but it's load-bearing here: the card MUST be collected during
      // a trial checkout so billing starts automatically when the trial ends —
      // pinned explicitly so a future Stripe default change can't loosen it.
      payment_method_collection: "always",
      ...(trialDays ? { subscription_data: { trial_period_days: trialDays } } : {}),
      // Record the seat count so the webhook provisions the office reliably,
      // and the redemption so it can be marked spent on completion. Consumed
      // there rather than here on purpose: a customer who opens Checkout and
      // walks away has had nothing, and must not lose their code for it.
      metadata: {
        ...(isOffice ? { seats: String(quantity) } : {}),
        ...(promoRedemptionId ? { promo_redemption_id: promoRedemptionId } : {}),
      },
      // ALWAYS through /checkout/success, carrying the caller's destination as
      // `next` and Stripe's session id. Stripe redirects the buyer here the
      // instant they pay, usually BEFORE the webhook has set their plan — and
      // /office/admin sent anyone not yet on Office to /pricing (in the app:
      // /pricing → /dashboard → /welcome, the plan chooser again). The success
      // page holds them on "Setting up…" until the plan has landed.
      success_url: `${APP_URL}/checkout/success?plan=${planKey}${successPath.startsWith("/checkout/success") ? "" : `&next=${encodeURIComponent(successPath)}`}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}${cancelPath}`,
      // Every code is entered in SwiftCard's box on the order page and applied
      // here. Stripe's own "Add promotion code" field is OFF: it could only
      // ever take money-off codes, so a free-time code typed there was always
      // "invalid" (owner report 2026-09-23), and one entry point is one set of
      // rules (plan, billing period, audience, once per account).
      ...(couponId
        ? { discounts: [{ coupon: couponId }] }
        : promotionCodeId
          ? { discounts: [{ promotion_code: promotionCodeId }] }
          : {}),
    }, {
      // Idempotency: a double-click (or a retried request) within the same minute
      // returns the SAME Checkout Session instead of creating a duplicate.
      // Every parameter that can differ between two clicks is part of the key.
      // Stripe rejects a reused key whose parameters changed, so cancelling out
      // of a /welcome checkout (which sets its own success page) and pressing
      // "Continue" on /checkout within the minute showed a raw Stripe error
      // (2026-09-16 website audit).
      idempotencyKey: `checkout:${user.id}:${priceId}:${quantity}:${createHash("sha256").update(JSON.stringify([successPath, trialDays ?? 0, couponId ?? "", promotionCodeId ?? "", promoRedemptionId ?? ""])).digest("hex").slice(0, 16)}:${Math.floor(Date.now() / 60000)}`,
    });

    // "Picked a plan" in the admin funnel, for a new account whose first
    // choice is paid (the Free choice is counted in /api/account/choose-plan).
    // Only while no plan has been settled for the account. The plan-chosen
    // marker is written after payment, so someone who opens Stripe, backs out
    // and opens it again is counted twice — rare, and on the generous side of
    // a step that read 0 before.
    if (!(profile.customization as Record<string, unknown> | null)?.[PLAN_CHOSEN_KEY]) {
      await recordServerEvent("plan_selected", { plan: planKey }, { path: "/checkout", email: user.email });
    }

    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Stripe checkout error:", message);
    // A code made in the Stripe dashboard carries its own rules (first-time
    // customers only, a minimum amount…) that only Stripe can judge, at this
    // moment. Its refusal is about the CODE, so the order page offers
    // "Continue without the code" instead of a dead end.
    if ((err as { type?: string } | null)?.type === "StripeInvalidRequestError" && /promotion code|coupon/i.test(message)) {
      return NextResponse.json({ error: `That code can't be used for this purchase: ${message}`, promoUnusable: true }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
