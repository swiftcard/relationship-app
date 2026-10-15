import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { requireAdmin } from "@/lib/admin";

export const runtime = "nodejs";

// Website-analytics aggregation for the site-owner admin page. Admin-gated.
// ?internal=1 includes owner/partner traffic (default: excluded).

const DAY = 86_400_000;
// Bounded fetch for the charts / top-lists (KPIs use exact head counts). Early
// stage this holds the whole 30-day window; if it's ever hit we log the cap so
// the numbers are never silently truncated.
const ROW_CAP = 50_000;

function dayKey(iso: string): string {
  return iso.slice(0, 10); // YYYY-MM-DD (UTC)
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }

  const includeInternal = req.nextUrl.searchParams.get("internal") === "1";
  const admin = getAdminSupabase();
  const now = Date.now();
  const since30 = new Date(now - 30 * DAY).toISOString();
  const since7 = new Date(now - 7 * DAY).toISOString();
  const since1 = new Date(now - DAY).toISOString();

  const base = () => {
    let q = admin.from("site_pageviews").select("*", { count: "exact", head: true });
    if (!includeInternal) q = q.eq("is_internal", false);
    return q;
  };

  // Exact pageview counts per window (cheap head counts).
  const [pv30, pv7, pv1] = await Promise.all([
    base().gte("created_at", since30),
    base().gte("created_at", since7),
    base().gte("created_at", since1),
  ]);

  // Rows for the 30-day window → daily series, uniques, sessions, top lists.
  let rowsQ = admin
    .from("site_pageviews")
    .select("visitor_id, session_id, path, referrer, country, duration_ms, created_at")
    .gte("created_at", since30)
    .order("created_at", { ascending: false })
    .limit(ROW_CAP);
  if (!includeInternal) rowsQ = rowsQ.eq("is_internal", false);
  const { data: rows } = await rowsQ;
  const all = rows ?? [];
  if (all.length === ROW_CAP) {
    console.warn(`[admin/website] row cap ${ROW_CAP} hit — charts reflect the most recent ${ROW_CAP} views only.`);
  }

  // Daily buckets (last 30 days) for pageviews + unique visitors.
  const days: { date: string; views: number; visitors: number }[] = [];
  const dayVisitors = new Map<string, Set<string>>();
  const dayViews = new Map<string, number>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * DAY).toISOString().slice(0, 10);
    dayVisitors.set(d, new Set());
    dayViews.set(d, 0);
  }

  const uniq30 = new Set<string>();
  const uniq7 = new Set<string>();
  const uniq1 = new Set<string>();
  const sessions = new Map<string, { views: number; visitor: string }>();
  const pathCount = new Map<string, number>();
  const refCount = new Map<string, number>();
  const countryCount = new Map<string, number>();
  let durationSum = 0;
  let durationN = 0;

  for (const r of all) {
    const t = new Date(r.created_at as string).getTime();
    const vid = (r.visitor_id as string) || "?";
    const d = dayKey(r.created_at as string);
    if (dayViews.has(d)) {
      dayViews.set(d, (dayViews.get(d) ?? 0) + 1);
      dayVisitors.get(d)!.add(vid);
    }
    uniq30.add(vid);
    if (t >= now - 7 * DAY) uniq7.add(vid);
    if (t >= now - DAY) uniq1.add(vid);

    const sid = (r.session_id as string) || "?";
    const s = sessions.get(sid) ?? { views: 0, visitor: vid };
    s.views++;
    sessions.set(sid, s);

    pathCount.set(r.path as string, (pathCount.get(r.path as string) ?? 0) + 1);
    if (r.referrer) refCount.set(r.referrer as string, (refCount.get(r.referrer as string) ?? 0) + 1);
    if (r.country) countryCount.set(r.country as string, (countryCount.get(r.country as string) ?? 0) + 1);

    if (r.duration_ms != null) { durationSum += Number(r.duration_ms); durationN++; }
  }

  for (const [date, views] of dayViews) {
    days.push({ date, views, visitors: dayVisitors.get(date)!.size });
  }
  days.sort((a, b) => a.date.localeCompare(b.date));

  const sessionCount = sessions.size;
  const oneViewSessions = [...sessions.values()].filter((s) => s.views === 1).length;
  const top = (m: Map<string, number>, n: number) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([label, count]) => ({ label, count }));

  return NextResponse.json({
    includeInternal,
    capHit: all.length === ROW_CAP,
    kpis: {
      pageviews: { d1: pv1.count ?? 0, d7: pv7.count ?? 0, d30: pv30.count ?? 0 },
      visitors: { d1: uniq1.size, d7: uniq7.size, d30: uniq30.size },
      sessions: sessionCount,
      pagesPerSession: sessionCount ? Math.round((all.length / sessionCount) * 10) / 10 : 0,
      avgDurationSec: durationN ? Math.round(durationSum / durationN / 1000) : 0,
      bounceRatePct: sessionCount ? Math.round((oneViewSessions / sessionCount) * 100) : 0,
    },
    daily: days,
    topPages: top(pathCount, 12),
    topReferrers: top(refCount, 10),
    topCountries: top(countryCount, 10),
  });
}
