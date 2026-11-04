import { DEMO_DURATION_MS, DEMO_RULES, DEMO_TIME_ZONE } from "./config";
import { zonedParts, zonedWallTimeToUtc } from "@/lib/tz-days";

// ── Which demo times are open ───────────────────────────────────────────────
// Pure: the API, the popup's tests and the booking check all call the same
// function. A time is open when it is on the 30-minute grid inside the weekday
// hours (New York time), on a later New York day than today (never the same
// day, owner 2026-11-04), inside the booking horizon, and overlaps nothing
// busy: no confirmed demo and nothing marked busy on the owner's Google
// Calendar.

export type Busy = { start: number; end: number };

const DAY_MS = 86_400_000;

export function overlaps(aStart: number, aEnd: number, busy: Busy[]): boolean {
  return busy.some((b) => aStart < b.end && b.start < aEnd);
}

/** Every open start time from `now` to the end of the horizon, earliest first. */
export function openDemoSlots(now: Date, busy: Busy[] = []): Date[] {
  const earliest = now.getTime();
  const latest = now.getTime() + DEMO_RULES.horizonDays * DAY_MS;
  const today = zonedParts(now, DEMO_TIME_ZONE);
  const out: Date[] = [];
  // Day 0 is today in New York: never offered.
  for (let i = DEMO_RULES.minDaysAhead; i <= DEMO_RULES.horizonDays; i++) {
    // Calendar arithmetic on the New York date, independent of any offset.
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d + i));
    if (!DEMO_RULES.weekdays.includes(day.getUTCDay())) continue;
    for (let minute = DEMO_RULES.startHour * 60; minute + DEMO_RULES.durationMin <= DEMO_RULES.endHour * 60; minute += DEMO_RULES.durationMin) {
      const start = zonedWallTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), Math.floor(minute / 60), minute % 60, DEMO_TIME_ZONE);
      const s = start.getTime();
      if (s < earliest || s > latest) continue;
      if (overlaps(s, s + DEMO_DURATION_MS, busy)) continue;
      out.push(start);
    }
  }
  return out;
}

/** True when `start` is exactly one of the open times right now. */
export function isOpenDemoSlot(start: Date, now: Date, busy: Busy[] = []): boolean {
  const t = start.getTime();
  if (!Number.isFinite(t)) return false;
  return openDemoSlots(now, busy).some((d) => d.getTime() === t);
}
