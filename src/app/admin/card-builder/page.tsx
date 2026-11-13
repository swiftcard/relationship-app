import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { listEvents, listQueue, recentBatches } from "@/lib/prospect-preview/desk";
import { batchBrief, messageStats, type BatchBrief } from "@/lib/prospect-preview/learn";
import { listPreviews } from "@/lib/prospect-preview/store";
import CardBuilderView from "./CardBuilderView";

export const metadata = { title: "Card Builder — SwiftCard Admin" };
export const dynamic = "force-dynamic";

// ── Card Builder: preview cards for sales prospects ─────────────────────────
// Three buttons: Approve what was built, call and follow up, add who is next.
// The moment a prospect really looks at their card, every admin is alerted to
// call (lib/prospect-preview/alert.ts). The markup lives in CardBuilderView.tsx.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";
/** A finished batch stays at the top this long, while it still has drafts waiting. */
const BRIEF_DAYS = 3;

export default async function CardBuilderPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  // The admin layout is NOT a security boundary; every data page checks.
  if (!(await requireAdmin())) notFound();
  const sp = await searchParams;
  const [list, queue, batches, events] = await Promise.all([listPreviews(), listQueue().catch(() => []), recentBatches(3).catch(() => []), listEvents().catch(() => [])]);
  const now = new Date();
  const rows = list.ready ? list.rows : [];
  let brief: BatchBrief | null = null;
  for (const b of batches) {
    const made = batchBrief(b, rows);
    const fresh = now.getTime() - Date.parse(b.finished_at ?? b.created_at) < BRIEF_DAYS * 24 * 60 * 60 * 1000;
    // Running, or finished with drafts still waiting (or just finished, to say what was skipped).
    if (fresh && (!made.finished || made.ready.length > 0 || made.skippedCount > 0)) { brief = made; break; }
  }
  return (
    <CardBuilderView
      list={list}
      appUrl={APP_URL}
      now={now.getTime()}
      made={sp.made ?? null}
      error={sp.error ?? null}
      done={sp.done ?? null}
      queueCount={queue.length}
      brief={brief}
      stats={messageStats(events, rows)}
    />
  );
}
