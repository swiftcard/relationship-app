import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { pullBrandColors } from "@/lib/prospect-preview/colors-server";
import { clean, parsePreviewFields, UUID_RE } from "@/lib/prospect-preview/input";
import { clearSent, deletePreview, getPreviewById, markSent, publishPreview, setBrandColors, unpublishPreview, updateCall, updatePreview } from "@/lib/prospect-preview/store";

export const runtime = "nodejs";
export const maxDuration = 30;

// POST /api/admin/card-builder/<id>   action = …
//
//   call       the "Called" checkbox and the notes beside it (both in one form)
//   save       the edit screen: every field of the preview, and its sources
//   publish    save, then make the link open (the 14 days start now)
//   unpublish  back to a draft: the link answers 404 again
//   sent       a send button was pressed: kind = ask | text | email (the message
//              itself goes from the founder's own phone or inbox)
//   unsent     "I didn't send that after all"
//   colors     read the brand colours from the logo (or the site's theme colour)
//   delete     removes the preview and every view of it; its link then 404s
//
// Posted by plain <form method="post">s on /admin/card-builder, the edit screen
// and the Call screen, so it answers with a 303 back to where the button was
// (?done=…, or ?error=… with what to fix); a JSON caller gets JSON.

function safeBack(v: unknown): string {
  return typeof v === "string" && /^\/admin\/card-builder(\/(call|edit|send)\/[0-9a-f-]{36})?$/i.test(v) ? v : "/admin/card-builder";
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
  const reply = (done: string, status = 200, error?: string) => {
    if (isJson) return NextResponse.json({ ok: !error && done !== "failed", done, ...(error ? { error } : {}) }, { status });
    const url = new URL(safeBack(input.back), req.nextUrl.origin);
    if (error) url.searchParams.set("error", error.slice(0, 300));
    else url.searchParams.set("done", done);
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
    case "save":
    case "publish": {
      const parsed = parsePreviewFields((k) => input[k]);
      // A refusal saves nothing, so a publish can never put out a half-checked card.
      if (!parsed.ok) return reply("failed", 400, parsed.error);
      if (!(await updatePreview(id, parsed.value))) return reply("failed", 500);
      if (input.action === "save") return reply("saved");
      // Already live: the save above is all "publish" has left to do.
      await publishPreview(id);
      return reply("published");
    }
    case "unpublish": {
      const ok = await unpublishPreview(id);
      return reply(ok ? "unpublished" : "failed", ok ? 200 : 500);
    }
    case "sent": {
      const kind = input.kind;
      if (kind !== "ask" && kind !== "text" && kind !== "email") return reply("failed", 400);
      const got = await markSent(id, kind);
      if (got === "not_live") return reply("failed", 409, "That message has the link in it, and the link doesn't open yet. Publish the preview first.");
      return reply(got === "ok" ? "sent" : "failed", got === "ok" ? 200 : 500);
    }
    case "unsent": {
      const ok = await clearSent(id);
      return reply(ok ? "unsent" : "failed", ok ? 200 : 500);
    }
    case "colors": {
      const p = await getPreviewById(id);
      if (!p) return reply("failed", 404);
      const pulled = await pullBrandColors(p);
      if (!pulled) return reply("failed", 422, "Couldn't read colors from the logo or the website. Save a logo address first, or pick the colors by hand.");
      const note = pulled.from === "logo" ? "Read from the logo" : "The website's theme color";
      const ok = await setBrandColors(id, pulled, { ...p.sources, colors: { url: pulled.url, uncertain: false, note } });
      return reply(ok ? "colors" : "failed", ok ? 200 : 500);
    }
    case "delete": {
      // Deleting from the Call or edit screen can't return to a page that is gone.
      if (/\/(call|edit|send)\//.test(clean(input.back, 120))) input.back = "/admin/card-builder";
      const ok = await deletePreview(id);
      return reply(ok ? "deleted" : "failed", ok ? 200 : 500);
    }
    default:
      return reply("failed", 400);
  }
}
