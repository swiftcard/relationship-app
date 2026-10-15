// ── What an Office seat change does, decided in one place ───────────────────
//
// The owner's rule (2026-10-15):
//   • Adding a seat charges for it now (the prorated rest of the period).
//   • Removing a seat keeps it, paid, until the end of the billing period. No
//     partial refund. The NEXT renewal bills the lower count.
//   • Removing a seat within 24 hours of adding it costs nothing: it comes off
//     now and the charge for it is refunded.
//
// How that maps onto the two places seats live:
//   • offices.seats is what the team can USE now: the seats paid for in the
//     current period. Invites are gated on it.
//   • Stripe's quantity is what the NEXT renewal bills.
// Normally the two are equal. While a reduction is pending, Stripe already
// holds the lower count and offices.seats keeps the paid one until
// scheduled_seats_at (audit B-01). The old design changed Stripe only after the
// period ended, by which time the renewal had already billed the old count.
//
// Seats added in the last 24 hours ride on the subscription's metadata
// (SEAT_ADDS_KEY), with the invoice that charged for them, so a quick removal
// can refund exactly that charge.

export const SEAT_REFUND_WINDOW_MS = 24 * 60 * 60 * 1000;
export const SEAT_ADDS_KEY = "sc_seat_adds";

/** One seat purchase still inside the refund window. */
export type SeatAdd = {
  /** When it was bought, ms since epoch. */
  at: number;
  /** Seats bought in that purchase. */
  n: number;
  /** Of those, seats not yet removed and refunded. */
  left: number;
  /** The invoice that charged for them (null when Stripe didn't return one). */
  inv: string | null;
};

/**
 * Seats the team holds this period. Stripe's count, except while a reduction
 * is pending: then Stripe already bills the lower count next time and
 * offices.seats keeps the paid one. The higher of the two, so a seat Stripe is
 * billing is never treated as unpaid.
 */
export function paidSeats(stripeQty: number, dbSeats: number | null, scheduledSeats: number | null): number {
  if (scheduledSeats == null || dbSeats == null) return stripeQty;
  return Math.max(stripeQty, dbSeats);
}

/**
 * What a customer.subscription.updated should do to offices.seats, given the
 * LIVE Stripe count (audit B-02: never the event's own snapshot).
 *   noop       Stripe and the office already agree.
 *   keep       A reduction is pending and Stripe already holds it for the next
 *              renewal; the team keeps its paid seats until the date.
 *   apply_due  That reduction's date has come (the renewal fired this): apply
 *              it the same way the daily job does, never by trimming members.
 *   sync       Anything else (a change made in the Stripe portal, say): the
 *              office follows Stripe, and a pending reduction is dropped.
 */
export type SeatSync = "noop" | "keep" | "apply_due" | "sync";
export function seatSyncDecision(input: {
  liveQty: number;
  dbSeats: number | null;
  scheduledSeats: number | null;
  scheduledAt: string | null;
  now: number;
}): SeatSync {
  const { liveQty, dbSeats, scheduledSeats, scheduledAt, now } = input;
  if (scheduledSeats != null && liveQty === scheduledSeats) {
    const due = !scheduledAt || Date.parse(scheduledAt) <= now;
    return due ? "apply_due" : "keep";
  }
  if (dbSeats != null && liveQty === dbSeats) return "noop";
  return "sync";
}

/** Read the metadata value; anything malformed reads as no recent adds. */
export function parseSeatAdds(raw: string | null | undefined): SeatAdd[] {
  if (!raw) return [];
  try {
    const rows = JSON.parse(raw) as unknown;
    if (!Array.isArray(rows)) return [];
    const out: SeatAdd[] = [];
    for (const r of rows) {
      if (!Array.isArray(r)) continue;
      const [atSec, n, left, inv] = r as unknown[];
      if (typeof atSec !== "number" || typeof n !== "number" || typeof left !== "number") continue;
      if (n < 1 || left < 0 || left > n) continue;
      out.push({ at: atSec * 1000, n, left, inv: typeof inv === "string" && inv ? inv : null });
    }
    return out;
  } catch {
    return [];
  }
}

/** Purchases still refundable at `now`: inside the window, with seats left. */
export function freshSeatAdds(adds: SeatAdd[], now: number): SeatAdd[] {
  return adds.filter((a) => a.left > 0 && now - a.at < SEAT_REFUND_WINDOW_MS);
}

/**
 * The metadata value to store. Only refundable purchases are kept, newest
 * last, capped so it can never outgrow Stripe's 500-character metadata limit.
 * "" deletes the key.
 */
export function serializeSeatAdds(adds: SeatAdd[], now: number): string {
  const keep = freshSeatAdds(adds, now).sort((a, b) => a.at - b.at).slice(-8);
  if (!keep.length) return "";
  return JSON.stringify(keep.map((a) => [Math.floor(a.at / 1000), a.n, a.left, a.inv ?? ""]));
}

/** Refund owed for removing `seats` of a purchase of `n` that cost `amountPaid` cents. */
export function seatRefundCents(input: {
  amountPaid: number;
  alreadyCredited: number;
  seats: number;
  of: number;
  /** True when this removal takes the purchase's last remaining seat. */
  last: boolean;
}): number {
  const { amountPaid, alreadyCredited, seats, of, last } = input;
  const refundable = Math.max(0, amountPaid - alreadyCredited);
  // The last seat refunds whatever is left, so rounding can never strand a cent.
  const share = last ? refundable : Math.round((amountPaid * seats) / of);
  return Math.max(0, Math.min(refundable, share));
}

export type SeatRefund = {
  inv: string;
  seats: number;
  of: number;
  last: boolean;
  /** The purchase's `at`, to find it again in the list. */
  at: number;
};

export type SeatChangePlan =
  | {
      kind: "increase";
      /** Put Stripe back on the paid count first (no charge) when a reduction was pending. */
      restoreTo: number | null;
      quantity: number;
      added: number;
      dbSeats: number;
    }
  | {
      kind: "unchanged";
      /** Stripe back to the paid count (no charge), cancelling a pending reduction. */
      restoreTo: number | null;
      dbSeats: number;
    }
  | {
      kind: "decrease";
      /** The quantity the next renewal bills. Applied now, with no proration. */
      quantity: number;
      /** Seats bought in the last 24h that come off now, refunded. */
      refunds: SeatRefund[];
      /** The purchases list after those refunds (before any refund fails). */
      addsAfter: SeatAdd[];
      /** Seats usable now, if every refund goes through. */
      dbSeatsIfRefunded: number;
    };

/**
 * Decide what a request for `requested` seats does.
 *
 * `paid` is what the team holds this period (offices.seats, or Stripe's count
 * when that's higher, so a seat Stripe is billing is never treated as unpaid).
 * `stripeQty` is the count the next renewal bills.
 */
export function planSeatChange(input: {
  paid: number;
  stripeQty: number;
  requested: number;
  adds: SeatAdd[];
  now: number;
}): SeatChangePlan {
  const { paid, stripeQty, requested, adds, now } = input;

  if (requested > paid) {
    return {
      kind: "increase",
      restoreTo: stripeQty !== paid ? paid : null,
      quantity: requested,
      added: requested - paid,
      dbSeats: requested,
    };
  }

  if (requested === paid) {
    return { kind: "unchanged", restoreTo: stripeQty !== paid ? paid : null, dbSeats: paid };
  }

  // Removing seats. The newest purchases inside the window come off first and
  // are refunded; anything beyond them is an ordinary removal that keeps the
  // seat to the end of the period.
  let toRemove = paid - requested;
  const addsAfter = adds.map((a) => ({ ...a }));
  const refunds: SeatRefund[] = [];
  const fresh = freshSeatAdds(addsAfter, now).sort((a, b) => b.at - a.at);
  for (const a of fresh) {
    if (toRemove <= 0) break;
    if (!a.inv) continue; // nothing to refund against: treat it as an ordinary removal
    const k = Math.min(a.left, toRemove);
    refunds.push({ inv: a.inv, seats: k, of: a.n, last: a.left - k === 0, at: a.at });
    a.left -= k;
    toRemove -= k;
  }
  const refundedSeats = refunds.reduce((s, r) => s + r.seats, 0);

  return {
    kind: "decrease",
    quantity: requested,
    refunds,
    addsAfter,
    dbSeatsIfRefunded: paid - refundedSeats,
  };
}
