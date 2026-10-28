import { localDayKey, startOfLocalDayUtc } from "@/lib/tz-days";

// ── The business's clock: New York days ─────────────────────────────────────
// Every admin number is read by the owner in New York. Bucketing by the UTC
// calendar put a 9pm signup on "tomorrow", and "today" meant "the last 24
// hours" — so the admin's "today" and the owner's today were different days.
// One clock for every admin number: calendar days in America/New_York,
// DST-safe (lib/tz-days recomputes the offset at each instant).

export const BUSINESS_TZ = "America/New_York";

const DAY_MS = 86_400_000;

/** "YYYY-MM-DD" of `instant` on the New York calendar. */
export function nyDayKey(instant: Date | string | number): string {
  return localDayKey(typeof instant === "number" ? new Date(instant) : instant, BUSINESS_TZ);
}

/** The UTC instant New York's day began, `daysAgo` days before today (0 = today). */
export function startOfNyDay(daysAgo: number, now: Date = new Date()): Date {
  return startOfLocalDayUtc(daysAgo, BUSINESS_TZ, now);
}

/** The last `days` New York calendar days, oldest first, ending today. */
export function nyDayKeys(days: number, now: Date = new Date()): string[] {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) keys.push(nyDayKey(startOfNyDay(i, now).getTime() + DAY_MS / 2));
  return keys;
}

/** An empty count per New York day for the last `days` days. */
export function emptyDaySeries(days: number, now: Date = new Date()): Map<string, number> {
  return new Map(nyDayKeys(days, now).map((k) => [k, 0]));
}
