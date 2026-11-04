import { safeTimeZone, zonedParts, zonedWallTimeToUtc } from "@/lib/tz-days";

// ── When the reminders go out ───────────────────────────────────────────────
// Owner, 2026-11-03: after the confirmation, a reminder halfway between booking
// and the demo, another the night before, and another the day of — and a text
// the morning of. All in the PROSPECT's time zone (a 7 PM email is 7 PM where
// they are). Pure: the booking route writes these rows, the tests pin them.
//
//   day_of        8:00 AM on the demo day, or 1 hour before the start when
//                 that is earlier (a West Coast visitor at 7 AM their time)
//                 or when they booked that same morning.
//   night_before  7:00 PM the evening before.
//   halfway       halfway from booking to the demo; overnight (8 PM–9 AM)
//                 it moves to 9 AM.
//
// A reminder in the past, inside 2 hours of the booking (the confirmation just
// went), after the start, or within 3 hours of a more important one is dropped.
// Importance: day_of, then night_before, then halfway.

export type ReminderKind = "halfway" | "night_before" | "day_of";
export type PlannedReminder = { kind: ReminderKind; sendAt: Date };

const HOUR = 3_600_000;
const NEAR_BOOKING_MS = 2 * HOUR;
const MIN_GAP_MS = 3 * HOUR;

/** The local hours a text may go out (8 AM to 9 PM, their time). */
export const SMS_LOCAL_HOURS = { from: 8, to: 21 } as const;

export function planReminders(bookedAt: Date, start: Date, timeZone: string | null | undefined): PlannedReminder[] {
  const tz = safeTimeZone(timeZone);
  const s = zonedParts(start, tz);

  const eightAm = zonedWallTimeToUtc(s.y, s.m, s.d, 8, 0, tz);
  const hourBefore = new Date(start.getTime() - HOUR);
  // 8 AM, unless that is later than an hour before, or was already too close
  // to the booking (booked the same morning): then an hour before.
  const eightAmUsable = eightAm < hourBefore && eightAm.getTime() >= bookedAt.getTime() + NEAR_BOOKING_MS;
  const dayOf = eightAmUsable ? eightAm : hourBefore;

  const nightBefore = zonedWallTimeToUtc(s.y, s.m, s.d - 1, 19, 0, tz);

  let halfway = new Date(bookedAt.getTime() + (start.getTime() - bookedAt.getTime()) / 2);
  const h = zonedParts(halfway, tz);
  if (h.h >= 20) halfway = zonedWallTimeToUtc(h.y, h.m, h.d + 1, 9, 0, tz);
  else if (h.h < 9) halfway = zonedWallTimeToUtc(h.y, h.m, h.d, 9, 0, tz);

  const candidates: PlannedReminder[] = [
    { kind: "day_of", sendAt: dayOf },
    { kind: "night_before", sendAt: nightBefore },
    { kind: "halfway", sendAt: halfway },
  ];
  const kept: PlannedReminder[] = [];
  for (const c of candidates) {
    const t = c.sendAt.getTime();
    if (t >= start.getTime()) continue;
    if (t < bookedAt.getTime() + NEAR_BOOKING_MS) continue;
    if (kept.some((k) => Math.abs(k.sendAt.getTime() - t) < MIN_GAP_MS)) continue;
    kept.push(c);
  }
  return kept.sort((a, b) => a.sendAt.getTime() - b.sendAt.getTime());
}

/** May a text go out at `at` to someone in `timeZone`? */
export function withinTextHours(at: Date, timeZone: string | null | undefined): boolean {
  const hour = zonedParts(at, safeTimeZone(timeZone)).h;
  return hour >= SMS_LOCAL_HOURS.from && hour < SMS_LOCAL_HOURS.to;
}
