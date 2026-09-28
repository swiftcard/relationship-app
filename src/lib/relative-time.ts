// ── Human-friendly relative dates ────────────────────────────────────────────
// The office admin is written for a small-business owner, not an engineer —
// "2 days ago" reads instantly; "2026-07-12T14:03:22Z" does not. Pure and
// injectable-now so it's unit-testable.

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = now - t;
  if (diff < 0) return "Just now"; // clock skew — never show "in -2 minutes"
  if (diff < MIN) return "Just now";
  if (diff < HOUR) {
    const m = Math.floor(diff / MIN);
    return `${m} minute${m === 1 ? "" : "s"} ago`;
  }
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  if (diff < 2 * DAY) return "Yesterday";
  if (diff < 30 * DAY) {
    const d = Math.floor(diff / DAY);
    return `${d} days ago`;
  }
  if (diff < 365 * DAY) {
    const mo = Math.floor(diff / (30 * DAY));
    return `${mo} month${mo === 1 ? "" : "s"} ago`;
  }
  const y = Math.floor(diff / (365 * DAY));
  return `${y} year${y === 1 ? "" : "s"} ago`;
}

// "Jul 12" style — for invite-sent dates where the calendar day matters more
// than the distance.
// `timeZone` — pass one whenever the output is rendered on BOTH the server and
// the client (see components/DisplayClock): without it each side uses its own
// zone, and the server's UTC day is tomorrow for an American evening.
export function shortDate(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(timeZone ? { timeZone } : {}) });
}
