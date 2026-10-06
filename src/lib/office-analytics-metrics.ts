import { localDayKey } from "@/lib/tz-days";
// ── Office analytics — pure business-metric calculations ────────────────────
// Kept out of office-analytics.ts (which does the DB/RPC calls) so the actual
// formulas are reviewable and unit-testable in isolation, matching this
// codebase's convention (see tests/authz-negative.test.ts) of extracting the
// meaningful logic into plain, dependency-free functions.

// null (not 0 or +Infinity) when there's no prior-period baseline to compare
// against — "new this period" is a different story than "0% change" or an
// undefined blow-up.
export function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? null : 0;
  return (current - previous) / previous;
}

export type DailyPoint = { date: string; views: number };

// Zero-fills every UTC day in [sinceIso, untilIso) missing from `rows`, so a
// day-bucketed chart always renders an evenly spaced series — the aggregate
// SQL functions only return rows for days that actually had views.
export function fillDateRange(rows: DailyPoint[], sinceIso: string, untilIso: string, tz = "UTC"): DailyPoint[] {
  const byDate = new Map(rows.map((r) => [r.date, r.views]));
  // One point per LOCAL day in the range (the same calendar the range and the
  // day totals use). Stepping from midday keeps a 23- or 25-hour DST day from
  // skipping or repeating a date.
  const DAY = 24 * 60 * 60 * 1000;
  const end = new Date(untilIso).getTime();
  const out: DailyPoint[] = [];
  const seen = new Set<string>();
  for (let t = new Date(sinceIso).getTime() + DAY / 2; t < end; t += DAY) {
    const date = localDayKey(new Date(t), tz);
    if (seen.has(date)) continue;
    seen.add(date);
    out.push({ date, views: byDate.get(date) ?? 0 });
  }
  return out;
}

export type SortableEmployeeRow = { views: number; contactsSaved: number; name: string };

// The employee table's default order: card views, then contact downloads, then
// name — whose card is getting used. Never leads first: a card is there to make
// the people a teammate meets save and reach them easily, not to be a lead
// funnel (a client saving their lawyer's contact isn't a lead). Owner,
// 2026-10-06; the Conversion rate figure went the same day.
export function defaultEmployeeSort<T extends SortableEmployeeRow>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => b.views - a.views || b.contactsSaved - a.contactsSaved || a.name.localeCompare(b.name)
  );
}
