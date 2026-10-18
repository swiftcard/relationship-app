import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { getStripe } from "@/lib/stripe";
import { PLAN_LIMITS } from "@/lib/plan";
import { priceIdForPlan, planFromPriceId, isUpgrade, DB_PLAN, type BillingPlan, type BillingInterval } from "@/lib/subscription";
import { provisionOfficeForOwner, tearDownOfficeForOwner } from "@/lib/office-billing-sync";
import { restorePendingSeatReduction } from "@/lib/office-scheduled-seats";
import type Stripe from "stripe";
import { officeSubUserBlockMessage, resolveBillingSubjectId } from "@/lib/office-roles";
import { mergeCustomization } from "@/lib/customization-merge";

// POST /api/stripe/subscription/change-plan { plan: "pro"|"office", interval, seats? }
// Switches an EXISTING paid subscription between Pro and Office (and between
// monthly/annual), prorated. Free→paid must go through checkout (card capture),
// and paid→Free is the Cancel flow — both are rejected here so each action stays
// separate and honest, exactly as required.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Office sub-users have no personal subscription to manage — billing is
  // the organization's. A delegated billing_admin passes through.
  const subBlocked = await officeSubUserBlockMessage(user.id, {
    unless: "manage_billing",
    message: "Billing for your account is managed by your organization.",
  });
  if (subBlocked) return NextResponse.json({ error: subBlocked }, { status: 403 });

  // A delegated billing_admin changes the OWNER's plan (and the OWNER's office),
  // not their own account. For the owner (or a plain user) subjectId === user.id.
  const subjectId = await resolveBillingSubjectId(user.id);

  const body = await req.json().catch(() => ({}));
  const targetPlan = body.plan as BillingPlan;
  const interval = (body.interval === "annual" ? "annual" : "monthly") as BillingInterval;
  if (targetPlan !== "pro" && targetPlan !== "office") {
    return NextResponse.json({ error: "To move to Free, cancel your subscription instead." }, { status: 400 });
  }

  const admin = getAdminSupabase();
  const { data: profile } = await admin
    .from("profiles")
    .select("plan, stripe_subscription_id")
    .eq("id", subjectId)
    .single();

  if (!profile?.stripe_subscription_id) {
    // No subscription to modify — this is a first-time purchase; the client
    // should send them through checkout (which captures a card).
    return NextResponse.json({ error: "needs_checkout", needsCheckout: true }, { status: 409 });
  }

  const targetPriceId = priceIdForPlan(targetPlan, interval);
  if (!targetPriceId) {
    return NextResponse.json({ error: "That plan isn't available right now." }, { status: 400 });
  }

  const wasOffice = profile.plan === "enterprise";
  const seatsProvided = body.seats != null && Number.isFinite(Number(body.seats));

  // Seats only matter for Office; resolved against Stripe's current quantity
  // inside the try below (needs the retrieved subscription). Function-scoped so
  // the later Office→Pro cascade can read it.
  let seats = 1;
  // Set inside the try (needs the retrieved subscription).
  let endsTrial = false;

  // Perform the swap on Stripe with proration.
  try {
    let sub = (await getStripe().subscriptions.retrieve(profile.stripe_subscription_id)) as Stripe.Subscription;
    if (!sub.items.data[0]) return NextResponse.json({ error: "Subscription has no billable item." }, { status: 400 });

    // When staying on Office and the caller didn't explicitly ask to change
    // seats, DEFAULT to the seats they've paid for — never to the plan minimum.
    // The old code defaulted to 2, so an Office→Office call with seats omitted
    // slammed quantity down to 2 and the webhook trim loop deleted active
    // members. (billing audit #4)
    //
    // And a plan change never LOWERS seats (audit B-16). Swapped here, a
    // reduction applied at once with a prorated credit — months of seats back
    // on an annual plan — where the Team seats control keeps a removed seat
    // paid until the billing date (free only within 24 hours of adding it).
    // One rule for removing a seat, so this sends them there. Asked before a
    // pending reduction is touched below, so a refusal changes nothing.
    if (targetPlan === "office") {
      const { data: officeRow } = wasOffice
        ? await admin.from("offices").select("seats, scheduled_seats").eq("owner_id", subjectId).maybeSingle()
        : { data: null };
      const stripeQty = sub.items.data[0].quantity ?? PLAN_LIMITS.OFFICE_MIN_SEATS;
      // During a scheduled reduction Stripe already holds the lower count; the
      // seats they have paid for are the office's (lib/office-scheduled-seats).
      const paidQty = officeRow?.scheduled_seats != null ? Math.max(stripeQty, (officeRow.seats as number | null) ?? 0) : stripeQty;
      const requested = seatsProvided ? Math.floor(Number(body.seats)) : (wasOffice ? paidQty : PLAN_LIMITS.OFFICE_MIN_SEATS);
      seats = Math.max(PLAN_LIMITS.OFFICE_MIN_SEATS, requested);
      if (wasOffice && seats < paidQty) {
        return NextResponse.json(
          { error: "use_seats_control", message: `Your plan has ${paidQty} seats. To use fewer, lower them under Team seats in Plan and billing, then switch your plan here.` },
          { status: 409 },
        );
      }
    }

    // A pending seat reduction already sits in Stripe at the lower count (audit
    // B-01). A swap prorates against Stripe's count, so put the paid seats back
    // first, or the swap credits too little and re-charges seats already paid.
    if (wasOffice) sub = (await restorePendingSeatReduction(subjectId, sub)) ?? sub;
    const item = sub.items.data[0];
    if (!item) return NextResponse.json({ error: "Subscription has no billable item." }, { status: 400 });

    const current = planFromPriceId(item.price?.id);
    if (current && current.plan === targetPlan && current.interval === interval && targetPlan !== "office") {
      return NextResponse.json({ error: "You're already on that plan." }, { status: 400 });
    }

    // Upgrading = the customer gets a bigger plan the moment this returns, so
    // they're invoiced for it now (Stripe credits the unused part of the old
    // plan first). Without this the proration would sit on the NEXT invoice and
    // they'd have Office free until their billing date. Adding seats to an
    // existing Office plan counts as an upgrade for the same reason.
    // Downgrades/lateral moves keep create_prorations: the credit rides the next
    // invoice, so we never owe a cash refund.
    const addingSeats = targetPlan === "office" && seats > (item.quantity ?? 1);
    // Office has no free trial: a Pro trial moved up to Office ends now and is
    // charged (the /checkout review page quotes exactly this). Without it the
    // subscription stayed trialing and the office ran free until the Pro
    // trial's end date — with nothing telling the owner so.
    endsTrial = sub.status === "trialing" && targetPlan === "office" && !wasOffice;
    const upgrading = isUpgrade(current, { plan: targetPlan, interval }) || addingSeats;

    // Honour the timestamp the preview quoted from, so the amount we showed is
    // the amount we charge — Stripe prorates by the second, and re-deriving
    // "now" here would drift from the quote by however long the user took to
    // click. Ignore a stale/implausible value rather than trust the client.
    const clientDate = Math.floor(Number(body.prorationDate));
    const nowSec = Math.floor(Date.now() / 1000);
    const prorationDate =
      Number.isFinite(clientDate) && clientDate > nowSec - 15 * 60 && clientDate <= nowSec
        ? clientDate
        : undefined;

    // Idempotency key derived from the exact transition, so a network-level
    // retry of the same change can't double-apply (mirrors the seats route).
    // (billing audit #12)
    // …scoped to the moment (the quoted prorationDate, else the minute). Stripe
    // keeps keys for 24 hours, and the same transition made AGAIN later that
    // day (Office → Pro → Office) replayed the first response: nothing changed
    // on Stripe while the plan below was written anyway.
    const idempotencyKey = `change:${profile.stripe_subscription_id}:${item.price?.id}->${targetPriceId}:${seats}:${prorationDate ?? Math.floor(nowSec / 60)}`;
    await getStripe().subscriptions.update(profile.stripe_subscription_id, {
      items: [{ id: item.id, price: targetPriceId, quantity: seats }],
      proration_behavior: upgrading ? "always_invoice" : "create_prorations",
      // Without this, Stripe's default (allow_incomplete) applies the item
      // change and leaves an uncollectable proration invoice open — the plan
      // change went through and got written below even though nothing was
      // paid for it. error_if_incomplete makes Stripe reject the update
      // synchronously instead, so the catch below actually fires on a
      // decline (billing audit — this previously granted the upgrade for free).
      ...(upgrading ? { payment_behavior: "error_if_incomplete" as const } : {}),
      ...(prorationDate ? { proration_date: prorationDate } : {}),
      ...(endsTrial ? { trial_end: "now" as const } : {}),
      cancel_at_period_end: false, // switching plans clears any pending cancel
    }, { idempotencyKey });
  } catch (err) {
    // A declined card (or an invoice needing 3DS/SCA action) on the immediate
    // upgrade invoice must say so plainly — "try again" would just fail the
    // same way. error_if_incomplete can surface either as a card error or an
    // invoice/payment-intent-requires-action error, so both are treated the
    // same: the plan was NOT changed.
    const e = err as { code?: string; type?: string; message?: string };
    if (
      e?.type === "StripeCardError" ||
      e?.code === "card_declined" ||
      e?.code === "invoice_payment_intent_requires_action" ||
      e?.code === "subscription_payment_intent_requires_action"
    ) {
      return NextResponse.json(
        { error: "Your card was declined, so the plan wasn't changed. Update your payment method and try again." },
        { status: 402 }
      );
    }
    console.error("Stripe change-plan error:", e?.message ?? err);
    return NextResponse.json({ error: "Couldn't change your plan. Please try again." }, { status: 502 });
  }

  // Reflect the new plan immediately (the webhook also reconciles this).
  await admin.from("profiles").update({ plan: DB_PLAN[targetPlan] }).eq("id", subjectId);
  // Switching plans means the customer is staying: clear any pending-cancel
  // mirror. And when the trial is over, no "trial ends" banner or day-7
  // charge notice for it. Only these keys (lib/customization-merge, B-03).
  await mergeCustomization(subjectId, {
    set: {},
    remove: [
      "_cancelAtPeriodEnd", "_cancelAt", "_cancelReason",
      ...(endsTrial ? ["_trialEndsAt", "_trialChargeCents", "_trialChargeInterval"] : []),
    ],
  });

  if (targetPlan === "office") {
    await provisionOfficeForOwner(admin, subjectId, seats);
  } else if (wasOffice) {
    // Leaving Office → tear the office down: release every active member back
    // to their own plan, strip the office brand from their cards, notify them,
    // remove the office. Shared with the subscription.updated webhook so a
    // portal-initiated Office->Pro swap tears down the office too (billing audit).
    await tearDownOfficeForOwner(admin, subjectId);
  }

  return NextResponse.json({ ok: true, plan: targetPlan, interval, seats });
}

