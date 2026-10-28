import { startOfNyDay, nyDayKey, nyDayKeys } from "./time";
import { referrerName } from "@/app/admin/_ui/labels";

// ── The Website page's numbers, from every pageview ─────────────────────────
//
// The owner, 2026-10-28: "website analytics is fake — make it accurate". What
// was wrong, each of which this module fixes:
//
//   • Only the newest 1,000 rows were read (PostgREST's silent cap), so with
//     "Include my team's visits" on, every number except pageviews came from
//     a sample. The route now pages through the whole window and hands it here.
//   • A visit's source was counted once per PAGEVIEW, and a client-side page
//     change kept the original document.referrer — so one visit from Google
//     that read six pages was "6 from Google". Sources are counted once per
//     VISIT, from the page it started on.
//   • Visits were keyed on the tab's session id alone, and every browser with
//     storage blocked shared the id "nostore" — one giant visit. A visit is
//     now visitor + session.
//   • Days were UTC and "today" was the last 24 hours. Both are New York
//     calendar days now, like every other admin number (./time.ts).
//   • Countries were counted per pageview; they are per person now.
//
// Pure: the route reads the rows, this counts them, tests pin the counting.

export type PageviewRow = {
  visitor_id: string | null;
  session_id: string | null;
  path: string;
  referrer: string | null;
  country: string | null;
  duration_ms: number | null;
  created_at: string;
  is_internal: boolean | null;
  landing?: boolean | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  src?: string | null;
  device?: string | null;
};

export type Ranked = { label: string; count: number };

export type WebsiteSummary = {
  /** The team's own rows in the 30 days — what the switch adds or leaves out. */
  team: { pageviews: number; visits: number; visitors: number };
  kpis: {
    pageviews: { d1: number; d7: number; d30: number };
    visitors: { d1: number; d7: number; d30: number };
    visits: { d1: number; d7: number; d30: number };
    /** = visits.d30, kept for older readers. */
    sessions: number;
    pagesPerSession: number;
    avgDurationSec: number;
    bounceRatePct: number;
    /** People with two or more visits in the 30 days. */
    cameBack: number;
  };
  daily: { date: string; views: number; visitors: number }[];
  /** avgSec: average visible time on that page, when at least 3 views were timed. */
  topPages: (Ranked & { avgSec: number | null })[];
  /** The last page of each visit. */
  exitPages: Ranked[];
  /** Grouped by the name people know; detail lists the hosts behind it. */
  topReferrers: (Ranked & { detail: string })[];
  /** Visits that arrived with no referrer: typed in, bookmarks, most apps. */
  directVisits: number;
  topCountries: Ranked[];
  devices: Ranked[];
  campaigns: Ranked[];
  /** Visits that went on to the card builder, by where they came from. */
  builderBySource: Ranked[];
  /** When campaigns and devices started being recorded (the first row with a
   *  device), so the page can say "counted from …". Null when none yet. */
  detailSince: string | null;
};

/** A visit that continues into one of these isn't a bounce, and a one-page
 *  visit that IS one of these isn't either: the person went to sign up or in. */
const CONTINUE_PATHS = new Set(["/cards/new", "/login"]);
const NO_REFERRER = "No referrer";

const t = (r: PageviewRow) => Date.parse(r.created_at);

function rank(m: Map<string, number>, n: number): Ranked[] {
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([label, count]) => ({ label, count }));
}

function bump(m: Map<string, number>, k: string, by = 1) {
  m.set(k, (m.get(k) ?? 0) + by);
}

function campaignOf(r: PageviewRow): string | null {
  if (r.src) return `src=${r.src}`;
  if (r.utm_campaign) return r.utm_source ? `${r.utm_source} · ${r.utm_campaign}` : r.utm_campaign;
  if (r.utm_source) return r.utm_medium ? `${r.utm_source} · ${r.utm_medium}` : r.utm_source;
  return null;
}

type Visit = { first: PageviewRow; last: PageviewRow; views: number; paths: Set<string>; campaign: string | null };

function visitsOf(rows: PageviewRow[]): Map<string, Visit> {
  const visits = new Map<string, Visit>();
  for (const r of rows) {
    const key = `${r.visitor_id ?? "?"}|${r.session_id ?? "?"}`;
    const v = visits.get(key);
    if (!v) {
      visits.set(key, { first: r, last: r, views: 1, paths: new Set([r.path]), campaign: campaignOf(r) });
    } else {
      v.last = r;
      v.views++;
      v.paths.add(r.path);
      v.campaign ??= campaignOf(r);
    }
  }
  return visits;
}

export function summarizeWebsite(rows: PageviewRow[], opts: { includeInternal: boolean; now?: Date }): WebsiteSummary {
  const now = opts.now ?? new Date();
  const start1 = startOfNyDay(0, now).getTime();
  const start7 = startOfNyDay(6, now).getTime();
  const start30 = startOfNyDay(29, now).getTime();

  // Oldest first: a visit's first row is its landing page, its last its exit.
  const inWindow = rows.filter((r) => t(r) >= start30).sort((a, b) => t(a) - t(b));
  const teamRows = inWindow.filter((r) => r.is_internal === true);
  const counted = opts.includeInternal ? inWindow : inWindow.filter((r) => r.is_internal !== true);

  const visitorsSince = (from: number) => new Set(counted.filter((r) => t(r) >= from).map((r) => r.visitor_id ?? "?")).size;
  const pageviewsSince = (from: number) => counted.filter((r) => t(r) >= from).length;

  const visits = visitsOf(counted);
  const visitList = [...visits.values()];
  const visitsSince = (from: number) => visitList.filter((v) => t(v.first) >= from).length;

  // Per day, on the New York calendar.
  const dayViews = new Map(nyDayKeys(30, now).map((k) => [k, 0]));
  const dayPeople = new Map(nyDayKeys(30, now).map((k) => [k, new Set<string>()]));
  for (const r of counted) {
    const k = nyDayKey(r.created_at);
    if (!dayViews.has(k)) continue;
    bump(dayViews, k);
    dayPeople.get(k)!.add(r.visitor_id ?? "?");
  }

  // Pages, and how long each was looked at.
  const pathCount = new Map<string, number>();
  const pathTime = new Map<string, { sum: number; n: number }>();
  let durationSum = 0;
  let durationN = 0;
  for (const r of counted) {
    bump(pathCount, r.path);
    if (r.duration_ms != null && r.duration_ms > 0) {
      durationSum += r.duration_ms;
      durationN++;
      const pt = pathTime.get(r.path) ?? { sum: 0, n: 0 };
      pt.sum += r.duration_ms;
      pt.n++;
      pathTime.set(r.path, pt);
    }
  }
  const topPages = rank(pathCount, 12).map((p) => {
    const pt = pathTime.get(p.label);
    return { ...p, avgSec: pt && pt.n >= 3 ? Math.round(pt.sum / pt.n / 1000) : null };
  });

  // Once per visit: where it came from, where it ended, its campaign, and
  // whether it reached the card builder.
  const sourceCount = new Map<string, number>();
  const sourceHosts = new Map<string, Set<string>>();
  const exitCount = new Map<string, number>();
  const campaignCount = new Map<string, number>();
  const builderCount = new Map<string, number>();
  let directVisits = 0;
  let bounces = 0;
  const visitsPerPerson = new Map<string, number>();
  for (const v of visitList) {
    const host = v.first.referrer;
    const source = host ? referrerName(host) : NO_REFERRER;
    if (host) {
      bump(sourceCount, source);
      const hosts = sourceHosts.get(source) ?? new Set<string>();
      hosts.add(host);
      sourceHosts.set(source, hosts);
    } else {
      directVisits++;
    }
    bump(exitCount, v.last.path);
    if (v.campaign) bump(campaignCount, v.campaign);
    if (v.paths.has("/cards/new")) bump(builderCount, source);
    if (v.views === 1 && !CONTINUE_PATHS.has(v.first.path)) bounces++;
    bump(visitsPerPerson, v.first.visitor_id ?? "?");
  }

  // Once per person: their country (first seen) and device (last seen).
  const personCountry = new Map<string, string>();
  const personDevice = new Map<string, string>();
  for (const r of counted) {
    const who = r.visitor_id ?? "?";
    if (r.country && !personCountry.has(who)) personCountry.set(who, r.country);
    if (r.device) personDevice.set(who, r.device);
  }
  const countryCount = new Map<string, number>();
  for (const c of personCountry.values()) bump(countryCount, c);
  const deviceCount = new Map<string, number>();
  for (const d of personDevice.values()) bump(deviceCount, d);

  const firstDetail = inWindow.find((r) => r.device);
  const visits30 = visitList.length;
  const pageviews30 = counted.length;

  return {
    team: {
      pageviews: teamRows.length,
      visits: visitsOf(teamRows).size,
      visitors: new Set(teamRows.map((r) => r.visitor_id ?? "?")).size,
    },
    kpis: {
      pageviews: { d1: pageviewsSince(start1), d7: pageviewsSince(start7), d30: pageviews30 },
      visitors: { d1: visitorsSince(start1), d7: visitorsSince(start7), d30: visitorsSince(start30) },
      visits: { d1: visitsSince(start1), d7: visitsSince(start7), d30: visits30 },
      sessions: visits30,
      pagesPerSession: visits30 ? Math.round((pageviews30 / visits30) * 10) / 10 : 0,
      avgDurationSec: durationN ? Math.round(durationSum / durationN / 1000) : 0,
      bounceRatePct: visits30 ? Math.round((bounces / visits30) * 100) : 0,
      cameBack: [...visitsPerPerson.values()].filter((n) => n >= 2).length,
    },
    daily: [...dayViews.entries()].map(([date, views]) => ({ date, views, visitors: dayPeople.get(date)!.size })),
    topPages,
    exitPages: rank(exitCount, 10),
    topReferrers: rank(sourceCount, 10).map((s) => ({ ...s, detail: [...(sourceHosts.get(s.label) ?? [])].sort().join(", ") })),
    directVisits,
    topCountries: rank(countryCount, 10),
    devices: rank(deviceCount, 3),
    campaigns: rank(campaignCount, 10),
    builderBySource: rank(builderCount, 10),
    detailSince: firstDetail ? firstDetail.created_at : null,
  };
}
