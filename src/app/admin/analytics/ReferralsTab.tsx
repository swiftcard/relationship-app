"use client";

// Company Analytics › Referrals. Referral program performance: signups by
// source, rewards granted, active free months, and fraud flags. This was
// /admin/referrals (which now redirects here). Custom referral codes are
// assigned per-user from the user's page.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getSignupSourceLabel } from "@/lib/source-labels";
import { REFERRAL } from "@/lib/referral";
import { Columns, KpiCard, KpiGrid, Section, Stack } from "../_ui/layout";
import { BarList } from "../_ui/charts";
import { EmptyState, ErrorState, PageSkeleton } from "../_ui/states";
import { fmtDate, fmtNum } from "../_ui/format";

export type RefStats = {
  ready: boolean; message?: string;
  bySource?: Record<string, number>;
  totalReferrals?: number; validSignups?: number; paid?: number;
  monthsClaimed?: number; monthsClaimable?: number; flagged?: number;
  selfReferral?: number; activeFreeMonths?: number;
  flaggedList?: { code: string | null; reason: string; created_at: string }[];
};

export default function ReferralsTab({ initial }: { initial?: RefStats } = {}) {
  const [stats, setStats] = useState<RefStats | null>(initial ?? null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    fetch("/api/admin/referrals")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load"))))
      .then(setStats)
      .catch(() => setFailed(true));
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time data fetch on mount
  useEffect(() => { if (!initial) load(); }, [load, initial]);

  if (failed) return <ErrorState message="The referral numbers didn't load." onRetry={load} />;
  if (!stats) return <PageSkeleton />;

  return (
    <Stack>
      <div className="adm-card p-4 sm:p-5">
        <p className="sc-t-headline">How the referral program works</p>
        <p className="adm-muted sc-t-subhead mt-1">
          <span className="font-semibold" style={{ color: "var(--sc-label)" }}>
            {REFERRAL.SIGNUPS_PER_REWARD} successful signups = 1 claimable free month of Pro
          </span>{" "}
          (the user taps to claim; max {REFERRAL.MAX_REFERRAL_REWARDS} months each). Friends who sign up through a link get a free month too.
          To give someone a custom code or a free month by hand, open them in{" "}
          <Link href="/admin/users" className="adm-link">Users</Link>.
        </p>
      </div>

      {!stats.ready ? (
        <p className="adm-callout-warn px-4 py-3 sc-t-subhead">
          {stats.message || "Referral analytics aren't available yet — run REFERRAL_SETUP.sql in Supabase."}
        </p>
      ) : (
        <>
          <KpiGrid>
            <KpiCard label="Successful referred signups" value={fmtNum(stats.validSignups ?? 0)} sub="Passed the fraud checks" />
            <KpiCard label="Months claimed" value={fmtNum(stats.monthsClaimed ?? 0)} sub="Free months users took" />
            <KpiCard label="Earned, not claimed yet" value={fmtNum(stats.monthsClaimable ?? 0)} sub="Waiting for the user to tap" />
            <KpiCard label="Active free months" value={fmtNum(stats.activeFreeMonths ?? 0)} sub="From every source, right now" />
          </KpiGrid>

          <Columns>
            <Section
              title="Signups by source"
              hint="Every account by how it found SwiftCard. The “Referral link” row is the referral program; the rest are the free-account prompts around the product."
            >
              <BarList
                rows={Object.entries(stats.bySource ?? {}).sort((a, b) => b[1] - a[1]).map(([src, n]) => ({ key: src, label: getSignupSourceLabel(src), value: n }))}
                showShare
                empty="No signups yet."
              />
            </Section>

            <Section
              title="Suspicious referrals"
              hint={`${fmtNum(stats.flagged ?? 0)} flagged · ${fmtNum(stats.selfReferral ?? 0)} self-referrals`}
              flush
            >
              {/* This used to say "These never grant free months." That was true
                  of the REFERRER's reward and false of the referee's month,
                  which was granted regardless — so the one panel where abuse
                  surfaces made a security claim that masked the bug. The grant
                  is fixed (referral-server: a month now needs a referrer, a
                  clean status AND the referral source), so the claim is finally
                  accurate — stated precisely rather than broadly. */}
              <p className="adm-muted sc-t-footnote px-4 sm:px-5">
                Referral signups the fraud checks caught (same device/IP as the referrer, self-referrals). Neither side is rewarded: no free month for the signup, no credit for the referrer. Listed here so you can spot abuse patterns.
              </p>
              {(stats.flaggedList ?? []).length === 0 ? (
                <EmptyState className="pb-6">Nothing suspicious so far.</EmptyState>
              ) : (
                <ul className="adm-divide mt-3">
                  {(stats.flaggedList ?? []).map((f, i) => (
                    <li key={i} className="adm-list-row flex items-center justify-between gap-3 px-4 sm:px-5 py-2.5">
                      <span className="font-mono sc-t-footnote truncate">{f.code || "—"}</span>
                      <span className="sc-badge sc-badge-orange shrink-0">{f.reason.replace(/_/g, " ")}</span>
                      <span className="sc-t-caption adm-muted shrink-0 adm-num">{fmtDate(f.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </Columns>
        </>
      )}
    </Stack>
  );
}
