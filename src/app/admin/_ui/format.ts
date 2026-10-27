// ── One way to write every number, date and plan in the site admin ─────────
// Every page formats through here, so "1,284", "$4.99", "12%" and "Oct 27"
// look the same wherever they appear.

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US");
}

/** Dollars. Whole dollars from $1,000 up; cents below, where they matter. */
export function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n >= 1000
    ? `$${Math.round(n).toLocaleString("en-US")}`
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** A percentage: one decimal under 10%, whole numbers above. */
export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  return `${a < 10 && a % 1 ? n.toFixed(1) : Math.round(n)}%`;
}

/** Share of a total as a percentage (null when the total is zero). */
export function pctOf(part: number, total: number): number | null {
  return total > 0 ? (part / total) * 100 : null;
}

/** "Oct 27", or "Oct 27, 2025" when it isn't this year. */
export function fmtDate(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString("en-US", sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

/** "October 3, 2026" — for the one place a date is the headline. */
export function fmtLongDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** "just now", "5m ago", "3h ago", "2d ago", then the date. */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return fmtDate(iso, now);
}

/** Whole days from now until `iso` (0 when it has passed). */
export function daysUntil(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Math.max(0, Math.ceil((t - now) / 86_400_000));
}

export type Delta = { cur: number; prev: number; pct: number | null };

/**
 * The last `days` of a daily series against the `days` before them. The
 * admin APIs return 30 days, so 7 vs 7 is always available. `pct` is null
 * when the earlier window is zero: "up from nothing" has no honest percentage.
 */
export function periodDelta(series: { count: number }[], days = 7): Delta {
  const cur = series.slice(-days).reduce((n, s) => n + s.count, 0);
  const prev = series.slice(-2 * days, -days).reduce((n, s) => n + s.count, 0);
  return { cur, prev, pct: prev > 0 ? ((cur - prev) / prev) * 100 : null };
}

export type PlanKey = "free" | "pro" | "office";

/** The database calls Office "enterprise"; nothing on screen ever does. */
export function planKey(plan: string | null | undefined): PlanKey {
  return plan === "pro" ? "pro" : plan === "enterprise" || plan === "office" ? "office" : "free";
}

export const PLAN_NAME: Record<PlanKey, string> = { free: "Free", pro: "Pro", office: "Office" };

export function planName(plan: string | null | undefined): string {
  return PLAN_NAME[planKey(plan)];
}
