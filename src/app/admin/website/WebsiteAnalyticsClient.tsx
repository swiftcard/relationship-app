"use client";

// ── Website: who visits swiftcard.me ────────────────────────────────────────
// The marketing site's traffic (home, pricing, product and preview pages) —
// not the app, this admin, or shared cards. The owner found the old page "a
// mishmash" (2026-10-27), so it opens on one plain sentence, then splits into
// one tab per question: how many came, what they read, where from, who.
// One fetch feeds every tab; switching tabs keeps it (this stays mounted).

import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader, KpiCard, KpiGrid, Section, Stack, Columns } from "../_ui/layout";
import { Tabs } from "../_ui/links";
import { ShareBar, TrendBars } from "../_ui/charts";
import { EmptyState, ErrorState, HowCounted, NotTracked, PageSkeleton } from "../_ui/states";
import { Icon } from "../_ui/icons";
import { fmtNum } from "../_ui/format";
import { countryFlag, countryName, pageName, referrerName } from "../_ui/labels";
import { WEBSITE_TABS, type WebsiteTab } from "./tabs";

export type WebsiteData = {
  includeInternal: boolean;
  capHit: boolean;
  kpis: {
    pageviews: { d1: number; d7: number; d30: number };
    visitors: { d1: number; d7: number; d30: number };
    sessions: number;
    pagesPerSession: number;
    avgDurationSec: number;
    bounceRatePct: number;
  };
  daily: { date: string; views: number; visitors: number }[];
  topPages: { label: string; count: number }[];
  topReferrers: { label: string; count: number }[];
  topCountries: { label: string; count: number }[];
};

function duration(sec: number) {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

export default function WebsiteAnalyticsClient({ initialInternalDevice, tab = "traffic", initial }: {
  initialInternalDevice: boolean;
  tab?: WebsiteTab;
  /** Fixture data for tests/render; the page itself always fetches. */
  initial?: WebsiteData;
}) {
  const [data, setData] = useState<WebsiteData | null>(initial ?? null);
  const [loading, setLoading] = useState(!initial);
  const [err, setErr] = useState(false);
  const [includeInternal, setIncludeInternal] = useState(false);
  const [internalDevice, setInternalDevice] = useState(initialInternalDevice);
  const [savingDevice, setSavingDevice] = useState(false);
  // With fixture data (tests/render) the first fetch is skipped; the switch
  // still refetches.
  const firstRun = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(false);
    try {
      const res = await fetch(`/api/admin/website?internal=${includeInternal ? "1" : "0"}`);
      if (!res.ok) { setErr(true); return; }
      setData(await res.json());
    } catch {
      setErr(true);
    } finally {
      setLoading(false);
    }
  }, [includeInternal]);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      if (initial) return;
    }
    // On mount, and again whenever the team-visits switch changes.
    load();
  }, [load, initial]);

  async function toggleDevice() {
    const next = !internalDevice;
    setSavingDevice(true);
    try {
      const res = await fetch("/api/admin/website/internal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on: next }),
      });
      if (res.ok) setInternalDevice(next);
    } finally {
      setSavingDevice(false);
    }
  }

  return (
    <Stack>
      <PageHeader
        title="Website"
        description="Who visits swiftcard.me, what they read, and where they came from. Your app, this admin and shared cards aren't counted here."
        actions={
          <>
            <span className={internalDevice ? "sc-badge sc-badge-green" : "sc-badge"} title="Change it on the Settings tab">
              This device: {internalDevice ? "excluded ✓" : "counted"}
            </span>
            <label className="inline-flex items-center gap-2 sc-t-footnote cursor-pointer select-none min-h-[44px]">
              <button
                type="button"
                role="switch"
                aria-checked={includeInternal}
                onClick={() => setIncludeInternal((v) => !v)}
                className="sc-switch sc-switch-sm"
              />
              Include my team&apos;s visits
            </label>
          </>
        }
      />
      <Tabs base="/admin/website" items={[...WEBSITE_TABS]} active={tab} />

      {err && !data ? (
        <ErrorState message="The website numbers didn't load." onRetry={load} />
      ) : !data ? (
        <PageSkeleton kpis={3} />
      ) : (
        <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={loading}>
          {tab === "pages" ? <PagesTab d={data} />
            : tab === "sources" ? <SourcesTab d={data} />
            : tab === "audience" ? <AudienceTab d={data} />
            : tab === "settings" ? <SettingsTab internalDevice={internalDevice} saving={savingDevice} onToggle={toggleDevice} />
            : <TrafficTab d={data} />}
          {data.capHit && tab !== "settings" && (
            <p className="adm-callout-warn px-4 py-3 sc-t-footnote mt-6">Charts reflect the most recent 50,000 pageviews (the 30 days were busier than that).</p>
          )}
        </div>
      )}
    </Stack>
  );
}

/** A ranked list: name on top, the raw value under it, count + share bar. */
function RankList({ rows, empty, name, detail }: {
  rows: { label: string; count: number }[];
  empty: string;
  name: (label: string) => React.ReactNode;
  detail?: (label: string) => React.ReactNode;
}) {
  if (rows.length === 0) return <EmptyState className="pb-6">{empty}</EmptyState>;
  const max = Math.max(1, ...rows.map((r) => r.count));
  const total = rows.reduce((n, r) => n + r.count, 0);
  return (
    <ol className="adm-divide">
      {rows.map((r, i) => (
        <li key={r.label} className="px-4 sm:px-5 py-3 flex items-center gap-3 sm:gap-4">
          <span className="w-5 sc-t-footnote adm-faint adm-num shrink-0">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <p className="sc-t-subhead font-medium truncate">{name(r.label)}</p>
            {detail && <p className="sc-t-caption adm-muted truncate">{detail(r.label)}</p>}
            <div className="mt-1.5 sm:hidden"><ShareBar value={r.count} max={max} /></div>
          </div>
          <div className="hidden sm:block w-40 shrink-0"><ShareBar value={r.count} max={max} /></div>
          <span className="w-14 text-right sc-t-subhead font-semibold adm-num shrink-0">{fmtNum(r.count)}</span>
          <span className="w-10 text-right sc-t-caption adm-muted adm-num shrink-0">{total ? `${Math.round((r.count / total) * 100)}%` : "—"}</span>
        </li>
      ))}
    </ol>
  );
}

// ── Traffic ─────────────────────────────────────────────────────────────────
function TrafficTab({ d }: { d: WebsiteData }) {
  const k = d.kpis;
  const topSource = d.topReferrers[0];
  const topPage = d.topPages[0];
  return (
    <Stack>
      <section className="adm-card p-4 sm:p-5">
        <p className="sc-t-callout">
          In the last 7 days, <b className="adm-num">{fmtNum(k.visitors.d7)}</b> {k.visitors.d7 === 1 ? "person" : "people"} visited swiftcard.me and viewed{" "}
          <b className="adm-num">{fmtNum(k.pageviews.d7)}</b> {k.pageviews.d7 === 1 ? "page" : "pages"}.
          {topSource ? <> Over 30 days the biggest outside source was <b>{referrerName(topSource.label)}</b>.</> : <> Nobody has arrived from another site yet — visits so far are typed in or from apps.</>}
          {topPage && <> The most-read page was <b>{pageName(topPage.label)}</b>.</>}
        </p>
      </section>

      <KpiGrid cols={3}>
        <KpiCard label="Visitors today" value={fmtNum(k.visitors.d1)} sub={`${fmtNum(k.pageviews.d1)} pages viewed`} />
        <KpiCard label="Visitors · 7 days" value={fmtNum(k.visitors.d7)} sub={`${fmtNum(k.pageviews.d7)} pages viewed`} />
        <KpiCard label="Visitors · 30 days" value={fmtNum(k.visitors.d30)} sub={`${fmtNum(k.pageviews.d30)} pages viewed`} />
        <KpiCard label="Pages per visit" value={String(k.pagesPerSession)} sub={`Across ${fmtNum(k.sessions)} visits in 30 days`} />
        <KpiCard label="Time on a page" value={duration(k.avgDurationSec)} sub="On average, before moving on" />
        <KpiCard label="Left after one page" value={`${k.bounceRatePct}%`} sub="Visits that saw a single page" />
      </KpiGrid>

      <Section title="Visitors and pages viewed per day" hint="The last 30 days. The pale bar is pages viewed; the solid bar inside it is the people who viewed them.">
        <TrendBars
          height={180}
          data={d.daily.map((x) => ({ date: x.date, values: [x.views, x.visitors] }))}
          series={[{ label: "Pages viewed", color: "var(--adm-series-1-soft)" }, { label: "Visitors", color: "var(--adm-series-1)" }]}
          caption="Pages viewed and visitors per day, last 30 days"
        />
      </Section>

      <HowCounted>
        <p>A visitor is one browser, counted once in each period however many pages it opens. A visit ends when the tab closes or after a stretch of doing nothing.</p>
        <p>Only the marketing site counts: home, pricing, product and preview pages. The app, this admin and shared cards have their own numbers.</p>
        <p>Your team&apos;s visits are left out unless you switch them on above, and any device marked on the Settings tab never counts.</p>
      </HowCounted>
    </Stack>
  );
}

// ── Pages ───────────────────────────────────────────────────────────────────
function PagesTab({ d }: { d: WebsiteData }) {
  return (
    <Stack>
      <Section title="Most-read pages · 30 days" hint="Every marketing page by how many times it was viewed." flush>
        <RankList rows={d.topPages} empty="No pageviews yet." name={pageName} detail={(p) => p} />
      </Section>
      <Columns>
        <NotTracked title="Time on each page" detail="which pages people actually read, not just open." />
        <NotTracked title="Where people leave" detail="the last page before someone closes the site." />
      </Columns>
    </Stack>
  );
}

// ── Sources ─────────────────────────────────────────────────────────────────
function SourcesTab({ d }: { d: WebsiteData }) {
  return (
    <Stack>
      <Section
        title="Where visitors come from · 30 days"
        hint="The site someone was on just before. Typed-in addresses, bookmarks and most apps don't say where they came from, so they aren't listed here."
        flush
      >
        <RankList rows={d.topReferrers} empty="No outside sources yet — traffic so far is typed in or from apps." name={referrerName} detail={(h) => h} />
      </Section>
      <Columns>
        <NotTracked title="Campaigns" detail="visits from your own tagged links (flyers, posts, emails), by campaign." />
        <NotTracked title="Signups by source" detail="which source brings people who go on to make an account." />
      </Columns>
    </Stack>
  );
}

// ── Audience ────────────────────────────────────────────────────────────────
function AudienceTab({ d }: { d: WebsiteData }) {
  return (
    <Stack>
      <Section title="Countries · 30 days" hint="Where visitors are, by pageviews." flush>
        <RankList
          rows={d.topCountries}
          empty="No location data yet."
          name={(c) => <><span aria-hidden className="mr-2">{countryFlag(c)}</span>{countryName(c)}</>}
          detail={(c) => c.toUpperCase()}
        />
      </Section>
      <Columns>
        <NotTracked title="Phone or computer" detail="how many visitors are on a phone, a tablet or a computer." />
        <NotTracked title="New or returning" detail="first-time visitors against people coming back." />
      </Columns>
    </Stack>
  );
}

// ── Settings ────────────────────────────────────────────────────────────────
function SettingsTab({ internalDevice, saving, onToggle }: { internalDevice: boolean; saving: boolean; onToggle: () => void }) {
  return (
    <Stack>
      <Section title="This device" hint="Turn this on wherever you and your partner browse the site, so your own visits don't inflate the numbers.">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="sc-t-subhead flex items-center gap-2">
            <span className={internalDevice ? "adm-good" : "adm-muted"}><Icon name={internalDevice ? "check" : "website"} /></span>
            {internalDevice ? "This device is excluded from the numbers." : "This device is counted in the numbers."}
          </p>
          <button
            type="button"
            onClick={onToggle}
            disabled={saving}
            className={`sc-btn sc-btn-sm ${internalDevice ? "sc-btn-gray" : "sc-btn-filled"}`}
          >
            {saving ? "Saving…" : internalDevice ? "Count this device again" : "Exclude my visits"}
          </button>
        </div>
      </Section>
      <Section title="What's counted here">
        <ul className="space-y-2 sc-t-subhead">
          <li className="flex gap-2"><span className="adm-good"><Icon name="check" /></span>The marketing site: home, pricing, the product pages and the card preview.</li>
          <li className="flex gap-2"><span className="adm-muted"><Icon name="close" /></span>The app (dashboard, settings), this admin, and people&apos;s shared cards — those have their own numbers.</li>
          <li className="flex gap-2"><span className="adm-muted"><Icon name="close" /></span>Your team&apos;s visits, unless you switch &ldquo;Include my team&apos;s visits&rdquo; on at the top.</li>
        </ul>
      </Section>
    </Stack>
  );
}
