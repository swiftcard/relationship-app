"use client";

// ── Company Analytics: the numbers that grow the business ──────────────────
// One fetch of /api/admin/analytics feeds five of the seven tabs (Growth,
// Revenue, Funnel, Engagement, Data quality); Retention is rendered on the
// server (RetentionTab) and Referrals has its own endpoint (ReferralsTab).
// Switching between these five tabs never refetches: the page swaps `tab`
// and this component stays mounted.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getSignupSourceLabel, getSourceLabel } from "@/lib/source-labels";
import type { WarmLeadMetrics } from "@/lib/warm-lead-metrics";
import { PLAN_PRICES } from "@/lib/plan";
import { Columns, KpiCard, KpiGrid, Section, Stack } from "../_ui/layout";
import { BarList, PlanMixBar, TrendBars } from "../_ui/charts";
import { EmptyState, ErrorState, HowCounted, NotTracked, PageSkeleton } from "../_ui/states";
import { Avatar, PlanBadge } from "../_ui/badges";
import { fmtDateTime, fmtMoney, fmtNum, fmtPct, periodDelta, timeAgo } from "../_ui/format";
import { SeeAll } from "../_ui/links";
import { Icon } from "../_ui/icons";

type Funnel = {
  available: boolean;
  d30: Record<string, number>;
  d7: Record<string, number>;
  internal30: number;
  topCtas: [string, number][];
  lockedFeatures: [string, number][];
};

export type Analytics = {
  /** The click funnel (product_events). `available: false` means
   *  supabase/product-events.sql hasn't been run yet. */
  funnel?: Funnel;
  /** Ingest DECISIONS, not traffic — see lib/ingest-log.ts. `available: false`
   *  means supabase/analytics-accuracy.sql hasn't been run yet. */
  ingest?: {
    available: boolean;
    byReason: [string, number][];
    byClassification: [string, number][];
    byGeoAccuracy: [string, number][];
    counted7: number;
    declined7: number;
    relay7: number;
    recentDeclines: { at: string; entity: string; event: string; reason: string; classification: string | null }[];
  };
  /** Returning-contact alerts (lib/warm-lead-metrics.ts). */
  warmLead?: WarmLeadMetrics;
  accounts: { total: number; today: number; d7: number; d30: number; series: { date: string; count: number }[]; recent: { id?: string; name: string; email: string; username: string; plan: string; created_at: string }[] };
  plans: { free: number; pro: number; office: number; paid: number; conversion: number; estMrr: number; compedPaidPlans?: number };
  acquisition: { source: string; signups: number; d30: number; paid: number; paidRate: number }[];
  cards: { total: number; perAccount: number };
  leads: { total: number; today: number; d7: number; series: { date: string; count: number }[]; bySource: [string, number][]; perAccount: number };
  views: { total: number; d7: number; cardViews30: number; linkViews30: number };
  engagement: { activatedCards: number; activationRate: number };
  topCards: { username: string; count: number }[];
};

// The ingest vocabulary in plain words. Written so the panel answers "why is
// that view missing?" without anyone having to open lib/ingest-log.ts.
const REASON_LABEL: Record<string, string> = {
  recorded: "Counted — a real visit",
  deduped: "Same visit again (reload / double-fire)",
  self: "The owner's own visit",
  inactive: "Card no longer serves",
  bot: "Bot, crawler or preview",
  prefetch: "Browser prefetch / prerender",
  rate_limited: "Over the per-IP cap",
  rejected: "Refused (bad event type)",
  error: "Write failed",
};
const CLASSIFICATION_LABEL: Record<string, string> = {
  human: "Human",
  crawler: "Crawler / unfurler",
  automation: "Headless browser",
  monitor: "Uptime monitor",
  http_client: "Scripted HTTP client",
  datacenter: "Datacenter network",
};
const GEO_LABEL: Record<string, string> = {
  city: "City — two databases agreed",
  city_approx: "Near a city — one source only",
  region: "Region only — sources disagreed",
  country: "Country only",
  "—": "No location",
};

/**
 * The journey, in the order a real person walks it.
 *
 * Labelled in plain words rather than event names: this panel exists to answer
 * "where do people give up?", and "card_creation_started" does not answer that
 * to anyone reading it quickly. `key` is the event name from lib/events.ts.
 */
const FUNNEL_STEPS: { key: string; label: string; hint: string; fromAccounts?: boolean }[] = [
  { key: "page_viewed", label: "Landed on the site", hint: "Home, pricing or the builder" },
  { key: "card_creation_started", label: "Started building a card", hint: "Opened the card editor (once per visit)" },
  { key: "card_creation_completed", label: "Finished the card", hint: "Reached the end of the builder" },
  // Counted from the accounts table, not an event: a real row is exact, can't
  // double-count a revisit, and can't be lost to a blocked request. Never
  // measure with an event something the database already knows for certain.
  { key: "account_created", label: "Created an account", hint: "From real accounts, not clicks", fromAccounts: true },
  { key: "plan_selected", label: "Picked a plan", hint: "Free or paid — the choice itself" },
  { key: "upgrade_prompt_viewed", label: "Hit a Pro-only feature", hint: "Bumped into something locked" },
  { key: "upgrade_started", label: "Clicked upgrade", hint: "Went looking for the paid plan" },
  { key: "checkout_started", label: "Opened checkout", hint: "Reached the payment step" },
  { key: "checkout_completed", label: "Paid", hint: "Money in" },
];

/**
 * The `feature` key on every PlanGate, in plain words.
 *
 * These keys are written for the code ("swift-links-cap"), and this panel's
 * whole job is to say which Pro feature Free users want most. A raw key needs
 * decoding before it can answer that, which is one step too many for a number
 * you glance at.
 */
export const GATE_LABEL: Record<string, string> = {
  "colors-fonts": "Any color & finishes",
  "custom-designer": "The custom designer",
  customization: "Card customization",
  "second-card": "A second card",
  "leads-cap": "More than 5 leads a month",
  "leads-locked": "Seeing a locked lead",
  "swift-links-cap": "More Swift Links",
  "link-off-badge": "Removing the SwiftCard badge",
  scanner: "Scanning a paper card",
  "ai-sequences": "Automated follow-ups",
  "analytics-locations": "Who viewed & where",
  "card-view-only": "Full card analytics",
  "csv-export": "Exporting contacts",
  "integration-crm": "CRM sync",
  "integration-google": "Google Contacts sync",
  "integration-zapier": "Zapier",
};
const gateLabel = (k: string) => GATE_LABEL[k] ?? k.replace(/-/g, " ");

const toRows = (pairs: [string, number][], label: (k: string) => string = (k) => k.replace(/_/g, " ")) =>
  pairs.map(([k, n]) => ({ key: k, label: label(k), value: n }));

export function FunnelPanel({ funnel, signups }: { funnel: Funnel; signups: { d30: number; d7: number } }) {
  if (!funnel.available) {
    return (
      <Section title="The journey · last 30 days">
        <p className="adm-callout-warn px-4 py-3 sc-t-subhead">
          Not switched on yet — run <code className="font-mono">supabase/product-events.sql</code> in the Supabase SQL editor and this fills in on its own.
        </p>
      </Section>
    );
  }

  const rows = FUNNEL_STEPS.map((s) => ({
    ...s,
    n30: s.fromAccounts ? signups.d30 : funnel.d30[s.key] ?? 0,
    n7: s.fromAccounts ? signups.d7 : funnel.d7[s.key] ?? 0,
  }));
  const top = Math.max(1, ...rows.map((r) => r.n30));
  const anyData = rows.some((r) => r.n30 > 0);

  return (
    <Stack>
      <Section
        title="The journey · last 30 days"
        hint={
          <>
            Every step someone takes before they pay. The percentage is how many of the step before made it this far — that&apos;s where you&apos;re losing people.
            {funnel.internal30 > 0 && <> {funnel.internal30.toLocaleString()} of your own events are left out.</>}
          </>
        }
      >
        {!anyData ? (
          <EmptyState>Nothing yet. Numbers appear here as soon as real visitors move through the site.</EmptyState>
        ) : (
          <div className="space-y-3 sm:space-y-2">
            {rows.map((r, i) => {
              const prev = i === 0 ? null : rows[i - 1].n30;
              // Only meaningful once the step above actually happened.
              const pct = prev && prev > 0 ? Math.round((r.n30 / prev) * 100) : null;
              return (
                // Stacks on a phone. Side by side, a fixed label column left the
                // bar about 80px wide, so every step drew nearly the same length
                // and the funnel stopped showing the drop-off it exists to show —
                // and the count inside the bar clipped to a single digit.
                <div key={r.key} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                  <div className="sm:w-48 shrink-0 min-w-0">
                    <p className="sc-t-subhead truncate" title={r.label}>{i + 1}. {r.label}</p>
                    <p className="sc-t-caption adm-muted truncate" title={r.hint}>{r.hint}</p>
                  </div>
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="flex-1 h-6 adm-track overflow-hidden min-w-0" style={{ borderRadius: 6 }}>
                      <div
                        className="h-full"
                        style={{ width: `${(r.n30 / top) * 100}%`, borderRadius: "0 6px 6px 0", background: "linear-gradient(90deg, var(--adm-series-1, #1D4ED8), var(--adm-plan-office, #B26CF5))" }}
                      />
                    </div>
                    {/* The count sits OUTSIDE the bar: inside, a small step's own
                        number is wider than the bar drawn for it. */}
                    <span className="w-14 text-right sc-t-subhead font-semibold adm-num shrink-0">{r.n30.toLocaleString()}</span>
                    <span className="w-12 text-right sc-t-footnote adm-num shrink-0">
                      {pct === null ? <span className="adm-faint">—</span> : pct > 100 ? (
                        // Not every step feeds only from the one above it: someone
                        // can sign up without ever opening the builder, and for
                        // the first 30 days accounts predate this tracking
                        // entirely. Shown grey rather than as a green 300%, which
                        // would read as a wildly good conversion rate.
                        <span className="adm-faint" title="More than the step above — some people arrive here without passing through it.">&gt;100%</span>
                      ) : (
                        <span className={pct >= 50 ? "adm-good" : pct >= 20 ? "adm-warn" : "adm-bad"}>{pct}%</span>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {(funnel.lockedFeatures.length > 0 || funnel.topCtas.length > 0) && (
        <Columns>
          <Section title="Which Pro features they want" hint="What Free users bump into most. The top one is your best upgrade pitch.">
            <BarList rows={toRows(funnel.lockedFeatures, gateLabel)} color="var(--adm-series-3)" empty="No one has hit a Pro feature yet." />
          </Section>
          <Section title="Most-clicked buttons" hint="Which calls to action people actually press.">
            <BarList rows={toRows(funnel.topCtas)} color="var(--adm-series-2)" empty="No button clicks yet." />
          </Section>
        </Columns>
      )}
    </Stack>
  );
}

export default function AnalyticsClient({ tab, initial }: {
  tab: "growth" | "revenue" | "funnel" | "engagement" | "data";
  /** Fixture data for tests/render; the page itself always fetches. */
  initial?: Analytics;
}) {
  const [a, setA] = useState<Analytics | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    fetch("/api/admin/analytics")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("The server didn't answer. Try again in a moment."))))
      .then(setA)
      .catch((e) => setError(e instanceof Error && e.message ? e.message : "Couldn't reach the server."));
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time data fetch on mount; load() owns its own state
  useEffect(() => { if (!initial) load(); }, [load, initial]);

  if (error && !a) return <ErrorState message={error} onRetry={load} />;
  if (!a) return <PageSkeleton />;

  if (tab === "revenue") return <RevenueTab a={a} />;
  if (tab === "funnel") return <FunnelTab a={a} />;
  if (tab === "engagement") return <EngagementTab a={a} />;
  if (tab === "data") return <DataQualityTab a={a} />;
  return <GrowthTab a={a} />;
}

// ── Growth ──────────────────────────────────────────────────────────────────
function GrowthTab({ a }: { a: Analytics }) {
  const delta = periodDelta(a.accounts.series);
  const perDay = a.accounts.d30 / 30;
  return (
    <Stack>
      <KpiGrid>
        <KpiCard label="Total accounts" value={fmtNum(a.accounts.total)} sub="Customers only — your own and the demo account are left out" />
        <KpiCard label="New signups · 7 days" value={fmtNum(a.accounts.d7)} delta={delta} trend={a.accounts.series.slice(-14).map((s) => s.count)} sub={`${fmtNum(a.accounts.today)} today`} />
        <KpiCard label="New signups · 30 days" value={fmtNum(a.accounts.d30)} sub={`About ${perDay >= 10 ? Math.round(perDay) : perDay.toFixed(1)} a day`} />
        <KpiCard label="Card activation" value={fmtPct(a.engagement.activationRate)} sub={`${fmtNum(a.engagement.activatedCards)} cards captured a contact`} />
      </KpiGrid>

      <Section title="New accounts per day" hint="The last 30 days — your growth curve. A flat stretch means marketing needs a push.">
        <TrendBars data={a.accounts.series.map((s) => ({ date: s.date, values: [s.count] }))} series={[{ label: "Signups", color: "var(--adm-series-1)" }]} caption="New accounts per day, last 30 days" />
      </Section>

      <Columns wide>
        <Section title="Where signups come from" hint="How each account found SwiftCard, and how many went on to pay — the column that says where marketing money works hardest." flush>
          {a.acquisition.length === 0 ? <EmptyState className="pb-6">No signups yet.</EmptyState> : <AcquisitionTable rows={a.acquisition} />}
        </Section>
        <Section title="Plan mix" hint="Everyone, by the plan they're on now. Free is your upgrade pipeline.">
          <PlanMixBar free={a.plans.free} pro={a.plans.pro} office={a.plans.office} />
        </Section>
      </Columns>

      <Section title="Latest signups" hint="The newest accounts and the plan they're on." action={<SeeAll href="/admin/users">All users</SeeAll>} flush>
        {a.accounts.recent.length === 0 ? <EmptyState className="pb-6">No signups yet.</EmptyState> : (
          <ul className="adm-divide">
            {a.accounts.recent.map((u, i) => {
              const body = (
                <>
                  <Avatar name={u.name || u.email} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="sc-t-subhead font-medium truncate">{u.name || u.username || u.email}</p>
                    <p className="sc-t-caption adm-muted truncate">{u.email}</p>
                  </div>
                  <PlanBadge plan={u.plan} />
                  <span className="sc-t-caption adm-muted w-16 text-right shrink-0" title={fmtDateTime(u.created_at)}>{timeAgo(u.created_at)}</span>
                </>
              );
              return (
                <li key={u.id ?? `${u.username}-${i}`}>
                  {u.id ? (
                    <Link href={`/admin/users/${u.id}`} className="adm-list-row flex items-center gap-3 px-4 sm:px-5 py-2.5">{body}</Link>
                  ) : (
                    <div className="adm-list-row flex items-center gap-3 px-4 sm:px-5 py-2.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Columns>
        <NotTracked title="Signups by week · 12 weeks" detail="the longer trend, so a slow month stands out against the season." />
        <NotTracked title="From signup to first contact" detail="how many new accounts make a card, share it, get a view and capture a contact — and how long each step takes." />
      </Columns>

      <HowCounted>
        <p>Accounts are counted from the accounts table itself, so every number here is a real account, not a click. Your own account, any admin account and the App Review demo account are left out.</p>
        <p>&ldquo;Went paid&rdquo; counts only accounts with a real Stripe subscription. An account you moved to Pro by hand, or a gift month, is not counted as paying.</p>
        <p>Card activation is the share of cards that have captured at least one real contact (the sample contact every new card starts with doesn&apos;t count).</p>
      </HowCounted>
    </Stack>
  );
}

function AcquisitionTable({ rows }: { rows: Analytics["acquisition"] }) {
  return (
    <>
      {/* Phone: one source per row. */}
      <ul className="sm:hidden adm-divide">
        {rows.map((r) => (
          <li key={r.source} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="sc-t-subhead font-medium truncate">{getSignupSourceLabel(r.source)}</span>
              <span className="sc-t-subhead font-semibold adm-num shrink-0">{fmtNum(r.signups)}</span>
            </div>
            <p className="sc-t-caption adm-muted mt-0.5 adm-num">
              {fmtNum(r.d30)} in the last 30 days · {fmtNum(r.paid)} paid ·{" "}
              <span className={r.paidRate > 0 ? "adm-good font-semibold" : ""}>{fmtPct(r.paidRate)} paid rate</span>
            </p>
          </li>
        ))}
      </ul>
      <div className="hidden sm:block overflow-x-auto">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Source</th>
              <th className="adm-r">Signups</th>
              <th className="adm-r">Last 30 days</th>
              <th className="adm-r">Went paid</th>
              <th className="adm-r">Paid rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.source}>
                <td className="font-medium">{getSignupSourceLabel(r.source)}</td>
                <td className="adm-r font-semibold">{fmtNum(r.signups)}</td>
                <td className="adm-r">{fmtNum(r.d30)}</td>
                <td className="adm-r">{fmtNum(r.paid)}</td>
                <td className={`adm-r font-semibold ${r.paidRate > 0 ? "adm-good" : "adm-muted"}`}>{fmtPct(r.paidRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Revenue ─────────────────────────────────────────────────────────────────
function RevenueTab({ a }: { a: Analytics }) {
  const p = a.plans;
  const comped = p.compedPaidPlans ?? 0;
  return (
    <Stack>
      <KpiGrid>
        <KpiCard label="Monthly revenue (est.)" value={fmtMoney(p.estMrr)} sub="Stripe subscriptions at list price" />
        <KpiCard label="Yearly run rate (est.)" value={fmtMoney(p.estMrr * 12)} sub="Monthly revenue × 12" />
        <KpiCard label="Paying customers" value={fmtNum(p.paid)} sub={`${fmtPct(p.conversion)} of all accounts`} />
        <KpiCard label="Per paying customer (est.)" value={p.paid ? fmtMoney(p.estMrr / p.paid) : "—"} sub="A month, on average" />
      </KpiGrid>

      <Columns>
        <Section title="Who pays" hint="Everyone on a paid plan, split by whether money is actually coming in.">
          <ul className="space-y-3">
            {[
              { label: "Paying through Stripe", n: p.paid, note: "A real subscription", tone: "adm-good" },
              { label: "On a paid plan, not paying", n: comped, note: "Moved by hand, a gift month, or a checkout that never finished", tone: comped ? "adm-warn" : "" },
              { label: "On Pro", n: p.pro, note: "Paying or not", tone: "" },
              { label: "On Office", n: p.office, note: "Paying or not — owners only, not seats", tone: "" },
            ].map((r) => (
              <li key={r.label} className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="sc-t-subhead font-medium">{r.label}</p>
                  <p className="sc-t-caption adm-muted">{r.note}</p>
                </div>
                <span className={`sc-t-title3 adm-num shrink-0 ${r.tone}`}>{fmtNum(r.n)}</span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Plan mix" hint="Everyone, by the plan they're on now.">
          <PlanMixBar free={p.free} pro={p.pro} office={p.office} />
        </Section>
      </Columns>

      <KpiGrid>
        <NotTracked title="Paying through Apple" detail="subscribers who pay in the iPhone app — today's revenue counts Stripe only." />
        <NotTracked title="Office seats billed" detail="how many seats each Office team pays for." />
        <NotTracked title="New vs lost revenue · this month" detail="money from new and upgraded customers against money from cancellations." />
        <NotTracked title="Trials" detail="how many are on a Pro trial now, and how many trials turn into paying." />
      </KpiGrid>

      <HowCounted>
        <p>Monthly revenue counts only accounts with a real Stripe subscription, at list price ({fmtMoney(PLAN_PRICES.PRO_MONTHLY_CENTS / 100)} Pro, {fmtMoney(PLAN_PRICES.OFFICE_MONTHLY_PER_SEAT_CENTS / 100)} Office), before discounts. Annual plans, Office seat counts and Apple subscribers aren&apos;t in it yet — the data pass fixes that.</p>
        <p>Accounts on a paid plan with nothing behind them (moved by hand, a gift month, an unfinished checkout) are listed separately rather than counted as money.</p>
      </HowCounted>
    </Stack>
  );
}

// ── Funnel ──────────────────────────────────────────────────────────────────
function FunnelTab({ a }: { a: Analytics }) {
  return (
    <Stack>
      {a.funnel ? <FunnelPanel funnel={a.funnel} signups={{ d30: a.accounts.d30, d7: a.accounts.d7 }} /> : <EmptyState>The journey isn&apos;t available.</EmptyState>}
      <HowCounted>
        <p>Each step counts a visit once, however many times it happened in that visit — a reload of the card editor doesn&apos;t count as another person starting a card.</p>
        <p>&ldquo;Created an account&rdquo; is counted from real accounts, not clicks. Your own visits (any device you&apos;ve excluded on the Website page) are left out. Counting started 10 Sep 2026.</p>
      </HowCounted>
    </Stack>
  );
}

// ── Engagement ──────────────────────────────────────────────────────────────
function EngagementTab({ a }: { a: Analytics }) {
  const views30 = a.views.cardViews30 + a.views.linkViews30;
  return (
    <Stack>
      <KpiGrid>
        <KpiCard label="Contacts captured" value={fmtNum(a.leads.total)} delta={periodDelta(a.leads.series)} sub={`+${fmtNum(a.leads.d7)} this week · ${fmtNum(a.leads.today)} today`} />
        <KpiCard label="Cards made" value={fmtNum(a.cards.total)} sub={`${a.cards.perAccount} per account`} />
        <KpiCard label="Views · 7 days" value={fmtNum(a.views.d7)} sub={`${fmtNum(a.views.total)} all time`} />
        <KpiCard label="Card activation" value={fmtPct(a.engagement.activationRate)} sub={`${fmtNum(a.engagement.activatedCards)} cards got a contact`} />
      </KpiGrid>

      <Section title="Contacts captured per day" hint="New contacts landing in users' lists — the clearest sign the product is doing its job.">
        <TrendBars data={a.leads.series.map((s) => ({ date: s.date, values: [s.count] }))} series={[{ label: "Contacts", color: "var(--adm-series-2)" }]} caption="Contacts captured per day, last 30 days" />
      </Section>

      <Columns>
        <Section title="Where contacts come from · 30 days" hint="Across every user: how people reached a card before sharing their details.">
          <BarList rows={toRows(a.leads.bySource, getSourceLabel)} color="var(--adm-series-2)" showShare empty="No contacts in the last 30 days." />
        </Section>
        <Section title="Card pages vs Swift Links · 30 days" hint={`${fmtNum(views30)} views across both.`}>
          <BarList rows={[{ label: "Card pages", value: a.views.cardViews30 }, { label: "Swift Links pages", value: a.views.linkViews30 }]} showShare />
        </Section>
      </Columns>

      <Section title="Top cards by contacts" hint="The cards capturing the most contacts — your power users. Great for testimonials and referrals." flush>
        {a.topCards.length === 0 ? <EmptyState className="pb-6">No contacts yet.</EmptyState> : (
          <ol className="adm-divide">
            {a.topCards.map((c, i) => (
              <li key={c.username}>
                <a href={`/${c.username.replace("__links", "")}`} target="_blank" rel="noopener noreferrer" className="adm-list-row flex items-center gap-3 px-4 sm:px-5 py-2.5">
                  <span className="w-5 sc-t-footnote adm-muted adm-num">{i + 1}</span>
                  <span className="flex-1 min-w-0 sc-t-subhead truncate">/{c.username}</span>
                  <span className="sc-t-subhead font-semibold adm-num">{fmtNum(c.count)}</span>
                  <Icon name="external" className="w-4 h-4 adm-muted shrink-0" />
                </a>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Columns>
        <NotTracked title="Active users · day / week / month" detail="how many people open SwiftCard, not just how many signed up." />
        <NotTracked title="Feature use" detail="who connected a CRM, added the Wallet pass, set up Swift Signature or turned on follow-ups." />
      </Columns>

      <HowCounted>
        <p>Contacts and views count only cards that exist today, and never the sample contact every new card starts with. The App Review demo account&apos;s views are left out.</p>
        <p>A view is counted once per visit; bots, link previews and the owner looking at their own card are not views. The Data quality tab shows why each one was or wasn&apos;t counted.</p>
      </HowCounted>
    </Stack>
  );
}

// ── Data quality ────────────────────────────────────────────────────────────
function DataQualityTab({ a }: { a: Analytics }) {
  const checks = [
    { label: "Funnel events", detail: "The journey on the Funnel tab", on: !!a.funnel?.available, sql: "supabase/product-events.sql" },
    { label: "View decisions log", detail: "Why each view was or wasn't counted", on: !!a.ingest?.available, sql: "supabase/analytics-accuracy.sql" },
    { label: "Returning-contact alerts", detail: "The alert scorecard below", on: !!a.warmLead?.available, sql: "supabase/warm-lead-alerts.sql" },
  ];
  return (
    <Stack>
      <p className="adm-muted sc-t-subhead -mt-2">For checking the numbers are honest. Nothing here is a customer number.</p>

      <Section title="Tracking switched on" hint="Each of these needs its table in the database. Anything off here shows as empty elsewhere." flush>
        <ul className="adm-divide">
          {checks.map((c) => (
            <li key={c.label} className="flex items-center gap-3 px-4 sm:px-5 py-3">
              <span className={c.on ? "adm-good" : "adm-warn"}><Icon name={c.on ? "check" : "alert"} /></span>
              <div className="min-w-0 flex-1">
                <p className="sc-t-subhead font-medium">{c.label}</p>
                <p className="sc-t-caption adm-muted">{c.on ? c.detail : <>Off — run <span className="font-mono">{c.sql}</span> in the Supabase SQL editor.</>}</p>
              </div>
              <span className={c.on ? "sc-badge sc-badge-green" : "sc-badge sc-badge-orange"}>{c.on ? "Recording" : "Off"}</span>
            </li>
          ))}
        </ul>
      </Section>

      {/* ── Returning-contact alerts ────────────────────────────────────
          The warm-lead feature's own scorecard (docs/plans/
          warm-lead-alerts.md §2.9). "Wrong person" is the number that
          decides whether it stays on: above 2% of named alerts, the
          recognition is not good enough to name people. */}
      {a.warmLead && (
        <Section title="Returning-contact alerts · last 30 days" hint="Named alerts, what owners did with them, and how often we named the wrong person (target under 2%).">
          {!a.warmLead.available ? (
            <p className="adm-callout-warn px-4 py-3 sc-t-subhead">
              Not recording yet — run <span className="font-mono">supabase/warm-lead-alerts.sql</span> in the Supabase SQL editor.
            </p>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
                {[
                  { label: "Named alerts", value: fmtNum(a.warmLead.named), sub: `${fmtNum(a.warmLead.pushes)} reached a phone`, tone: undefined },
                  { label: "Opened", value: fmtNum(a.warmLead.opened), sub: a.warmLead.named ? fmtPct((a.warmLead.opened / a.warmLead.named) * 100) : "—", tone: undefined },
                  { label: "Followed up in 24h", value: fmtNum(a.warmLead.followedUp), sub: a.warmLead.named ? fmtPct((a.warmLead.followedUp / a.warmLead.named) * 100) : "—", tone: undefined },
                  { label: "Wrong person", value: fmtNum(a.warmLead.wrong), sub: `${a.warmLead.wrongRate}% of named`, tone: a.warmLead.wrongRate > 2 ? "adm-bad" : "adm-good" },
                  { label: "Recognised devices", value: fmtNum(a.warmLead.bindings.reduce((n, [, c]) => n + c, 0)), sub: "", tone: undefined },
                ].map((k) => (
                  <div key={k.label} className="adm-inset p-3.5">
                    <p className="sc-t-caption adm-muted">{k.label}</p>
                    <p className={`adm-kpi-value mt-1 ${k.tone ?? ""}`}>{k.value}</p>
                    {k.sub && <p className="sc-t-caption adm-muted mt-0.5">{k.sub}</p>}
                  </div>
                ))}
              </div>
              {a.warmLead.bindings.length > 0 && (
                <BarList rows={toRows(a.warmLead.bindings, (k) => ({ form: "Shared their details", link: "Opened a personal link", account: "Signed-in SwiftCard user" } as Record<string, string>)[k] ?? k)} />
              )}
            </div>
          )}
        </Section>
      )}

      {/* ── Ingest decisions ────────────────────────────────────────────
          Not a customer number and never summed into one: card_views is
          the one source of counted truth. This is the audit trail for the
          decisions that produce it, so "is that view real?" and "why is
          that view missing?" stop being arguments. 7-day window; the table
          itself keeps 14 days and trims itself. */}
      {a.ingest && (
        <Section title="View decisions · last 7 days" hint="Why each tracked card view was counted or not. Customer dashboards read the counted views, never this log.">
          {!a.ingest.available ? (
            <p className="adm-callout-warn px-4 py-3 sc-t-subhead">
              Not recording yet — run <span className="font-mono">supabase/analytics-accuracy.sql</span> in the Supabase SQL editor.
            </p>
          ) : (
            <div className="space-y-6">
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
                {[
                  { label: "Counted", value: a.ingest.counted7, sub: "Real visits", tone: "adm-good" },
                  { label: "Declined", value: a.ingest.declined7, sub: "Reasons below", tone: "" },
                  { label: "Relay / cloud network", value: a.ingest.relay7, sub: "Location downgraded, still counted", tone: "" },
                ].map((k) => (
                  <div key={k.label} className="adm-inset p-3.5">
                    <p className="sc-t-caption adm-muted">{k.label}</p>
                    <p className={`adm-kpi-value mt-1 ${k.tone}`}>{fmtNum(k.value)}</p>
                    <p className="sc-t-caption adm-muted mt-0.5">{k.sub}</p>
                  </div>
                ))}
              </div>
              <div className="grid gap-6 sm:grid-cols-2">
                <div>
                  <p className="sc-t-footnote font-semibold mb-3">Decision</p>
                  <BarList rows={toRows(a.ingest.byReason, (k) => REASON_LABEL[k] ?? k.replace(/_/g, " "))} />
                </div>
                <div>
                  <p className="sc-t-footnote font-semibold mb-3">What we thought it was</p>
                  <BarList rows={toRows(a.ingest.byClassification, (k) => CLASSIFICATION_LABEL[k] ?? k.replace(/_/g, " "))} color="var(--adm-plan-office)" />
                </div>
                <div>
                  <p className="sc-t-footnote font-semibold mb-3">Location confidence</p>
                  <BarList rows={toRows(a.ingest.byGeoAccuracy, (k) => GEO_LABEL[k] ?? k.replace(/_/g, " "))} color="var(--adm-series-3)" />
                </div>
                <div className="min-w-0">
                  <p className="sc-t-footnote font-semibold mb-3">Most recent declines</p>
                  {a.ingest.recentDeclines.length === 0 ? (
                    <p className="adm-muted sc-t-subhead">Nothing declined in the window.</p>
                  ) : (
                    <ul className="space-y-2 max-h-56 overflow-y-auto pr-1">
                      {a.ingest.recentDeclines.map((d, i) => (
                        <li key={`${d.at}-${i}`} className="flex items-baseline gap-2 sc-t-caption min-w-0">
                          <span className="adm-muted adm-num shrink-0">{fmtDateTime(d.at)}</span>
                          <span className="truncate min-w-0">{d.entity}</span>
                          <span className="adm-muted shrink-0 ml-auto">{REASON_LABEL[d.reason] ?? d.reason}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}
        </Section>
      )}
    </Stack>
  );
}
