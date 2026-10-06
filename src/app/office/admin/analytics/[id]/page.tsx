import { cookies } from "next/headers";
import { safeTimeZone } from "@/lib/tz-days";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireOfficeAdmin } from "@/lib/office-admin-guard";
import { getOfficeUserIds, isOfficeMember } from "@/lib/office-cards";
import { getAdminSupabase } from "@/lib/supabase-admin";
import {
  getOfficeTeam,
  memberSlugs,
  flattenOfficeKeys,
  getOfficeEmployeeMetricsForTeam,
  getOfficeDailyViews,
  getOfficeTrafficSources,
  getEmployeeCardBreakdown,
  getRecentLeadsForSlugs,
} from "@/lib/office-analytics";
import { resolveDateRange, type DateRangePreset } from "@/lib/office-analytics-dates";
import { fillDateRange } from "@/lib/office-analytics-metrics";
import { getSourceLabel } from "@/lib/source-labels";
import { relativeTime } from "@/lib/relative-time";
import { StatTile, PageHead, Empty } from "@/components/office/OfficeUI";
import ViewsChart from "@/components/ViewsChart";
import AnalyticsDateRangePicker from "../AnalyticsDateRangePicker";

export const metadata = { title: "Employee analytics — Admin — SwiftCard" };

const PRESETS: DateRangePreset[] = ["7d", "30d", "90d"];

export default async function OfficeAnalyticsMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { id } = await params;
  const { office, officeId, ownerId } = await requireOfficeAdmin();
  if (!office || !officeId || !ownerId) redirect("/office/admin");

  // Authorization: only someone this office actually controls — same IDOR
  // guard as /office/admin/team/[id]. Without this, an admin could read any
  // user's activity by pasting a user id into the URL.
  const teamIds = await getOfficeUserIds(officeId);
  if (!isOfficeMember(teamIds, id)) notFound();

  const { range: rawRange } = await searchParams;
  const preset: DateRangePreset = (PRESETS as string[]).includes(rawRange ?? "") ? (rawRange as DateRangePreset) : "30d";
  // The viewer's local calendar (the browser's time zone), like the personal
  // dashboard — see lib/office-analytics-dates.
  const tz = safeTimeZone((await cookies()).get("sc_tz")?.value);
  const range = resolveDateRange(preset, new Date(), undefined, tz);

  const admin = getAdminSupabase();
  const team = await getOfficeTeam(admin, officeId, ownerId);
  const member = team.find((m) => m.userId === id);
  if (!member) notFound();

  const slugs = memberSlugs(member);
  const keys = flattenOfficeKeys(slugs);
  // Reuses the `team` already resolved above instead of getOfficeEmployeeMetrics
  // re-resolving it internally, and runs alongside the other independent
  // queries rather than serially ahead of them (code review).
  const [allMetrics, dailyViews, trafficSources, cardBreakdown, recentLeads] = await Promise.all([
    getOfficeEmployeeMetricsForTeam(team, range.since, range.until).catch(() => []),
    getOfficeDailyViews(keys, range.since, range.until, tz),
    getOfficeTrafficSources(keys, range.since, range.until),
    getEmployeeCardBreakdown(member.cardSlugs, range.since, range.until),
    getRecentLeadsForSlugs(slugs, range.since, range.until),
  ]);
  const mine = allMetrics.find((m) => m.userId === id) ?? null;
  const others = allMetrics.filter((m) => m.userId !== id);
  const officeAverage = {
    views: others.length ? others.reduce((s, e) => s + e.views + e.swiftlinkViews, 0) / others.length : 0,
    contactsSaved: others.length ? others.reduce((s, e) => s + e.contactsSaved, 0) / others.length : 0,
  };

  const chartData = fillDateRange(dailyViews, range.since, range.until, tz);
  const totalViews = (mine?.views ?? 0) + (mine?.swiftlinkViews ?? 0);
  const mostActiveCard = cardBreakdown[0] ?? null;

  return (
    <div>
      <Link href="/office/admin/analytics" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
        ← Back to Analytics
      </Link>

      <div className="mt-3">
        <PageHead title={member.name} desc={member.username ? `@${member.username}` : undefined} action={<AnalyticsDateRangePicker current={preset} />} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatTile label="Total views" value={totalViews} hint="Repeat visits count; reloads within a visit don't" />
        <StatTile label="Unique visitors" value={mine?.uniqueVisitors ?? 0} />
        <StatTile label="Scans" value={mine?.scans ?? 0} hint="QR code or NFC tap" />
        <StatTile label="Leads captured" value={mine?.leads ?? 0} />
        <StatTile label="Contact downloads" value={mine?.contactsSaved ?? 0} />
        <StatTile label="SwiftLink views" value={mine?.swiftlinkViews ?? 0} />
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mb-6 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-400">
        <span>Office average: <span className="text-gray-200 tabular-nums">{officeAverage.views.toFixed(1)}</span> views</span>
        <span>Office average: <span className="text-gray-200 tabular-nums">{officeAverage.contactsSaved.toFixed(1)}</span> contact downloads</span>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-6">
        <p className="text-[0.6875rem] font-semibold text-gray-500 uppercase tracking-wider mb-3">Views over time</p>
        {totalViews === 0 ? <Empty>No views yet for this range.</Empty> : <ViewsChart data={chartData} />}
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <p className="text-[0.6875rem] font-semibold text-gray-500 uppercase tracking-wider mb-3">Traffic sources</p>
          {trafficSources.length === 0 ? (
            <p className="text-gray-500 text-sm">No tracked traffic yet.</p>
          ) : (
            <div className="space-y-1.5">
              {trafficSources.map((s) => (
                <div key={s.source} className="flex items-center justify-between text-sm">
                  <span className="text-gray-300">{getSourceLabel(s.source)}</span>
                  <span className="text-gray-500 tabular-nums">{s.views}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <p className="text-[0.6875rem] font-semibold text-gray-500 uppercase tracking-wider mb-3">Most active card</p>
          {mostActiveCard ? (
            <div>
              <p className="text-white font-medium">{mostActiveCard.label}</p>
              <p className="text-gray-500 text-xs mt-0.5 tabular-nums">{mostActiveCard.views} views this range</p>
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No card yet.</p>
          )}
          <p className="text-gray-600 text-[0.6875rem] mt-3 leading-relaxed">
            Individual SwiftLink click tracking isn&apos;t available yet — only overall Swift Links page visits are
            tracked (see &quot;SwiftLink views&quot; above).
          </p>
        </div>
      </div>

      <p className="text-[0.6875rem] font-semibold text-gray-500 uppercase tracking-wider mb-2">Recent lead activity</p>
      {recentLeads.length === 0 ? (
        <Empty>No leads yet in this range.</Empty>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl divide-y divide-gray-800 overflow-hidden">
          {recentLeads.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="text-sm text-gray-200 truncate">{l.name}</p>
                <p className="text-xs text-gray-500 truncate">{l.email ?? "No email left"}</p>
              </div>
              <p className="text-xs text-gray-600 shrink-0 whitespace-nowrap">{relativeTime(l.created_at)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
