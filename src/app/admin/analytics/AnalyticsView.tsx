import { PageHeader, Stack } from "../_ui/layout";
import { Tabs } from "../_ui/links";
import AnalyticsClient, { type Analytics } from "./AnalyticsClient";
import ReferralsTab, { type RefStats } from "./ReferralsTab";
import RetentionTab, { type RetentionData } from "./RetentionTab";
import { ANALYTICS_TABS, type AnalyticsTab } from "./tabs";

// ── Company Analytics, the markup ───────────────────────────────────────────
// page.tsx gates and loads; this renders. Split so tests/render can measure
// every tab with fixture data (a page file may not export anything else).

export default function AnalyticsView({ tab, retention, now, initial, referrals }: {
  tab: AnalyticsTab;
  retention?: RetentionData;
  now: number;
  /** Fixture data for tests/render; the live page fetches it in the browser. */
  initial?: Analytics;
  referrals?: RefStats;
}) {
  return (
    <Stack>
      <PageHeader
        title="Company Analytics"
        description="The numbers that grow the business: who signs up, who pays, who stays, and why."
        actions={<span className="sc-badge">Last 30 days</span>}
      />
      <Tabs base="/admin/analytics" items={[...ANALYTICS_TABS]} active={tab} />
      {tab === "retention" ? (
        retention ? <RetentionTab data={retention} now={now} /> : null
      ) : tab === "referrals" ? (
        <ReferralsTab initial={referrals} />
      ) : (
        <AnalyticsClient tab={tab} initial={initial} />
      )}
    </Stack>
  );
}
