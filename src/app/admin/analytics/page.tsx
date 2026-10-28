import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { retentionFunnel } from "@/lib/retention-alert";
import AnalyticsView from "./AnalyticsView";
import { resolveAnalyticsTab } from "./tabs";

export const metadata = { title: "Company Analytics — SwiftCard Admin" };
// Retention is read live on every visit: the numbers are small and the point
// is to see a reason while the person who wrote it is still reachable.
export const dynamic = "force-dynamic";

// ── Company Analytics (/admin/analytics) ────────────────────────────────────
// The owner's business numbers, one tab per question (owner, 2026-10-27:
// "show me important stuff that will help me grow my business … that will
// help us understand our users"). Retention and Referrals were pages of their
// own; they are tabs here now, and their old addresses redirect.
export default async function AdminAnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  // The admin layout is NOT a security boundary: an RSC request can render
  // this segment without its parent layout. Every page that reads data checks.
  if (!(await requireAdmin())) notFound();
  const tab = resolveAnalyticsTab((await searchParams).tab);
  const retention = tab === "retention" ? await retentionFunnel(2000) : undefined;
  // eslint-disable-next-line react-hooks/purity -- a server component renders once per request; this IS the request's time
  return <AnalyticsView tab={tab} retention={retention} now={Date.now()} />;
}
