import { getAdminSupabase } from "@/lib/supabase-admin";
import { getStripe } from "@/lib/stripe";
import { PLAN_LIMITS } from "@/lib/plan";
import { getOfficeSeatUsage } from "@/lib/office-seats";
import { writeAudit } from "@/lib/audit";
import { reportError } from "@/lib/report-error";
import type Stripe from "stripe";

// ── Pure guard: what seat target is actually applicable right now ─────────────
// A scheduled reduction can never drop below what's in use at apply-time (the
// team may have grown after it was scheduled). Also honors the 2-seat minimum.
export function applicableTarget(scheduled: number, inUse: number): number {
  return Math.max(scheduled, inUse, PLAN_LIMITS.OFFICE_MIN_SEATS);
}

type ScheduledOffice = { id: string; owner_id: string; scheduled_seats: number; scheduled_seats_at: string | null };

/** The owner's live Office subscription, or null when there is none to touch. */
async function liveOfficeSubscription(ownerId: string): Promise<Stripe.Subscription | null> {
  const { data: prof } = await getAdminSupabase()
    .from("profiles")
    .select("stripe_subscription_id, plan")
    .eq("id", ownerId)
    .maybeSingle();
  if (prof?.plan !== "enterprise" || !prof.stripe_subscription_id) return null;
  return (await getStripe().subscriptions.retrieve(prof.stripe_subscription_id as string)) as Stripe.Subscription;
}

/**
 * A pending reduction whose date has come: the office drops to it.
 *
 * Since audit B-01, Stripe was moved to the reduced count when the reduction
 * was scheduled, so the renewal already billed it and there is normally
 * nothing to do in Stripe. Two exceptions:
 *   • the team grew past the reduction meanwhile (the paid seats stayed usable
 *     until today): the office keeps what is in use, and Stripe bills those
 *     extra seats from now on (prorated onto the next invoice);
 *   • a reduction scheduled before B-01, still with Stripe on the old count:
 *     lowered now, without proration, as it always was.
 * Called by the daily job and by the webhook the renewal fires. Throws on a
 * Stripe failure so the caller can leave the schedule for another try.
 */
export async function applyScheduledReduction(o: ScheduledOffice): Promise<number> {
  const admin = getAdminSupabase();
  const scheduled = o.scheduled_seats;
  const usage = await getOfficeSeatUsage(o.id, scheduled);
  const inUse = usage.ownerSeats + usage.active + usage.pending;
  const target = applicableTarget(scheduled, inUse);

  const sub = await liveOfficeSubscription(o.owner_id);
  const item = sub?.items.data[0];
  if (sub && item && (item.quantity ?? 0) !== target) {
    await getStripe().subscriptions.update(sub.id, {
      items: [{ id: item.id, quantity: target }],
      proration_behavior: (item.quantity ?? 0) < target ? "create_prorations" : "none",
    });
  }

  await admin
    .from("offices")
    .update({ seats: target, scheduled_seats: null, scheduled_seats_at: null })
    .eq("id", o.id);
  await writeAudit({ action: "seat.changed", orgId: o.id, metadata: { seats: target, mode: "scheduled_applied" } });
  return target;
}

/**
 * Before a change-plan touches an Office subscription: put a pending
 * reduction back, so Stripe holds the seats the team actually paid for. A
 * plan or interval swap prorates against Stripe's count; with a reduction
 * pending that count is the lower, not-yet-effective one, and the swap would
 * credit too little and charge for seats already paid. Returns the updated
 * subscription when it restored anything, else null.
 */
export async function restorePendingSeatReduction(ownerId: string, sub: Stripe.Subscription): Promise<Stripe.Subscription | null> {
  const admin = getAdminSupabase();
  const { data: office } = await admin
    .from("offices")
    .select("id, seats, scheduled_seats")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (!office || office.scheduled_seats == null) return null;
  const item = sub.items.data[0];
  const paid = office.seats as number;
  if (!item || (item.quantity ?? 0) >= paid) return null;
  const updated = (await getStripe().subscriptions.update(sub.id, {
    items: [{ id: item.id, quantity: paid }],
    proration_behavior: "none",
  })) as Stripe.Subscription;
  await admin.from("offices").update({ scheduled_seats: null, scheduled_seats_at: null }).eq("id", office.id as string);
  await writeAudit({ action: "seat.reduction_canceled", orgId: office.id as string, metadata: { reason: "plan_change" } });
  return updated;
}

// The daily backstop (/api/reminders). Applies every reduction whose date has
// passed (normally the renewal webhook already did), and moves any reduction
// scheduled before audit B-01, with Stripe still on the old count, onto Stripe
// now, before its renewal can bill the old count again. Best-effort per
// office; a Stripe failure leaves that office for the next run. Returns the
// count applied.
export async function applyDueSeatReductions(): Promise<number> {
  const admin = getAdminSupabase();
  const now = Date.now();

  const { data: offices } = await admin
    .from("offices")
    .select("id, owner_id, scheduled_seats, scheduled_seats_at")
    .not("scheduled_seats", "is", null);

  let applied = 0;
  for (const o of (offices ?? []) as ScheduledOffice[]) {
    const due = !o.scheduled_seats_at || Date.parse(o.scheduled_seats_at) <= now;
    try {
      if (due) {
        await applyScheduledReduction(o);
        applied++;
        continue;
      }
      // Not due yet: make sure the next renewal bills the reduced count.
      const sub = await liveOfficeSubscription(o.owner_id);
      const item = sub?.items.data[0];
      if (!sub || !item) continue;
      const usage = await getOfficeSeatUsage(o.id, o.scheduled_seats);
      const target = applicableTarget(o.scheduled_seats, usage.ownerSeats + usage.active + usage.pending);
      if ((item.quantity ?? 0) > target) {
        // The schedule names what Stripe will hold, so the webhook this change
        // fires reads it as the pending reduction it is ("keep").
        if (target !== o.scheduled_seats) {
          await admin.from("offices").update({ scheduled_seats: target }).eq("id", o.id);
        }
        await getStripe().subscriptions.update(sub.id, {
          items: [{ id: item.id, quantity: target }],
          proration_behavior: "none",
        });
      }
    } catch (e) {
      await reportError("office.seats.scheduled_apply_failed", e, { officeId: o.id, due });
    }
  }
  return applied;
}
