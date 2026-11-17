import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { listConnections } from "@/lib/prospect-preview/desk";
import { listPreviews, senderName } from "@/lib/prospect-preview/store";
import { failedJobs } from "@/lib/card-builder-jobs/jobs";
import { sendContext } from "@/lib/prospect-preview/outbox";
import { approvalQueue } from "@/lib/prospect-preview/pipeline";
import ApproveView from "./ApproveView";

export const metadata = { title: "Approve — SwiftCard Admin" };
export const dynamic = "force-dynamic";

// ── Card Builder: the Approve queue ─────────────────────────────────────────
// The drafts /build-card and /build-batch made, one card each, for the owner
// to approve from their phone, and (once approved) the one tap that opens
// Messages with the first text. The markup lives in ApproveView.tsx.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

export default async function ApprovePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  // The admin layout is NOT a security boundary; every data page checks.
  const admin = await requireAdmin();
  if (!admin) notFound();
  const sp = await searchParams;
  const [list, sender, connections, failed] = await Promise.all([listPreviews(), senderName(admin.id), listConnections().catch(() => []), failedJobs().catch(() => [])]);
  const now = new Date();
  // Each card's way out (iMessage or Google Voice) and the numbers that mustn't get a button.
  const rows = list.ready ? list.rows : [];
  const ctx = await sendContext(approvalQueue(rows, now.getTime()).send, rows, now);
  return <ApproveView connections={connections} list={list} appUrl={APP_URL} now={now.getTime()} sender={sender} done={sp.done ?? null} error={sp.error ?? null} about={sp.id ?? null} tally={sp.tally ?? null} failed={failed} ctx={ctx} />;
}
