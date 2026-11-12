import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { clean, UUID_RE } from "@/lib/prospect-preview/input";
import { deletePreview, updateCall } from "@/lib/prospect-preview/store";

export const runtime = "nodejs";

// POST /api/admin/card-builder/<id>   action = call | delete
//
//   call    the "Called" checkbox and the notes beside it (both in one form)
//   delete  removes the preview and every view of it; its link then 404s
//
// Posted by plain <form method="post">s on /admin/card-builder and on the Call
// screen, so it answers with a 303 back to where the button was (?done=…); a
// JSON caller gets JSON.

function safeBack(v: unknown): string {
  return typeof v === "string" && /^\/admin\/card-builder(\/call\/[0-9a-f-]{36})?$/i.test(v) ? v : "/admin/card-builder";
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.nextUrl.host) return NextResponse.json({ error: "cross-site" }, { status: 403 });

  const { id } = await ctx.params;
  const isJson = (req.headers.get("content-type") ?? "").includes("application/json");
  const input: Record<string, unknown> = isJson
    ? await req.json().catch(() => ({}))
    : Object.fromEntries((await req.formData().catch(() => new FormData())).entries());
  const reply = (done: string, status = 200) => {
    if (isJson) return NextResponse.json({ ok: done !== "failed", done }, { status });
    const url = new URL(safeBack(input.back), req.nextUrl.origin);
    url.searchParams.set("done", done);
    return NextResponse.redirect(url, 303);
  };

  if (!UUID_RE.test(id)) return reply("failed", 404);

  switch (input.action) {
    case "call": {
      // An unticked checkbox isn't in a form post at all, so absence means "not called".
      const called = input.called === "on" || input.called === true;
      const notes = typeof input.notes === "string" ? input.notes.trim().slice(0, 2000) || null : undefined;
      const ok = await updateCall(id, { called, ...(notes !== undefined ? { notes } : {}) });
      return reply(ok ? "saved" : "failed", ok ? 200 : 500);
    }
    case "delete": {
      // Deleting from the Call screen can't return to a page that is gone.
      if (clean(input.back, 120).includes("/call/")) input.back = "/admin/card-builder";
      const ok = await deletePreview(id);
      return reply(ok ? "deleted" : "failed", ok ? 200 : 500);
    }
    default:
      return reply("failed", 400);
  }
}
