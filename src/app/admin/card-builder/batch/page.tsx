import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { recentBatches } from "@/lib/prospect-preview/desk";
import { macStatus } from "@/lib/prospect-preview/outbox";
import BatchView from "./BatchView";

export const metadata = { title: "New batch — SwiftCard Admin" };
export const dynamic = "force-dynamic";

// ── Card Builder: New batch ─────────────────────────────────────────────────
// Ask for 1 to 100 prospects, by target or CSV, now or overnight, and see the
// batches that ran. The markup lives in BatchView.tsx.

export default async function BatchPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  // The admin layout is NOT a security boundary; every data page checks.
  if (!(await requireAdmin())) notFound();
  const sp = await searchParams;
  const [batches, mac] = await Promise.all([recentBatches(12).catch(() => []), macStatus().catch(() => ({ at: null, note: null, next_send_at: null }))]);
  return <BatchView batches={batches} mac={mac} now={new Date().getTime()} done={sp.done ?? null} error={sp.error ?? null} />;
}
