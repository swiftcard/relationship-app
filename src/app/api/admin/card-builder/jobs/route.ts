import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { retryJob } from "@/lib/card-builder-jobs/jobs";
import { UUID_RE } from "@/lib/prospect-preview/input";

export const runtime = "nodejs";

// POST /api/admin/card-builder/jobs   action = retry, id = a failed job
//
// "Try again" on Approve's "Couldn't be built" list: the job starts its step
// over, with fresh tries, on the worker's next run. A plain <form>: answers
// with a 303 back to Approve.

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.nextUrl.host) return NextResponse.json({ error: "cross-site" }, { status: 403 });
  const form = await req.formData().catch(() => new FormData());
  const id = String(form.get("id") ?? "");
  const back = new URL("/admin/card-builder/approve", req.nextUrl.origin);
  const ok = form.get("action") === "retry" && UUID_RE.test(id) && (await retryJob(id));
  if (ok) back.searchParams.set("done", "retried");
  else back.searchParams.set("error", "That one can't be retried (it may already be running).");
  return NextResponse.redirect(back, 303);
}
