import Link from "next/link";
import type { RetentionRow } from "@/lib/retention-alert";
import { Columns, KpiCard, KpiGrid, Section, Stack } from "../_ui/layout";
import { TrendBars } from "../_ui/charts";
import { EmptyState, HowCounted, NotTracked } from "../_ui/states";
import { PlanBadge, StatusBadge } from "../_ui/badges";
import { fmtDate, fmtNum, fmtPct } from "../_ui/format";
import { reasonText, savedByText } from "../_ui/reasons";

// ── Company Analytics › Retention ───────────────────────────────────────────
// Everyone who opened the delete or cancel flow: what they said, and whether
// an offer kept them. This was /admin/retention, a page of its own; it is a
// tab now (owner, 2026-10-27: "Why is there one page for referrals and one
// page for retention? That doesn't make sense."). The people who actually
// closed their accounts are also listed under Users › Closed accounts.
//
// Server-rendered from lib/retention-alert's retentionFunnel(), which reads
// customization._retention / _deletion straight off the profiles.

export type RetentionData = {
  rows: RetentionRow[];
  totals: { attempts: number; saved: number; deleted: number; open: number; saveRate: number };
  byReason: { reason: string; attempts: number; saved: number }[];
};

const OUTCOME: Record<RetentionRow["outcome"], { label: string; tone: "good" | "bad" | "warn" }> = {
  saved: { label: "Stayed", tone: "good" },
  deleted: { label: "Closed their account", tone: "bad" },
  open: { label: "Partway through", tone: "warn" },
};

/** Closed accounts per week, for the last 8 weeks (weeks start Monday, UTC). */
function closedPerWeek(rows: RetentionRow[], now: number) {
  const DAY = 86_400_000;
  const d = new Date(now);
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY;
  const weeks = Array.from({ length: 8 }, (_, i) => ({ start: monday - (7 - i) * 7 * DAY, n: 0 }));
  for (const r of rows) {
    if (r.outcome !== "deleted" || !r.at) continue;
    const t = new Date(r.at).getTime();
    const w = weeks.find((x) => t >= x.start && t < x.start + 7 * DAY);
    if (w) w.n++;
  }
  return weeks.map((w) => ({ date: new Date(w.start).toISOString(), values: [w.n] }));
}

export default function RetentionTab({ data, now }: { data: RetentionData; now: number }) {
  const { rows, totals, byReason } = data;
  const decided = totals.saved + totals.deleted;
  const maxAttempts = Math.max(1, ...byReason.map((r) => r.attempts));

  return (
    <Stack>
      <KpiGrid>
        <KpiCard label="Save rate" value={decided ? fmtPct(totals.saveRate) : "—"} sub={`${fmtNum(totals.saved)} of ${fmtNum(decided)} who decided`} tone={decided ? (totals.saveRate >= 30 ? "good" : "warn") : undefined} />
        <KpiCard label="Stayed" value={fmtNum(totals.saved)} sub="Took an offer or switched to Free" />
        <KpiCard label="Closed their account" value={fmtNum(totals.deleted)} sub="Went through with it" />
        <KpiCard label="Partway through" value={fmtNum(totals.open)} sub="Answered, haven't decided" />
      </KpiGrid>

      <Columns>
        <Section title="Closed accounts per week" hint="The last 8 weeks. Fewer is better.">
          <TrendBars data={closedPerWeek(rows, now)} series={[{ label: "Closed accounts", color: "var(--adm-series-3)" }]} height={140} caption="Closed accounts per week" />
        </Section>

        <Section title="Why they leave" hint="Every reason given, and how many of those people an offer kept.">
          {byReason.length === 0 ? (
            <EmptyState>Nobody has given a reason yet.</EmptyState>
          ) : (
            <ul className="space-y-3">
              {byReason.map((r) => (
                <li key={r.reason} className="min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="sc-t-subhead truncate min-w-0" title={reasonText(r.reason)}>{reasonText(r.reason)}</span>
                    <span className="shrink-0 sc-t-footnote adm-num">
                      <span className="font-semibold">{fmtNum(r.attempts)}</span>
                      <span className="adm-muted"> · {fmtNum(r.saved)} stayed</span>
                    </span>
                  </div>
                  <div className="adm-track h-1.5 mt-1.5 overflow-hidden flex">
                    <div className="h-full" style={{ width: `${(r.saved / maxAttempts) * 100}%`, background: "var(--adm-series-2)" }} />
                    <div className="h-full" style={{ width: `${((r.attempts - r.saved) / maxAttempts) * 100}%`, background: "var(--adm-series-3)" }} />
                  </div>
                </li>
              ))}
              <li className="flex gap-4 pt-1 sc-t-caption adm-muted" aria-hidden>
                <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: "var(--adm-series-2)" }} />Stayed</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: "var(--adm-series-3)" }} />Left or undecided</span>
              </li>
            </ul>
          )}
        </Section>
      </Columns>

      <Section
        title="Everyone who opened the delete or cancel flow"
        hint="Newest first. Tap a person to open their account. Their own words are quoted."
        flush
      >
        {rows.length === 0 ? (
          <EmptyState className="pb-8">Nobody has opened the delete or cancel flow yet.</EmptyState>
        ) : (
          <ul className="adm-divide">
            {rows.map((r) => {
              const o = OUTCOME[r.outcome];
              const saved = savedByText(r.savedBy);
              return (
                <li key={r.userId} className="px-4 sm:px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={o.tone}>{o.label}</StatusBadge>
                    {saved && <StatusBadge tone="tint">{saved}</StatusBadge>}
                    <PlanBadge plan={r.plan} />
                    <span className="ml-auto sc-t-caption adm-muted adm-num">{fmtDate(r.at, now)}</span>
                  </div>
                  <Link href={`/admin/users/${r.userId}`} className="adm-link sc-t-subhead font-semibold mt-2 inline-block max-w-full truncate">
                    {r.email ?? `Account ${r.userId.slice(0, 8)}`}
                  </Link>
                  <p className="sc-t-subhead mt-1"><span className="adm-muted">Why: </span>{reasonText(r.reason, r.plan)}</p>
                  {r.comment && (
                    <blockquote className="adm-inset mt-2 px-3.5 py-2.5 sc-t-subhead whitespace-pre-wrap break-words">“{r.comment}”</blockquote>
                  )}
                  {r.email && r.outcome !== "deleted" && (
                    <a href={`mailto:${r.email}`} className="adm-link sc-t-footnote mt-2 inline-flex min-h-[28px] items-center">
                      Reply to them →
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <NotTracked title="Who's still here, by signup month" detail="a grid of each month's signups and how many are still active 1, 2 and 3 months later." />

      <HowCounted>
        <p>Read straight from each account: the answers the delete and cancel flows save, and the outcome. Nothing is estimated.</p>
        <p>The save rate is out of people who decided — stayed or closed. Someone still partway through hasn&apos;t chosen yet, so they aren&apos;t counted as a loss.</p>
        <p>A closed account is kept for 30 days so it can be reopened, then permanently deleted — and its answers go with it. Keeping the reasons after that is part of the data pass.</p>
      </HowCounted>
    </Stack>
  );
}
