import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { retentionFunnel } from "@/lib/retention-alert";
import OverviewClient, { type OverviewRetention } from "./OverviewClient";
import { reasonText } from "./_ui/reasons";

export const metadata = { title: "Overview — SwiftCard Admin" };
// The "who just left / who is partway" half is read live on every visit.
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // The admin layout is NOT a security boundary: an RSC request can render
  // this segment without its parent layout. Every page that reads data checks.
  if (!(await requireAdmin())) notFound();
  const { rows, totals } = await retentionFunnel(2000);
  // eslint-disable-next-line react-hooks/purity -- a server component renders once per request; this IS the request's time
  const weekAgo = Date.now() - 7 * 86_400_000;
  const closed = rows.filter((r) => r.outcome === "deleted");
  const retention: OverviewRetention = {
    partway: totals.open,
    closedThisWeek: closed.filter((r) => r.at && Date.parse(r.at) >= weekAgo).length,
    recentClosed: closed.slice(0, 5).map((r) => ({ userId: r.userId, email: r.email, plan: r.plan, at: r.at, reasonText: reasonText(r.reason, r.plan) })),
  };
  return <OverviewClient retention={retention} />;
}
