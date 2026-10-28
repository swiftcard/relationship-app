"use client";

// ── Website: who visits swiftcard.me ────────────────────────────────────────
// The marketing site's traffic (home, pricing, product and preview pages) —
// not the app, this admin, or shared cards. The owner found the old page "a
// mishmash" (2026-10-27), so it opens on one plain sentence, then splits into
// one tab per question: how many came, what they read, where from, who.
// One fetch feeds every tab; switching tabs keeps it (this stays mounted).
// The counting lives in lib/admin-data/website.ts (2026-10-28: every row,
// sources once per visit, New York days, the team's own visits counted apart).

import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader, KpiCard, KpiGrid, Section, Stack, Columns } from "../_ui/layout";
import { Tabs } from "../_ui/links";
import { ShareBar, TrendBars } from "../_ui/charts";
import { EmptyState, ErrorState, HowCounted, PageSkeleton } from "../_ui/states";
import { Icon } from "../_ui/icons";
import { fmtLongDate, fmtNum } from "../_ui/format";
import { countryFlag, countryName, pageName } from "../_ui/labels";
import { WEBSITE_TABS, type WebsiteTab } from "./tabs";
import type { WebsiteSummary } from "@/lib/admin-data/website";

export type WebsiteData = { includeInternal: boolean; capHit: boolean } & WebsiteSummary;

/** "1 visit", "12 visits". */
function many(n: number, word: string) {
  return `${fmtNum(n)} ${n === 1 ? word : `${word}s`}`;
}

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
      {data && <TeamLine d={data} />}
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
            <p className="adm-callout-warn px-4 py-3 sc-t-footnote mt-6">These numbers cover the first 300,000 pageviews of the 30 days (the month was busier than that).</p>
          )}
        </div>
      )}
    </Stack>
  );
}

/** A ranked list: name on top, the raw value under it, count + share bar. */
/** What the switch did, in words: the team's own visits in the 30 days and
 *  whether they're in the numbers. Zero says so too, so the switch is never a
 *  mystery. */
function TeamLine({ d }: { d: WebsiteData }) {
  const n = d.team.visits;
  const visits = many(n, "visit");
  return (
    <p className="sc-t-footnote adm-muted -mt-2" data-testid="team-line">
      {n === 0
        ? "Your team: no visits of your own in the last 30 days."
        : d.includeInternal
          ? <>Your team: <b className="adm-num">{visits}</b> ({many(d.team.pageviews, "page")}) included below.</>
          : <>Your team: <b className="adm-num">{visits}</b> ({many(d.team.pageviews, "page")}) left out of these numbers.</>}
    </p>
  );
}

function RankList<R extends { label: string; count: number }>({ rows, empty, name, detail, value }: {
  rows: R[];
  empty: string;
  name: (label: string) => React.ReactNode;
  detail?: (row: R) => React.ReactNode;
  /** The right-hand figure, when it isn't the count. */
  value?: (row: R) => React.ReactNode;
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
            {detail && <p className="sc-t-caption adm-muted truncate">{detail(r)}</p>}
            <div className="mt-1.5 sm:hidden"><ShareBar value={r.count} max={max} /></div>
          </div>
          <div className="hidden sm:block w-40 shrink-0"><ShareBar value={r.count} max={max} /></div>
          <span className="w-14 text-right sc-t-subhead font-semibold adm-num shrink-0">{value ? value(r) : fmtNum(r.count)}</span>
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
          In the last 7 days, <b className="adm-num">{fmtNum(k.visitors.d7)}</b> {k.visitors.d7 === 1 ? "person" : "people"} visited swiftcard.me{" "}
          <b className="adm-num">{fmtNum(k.visits.d7)}</b> {k.visits.d7 === 1 ? "time" : "times"} and viewed{" "}
          <b className="adm-num">{fmtNum(k.pageviews.d7)}</b> {k.pageviews.d7 === 1 ? "page" : "pages"}.
          {topSource ? <> Over 30 days the biggest outside source was <b>{topSource.label}</b>.</> : <> Nobody has arrived from another site yet — visits so far are typed in or from apps.</>}
          {topPage && <> The most-read page was <b>{pageName(topPage.label)}</b>.</>}
        </p>
      </section>

      <KpiGrid cols={3}>
        <KpiCard label="Visitors today" value={fmtNum(k.visitors.d1)} sub={`${many(k.visits.d1, "visit")} · ${many(k.pageviews.d1, "page")}`} />
        <KpiCard label="Visitors · 7 days" value={fmtNum(k.visitors.d7)} sub={`${many(k.visits.d7, "visit")} · ${many(k.pageviews.d7, "page")}`} />
        <KpiCard label="Visitors · 30 days" value={fmtNum(k.visitors.d30)} sub={`${many(k.visits.d30, "visit")} · ${many(k.pageviews.d30, "page")}`} />
        <KpiCard label="Pages per visit" value={String(k.pagesPerSession)} sub={`Across ${fmtNum(k.visits.d30)} visits in 30 days`} />
        <KpiCard label="Time on a page" value={duration(k.avgDurationSec)} sub="On average, while the page was on screen" />
        <KpiCard label="Left after one page" value={`${k.bounceRatePct}%`} sub="Saw one page and didn't go on to sign up or in" />
      </KpiGrid>

      <Section title="Visitors and pages viewed per day" hint="The last 30 days, New York time. The pale bar is pages viewed; the solid bar inside it is the people who viewed them.">
        <TrendBars
          height={180}
          data={d.daily.map((x) => ({ date: x.date, values: [x.views, x.visitors] }))}
          series={[{ label: "Pages viewed", color: "var(--adm-series-1-soft)" }, { label: "Visitors", color: "var(--adm-series-1)" }]}
          caption="Pages viewed and visitors per day, last 30 days"
        />
      </Section>

      <HowCounted>
        <p>A visitor is one person&apos;s browser, counted once in each period however many pages it opens. A visit ends when the tab closes or after 30 minutes of doing nothing. Days are New York calendar days; &ldquo;today&rdquo; started at midnight.</p>
        <p>A page counts once someone has had it on screen for a second. Previews, prerendered pages, automated browsers and traffic from cloud servers aren&apos;t people, so they never count.</p>
        <p>Only the marketing site counts: home, pricing, the product, comparison and help pages, the card builder and sign-in. The app, this admin and shared cards have their own numbers.</p>
        <p>Your team&apos;s visits (any of our accounts, signed in or not, and any device marked on the Settings tab) are left out unless you switch them on above.</p>
      </HowCounted>
    </Stack>
  );
}

// ── Pages ───────────────────────────────────────────────────────────────────
function PagesTab({ d }: { d: WebsiteData }) {
  return (
    <Stack>
      <Section title="Most-read pages · 30 days" hint="Every marketing page by how many times it was viewed, and how long it was on screen on average." flush>
        <RankList
          rows={d.topPages}
          empty="No pageviews yet."
          name={pageName}
          detail={(p) => <>{p.label}{p.avgSec != null && <> · {duration(p.avgSec)} on average</>}</>}
        />
      </Section>
      <Section title="Where people leave · 30 days" hint="The last page of each visit." flush>
        <RankList rows={d.exitPages} empty="No visits yet." name={pageName} detail={(p) => p.label} />
      </Section>
    </Stack>
  );
}

// ── Sources ─────────────────────────────────────────────────────────────────
function SourcesTab({ d }: { d: WebsiteData }) {
  const since = d.detailSince ? fmtLongDate(d.detailSince) : null;
  return (
    <Stack>
      <Section
        title="Where visits come from · 30 days"
        hint="The site someone was on just before, counted once per visit."
        flush
      >
        <RankList rows={d.topReferrers} empty="No outside sources yet — traffic so far is typed in or from apps." name={(n) => n} detail={(r) => r.detail} />
        <p className="px-4 sm:px-5 py-3 sc-t-footnote adm-muted">
          <b className="adm-num">{fmtNum(d.directVisits)}</b> {d.directVisits === 1 ? "visit" : "visits"} didn&apos;t say where {d.directVisits === 1 ? "it" : "they"} came from: a typed-in address, a bookmark, or an app that doesn&apos;t pass it on.
        </p>
      </Section>
      <Columns>
        <Section title="Campaigns · 30 days" hint={`Visits that started on one of your tagged links (?utm_… or ?src=).${since ? ` Counted since ${since}.` : ""}`} flush>
          <RankList rows={d.campaigns} empty="No tagged visits yet. Add ?utm_campaign= or ?src= to a link to see it here." name={(n) => n} />
        </Section>
        <Section title="Went on to build a card · 30 days" hint="Visits that reached the card builder, by where they came from." flush>
          <RankList rows={d.builderBySource} empty="No visit has reached the card builder yet." name={(n) => n} />
        </Section>
      </Columns>
    </Stack>
  );
}

// ── Audience ────────────────────────────────────────────────────────────────
const DEVICE_NAMES: Record<string, string> = { phone: "Phone", tablet: "Tablet", computer: "Computer" };

function AudienceTab({ d }: { d: WebsiteData }) {
  const since = d.detailSince ? fmtLongDate(d.detailSince) : null;
  const people = d.kpis.visitors.d30;
  return (
    <Stack>
      <KpiGrid cols={3}>
        <KpiCard label="Visitors · 30 days" value={fmtNum(people)} sub={many(d.kpis.visits.d30, "visit")} />
        <KpiCard label="Came back" value={fmtNum(d.kpis.cameBack)} sub="Two or more separate visits" />
        <KpiCard label="Came once" value={fmtNum(Math.max(0, people - d.kpis.cameBack))} sub="One visit in the 30 days" />
      </KpiGrid>
      <Columns>
        <Section title="Countries · 30 days" hint="Where visitors are, one count per person." flush>
          <RankList
            rows={d.topCountries}
            empty="No location data yet."
            name={(c) => <><span aria-hidden className="mr-2">{countryFlag(c)}</span>{countryName(c)}</>}
            detail={(c) => c.label.toUpperCase()}
          />
        </Section>
        <Section title="Phone or computer · 30 days" hint={`One count per person, by what their browser says it is.${since ? ` Counted since ${since}.` : ""}`} flush>
          <RankList rows={d.devices} empty="Not recorded yet — it starts with the next visit." name={(k) => DEVICE_NAMES[k] ?? k} />
        </Section>
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
          <li className="flex gap-2"><span className="adm-good"><Icon name="check" /></span>The marketing site: home, pricing, the product, comparison and help pages, the card builder and sign-in.</li>
          <li className="flex gap-2"><span className="adm-muted"><Icon name="close" /></span>The app (dashboard, settings), this admin, and people&apos;s shared cards — those have their own numbers.</li>
          <li className="flex gap-2"><span className="adm-muted"><Icon name="close" /></span>Your team&apos;s visits: any of our accounts (signed in, or on a browser one has signed in on) and any device marked here — unless you switch &ldquo;Include my team&apos;s visits&rdquo; on at the top.</li>
          <li className="flex gap-2"><span className="adm-muted"><Icon name="close" /></span>Previews, automated browsers and traffic from cloud servers. They aren&apos;t people.</li>
        </ul>
      </Section>
    </Stack>
  );
}
