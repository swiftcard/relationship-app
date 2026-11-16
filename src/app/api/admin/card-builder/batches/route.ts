import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { batchRunAfter, parseBatchForm } from "@/lib/prospect-preview/batch-input";
import { cancelBatch, requestBatch } from "@/lib/prospect-preview/desk";
import { UUID_RE } from "@/lib/prospect-preview/input";
import { enqueueBatch } from "@/lib/card-builder-jobs/jobs";

export const runtime = "nodejs";

// POST /api/admin/card-builder/batches   action = new | cancel
//
// "New batch" on admin › Card Builder › Batches (owner, 2026-11-16):
//
//   new     target = who to find ("realtors in Great Neck"), or csv = a file of
//           prospects; count = 1 to 100; when = now | tonight. Makes a
//           REQUESTED batch and queues its jobs; the server's worker
//           (lib/card-builder-jobs, every 5 minutes) starts it now, or at
//           11pm New York time, and builds every draft. Contacts nobody.
//   cancel  id = a batch that hasn't started yet
//
// Plain <form method="post">s: answers with a 303 back to the Batches page.

const MAX_CSV_BYTES = 512 * 1024;

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.nextUrl.host) return NextResponse.json({ error: "cross-site" }, { status: 403 });

  const form = await req.formData().catch(() => new FormData());
  const back = (params: Record<string, string>) => {
    const url = new URL("/admin/card-builder/batch", req.nextUrl.origin);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v.slice(0, 300));
    return NextResponse.redirect(url, 303);
  };

  if (form.get("action") === "cancel") {
    const id = String(form.get("id") ?? "");
    const ok = UUID_RE.test(id) && (await cancelBatch(id));
    return back(ok ? { done: "canceled" } : { error: "That batch has already started, so it can't be taken back." });
  }

  const file = form.get("csv");
  let csv: string | null = null;
  if (file && typeof file !== "string" && file.size > 0) {
    if (file.size > MAX_CSV_BYTES) return back({ error: "That file is too big. 100 rows is plenty." });
    csv = await file.text();
  }
  const parsed = parseBatchForm((k) => form.get(k), csv);
  if (!parsed.ok) return back({ error: parsed.error });
  const batch = await requestBatch({ ...parsed.value, runAfter: batchRunAfter(parsed.value.kind) });
  if (!batch) return back({ error: "That didn't save. Try again in a minute." });
  // Every job it needs, queued now and due at its start time: the server's worker clock does the rest (lib/card-builder-jobs).
  try {
    await enqueueBatch({ id: batch.id, run_after: batch.run_after ?? null });
  } catch {
    await cancelBatch(batch.id);
    return back({ error: "That didn't save. Try again in a minute." });
  }
  return back({ done: parsed.value.kind === "tonight" ? "tonight" : "now" });
}
