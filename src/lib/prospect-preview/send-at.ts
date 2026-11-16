// ── Card Builder: when an approved opener goes out (owner, 2026-11-16) ─────
// "Approved messages get a send_at time: 9 AM in the recipient's local time."
// The recipient's time zone comes from the state in their office address
// ("12 Front St, Brooklyn, NY 11201"); without one, the owner's own sending
// time zone. The release clock (lib/card-builder-jobs/release.ts) hands a
// message to the Mac once its send_at has passed, and the Mac still keeps to
// the owner's sending hours, daily cap and gaps (send-window.ts). Pure.

export const SEND_HOUR = 9;

/** Each state's main time zone. A few states span two; the larger part wins. */
const STATE_TZ: Record<string, string> = {
  CT: "America/New_York", DE: "America/New_York", DC: "America/New_York", FL: "America/New_York", GA: "America/New_York",
  IN: "America/Indiana/Indianapolis", KY: "America/New_York", ME: "America/New_York", MD: "America/New_York", MA: "America/New_York",
  MI: "America/Detroit", NH: "America/New_York", NJ: "America/New_York", NY: "America/New_York", NC: "America/New_York",
  OH: "America/New_York", PA: "America/New_York", RI: "America/New_York", SC: "America/New_York", VT: "America/New_York",
  VA: "America/New_York", WV: "America/New_York",
  AL: "America/Chicago", AR: "America/Chicago", IL: "America/Chicago", IA: "America/Chicago", KS: "America/Chicago",
  LA: "America/Chicago", MN: "America/Chicago", MS: "America/Chicago", MO: "America/Chicago", NE: "America/Chicago",
  ND: "America/Chicago", OK: "America/Chicago", SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago", WI: "America/Chicago",
  AZ: "America/Phoenix", CO: "America/Denver", ID: "America/Boise", MT: "America/Denver", NM: "America/Denver", UT: "America/Denver", WY: "America/Denver",
  CA: "America/Los_Angeles", NV: "America/Los_Angeles", OR: "America/Los_Angeles", WA: "America/Los_Angeles",
  AK: "America/Anchorage", HI: "Pacific/Honolulu", PR: "America/Puerto_Rico",
};

/** The two-letter state in an address: "…, NY 11201" or "…, NY". */
export function stateOf(address: string | null | undefined): string | null {
  if (!address) return null;
  const m = /,\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*(?:,\s*(?:USA|US|United States))?\s*$/.exec(address.trim()) ?? /\b([A-Z]{2})\s+\d{5}\b/.exec(address);
  return m && STATE_TZ[m[1]] ? m[1] : null;
}

export function recipientTimeZone(address: string | null | undefined, fallback: string): string {
  const s = stateOf(address);
  return s ? STATE_TZ[s] : fallback;
}

/** Minutes the zone is ahead of UTC at that instant (New York in winter: -300). */
function offsetMinutes(at: Date, tz: string): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** The instant it is `hour`:00 on that calendar day in `tz`. */
function zonedAt(y: number, m: number, d: number, hour: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, hour);
  let at = new Date(guess - offsetMinutes(new Date(guess), tz) * 60_000);
  // Once more, in case the guess sat on the other side of a clock change.
  at = new Date(guess - offsetMinutes(at, tz) * 60_000);
  return at;
}

/** The next 9:00 AM in `tz` that is after `now`. */
export function nextSendAt(now: Date, tz: string, hour: number = SEND_HOUR): Date {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now).map((x) => [x.type, x.value]));
  const today = zonedAt(+p.year, +p.month, +p.day, hour, tz);
  if (today.getTime() > now.getTime()) return today;
  const tomorrow = new Date(Date.UTC(+p.year, +p.month - 1, +p.day + 1));
  return zonedAt(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), hour, tz);
}
