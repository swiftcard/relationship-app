import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { addToQueue, queueItemsFrom, removeFromQueue } from "@/lib/prospect-preview/desk";
import { UUID_RE } from "@/lib/prospect-preview/input";

export const runtime = "nodejs";

// POST /api/admin/card-builder/queue   action = add | remove
//
// The Queue box on admin › Card Builder › Add: names, links or notes the owner
// drops in from their phone. The next /build run builds a draft for each.
// Adding to the queue contacts nobody and builds nothing by itself.
//
//   add     lines = one prospect per line (a name and city, or a link);
//           notes = the owner's own notes about ONE prospect
//   remove  id = an item still waiting
//
// Posted by plain <form method="post">s, so it answers with a 303 back to the
// Add page.

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.nextUrl.host) return NextResponse.json({ error: "cross-site" }, { status: 403 });

  const form = await req.formData().catch(() => new FormData());
  const back = (params: Record<string, string>) => {
    const url = new URL("/admin/card-builder/add", req.nextUrl.origin);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v.slice(0, 200));
    return NextResponse.redirect(url, 303);
  };

  if (form.get("action") === "remove") {
    const id = String(form.get("id") ?? "");
    const ok = UUID_RE.test(id) && (await removeFromQueue(id));
    return back(ok ? { done: "removed" } : { error: "That one couldn't be removed. It may already have been built." });
  }

  const items = queueItemsFrom(form.get("lines"), form.get("notes"));
  if (!items.length) return back({ error: "Type a name and city, paste a link, or add notes about one prospect." });
  const added = await addToQueue(items);
  return added ? back({ done: "queued", n: String(added) }) : back({ error: "That didn't save. Try again in a minute." });
}
