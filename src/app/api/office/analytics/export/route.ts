import { safeTimeZone } from "@/lib/tz-days";
import { NextRequest, NextResponse } from "next/server";
import { resolveDownloadUserId } from "@/lib/download-auth";
import { isRateLimited } from "@/lib/rate-limit";
import { requireOfficeCapability } from "@/lib/office-roles";
import { getOfficeEmployeeMetrics } from "@/lib/office-analytics";
import { resolveDateRange, type DateRangePreset } from "@/lib/office-analytics-dates";
import { buildEmployeeAnalyticsCsv } from "@/lib/office-analytics-csv";
import { defaultEmployeeSort } from "@/lib/office-analytics-metrics";

const PRESETS: DateRangePreset[] = ["7d", "30d", "90d"];

// GET /api/office/analytics/export?range=7d|30d|90d
// CSV export of the office's employee analytics for the given date range.
// Auth: the caller must hold view_org_analytics in SOME office — the export
// is then built strictly from THAT office's own resolved slug list (never an
// office id or usernames taken from the client), same isolation model as
// every other office route in this app (no DB RLS — this check IS the
// tenant-isolation boundary).
export async function GET(req: NextRequest) {
  // Session OR a signed ?dl= token (system-browser download from the app).
  const userId = await resolveDownloadUserId(req, "/api/office/analytics/export");
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Per-user throttle: authenticated but previously uncapped (cost/abuse guard).
  if (await isRateLimited(`office-export:${userId}`, 10, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests — please wait a moment and try again." }, { status: 429 });
  }


  const ctx = await requireOfficeCapability(userId, "view_org_analytics");
  if (!ctx) return NextResponse.json({ error: "You don't have permission to view these analytics." }, { status: 403 });

  const rawRange = req.nextUrl.searchParams.get("range");
  const preset: DateRangePreset = (PRESETS as string[]).includes(rawRange ?? "") ? (rawRange as DateRangePreset) : "30d";
  const range = resolveDateRange(preset, new Date(), undefined, safeTimeZone(req.cookies.get("sc_tz")?.value));

  const employees = await getOfficeEmployeeMetrics(ctx.officeId, ctx.ownerId, range.since, range.until);

  // A to Z, the order the Analytics table opens on (lib/office-analytics-metrics).
  const csv = buildEmployeeAnalyticsCsv(
    defaultEmployeeSort(employees).map((e) => ({
      name: e.name,
      cardName: e.cardName,
      views: e.views,
      uniqueVisitors: e.uniqueVisitors,
      scans: e.scans,
      leads: e.leads,
      contactsSaved: e.contactsSaved,
      swiftlinkViews: e.swiftlinkViews,
      lastActivityAt: e.lastActivityAt,
    }))
  );

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="swiftcard-office-analytics-${preset}.csv"`,
    },
  });
}
