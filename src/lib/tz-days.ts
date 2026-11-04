// ── Timezone-aware day bucketing for analytics ──────────────────────────────
// Analytics timestamps are stored in UTC, but an owner reads their dashboard in
// THEIR timezone. Bucketing views by the UTC calendar misattributes near-
// midnight views (e.g. a view at 11pm Pacific lands on the next UTC day). These
// helpers bucket + window by the owner's local calendar day instead, using the
// IANA timezone the browser reported (sc_tz cookie), falling back to UTC.
//
// DST-safe: offsets are recomputed at the target instant, so a window that
// spans a DST change is still aligned to local midnight on both sides.

const DAY_MS = 86_400_000;

// A tz string is only trusted if the runtime's Intl accepts it — a spoofed or
// unknown cookie value falls back to UTC rather than throwing.
export function safeTimeZone(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

// Milliseconds to ADD to a UTC instant to get the wall-clock time in `tz`.
// (Positive east of UTC, negative west.)
function tzOffsetMs(instant: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(instant).map((x) => [x.type, x.value])) as Record<string, string>;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUTC - instant.getTime();
}

// "YYYY-MM-DD" for the given UTC instant, in `tz`'s local calendar.
export function localDayKey(instant: Date | string, tz: string): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

/** The wall-clock fields of an instant in `tz` (month 1–12, dow 0 = Sunday). */
export function zonedParts(instant: Date, tz: string): { y: number; m: number; d: number; h: number; min: number; dow: number } {
  const local = new Date(instant.getTime() + tzOffsetMs(instant, tz));
  return {
    y: local.getUTCFullYear(), m: local.getUTCMonth() + 1, d: local.getUTCDate(),
    h: local.getUTCHours(), min: local.getUTCMinutes(), dow: local.getUTCDay(),
  };
}

/**
 * The UTC instant at which the wall clock in `tz` reads y-m-d h:min (month
 * 1–12). Corrected twice with the offset AT the target, so a time on the far
 * side of a DST change lands right. Days and months may overflow (d = 32 is
 * the 1st of next month), the way Date.UTC does.
 */
export function zonedWallTimeToUtc(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
  const wall = Date.UTC(y, m - 1, d, h, min);
  let t = wall - tzOffsetMs(new Date(wall), tz);
  t = wall - tzOffsetMs(new Date(t), tz);
  return new Date(t);
}

// The UTC instant of local-midnight, `daysAgo` local days before today, in `tz`.
// daysAgo=0 → start of today (local); daysAgo=7 → start of the day 7 days ago.
export function startOfLocalDayUtc(daysAgo: number, tz: string, now: Date = new Date()): Date {
  const off = tzOffsetMs(now, tz);
  // "now" shifted into local wall-clock space, read as UTC fields.
  const localNow = new Date(now.getTime() + off);
  // Local midnight (today) then step back whole days — DAY_MS steps are exact in
  // wall-clock space here because we correct the offset again below.
  const localMidnightMs = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate()) - daysAgo * DAY_MS;
  // Convert that local-midnight back to a real UTC instant. Correct with the
  // offset AT the target (not "now") so a window crossing a DST boundary lands
  // on true local midnight.
  const approx = new Date(localMidnightMs - off);
  const off2 = tzOffsetMs(approx, tz);
  return new Date(localMidnightMs - off2);
}
