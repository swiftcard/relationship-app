import { safeTimeZone } from "@/lib/tz-days";
import { DEMO_TIME_ZONE } from "./config";

// ── How a demo time is written ──────────────────────────────────────────────
// One wording everywhere: the popup, the emails, the texts and the admin page.
// Browser-safe (Intl only).

// Newer ICU puts a narrow no-break space (U+202F) before AM/PM. A text message
// strips it to "3:00PM" (GSM-7 is ASCII) and some mail clients draw it oddly,
// so every demo time uses a plain space.
const plain = (s: string) => s.replace(/[  ]/g, " ");

function fmt(d: Date, tz: string, o: Intl.DateTimeFormatOptions): string {
  return plain(new Intl.DateTimeFormat("en-US", { timeZone: safeTimeZone(tz), ...o }).format(d));
}

/** "3:00 PM" */
export function fmtTime(d: Date, tz: string): string {
  return fmt(d, tz, { hour: "numeric", minute: "2-digit" });
}

/** "EST", "PDT", or "GMT+1" where the zone has no short name. */
export function tzAbbr(d: Date, tz: string): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: safeTimeZone(tz), timeZoneName: "short" })
    .formatToParts(d).find((p) => p.type === "timeZoneName");
  return part?.value ?? "";
}

/** "Wednesday, November 5" */
export function fmtLongDay(d: Date, tz: string): string {
  return fmt(d, tz, { weekday: "long", month: "long", day: "numeric" });
}

/** "Wed, Nov 5" */
export function fmtShortDay(d: Date, tz: string): string {
  return fmt(d, tz, { weekday: "short", month: "short", day: "numeric" });
}

/** "Wednesday, November 5 at 3:00 PM EST" */
export function fmtWhen(d: Date, tz: string): string {
  return `${fmtLongDay(d, tz)} at ${fmtTime(d, tz)} ${tzAbbr(d, tz)}`.trim();
}

/** "Wed, Nov 5 at 3:00 PM EST" (subject lines, texts). */
export function fmtWhenShort(d: Date, tz: string): string {
  return `${fmtShortDay(d, tz)} at ${fmtTime(d, tz)} ${tzAbbr(d, tz)}`.trim();
}

/** "3:00–3:30 PM EST" (or "11:30 AM–12:00 PM EST" across noon). */
export function fmtRange(start: Date, end: Date, tz: string): string {
  const a = fmtTime(start, tz);
  const b = fmtTime(end, tz);
  const sameHalf = a.slice(-2) === b.slice(-2);
  return `${sameHalf ? a.slice(0, -3) : a}–${b} ${tzAbbr(start, tz)}`.trim();
}

/** The New York time, for anyone not in New York: "12:00 PM PT (3:00 PM ET)". */
export function fmtWithNewYork(d: Date, tz: string): string {
  const own = `${fmtTime(d, tz)} ${tzAbbr(d, tz)}`.trim();
  if (sameClock(d, tz, DEMO_TIME_ZONE)) return own;
  return `${own} (${fmtTime(d, DEMO_TIME_ZONE)} New York time)`;
}

function sameClock(d: Date, a: string, b: string): boolean {
  const o: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", day: "numeric" };
  return fmt(d, a, o) === fmt(d, b, o);
}

/** "New York (EST)", "Los Angeles (PST)", for the time-zone line. */
export function tzLabel(tz: string, at: Date = new Date()): string {
  const zone = safeTimeZone(tz);
  const city = zone === "UTC" ? "UTC" : (zone.split("/").pop() ?? zone).replace(/_/g, " ");
  const abbr = tzAbbr(at, zone);
  return abbr && abbr !== city ? `${city} (${abbr})` : city;
}

/** "YYYY-MM-DD" of an instant in `tz` (en-CA formats that way). */
export function dayKey(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: safeTimeZone(tz), year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** The time zones offered in the picker: the visitor's own first, then the
 *  US and a few common others. */
export const COMMON_TIME_ZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles",
  "America/Anchorage", "Pacific/Honolulu", "America/Toronto", "America/Vancouver", "America/Puerto_Rico",
  "Europe/London", "Europe/Paris", "Asia/Jerusalem", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Australia/Sydney",
] as const;
