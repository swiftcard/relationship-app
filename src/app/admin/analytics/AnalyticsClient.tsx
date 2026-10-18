"use client";

import { useEffect, useState } from "react";
import { getSignupSourceLabel, getSourceLabel } from "@/lib/source-labels";
import Link from "next/link";
import type { WarmLeadMetrics } from "@/lib/warm-lead-metrics";

type Funnel = {
  available: boolean;
  d30: Record<string, number>;
  d7: Record<string, number>;
  internal30: number;
  topCtas: [string, number][];
  lockedFeatures: [string, number][];
};

type Analytics = {
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
  accounts: { total: number; today: number; d7: number; d30: number; series: { date: string; count: number }[]; recent: { name: string; email: string; username: string; plan: string; created_at: string }[] };
  plans: { free: number; pro: number; office: number; paid: number; conversion: number; estMrr: number; compedPaidPlans?: number };
  acquisition: { source: string; signups: number; d30: number; paid: number; paidRate: number }[];
  cards: { total: number; perAccount: number };
  leads: { total: number; today: number; d7: number; series: { date: string; count: number }[]; bySource: [string, number][]; perAccount: number };
  views: { total: number; d7: number; cardViews30: number; linkViews30: number };
  engagement: { activatedCards: number; activationRate: number };
  topCards: { username: string; count: number }[];
};

const PLAN_LABEL: Record<string, string> = { free: "Free", pro: "Pro", enterprise: "Office", office: "Office" };

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
const PLAN_COLOR: Record<string, string> = { free: "#6b7280", pro: "#60a5fa", office: "#c084fc" };

function Kpi({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-4">
      <p className="text-2xl font-bold tabular-nums" style={accent ? { color: accent } : undefined}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      <p className="text-gray-400 text-xs mt-0.5">{label}</p>
      {sub && <p className="text-gray-600 text-[0.6875rem] mt-0.5">{sub}</p>}
    </div>
  );
}

function BarChart({ series, color = "#3b82f6" }: { series: { date: string; count: number }[]; color?: string }) {
  const max = Math.max(1, ...series.map((s) => s.count));
  return (
    <div className="flex items-end gap-[3px] h-24">
      {series.map((s) => (
        <div key={s.date} className="flex-1 group relative flex flex-col justify-end">
          <div className="rounded-t-sm transition-colors" style={{ height: `${(s.count / max) * 100}%`, minHeight: s.count ? 3 : 0, background: color }} />
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-gray-800 text-white text-[0.625rem] px-1.5 py-0.5 rounded whitespace-nowrap z-10">
            {new Date(s.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}: {s.count}
          </div>
        </div>
      ))}
    </div>
  );
}

function Bars({ rows, color = "#3b82f6", labeler }: { rows: [string, number][]; color?: string; labeler?: (key: string) => string }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  if (!rows.length) return <p className="text-gray-600 text-xs">No data yet.</p>;
  return (
    <div className="space-y-2">
      {rows.map(([label, n]) => (
        <div key={label} className="flex items-center gap-3">
          <span className="text-gray-300 text-xs w-36 shrink-0 truncate" title={labeler ? labeler(label) : label.replace(/_/g, " ")}>{labeler ? labeler(label) : label.replace(/_/g, " ")}</span>
          <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(n / max) * 100}%`, background: color }} />
          </div>
          <span className="text-gray-400 text-xs w-10 text-right tabular-nums">{n.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

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

export /**
 * The `feature` key on every PlanGate, in plain words.
 *
 * These keys are written for the code ("swift-links-cap"), and this panel's
 * whole job is to say which Pro feature Free users want most. A raw key needs
 * decoding before it can answer that, which is one step too many for a number
 * you glance at.
 */
const GATE_LABEL: Record<string, string> = {
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

export function FunnelPanel({ funnel, signups }: { funnel: Funnel; signups: { d30: number; d7: number } }) {
  if (!funnel.available) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <p className="text-white font-semibold text-sm mb-1">The journey · last 30 days</p>
        <p className="text-amber-400/90 text-xs leading-relaxed">
          Not switched on yet — run <code className="text-amber-300">supabase/product-events.sql</code> in the Supabase SQL editor and this fills in on its own.
        </p>
      </div>
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
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3 mb-1">
        <p className="text-white font-semibold text-sm">The journey <span className="text-gray-600 font-normal">· last 30 days</span></p>
        {funnel.internal30 > 0 && (
          <span className="text-gray-600 text-[0.6875rem] shrink-0">{funnel.internal30.toLocaleString()} of your own events hidden</span>
        )}
      </div>
      <p className="text-gray-600 text-[0.6875rem] mb-4">
        Every step someone takes before they pay. The number on the right is how many of the previous step made it this far — that&apos;s where you&apos;re losing people. Counting started 10 Sep 2026, so the first month is still filling in.
      </p>

      {!anyData ? (
        <p className="text-gray-600 text-xs">Nothing yet. Numbers appear here as soon as real visitors move through the site.</p>
      ) : (
        <div className="space-y-2.5 sm:space-y-1.5">
          {rows.map((r, i) => {
            const prev = i === 0 ? null : rows[i - 1].n30;
            // Only meaningful once the step above actually happened.
            const pct = prev && prev > 0 ? Math.round((r.n30 / prev) * 100) : null;
            return (
              // Stacks on a phone. Side by side, a fixed label column left the
              // bar about 80px wide, so every step drew nearly the same length
              // and the funnel stopped showing the drop-off it exists to show —
              // and the count inside the bar clipped to a single digit.
              <div key={r.key} className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-3">
                <div className="sm:w-44 shrink-0 min-w-0">
                  <p className="text-gray-200 text-xs truncate" title={r.label}>{r.label}</p>
                  <p className="text-gray-600 text-[0.625rem] truncate" title={r.hint}>{r.hint}</p>
                </div>
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="flex-1 h-5 bg-gray-800/60 rounded-lg overflow-hidden min-w-0">
                    <div
                      className="h-full rounded-lg"
                      style={{ width: `${(r.n30 / top) * 100}%`, background: "linear-gradient(90deg, #2563eb, #7c3aed)" }}
                    />
                  </div>
                  {/* The count sits OUTSIDE the bar: inside, a small step's own
                      number is wider than the bar drawn for it. */}
                  <span className="w-12 text-right text-[0.6875rem] font-semibold text-gray-200 tabular-nums shrink-0">{r.n30.toLocaleString()}</span>
                  <span className="w-10 text-right text-[0.6875rem] tabular-nums shrink-0">
                    {pct === null ? <span className="text-gray-600">—</span> : pct > 100 ? (
                      // Not every step feeds only from the one above it: someone
                      // can sign up without ever opening the builder, and for
                      // the first 30 days accounts predate this tracking
                      // entirely. Shown grey rather than as a green 300%, which
                      // would read as a wildly good conversion rate.
                      <span className="text-gray-500" title="More than the step above — some people arrive here without passing through it.">&gt;100%</span>
                    ) : (
                      <span className={pct >= 50 ? "text-green-400" : pct >= 20 ? "text-amber-400" : "text-red-400"}>{pct}%</span>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(funnel.lockedFeatures.length > 0 || funnel.topCtas.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mt-6 pt-5 border-t border-gray-800">
          {funnel.lockedFeatures.length > 0 && (
            <div>
              <p className="text-white font-semibold text-xs mb-1">Which Pro features they want</p>
              <p className="text-gray-600 text-[0.625rem] mb-3">What Free users bump into most. The top one is your best upgrade pitch.</p>
              <Bars rows={funnel.lockedFeatures} color="#f59e0b" labeler={gateLabel} />
            </div>
          )}
          {funnel.topCtas.length > 0 && (
            <div>
              <p className="text-white font-semibold text-xs mb-1">Most-clicked buttons</p>
              <p className="text-gray-600 text-[0.625rem] mb-3">Which calls to action people actually press.</p>
              <Bars rows={funnel.topCtas} color="#38bdf8" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AnalyticsClient() {
  const [a, setA] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/analytics")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load"))))
      .then(setA)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Company analytics</h1>
          <p className="text-gray-500 text-sm mt-1">Growth, revenue, engagement, and where users come from.</p>
        </div>

        {loading ? (
          <p className="text-gray-500 text-sm py-10 text-center">Loading analytics…</p>
        ) : error || !a ? (
          <p className="text-red-400 text-sm py-10 text-center">{error ?? "No data"}</p>
        ) : (
          <div className="space-y-8">
            {/* Headline KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Kpi label="Total accounts" value={a.accounts.total} sub={`+${a.accounts.d30} in 30d · +${a.accounts.today} today`} />
              <Kpi label="Paid customers" value={a.plans.paid} sub={`${a.plans.conversion}% conversion`} accent="#60a5fa" />
              <Kpi
                label="Est. MRR"
                value={`$${a.plans.estMrr.toLocaleString()}`}
                sub={
                  a.plans.compedPaidPlans
                    ? `Stripe subscriptions only · ${a.plans.compedPaidPlans} comped`
                    : "Stripe subscriptions only"
                }
                accent="#4ade80"
              />
              <Kpi label="Contacts captured" value={a.leads.total} sub={`+${a.leads.d7} this week`} />
            </div>

            {/* The click funnel. Sits directly under the KPIs because it is the
                only panel on this page that can see people who have NOT signed
                up — everything below counts rows that already exist. */}
            {a.funnel && <FunnelPanel funnel={a.funnel} signups={{ d30: a.accounts.d30, d7: a.accounts.d7 }} />}

            {/* Growth */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-1">
                <p className="text-white font-semibold text-sm">New accounts · last 30 days</p>
                <div className="flex gap-4 text-xs text-gray-500">
                  <span>Today <span className="text-white font-semibold">{a.accounts.today}</span></span>
                  <span>7d <span className="text-white font-semibold">{a.accounts.d7}</span></span>
                  <span>30d <span className="text-white font-semibold">{a.accounts.d30}</span></span>
                </div>
              </div>
              <p className="text-gray-600 text-[0.6875rem] mb-4">Signups per day — your growth curve. A flat stretch means marketing needs a push.</p>
              <BarChart series={a.accounts.series} color="#3b82f6" />
            </div>

            {/* Plans + Sources */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <p className="text-white font-semibold text-sm mb-1">Plan mix</p>
                <p className="text-gray-600 text-[0.6875rem] mb-4">How many users sit on each plan — Free is your upgrade pipeline.</p>
                <Bars rows={[["Free", a.plans.free], ["Pro", a.plans.pro], ["Office", a.plans.office]]} color="#8b5cf6" />
                <div className="grid grid-cols-3 gap-2 mt-4">
                  {[["Free", a.plans.free, "#6b7280"], ["Pro", a.plans.pro, "#60a5fa"], ["Office", a.plans.office, "#c084fc"]].map(([l, n, c]) => (
                    <div key={l as string} className="bg-gray-800/40 rounded-xl px-3 py-2.5 text-center">
                      <p className="text-lg font-bold tabular-nums" style={{ color: c as string }}>{(n as number).toLocaleString()}</p>
                      <p className="text-gray-500 text-[0.6875rem]">{l as string}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <p className="text-white font-semibold text-sm mb-1">Where contacts come from <span className="text-gray-600 font-normal">· last 30d</span></p>
                <p className="text-gray-600 text-[0.6875rem] mb-4">Across ALL users: how people reached a card before sharing their info (QR scan, card link, bio link…).</p>
                <Bars rows={a.leads.bySource} color="#22c55e" labeler={getSourceLabel} />
              </div>
            </div>

            {/* Contacts trend */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-1">
                <p className="text-white font-semibold text-sm">Contacts captured · last 30 days</p>
                <div className="flex gap-4 text-xs text-gray-500">
                  <span>Today <span className="text-white font-semibold">{a.leads.today}</span></span>
                  <span>7d <span className="text-white font-semibold">{a.leads.d7}</span></span>
                </div>
              </div>
              <p className="text-gray-600 text-[0.6875rem] mb-4">New contacts landing in users&apos; CRMs per day — the clearest signal the product is delivering value.</p>
              <BarChart series={a.leads.series} color="#22c55e" />
            </div>

            {/* Secondary KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Kpi label="Total cards" value={a.cards.total} sub={`${a.cards.perAccount} per account`} />
              <Kpi label="Total views" value={a.views.total} sub={`+${a.views.d7} this week`} />
              <Kpi label="Views by surface (30d)" value={`${a.views.cardViews30} / ${a.views.linkViews30}`} sub="card pages / Swift Links pages" />
              <Kpi label="Card activation" value={`${a.engagement.activationRate}%`} sub={`${a.engagement.activatedCards.toLocaleString()} cards got a lead`} />
            </div>

            {/* Top cards + recent signups */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <p className="text-white font-semibold text-sm mb-1">Top cards by contacts</p>
                <p className="text-gray-600 text-[0.6875rem] mb-3">The cards capturing the most contacts — your power users. Great candidates for testimonials and referrals.</p>
                {a.topCards.length === 0 ? <p className="text-gray-600 text-xs">No contacts yet.</p> : (
                  <div className="divide-y divide-gray-800/60">
                    {a.topCards.map((c, i) => (
                      <div key={c.username} className="flex items-center justify-between py-2 text-sm">
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="text-gray-600 text-xs w-4">{i + 1}</span>
                          <a href={`/${c.username.replace("__links", "")}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 truncate">/{c.username}</a>
                        </span>
                        <span className="text-white font-semibold tabular-nums shrink-0">{c.count.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <p className="text-white font-semibold text-sm mb-1">Latest signups</p>
                <p className="text-gray-600 text-[0.6875rem] mb-3">The most recent accounts — click through in Users to see any of them in detail.</p>
                <div className="divide-y divide-gray-800/60">
                  {a.accounts.recent.map((u) => (
                    <div key={u.username} className="flex items-center justify-between py-2 text-sm">
                      <span className="min-w-0">
                        <span className="text-white truncate block max-w-[180px]">{u.name || u.username}</span>
                        <span className="text-gray-600 text-[0.6875rem] truncate block max-w-[180px]">{u.email}</span>
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className="text-[0.625rem] font-bold px-2 py-0.5 rounded-full" style={{ background: (PLAN_COLOR[u.plan === "enterprise" ? "office" : u.plan] ?? "#6b7280") + "22", color: PLAN_COLOR[u.plan === "enterprise" ? "office" : u.plan] ?? "#9ca3af" }}>{PLAN_LABEL[u.plan] ?? "Free"}</span>
                        <span className="text-gray-600 text-[0.6875rem]">{new Date(u.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Acquisition — where signups come from and which sources convert to paid */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <p className="text-white font-semibold text-sm mb-1">Acquisition — where signups come from</p>
              <p className="text-gray-600 text-[0.6875rem] mb-4">Use the paid-conversion column to decide where marketing money works hardest.</p>
              {a.acquisition.length === 0 ? (
                <p className="text-gray-600 text-xs">No signups yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800 text-gray-500 text-xs">
                        <th className="text-left py-2 font-medium">Source</th>
                        <th className="text-right py-2 font-medium">Signups</th>
                        <th className="text-right py-2 font-medium">Last 30d</th>
                        <th className="text-right py-2 font-medium">Went paid</th>
                        <th className="text-right py-2 font-medium">Paid rate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/60">
                      {a.acquisition.map((row) => (
                        <tr key={row.source}>
                          <td className="py-2 text-gray-300 text-xs">{getSignupSourceLabel(row.source)}</td>
                          <td className="py-2 text-right text-white font-semibold tabular-nums">{row.signups.toLocaleString()}</td>
                          <td className="py-2 text-right text-gray-400 tabular-nums">{row.d30.toLocaleString()}</td>
                          <td className="py-2 text-right text-gray-400 tabular-nums">{row.paid.toLocaleString()}</td>
                          <td className="py-2 text-right tabular-nums font-semibold" style={{ color: row.paidRate > 0 ? "#4ade80" : "#6b7280" }}>{row.paidRate}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* ── Returning-contact alerts ────────────────────────────────────
                The warm-lead feature's own scorecard (docs/plans/
                warm-lead-alerts.md §2.9). "Wrong person" is the number that
                decides whether it stays on: above 2% of named alerts, the
                recognition is not good enough to name people. */}
            {a.warmLead && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <p className="text-white font-semibold text-sm">Returning-contact alerts · last 30 days</p>
                <p className="text-gray-600 text-[0.6875rem] mt-0.5 mb-4">
                  Named alerts, what owners did with them, and how often we named the wrong person (target under 2%).
                </p>
                {!a.warmLead.available ? (
                  <p className="text-amber-400/80 text-xs">
                    Not recording yet — run <span className="font-mono">supabase/warm-lead-alerts.sql</span> in the Supabase SQL editor.
                  </p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
                      <Kpi label="Named alerts" value={a.warmLead.named} sub={`${a.warmLead.pushes} reached a phone`} />
                      <Kpi label="Opened" value={a.warmLead.opened} sub={a.warmLead.named ? `${Math.round((a.warmLead.opened / a.warmLead.named) * 100)}%` : "—"} accent="#60a5fa" />
                      <Kpi label="Followed up in 24h" value={a.warmLead.followedUp} sub={a.warmLead.named ? `${Math.round((a.warmLead.followedUp / a.warmLead.named) * 100)}%` : "—"} accent="#4ade80" />
                      <Kpi label="Wrong person" value={a.warmLead.wrong} sub={`${a.warmLead.wrongRate}% of named`} accent={a.warmLead.wrongRate > 2 ? "#f87171" : "#4ade80"} />
                      <Kpi label="Recognised devices" value={a.warmLead.bindings.reduce((n, [, c]) => n + c, 0)} />
                    </div>
                    {a.warmLead.bindings.length > 0 && (
                      <Bars rows={a.warmLead.bindings} labeler={(k) => ({ form: "Shared their details", link: "Opened a personal link", account: "Signed-in SwiftCard user" } as Record<string, string>)[k] ?? k} />
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── Ingest decisions ────────────────────────────────────────────
                Not a customer number and never summed into one: card_views is
                the one source of counted truth. This is the audit trail for the
                decisions that produce it, so "is that view real?" and "why is
                that view missing?" stop being arguments. 7-day window; the table
                itself keeps 14 days and trims itself. */}
            {a.ingest && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <p className="text-white font-semibold text-sm">Ingest decisions · last 7 days</p>
                <p className="text-gray-600 text-[0.6875rem] mt-0.5 mb-4">
                  Why each tracked event was counted or not. Decisions only — customer dashboards read <span className="text-gray-500">card_views</span>, never this.
                </p>
                {!a.ingest.available ? (
                  <p className="text-amber-400/80 text-xs">
                    Not recording yet — run <span className="font-mono">supabase/analytics-accuracy.sql</span> in the Supabase SQL editor.
                  </p>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-3 mb-5">
                      <Kpi label="Counted" value={a.ingest.counted7} accent="#4ade80" />
                      <Kpi label="Declined" value={a.ingest.declined7} sub="reasons below" />
                      <Kpi label="Relay / cloud network" value={a.ingest.relay7} sub="location downgraded, still counted" />
                    </div>
                    <div className="grid sm:grid-cols-2 gap-5">
                      <div>
                        <p className="text-gray-400 text-xs font-semibold mb-2">Decision</p>
                        <Bars rows={a.ingest.byReason} color="#60a5fa" labeler={(k) => REASON_LABEL[k] ?? k.replace(/_/g, " ")} />
                      </div>
                      <div>
                        <p className="text-gray-400 text-xs font-semibold mb-2">What we thought it was</p>
                        <Bars rows={a.ingest.byClassification} color="#c084fc" labeler={(k) => CLASSIFICATION_LABEL[k] ?? k.replace(/_/g, " ")} />
                      </div>
                      <div>
                        <p className="text-gray-400 text-xs font-semibold mb-2">Location confidence</p>
                        <Bars rows={a.ingest.byGeoAccuracy} color="#fbbf24" labeler={(k) => GEO_LABEL[k] ?? k.replace(/_/g, " ")} />
                      </div>
                      <div>
                        <p className="text-gray-400 text-xs font-semibold mb-2">Most recent declines</p>
                        {a.ingest.recentDeclines.length === 0 ? (
                          <p className="text-gray-600 text-xs">Nothing declined in the window.</p>
                        ) : (
                          <div className="space-y-1.5 max-h-44 overflow-y-auto">
                            {a.ingest.recentDeclines.map((d, i) => (
                              <div key={`${d.at}-${i}`} className="flex items-baseline gap-2 text-[0.6875rem]">
                                <span className="text-gray-600 tabular-nums shrink-0">{new Date(d.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                                <span className="text-gray-300 truncate">{d.entity}</span>
                                <span className="text-gray-500 shrink-0 ml-auto">{REASON_LABEL[d.reason] ?? d.reason}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            <p className="text-gray-600 text-[0.6875rem] text-center">Referral & fraud analytics live in <Link href="/admin/referrals" className="text-blue-400 hover:text-blue-300">Referrals</Link>. Est. MRR uses list prices; excludes discounts &amp; Office seat counts.</p>
          </div>
        )}
    </div>
  );
}
