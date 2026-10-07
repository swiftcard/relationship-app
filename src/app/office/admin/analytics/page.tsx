import { cookies } from "next/headers";
import { safeTimeZone } from "@/lib/tz-days";
import { redirect } from "next/navigation";
import { requireOfficeAdmin } from "@/lib/office-admin-guard";
import { getAdminSupabase } from "@/lib/supabase-admin";
import {
  getOfficeTeam,
  memberSlugs,
  flattenOfficeKeys,
  getOfficeEmployeeMetricsForTeam,
  getOfficeDailyViews,
  getOfficeTrafficSources,
  getOfficeUniqueVisitors,
} from "@/lib/office-analytics";
import { resolveDateRange, previousPeriod, type DateRangePreset } from "@/lib/office-analytics-dates";
import { pctChange, fillDateRange } from "@/lib/office-analytics-metrics";
import { getSourceLabel } from "@/lib/source-labels";
import { StatTile, PageHead, Empty } from "@/components/office/OfficeUI";
import ViewsChart from "@/components/ViewsChart";
import EmployeeAnalyticsTable from "./EmployeeAnalyticsTable";
import AnalyticsDateRangePicker from "./AnalyticsDateRangePicker";

export const metadata = { title: "Analytics — Admin — SwiftCard" };

const PRESETS: DateRangePreset[] = ["7d", "30d", "90d"];

function deltaLabel(current: number, previous: number): string | undefined {
  const pct = pctChange(current, previous);
  if (pct === null) return current > 0 ? "New this period" : undefined;
  if (pct === 0 && previous === 0) return undefined;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${(pct * 100).toFixed(0)}% vs prior period`;
}

export default async function OfficeAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { office, officeId, ownerId } = await requireOfficeAdmin();
  if (!office || !officeId || !ownerId) redirect("/office/admin");

  const { range: rawRange } = await searchParams;
  const preset: DateRangePreset = (PRESETS as string[]).includes(rawRange ?? "") ? (rawRange as DateRangePreset) : "30d";
  // The viewer's local calendar (the browser's time zone), like the personal
  // dashboard — see lib/office-analytics-dates.
  const tz = safeTimeZone((await cookies()).get("sc_tz")?.value);
  const range = resolveDateRange(preset, new Date(), undefined, tz);
  const prevRange = previousPeriod(range);

  let employees: Awaited<ReturnType<typeof getOfficeEmployeeMetricsForTeam>> = [];
  let prevEmployees: Awaited<ReturnType<typeof getOfficeEmployeeMetricsForTeam>> = [];
  let dailyViews: { date: string; views: number }[] = [];
  let trafficSources: { source: string; views: number }[] = [];
  let officeUnique: number | null = null;
  let loadError = false;

  try {
    // Resolved ONCE and reused for both periods' metrics + the keys below —
    // each of getOfficeEmployeeMetrics/getOfficeKeys used to re-resolve the
    // team internally, tripling this same query chain per page load (code
    // review).
    const team = await getOfficeTeam(getAdminSupabase(), officeId, ownerId);
    const keys = flattenOfficeKeys(team.flatMap((m) => memberSlugs(m)));
    [employees, prevEmployees, dailyViews, trafficSources, officeUnique] = await Promise.all([
      getOfficeEmployeeMetricsForTeam(team, range.since, range.until),
      getOfficeEmployeeMetricsForTeam(team, prevRange.since, prevRange.until),
      getOfficeDailyViews(keys, range.since, range.until, tz),
      getOfficeTrafficSources(keys, range.since, range.until),
      getOfficeUniqueVisitors(keys, range.since, range.until),
    ]);
  } catch (e) {
    console.error("Office analytics dashboard failed to load:", e);
    loadError = true;
  }

  if (loadError) {
    return (
      <div>
        <PageHead title="Analytics" desc="Views, contacts and contact downloads for every card on your team, by date." />
        <Empty>Couldn&apos;t load analytics right now — try refreshing in a moment.</Empty>
      </div>
    );
  }

  // Card views and Swift Link views stay two numbers, as on each member's own
  // dashboard ("SwiftCard views" / "Swift Link views"); the old "Total views"
  // tile added them together and matched nothing a member could see.
  const totalViews = employees.reduce((s, e) => s + e.views, 0);
  // TRUE distinct across the whole team when the RPC exists; summing the
  // per-employee figures (the fallback) counts a visitor who opened several
  // colleagues' cards once per colleague.
  const summedUnique = employees.reduce((s, e) => s + e.uniqueVisitors, 0);
  const totalUnique = officeUnique ?? summedUnique;
  const totalScans = employees.reduce((s, e) => s + e.scans, 0);
  const totalLeads = employees.reduce((s, e) => s + e.leads, 0);
  const totalContacts = employees.reduce((s, e) => s + e.contactsSaved, 0);
  const totalSwiftlinkViews = employees.reduce((s, e) => s + e.swiftlinkViews, 0);

  const prevTotalViews = prevEmployees.reduce((s, e) => s + e.views, 0);
  const prevTotalSwiftlinkViews = prevEmployees.reduce((s, e) => s + e.swiftlinkViews, 0);
  const prevTotalScans = prevEmployees.reduce((s, e) => s + e.scans, 0);
  const prevTotalLeads = prevEmployees.reduce((s, e) => s + e.leads, 0);
  const prevTotalContacts = prevEmployees.reduce((s, e) => s + e.contactsSaved, 0);

  const chartData = fillDateRange(dailyViews, range.since, range.until, tz);
  const isEmpty = totalViews === 0 && totalSwiftlinkViews === 0 && totalLeads === 0 && totalContacts === 0;

  return (
    <div>
      <PageHead
        title="Analytics"
        desc="Views, contacts and contact downloads for every card on your team, by date."
        action={<AnalyticsDateRangePicker current={preset} />}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {/* The Team tab's four numbers first, for the chosen days, then the
            two that only make sense over a date range. */}
        <StatTile label="Card views" value={totalViews} hint={deltaLabel(totalViews, prevTotalViews)} />
        <StatTile label="Swift Link views" value={totalSwiftlinkViews} hint={deltaLabel(totalSwiftlinkViews, prevTotalSwiftlinkViews)} />
        <StatTile label="Contacts captured" value={totalLeads} hint={deltaLabel(totalLeads, prevTotalLeads)} />
        <StatTile label="Contact downloads" value={totalContacts} hint={deltaLabel(totalContacts, prevTotalContacts)} />
        <StatTile label="Unique visitors" value={totalUnique} hint={officeUnique != null ? "Distinct visitors across the whole team" : "Summed per employee"} />
        <StatTile label="QR & NFC scans" value={totalScans} hint={deltaLabel(totalScans, prevTotalScans)} />
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-6">
        <p className="text-[0.6875rem] font-semibold text-gray-500 uppercase tracking-wider">Views over time</p>
        <p className="text-[0.6875rem] text-gray-600 mt-0.5 mb-3">Card and Swift Link views together</p>
        {isEmpty ? (
          <Empty>No activity yet for this range — this fills in once your team&apos;s cards start getting views.</Empty>
        ) : (
          <ViewsChart data={chartData} />
        )}
      </div>

      {trafficSources.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-6">
          <p className="text-[0.6875rem] font-semibold text-gray-500 uppercase tracking-wider mb-3">Traffic sources</p>
          <div className="space-y-1.5">
            {trafficSources.map((s) => (
              <div key={s.source} className="flex items-center justify-between text-sm">
                <span className="text-gray-300">{getSourceLabel(s.source)}</span>
                <span className="text-gray-500 tabular-nums">{s.views}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-[0.6875rem] font-semibold text-gray-500 uppercase tracking-wider mb-2">Your team</p>
      <EmployeeAnalyticsTable employees={employees} range={preset} />
    </div>
  );
}
