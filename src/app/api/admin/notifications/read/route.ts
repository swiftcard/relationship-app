import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { safeBack } from "@/app/admin/notifications/tabs";

// Mark one notification read (id), or every unread one in a tab (all=1, kind).
// Posted by plain <form method="post">s on /admin/notifications, so it answers
// with a 303 back to the page it came from; a JSON caller gets JSON.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set(["money", "leaving", "agents"]);

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  // A form on another site can't mark the owner's notifications read.
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.nextUrl.host) return NextResponse.json({ error: "cross-site" }, { status: 403 });

  const isJson = (req.headers.get("content-type") ?? "").includes("application/json");
  const input: Record<string, unknown> = isJson
    ? await req.json().catch(() => ({}))
    : Object.fromEntries((await req.formData().catch(() => new FormData())).entries());

  const now = new Date().toISOString();
  let q = getAdminSupabase().from("admin_notifications").update({ read_at: now }).is("read_at", null);
  if (input.all === "1" || input.all === true) {
    if (typeof input.kind === "string" && KINDS.has(input.kind)) q = q.eq("kind", input.kind);
  } else if (typeof input.id === "string" && UUID_RE.test(input.id)) {
    q = q.eq("id", input.id);
  } else {
    return NextResponse.json({ error: "nothing to mark" }, { status: 400 });
  }
  const { error } = await q;
  if (error) return NextResponse.json({ error: "save_failed" }, { status: 500 });

  if (isJson) return NextResponse.json({ ok: true });
  return NextResponse.redirect(new URL(safeBack(input.back), req.nextUrl.origin), 303);
}
