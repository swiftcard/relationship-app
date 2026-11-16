import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { openerText } from "@/lib/prospect-preview/opener";
import { queueOpener, segmentOf, type QueueResult } from "@/lib/prospect-preview/outbox";
import { approvalQueue } from "@/lib/prospect-preview/pipeline";
import { assessQuality } from "@/lib/prospect-preview/quality";
import { getPreviewById, listPreviews, publishPreview } from "@/lib/prospect-preview/store";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/admin/card-builder/approve-all
//
// The review screen's "Approve all" (owner, 2026-11-16). For every draft
// waiting in Approve that passes the quality gate AND has an opening text:
// publish it, and put its opener in the Mac's outbox. The Mac sends them
// from the owner's own number, in sending hours, a few minutes apart, up to
// the daily cap (lib/prospect-preview/send-window.ts). Too-generic drafts,
// drafts with no opener and numbers that aren't a mobile are left where they
// are, and the answer says how many and why.

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.nextUrl.host) return NextResponse.json({ error: "cross-site" }, { status: 403 });

  const list = await listPreviews();
  const back = new URL("/admin/card-builder/approve", req.nextUrl.origin);
  if (!list.ready) { back.searchParams.set("done", "failed"); return NextResponse.redirect(back, 303); }

  const now = Date.now();
  const tally: Partial<Record<QueueResult | "too_generic", number>> = {};
  const add = (k: QueueResult | "too_generic") => { tally[k] = (tally[k] ?? 0) + 1; };
  for (const r of approvalQueue(list.rows, now).waiting) {
    if (!assessQuality(r).mayPublish) { add("too_generic"); continue; }
    if (!openerText(r.openers)) { add("no_opener"); continue; }
    if (!(await publishPreview(r.id))) { add("failed"); continue; }
    const live = await getPreviewById(r.id);
    add(live ? await queueOpener(live, APP_URL, await segmentOf(live)) : "failed");
  }
  back.searchParams.set("done", "all");
  back.searchParams.set("tally", Object.entries(tally).map(([k, n]) => `${k}:${n}`).join(","));
  return NextResponse.redirect(back, 303);
}
