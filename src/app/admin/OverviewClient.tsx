"use client";

// ── Overview: the owner's morning screen ───────────────────────────────────
// What matters, in the order it matters (owner, 2026-10-27: "It does not show
// me the really important stuff that I want to see"): money and growth on
// top, then anything that needs a person, then the shape of the last month,
// then who just arrived and who just left. Every number links to the page
// that explains it. The four sources load in parallel and each can fail on
// its own — a slow website query never blanks the revenue.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Analytics } from "./analytics/AnalyticsClient";
import type { WebsiteData } from "./website/WebsiteAnalyticsClient";
import type { RefStats } from "./analytics/ReferralsTab";
import { Columns, KpiGrid, PageHeader, Section, Stack } from "./_ui/layout";
import { KpiLink, SeeAll } from "./_ui/links";
import { MiniFunnel, PlanMixBar, TrendBars } from "./_ui/charts";
import { EmptyState, NotTracked, PageSkeleton } from "./_ui/states";
import { Avatar, PlanBadge } from "./_ui/badges";
import { Icon, type IconName } from "./_ui/icons";
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, periodDelta, timeAgo } from "./_ui/format";

/** The slice of the retention funnel the Overview needs (computed on the server). */
export type OverviewRetention = {
  partway: number;
  closedThisWeek: number;
  recentClosed: { userId: string; email: string | null; plan: string | null; at: string | null; reasonText: string }[];
};

export type OverviewData = {
  analytics: Analytics | null;
  website: WebsiteData | null;
  referrals: RefStats | null;
};

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export default function OverviewClient({ retention, initial }: {
  retention: OverviewRetention;
  /** Fixture data for tests/render; the page itself always fetches. */
  initial?: OverviewData & { updatedAt: number };
}) {
  const router = useRouter();
  const [data, setData] = useState<OverviewData | null>(initial ?? null);
  const [updatedAt, setUpdatedAt] = useState<number>(initial?.updatedAt ?? 0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    const [analytics, website, referrals] = await Promise.all([
      getJson<Analytics>("/api/admin/analytics"),
      getJson<WebsiteData>("/api/admin/website?internal=0"),
      getJson<RefStats>("/api/admin/referrals"),
    ]);
    setData({ analytics, website, referrals });
    setUpdatedAt(Date.now());
    setRefreshing(false);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time data fetch on mount; load() owns its own state
  useEffect(() => { if (!initial) void load(); }, [load, initial]);

  function refresh() {
    router.refresh(); // the server half: closed accounts and people partway through
    void load();
  }

  return (
    <Stack>
      <PageHeader
        title="Overview"
        description="How SwiftCard is doing right now."
        actions={
          <>
            {updatedAt > 0 && <span className="sc-t-footnote adm-muted">Updated {new Date(updatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>}
            <button type="button" onClick={refresh} disabled={refreshing} className="sc-btn sc-btn-gray sc-btn-sm">
              <Icon name="refresh" className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </>
        }
      />
      {/* updatedAt is set together with data, so "3h ago" counts from the load. */}
      {!data ? <PageSkeleton /> : <OverviewBody data={data} retention={retention} now={updatedAt} />}
    </Stack>
  );
}

type Attention = { icon: IconName; tone: "bad" | "warn"; text: string; n: number; href: string };

function OverviewBody({ data, retention, now }: { data: OverviewData; retention: OverviewRetention; now: number }) {
  const a = data.analytics;
  const w = data.website;
  const r = data.referrals;

  const attention: Attention[] = [
    { icon: "userMinus", tone: "bad", n: retention.closedThisWeek, text: `${retention.closedThisWeek === 1 ? "account was" : "accounts were"} closed this week`, href: "/admin/users?tab=closed" },
    { icon: "heart", tone: "warn", n: retention.partway, text: `${retention.partway === 1 ? "person is" : "people are"} partway through cancelling — still reachable`, href: "/admin/analytics?tab=retention" },
    { icon: "shield", tone: "warn", n: r?.ready ? r.flagged ?? 0 : 0, text: "suspicious referral signups to look at", href: "/admin/analytics?tab=referrals" },
    { icon: "creditCard", tone: "warn", n: a?.plans.compedPaidPlans ?? 0, text: "accounts on a paid plan with nothing paying for it", href: "/admin/analytics?tab=revenue" },
    {
      icon: "database", tone: "warn",
      n: a ? [a.funnel?.available, a.ingest?.available, a.warmLead?.available].filter((x) => x === false).length : 0,
      text: "tracking tables aren't switched on yet", href: "/admin/analytics?tab=data",
    },
  ].filter((x) => x.n > 0) as Attention[];
  if (!a) attention.unshift({ icon: "alert", tone: "bad", n: 1, text: "The company numbers didn't load — try Refresh", href: "/admin/analytics" });

  const recentClosed = retention.recentClosed;

  return (
    <>
      {/* Money and growth first. */}
      <KpiGrid>
        <KpiLink href="/admin/analytics?tab=revenue" label="Monthly revenue (est.)"
          value={a ? fmtMoney(a.plans.estMrr) : "—"}
          sub={a ? `${fmtNum(a.plans.paid)} paying · Stripe only for now` : "Didn't load"} />
        <KpiLink href="/admin/users?tab=pro" label="Paying customers"
          value={a ? fmtNum(a.plans.paid) : "—"}
          sub={a ? `${fmtNum(a.plans.pro)} on Pro · ${fmtNum(a.plans.office)} on Office` : "Didn't load"} />
        <KpiLink href="/admin/analytics" label="New signups · 7 days"
          value={a ? fmtNum(a.accounts.d7) : "—"}
          delta={a ? periodDelta(a.accounts.series) : undefined}
          trend={a ? a.accounts.series.slice(-14).map((s) => s.count) : undefined}
          sub={a ? `${fmtNum(a.accounts.today)} today` : "Didn't load"} />
        <KpiLink href="/admin/website" label="Website visitors · 7 days"
          value={w ? fmtNum(w.kpis.visitors.d7) : "—"}
          sub={w ? `${fmtNum(w.kpis.pageviews.d7)} pages viewed` : "Didn't load"} />
      </KpiGrid>

      <Columns wide>
        <Section title="Needs your attention" hint="Anything here is waiting on a person. Tap one to open it." flush>
          {attention.length === 0 ? (
            <p className="flex items-center gap-2 px-4 sm:px-5 pb-5 sc-t-subhead">
              <span className="adm-good"><Icon name="check" /></span> All clear — nothing needs you right now.
            </p>
          ) : (
            <ul className="adm-divide">
              {attention.map((x) => (
                <li key={x.href + x.text}>
                  <Link href={x.href} className="adm-list-row flex items-center gap-3 px-4 sm:px-5 py-3">
                    <span className={x.tone === "bad" ? "adm-bad" : "adm-warn"}><Icon name={x.icon} /></span>
                    <span className="flex-1 min-w-0 sc-t-subhead">
                      {x.icon !== "alert" && <b className="adm-num">{fmtNum(x.n)} </b>}{x.text}
                    </span>
                    <Icon name="chevron" className="w-4 h-4 adm-muted shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Plan mix" hint="Everyone, by the plan they're on now." action={<SeeAll href="/admin/users">Users</SeeAll>}>
          {a ? <PlanMixBar free={a.plans.free} pro={a.plans.pro} office={a.plans.office} /> : <EmptyState>Didn&apos;t load.</EmptyState>}
        </Section>
      </Columns>

      {a && (
        <Section title="Signups · last 30 days" hint={`${fmtNum(a.accounts.d30)} new accounts in 30 days.`} action={<SeeAll href="/admin/analytics">Company Analytics</SeeAll>}>
          <TrendBars data={a.accounts.series.map((s) => ({ date: s.date, values: [s.count] }))} series={[{ label: "Signups", color: "var(--adm-series-1)" }]} height={140} caption="New accounts per day, last 30 days" />
        </Section>
      )}

      {a?.funnel?.available ? (
        <Section title="The journey · last 30 days" hint="From a visit to paying. The percentage is how many of the step before made it." action={<SeeAll href="/admin/analytics?tab=funnel">Every step</SeeAll>}>
          <MiniFunnel steps={[
            { label: "Visited the site", value: a.funnel.d30.page_viewed ?? 0 },
            { label: "Started a card", value: a.funnel.d30.card_creation_started ?? 0 },
            { label: "Created an account", value: a.accounts.d30 },
            { label: "Paid", value: a.funnel.d30.checkout_completed ?? 0 },
          ]} />
        </Section>
      ) : a ? (
        <NotTracked title="The journey · last 30 days" detail="visits → started a card → account → paid, once the funnel table is switched on (Company Analytics › Data quality)." />
      ) : null}

      <Columns>
        <Section title="Newest signups" action={<SeeAll href="/admin/users">All users</SeeAll>} flush>
          {!a || a.accounts.recent.length === 0 ? <EmptyState className="pb-6">{a ? "No signups yet." : "Didn't load."}</EmptyState> : (
            <ul className="adm-divide">
              {a.accounts.recent.slice(0, 8).map((u, i) => {
                const row = (
                  <>
                    <Avatar name={u.name || u.email} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="sc-t-subhead font-medium truncate">{u.name || u.username || u.email}</p>
                      <p className="sc-t-caption adm-muted truncate">{u.email}</p>
                    </div>
                    <PlanBadge plan={u.plan} />
                    <span className="sc-t-caption adm-muted w-14 text-right shrink-0" title={fmtDateTime(u.created_at)}>{timeAgo(u.created_at, now)}</span>
                  </>
                );
                return (
                  <li key={u.id ?? `${u.username}-${i}`}>
                    {u.id
                      ? <Link href={`/admin/users/${u.id}`} className="adm-list-row flex items-center gap-3 px-4 sm:px-5 py-2.5">{row}</Link>
                      : <div className="adm-list-row flex items-center gap-3 px-4 sm:px-5 py-2.5">{row}</div>}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="Recently closed" hint="Who left, and why in the words they picked." action={<SeeAll href="/admin/users?tab=closed">Closed accounts</SeeAll>} flush>
          {recentClosed.length === 0 ? <EmptyState className="pb-6">No one has closed their account.</EmptyState> : (
            <ul className="adm-divide">
              {recentClosed.map((c) => (
                <li key={c.userId}>
                  <Link href={`/admin/users/${c.userId}`} className="adm-list-row flex items-start gap-3 px-4 sm:px-5 py-2.5">
                    <Avatar name={c.email} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="sc-t-subhead font-medium truncate">{c.email ?? `Account ${c.userId.slice(0, 8)}`}</p>
                      <p className="sc-t-caption adm-muted">{c.reasonText}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <PlanBadge plan={c.plan} />
                      <p className="sc-t-caption adm-muted mt-1 adm-num">{fmtDate(c.at, now)}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </Columns>

      {/* The things the owner does most, one tap each. */}
      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
        {([
          { href: "/admin/users?create=1", icon: "plus", title: "Create a card for a business", sub: "Set up an account and card for someone" },
          { href: "/admin/marketing", icon: "mail", title: "Email your users", sub: "Send an update or a promo code" },
          { href: "/admin/plans", icon: "sandbox", title: "Test a plan", sub: "Try Free, Pro or Office on your account" },
        ] as { href: string; icon: IconName; title: string; sub: string }[]).map((c) => (
          <Link key={c.href} href={c.href} className="adm-card adm-kpi p-4 sm:p-5 block">
            <span className="adm-link inline-flex"><Icon name={c.icon} /></span>
            <p className="sc-t-subhead font-semibold mt-2">{c.title}</p>
            <p className="sc-t-caption adm-muted mt-0.5">{c.sub}</p>
          </Link>
        ))}
        {/* A file download, not a page: a plain <a>. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/api/admin/users/export" className="adm-card adm-kpi p-4 sm:p-5 block">
          <span className="adm-link inline-flex"><Icon name="download" /></span>
          <p className="sc-t-subhead font-semibold mt-2">Export users</p>
          <p className="sc-t-caption adm-muted mt-0.5">Everyone, as a spreadsheet (CSV)</p>
        </a>
      </div>
    </>
  );
}
