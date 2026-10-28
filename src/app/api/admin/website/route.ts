import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { requireAdmin } from "@/lib/admin";
import { paged } from "@/lib/crew/paged";
import { startOfNyDay } from "@/lib/admin-data/time";
import { summarizeWebsite, type PageviewRow } from "@/lib/admin-data/website";

export const runtime = "nodejs";

// Website-analytics aggregation for the site-owner admin page. Admin-gated.
// ?internal=1 includes the team's own visits (default: left out).
//
// Every row of the 30 New York days is read, team rows included, so the
// switch changes the totals by exactly the team's rows and the page can say
// how many that is. Until 2026-10-28 this read at most 1,000 rows (PostgREST's
// silent cap, under a 50,000-row limit), and with the switch on every number but
// pageviews came from that sample. The counting is lib/admin-data/website.ts.

// Far above today's month (~5,000 rows); hitting it is reported, never hidden.
const ROW_MAX = 300_000;

const COLUMNS = "id, visitor_id, session_id, path, referrer, country, duration_ms, created_at, is_internal, landing, utm_source, utm_medium, utm_campaign, src, device";

export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }

  const includeInternal = req.nextUrl.searchParams.get("internal") === "1";
  const admin = getAdminSupabase();
  const now = new Date();
  const since = startOfNyDay(29, now).toISOString();

  let rows: PageviewRow[];
  try {
    rows = await paged<PageviewRow>(
      (from, to) => admin.from("site_pageviews").select(COLUMNS).gte("created_at", since)
        .order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to),
      ROW_MAX,
      "site_pageviews",
    );
  } catch (e) {
    console.error("[admin/website] read failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "read_failed" }, { status: 500 });
  }

  const capHit = rows.length >= ROW_MAX;
  if (capHit) console.warn(`[admin/website] ${ROW_MAX} rows in 30 days — the numbers cover the oldest ${ROW_MAX}.`);

  return NextResponse.json({ includeInternal, capHit, ...summarizeWebsite(rows, { includeInternal, now }) });
}
