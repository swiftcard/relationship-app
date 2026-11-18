// ── Card Builder: when the Mac may send an opener (owner, 2026-11-16) ───────
// Approved openers go out from the owner's own number, through the Messages
// app on their Mac (scripts/card-builder-mac/agent.mjs), one at a time:
//
//   • only in daytime hours, on the days the owner chose, in New York time
//   • never more than the daily cap the owner set
//   • a randomised gap of a few minutes between two sends
//   • not at all while paused
//
// NO IMPORTS on purpose: the Mac agent is plain Node and loads this file
// directly (Node strips the types), so the admin screen and the Mac apply the
// very same rule. Pure, tested in tests/card-builder-sender.test.ts.

export type SenderSettings = {
  paused: boolean;
  /** At most this many openers a day. */
  daily_cap: number;
  /** "HH:MM", 24-hour, in `tz`. Sends happen from `start` up to (not at) `end`. */
  start: string;
  end: string;
  /** 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** The gap between two sends, in minutes: a random length in [gap_min, gap_max]. */
  gap_min: number;
  gap_max: number;
  tz: string;
  /** At most this many openers a day from Google Voice, sent by hand (google-voice.ts). Shown on the Google Voice list; the Mac ignores it. */
  gv_daily_cap: number;
};

export const DEFAULT_SENDER: SenderSettings = {
  paused: false, daily_cap: 20, start: "10:00", end: "17:30", days: [1, 2, 3, 4, 5], gap_min: 3, gap_max: 9, tz: "America/New_York", gv_daily_cap: 20,
};
export const MAX_DAILY_CAP = 100;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const int = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : fallback;
};
const minutesOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** From the stored value or a form. Anything missing or wrong takes the default. */
export function readSenderSettings(v: unknown): SenderSettings {
  const r = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const d = DEFAULT_SENDER;
  const start = typeof r.start === "string" && HHMM.test(r.start) ? r.start : d.start;
  let end = typeof r.end === "string" && HHMM.test(r.end) ? r.end : d.end;
  if (minutesOf(end) <= minutesOf(start)) end = d.end;
  const rawDays = Array.isArray(r.days) ? r.days : typeof r.days === "string" ? r.days.split(",") : null;
  const days = rawDays ? [...new Set(rawDays.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))].sort() : d.days;
  const gap_min = int(r.gap_min, 1, 120, d.gap_min);
  const gap_max = Math.max(gap_min, int(r.gap_max, 1, 240, d.gap_max));
  return {
    paused: r.paused === true || r.paused === "1" || r.paused === "on",
    daily_cap: int(r.daily_cap, 0, MAX_DAILY_CAP, d.daily_cap),
    start, end, days: days.length ? days : d.days, gap_min, gap_max,
    tz: typeof r.tz === "string" && r.tz ? r.tz : d.tz,
    gv_daily_cap: int(r.gv_daily_cap, 0, MAX_DAILY_CAP, d.gv_daily_cap),
  };
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The day of the week, the minute of the day and the date, in `tz`. */
export function localClock(now: Date, tz: string): { day: number; minute: number; date: string } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now).map((p) => [p.type, p.value]));
  return { day: WEEKDAY[parts.weekday] ?? 0, minute: Number(parts.hour) * 60 + Number(parts.minute), date: `${parts.year}-${parts.month}-${parts.day}` };
}

export type SendDecision =
  | { ok: true }
  | { ok: false; reason: "paused" | "day_off" | "outside_hours" | "cap_reached" | "gap" };

/**
 * May one opener go now? `sentToday` counts the sends since local midnight;
 * `notBefore` is the end of the random gap after the last send.
 */
export function sendDecision(s: SenderSettings, ctx: { now: Date; sentToday: number; notBefore: Date | null }): SendDecision {
  if (s.paused) return { ok: false, reason: "paused" };
  const c = localClock(ctx.now, s.tz);
  if (!s.days.includes(c.day)) return { ok: false, reason: "day_off" };
  if (c.minute < minutesOf(s.start) || c.minute >= minutesOf(s.end)) return { ok: false, reason: "outside_hours" };
  if (ctx.sentToday >= s.daily_cap) return { ok: false, reason: "cap_reached" };
  if (ctx.notBefore && ctx.now.getTime() < ctx.notBefore.getTime()) return { ok: false, reason: "gap" };
  return { ok: true };
}

/** The wait after a send, in ms: anywhere in [gap_min, gap_max] minutes, to the second. */
export function nextGapMs(s: Pick<SenderSettings, "gap_min" | "gap_max">, rand: () => number = Math.random): number {
  const lo = s.gap_min * 60_000, hi = s.gap_max * 60_000;
  return Math.round(lo + (hi - lo) * Math.min(Math.max(rand(), 0), 1));
}

export const DECISION_LABELS: Record<Exclude<SendDecision, { ok: true }>["reason"], string> = {
  paused: "Paused",
  day_off: "Not a sending day",
  outside_hours: "Outside sending hours",
  cap_reached: "Today's cap is reached",
  gap: "Waiting out the gap between texts",
};
