import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { getStripe, subscriptionPeriodEndIso } from "@/lib/stripe";
import { PLAN_LIMITS } from "@/lib/plan";
import { planFromPriceId } from "@/lib/subscription";
import { getOfficeSeatUsage, computeSeatUsage } from "@/lib/office-seats";
import { writeAudit } from "@/lib/audit";
import { requireOfficeCapability } from "@/lib/office-roles";
import { reportError } from "@/lib/report-error";
import {
  SEAT_ADDS_KEY, paidSeats, parseSeatAdds, planSeatChange, seatRefundCents, serializeSeatAdds,
} from "@/lib/office-seat-plan";
import { createHash } from "node:crypto";
import type Stripe from "stripe";

// GET /api/stripe/subscription/seats — what the seat UI needs to offer "add a
// seat" and state the price before charging: current quantity, billing interval,
// the real per-seat unit_amount from Stripe, and live usage.
//
// Scoped by the SAME capability check as the POST (owner or billing_admin) and
// resolved through the office, not the caller's own profile — a billing_admin
// has no subscription of their own, so reading the caller's profile (as
// GET /api/stripe/subscription does) would report them as Free and hide the UI
// from someone the POST would happily authorize.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = await requireOfficeCapability(user.id, "manage_seats");
  if (!ctx) return NextResponse.json({ error: "You don't have permission to change seats." }, { status: 403 });

  const admin = getAdminSupabase();
  const { data: profile } = await admin
    .from("profiles")
    .select("plan, stripe_subscription_id")
    .eq("id", ctx.ownerId)
    .single();

  const { data: office } = await admin.from("offices").select("seats, scheduled_seats, scheduled_seats_at").eq("id", ctx.officeId).maybeSingle();
  const purchased = (office?.seats as number | null) ?? PLAN_LIMITS.OFFICE_MIN_SEATS;
  const usage = await getOfficeSeatUsage(ctx.officeId, purchased);
  const scheduledSeats = (office?.scheduled_seats as number | null | undefined) ?? null;

  const base = {
    seats: usage.purchased,
    usage,
    // A pending reduction: the count the next renewal bills (lib/office-seat-plan).
    scheduledSeats,
    scheduledSeatsAt: (office?.scheduled_seats_at as string | null | undefined) ?? null,
    interval: null as "monthly" | "annual" | null,
    perSeatCents: null as number | null,
    minSeats: PLAN_LIMITS.OFFICE_MIN_SEATS,
    // What one more seat actually costs TODAY (Stripe's own prorated figure for
    // the remainder of this billing period) and what the recurring total becomes.
    // Both null when Stripe can't quote — the UI then just omits the line rather
    // than guessing an amount someone is about to be charged.
    nextSeatProrationCents: null as number | null,
    nextSeatTotalCents: null as number | null,
    // False when the office has no Stripe subscription behind it (e.g. a plan
    // granted by hand) — there's nothing to bill, so the UI must not offer to.
    billable: profile?.plan === "enterprise" && !!profile.stripe_subscription_id,
  };
  if (!base.billable) return NextResponse.json(base);

  try {
    const stripe = getStripe();
    const sub = (await stripe.subscriptions.retrieve(profile!.stripe_subscription_id!)) as Stripe.Subscription;
    const item = sub.items.data[0];
    const mapped = planFromPriceId(item?.price?.id);
    if (!item || mapped?.plan !== "office") return NextResponse.json({ ...base, billable: false });
    // Stripe is authoritative for what they're paying for, except while a
    // reduction is pending: then Stripe already holds the lower count for the
    // next renewal and the team keeps the seats it paid for until then.
    const stripeQty = item.quantity ?? base.seats;
    base.seats = paidSeats(stripeQty, purchased, scheduledSeats);
    base.usage = { ...usage, ...computeSeatUsage(base.seats, usage.active, usage.pending) };
    base.interval = mapped.interval;
    base.perSeatCents = item.price?.unit_amount ?? null;
    if (base.perSeatCents != null) base.nextSeatTotalCents = base.perSeatCents * (base.seats + 1);

    // Quote one more seat. Best-effort: an extra API call that must never stop
    // the seat UI from rendering. One seat on top of Stripe's own count: with a
    // reduction pending, adding a seat first restores the paid seats at no
    // charge, so one seat is still all that's charged.
    try {
      const preview = await stripe.invoices.createPreview({
        customer: sub.customer as string,
        subscription: profile!.stripe_subscription_id!,
        subscription_details: {
          items: [{ id: item.id, quantity: stripeQty + 1 }],
          proration_behavior: "create_prorations",
          proration_date: Math.floor(Date.now() / 1000),
        },
      });
      // Only the proration lines — the preview also contains the next renewal.
      const prorated = (preview.lines?.data ?? [])
        .filter((l) => l.parent?.subscription_item_details?.proration)
        .reduce((s, l) => s + (l.amount ?? 0), 0);
      base.nextSeatProrationCents = Math.max(0, prorated);
    } catch {
      // Leave null → the modal drops the "charged today" line.
    }
  } catch {
    return NextResponse.json({ ...base, billable: false });
  }
  return NextResponse.json(base);
}

// POST /api/stripe/subscription/seats { seats }
// Change the Office seat count. Allowed for the owner AND a billing_admin — a
// delegated billing admin acts on the OWNER's subscription. Enforces the 2-seat
// minimum and refuses to drop below seats in use (owner + active + pending).
// What each change costs is the owner's rule, decided in lib/office-seat-plan:
// an added seat is charged now; a removed seat stays, paid, to the end of the
// period, and the next renewal bills the lower count; a seat removed within 24
// hours of being added comes off now and is refunded.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const requested = Math.floor(Number(body.seats));
  if (!Number.isFinite(requested)) return NextResponse.json({ error: "Invalid seat count." }, { status: 400 });
  if (requested < PLAN_LIMITS.OFFICE_MIN_SEATS) {
    return NextResponse.json({ error: `Office requires at least ${PLAN_LIMITS.OFFICE_MIN_SEATS} seats.` }, { status: 400 });
  }

  // Server-side authorization: caller must have manage_seats (owner or billing_admin).
  const ctx = await requireOfficeCapability(user.id, "manage_seats");
  if (!ctx) return NextResponse.json({ error: "You don't have permission to change seats." }, { status: 403 });

  const admin = getAdminSupabase();
  // The subscription belongs to the office OWNER (a billing_admin acts on it).
  const { data: profile } = await admin
    .from("profiles")
    .select("plan, stripe_subscription_id")
    .eq("id", ctx.ownerId)
    .single();

  if (profile?.plan !== "enterprise" || !profile.stripe_subscription_id) {
    return NextResponse.json({ error: "Seats can only be changed on an active Office plan." }, { status: 400 });
  }

  const office = { id: ctx.officeId };

  // Never strand anyone: seats can't drop below what's in use — owner (seat 1)
  // + active members + pending invitations (which reserve a seat). Revoke
  // invites / remove members first to free the seats.
  const usage = await getOfficeSeatUsage(office.id as string, requested);
  const inUse = usage.ownerSeats + usage.active + usage.pending;
  if (requested < inUse) {
    return NextResponse.json(
      { error: `You're using ${inUse} of your seats (you + ${usage.active} active + ${usage.pending} pending). Remove members or revoke invitations before reducing to ${requested} seats.` },
      { status: 409 }
    );
  }

  try {
    const stripe = getStripe();
    const subId = profile.stripe_subscription_id;
    const sub = (await stripe.subscriptions.retrieve(subId)) as Stripe.Subscription;
    const item = sub.items.data[0];
    // Guard: only touch it if it really is an Office (per-seat) price.
    const mapped = planFromPriceId(item?.price?.id);
    if (!item || mapped?.plan !== "office") {
      return NextResponse.json({ error: "This subscription isn't an Office plan." }, { status: 400 });
    }
    const stripeQty = item.quantity ?? PLAN_LIMITS.OFFICE_MIN_SEATS;
    const periodEnd = subscriptionPeriodEndIso(sub);
    const { data: officeRow } = await admin
      .from("offices")
      .select("seats, scheduled_seats, scheduled_seats_at")
      .eq("id", office.id)
      .maybeSingle();
    const pendingSeats = (officeRow?.scheduled_seats as number | null | undefined) ?? null;
    const paid = paidSeats(stripeQty, (officeRow?.seats as number | null | undefined) ?? null, pendingSeats);
    const now = Date.now();
    const addsRaw = sub.metadata?.[SEAT_ADDS_KEY] ?? "";
    const adds = parseSeatAdds(addsRaw);
    const plan = planSeatChange({ paid, stripeQty, requested, adds, now });

    // Idempotency keys name the TRANSITION and the subscription's state, not the
    // request: a double-click (or a retry after a timeout) reads the same state
    // and collapses into one Stripe call, while the same transition made again
    // later (add a seat, remove it within the day, add it again) sees a
    // different latest invoice or seat record and goes through. Derived
    // server-side, so a client can't defeat it by varying its payload.
    const latestInvoice = typeof sub.latest_invoice === "string" ? sub.latest_invoice : sub.latest_invoice?.id ?? "";
    const state = createHash("sha256").update(`${latestInvoice}|${addsRaw}|${pendingSeats ?? ""}`).digest("hex").slice(0, 16);
    const restore = async (to: number) => {
      // Back to the seats already paid for this period: no proration, no charge.
      await stripe.subscriptions.update(
        subId,
        { items: [{ id: item.id, quantity: to }], proration_behavior: "none" },
        { idempotencyKey: `office-seats-restore:${subId}:${stripeQty}->${to}:${state}` },
      );
    };

    if (plan.kind === "increase") {
      // INCREASE → effective immediately and charged now. Also cancels any
      // pending reduction (you're going up, not down).
      if (plan.restoreTo != null) await restore(plan.restoreTo);
      // always_invoice, NOT create_prorations: Stripe does not bill a positive
      // proration on its own — create_prorations only parks the line item on the
      // next renewal invoice, so an extra seat bought today would be used free
      // until the cycle rolled over. always_invoice finalizes an invoice for the
      // prorated remainder now and charges the card on file.
      const updated = await stripe.subscriptions.update(
        subId,
        {
          items: [{ id: item.id, quantity: plan.quantity }],
          proration_behavior: "always_invoice",
          // Without this, Stripe's default (allow_incomplete) applies the
          // seat increase and leaves an uncollectable proration invoice
          // open — offices.seats below would then be written even though
          // the added seat(s) were never paid for (billing audit).
          payment_behavior: "error_if_incomplete",
        },
        { idempotencyKey: `office-seats:${subId}:${paid}->${plan.quantity}:${state}` },
      );
      // Remember the purchase and the invoice that charged for it, so removing
      // these seats within 24 hours can refund exactly that charge. A failure
      // here costs only that refund window, never the purchase, so it's
      // reported, not fatal.
      const inv = typeof updated.latest_invoice === "string" ? updated.latest_invoice : updated.latest_invoice?.id ?? null;
      if (inv && inv !== latestInvoice && !adds.some((a) => a.inv === inv)) {
        try {
          await stripe.subscriptions.update(subId, {
            metadata: { [SEAT_ADDS_KEY]: serializeSeatAdds([...adds, { at: now, n: plan.added, left: plan.added, inv }], now) },
          });
        } catch (e) {
          await reportError("office.seats.add_record_failed", e, { subId, inv, added: plan.added });
        }
      }
      // DB only after Stripe confirms — if the charge failed, the office must not
      // believe it owns a seat it never bought.
      await admin.from("offices").update({ seats: plan.dbSeats, scheduled_seats: null, scheduled_seats_at: null }).eq("id", office.id);
      await writeAudit({ action: "seat.changed", actorId: user.id, orgId: office.id as string, metadata: { seats: plan.dbSeats, mode: "increase" } });
      const unit = updated.items.data[0]?.price?.unit_amount ?? item.price?.unit_amount ?? null;
      return NextResponse.json({
        ok: true,
        mode: "increased",
        seats: plan.dbSeats,
        perSeatCents: unit,
        totalCents: unit != null ? unit * plan.dbSeats : null,
        interval: mapped.interval,
      });
    }

    if (plan.kind === "unchanged") {
      // No change — treat as "cancel any scheduled reduction": the next renewal
      // goes back to billing the seats they have.
      if (plan.restoreTo != null) await restore(plan.restoreTo);
      await admin.from("offices").update({ seats: plan.dbSeats, scheduled_seats: null, scheduled_seats_at: null }).eq("id", office.id);
      await writeAudit({ action: "seat.reduction_canceled", actorId: user.id, orgId: office.id as string });
      return NextResponse.json({ ok: true, mode: "unchanged", seats: plan.dbSeats });
    }

    // REDUCTION. Seats bought in the last 24 hours come off now and are
    // refunded; the rest stay, paid, until the end of the period. Either way
    // Stripe moves to the new count NOW, with no proration, so the next renewal
    // bills it. (Changing Stripe only after the period ended, as this used to,
    // let the renewal bill a full extra cycle at the old count: audit B-01.)
    //
    // Guard: with no period end, the part that has to wait has no date to wait
    // for. Fail loudly instead of scheduling a reduction that never applies.
    // (billing audit #11)
    if (!periodEnd && plan.dbSeatsIfRefunded > requested) {
      return NextResponse.json(
        { error: "no_period_end", message: "We couldn't schedule the seat reduction right now. Please try again in a moment." },
        { status: 503 }
      );
    }

    // The schedule goes in BEFORE Stripe changes, so the webhook that change
    // fires finds a pending reduction and leaves the paid seats in place.
    const prevSchedule = {
      scheduled_seats: pendingSeats,
      scheduled_seats_at: (officeRow?.scheduled_seats_at as string | null | undefined) ?? null,
    };
    await admin.from("offices").update({ scheduled_seats: requested, scheduled_seats_at: periodEnd }).eq("id", office.id);
    try {
      await stripe.subscriptions.update(
        subId,
        {
          items: [{ id: item.id, quantity: plan.quantity }],
          proration_behavior: "none",
          metadata: { [SEAT_ADDS_KEY]: serializeSeatAdds(plan.addsAfter, now) },
        },
        { idempotencyKey: `office-seats:${subId}:${paid}->${plan.quantity}:${state}` },
      );
    } catch (e) {
      await admin.from("offices").update(prevSchedule).eq("id", office.id);
      throw e;
    }

    // Refund the seats that were added within the day. A refund that fails
    // leaves those seats as an ordinary removal (kept, and paid, to the end of
    // the period), so what the customer was charged and what they hold always
    // agree. The failure is reported so it can be refunded by hand.
    let refundedSeats = 0;
    let refundedCents = 0;
    for (const r of plan.refunds) {
      try {
        const invoice = await stripe.invoices.retrieve(r.inv);
        const cents = invoice.status === "paid"
          ? seatRefundCents({
              amountPaid: invoice.amount_paid ?? 0,
              alreadyCredited: invoice.post_payment_credit_notes_amount ?? 0,
              seats: r.seats,
              of: r.of,
              last: r.last,
            })
          : 0;
        if (cents > 0) {
          await stripe.creditNotes.create(
            {
              invoice: r.inv,
              amount: cents,
              refund_amount: cents,
              reason: "order_change",
              memo: `Seat${r.seats === 1 ? "" : "s"} removed within 24 hours of being added: not charged.`,
            },
            { idempotencyKey: `office-seat-refund:${r.inv}:${r.at}:${r.seats}:${state}` },
          );
        }
        refundedSeats += r.seats;
        refundedCents += cents;
      } catch (e) {
        await reportError("office.seats.refund_failed", e, { subId, invoice: r.inv, seats: r.seats });
      }
    }

    const dbSeats = paid - refundedSeats;
    const waiting = requested < dbSeats;
    await admin
      .from("offices")
      .update({ seats: dbSeats, scheduled_seats: waiting ? requested : null, scheduled_seats_at: waiting ? periodEnd : null })
      .eq("id", office.id);
    await writeAudit({
      action: waiting ? "seat.reduction_scheduled" : "seat.changed",
      actorId: user.id,
      orgId: office.id as string,
      metadata: { from: paid, to: requested, refundedSeats, refundedCents, ...(waiting ? { effectiveAt: periodEnd } : { mode: "refunded" }) },
    });
    return NextResponse.json({
      ok: true,
      mode: !waiting ? "reduced_now" : refundedSeats > 0 ? "reduced_now_and_scheduled" : "scheduled",
      seats: dbSeats,
      ...(waiting ? { scheduledSeats: requested, effectiveAt: periodEnd } : {}),
      refundedSeats,
      refundedCents,
    });
  } catch (err) {
    // A declined card (or an invoice needing 3DS/SCA action) on the immediate
    // seat-increase invoice must say so plainly, matching change-plan's
    // handling — error_if_incomplete (above) is what makes this reachable.
    const e = err as { code?: string; type?: string; message?: string };
    if (
      e?.type === "StripeCardError" ||
      e?.code === "card_declined" ||
      e?.code === "invoice_payment_intent_requires_action" ||
      e?.code === "subscription_payment_intent_requires_action"
    ) {
      return NextResponse.json(
        { error: "Your card was declined, so seats weren't added. Update your payment method and try again." },
        { status: 402 }
      );
    }
    console.error("Stripe seats error:", e?.message ?? err);
    return NextResponse.json({ error: "Couldn't update seats. Please try again." }, { status: 502 });
  }
}
