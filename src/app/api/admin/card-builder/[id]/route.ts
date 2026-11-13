import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { pullBrandColors } from "@/lib/prospect-preview/colors-server";
import { clean, parsePreviewFields, UUID_RE } from "@/lib/prospect-preview/input";
import { isCallOutcome } from "@/lib/prospect-preview/call";
import { isMessageKind } from "@/lib/prospect-preview/messages";
import { checkOutreach, parseOutreachForm } from "@/lib/prospect-preview/outreach";
import { assessQuality } from "@/lib/prospect-preview/quality";
import { clearSent, deletePreview, logOutcome, reopenPreview, getPreviewById, markSent, publishPreview, setBrandColors, setOutreach, setQualityOverride, setSkipped, unpublishPreview, updateCall, updatePreview } from "@/lib/prospect-preview/store";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

export const runtime = "nodejs";
export const maxDuration = 30;

// POST /api/admin/card-builder/<id>   action = …
//
//   call       the "Called" checkbox and the notes beside it (both in one form)
//   save       the edit screen: every field of the preview, and its sources
//   publish    save, then make the link open (the 14 days start now). HELD when
//              the preview is too generic (lib/prospect-preview/quality.ts)
//              and the owner hasn't overridden it: it is saved and stays a draft
//   approve    the Approve queue's "Approve and publish": publish the draft AS
//              IT IS (no fields are posted). Held by the same quality gate
//   skip       on = 1 | 0: the Approve queue's Skip. The draft stays a draft
//   outreach   the edit screen's Messages section: o_<message> for each of the
//              messages written for this prospect. Refused with what to fix
//              when a text runs past 160 characters, has an emoji or says "free"
//   override   on = 1 | 0: the owner lets a too-generic preview go out anyway
//   unpublish  back to a draft: the link answers 404 again
//   outcome    how a call went (outcome = no_answer | voicemail | reached |
//              meeting_booked | won | lost), which also moves the stage
//   reopen     put a won / lost / booked preview back in play
//   sent       a send button was pressed: kind = ask | text | email |
//              nudge_no_view | nudge_viewed (the message itself goes from the
//              founder's own phone or inbox; nothing here sends anything)
//   unsent     "I didn't send that after all"
//   colors     read the brand colours from the logo (or the site's theme colour)
//   delete     removes the preview and every view of it; its link then 404s
//
// Posted by plain <form method="post">s on /admin/card-builder, the edit screen
// and the Call screen, so it answers with a 303 back to where the button was
// (?done=…, or ?error=… with what to fix); a JSON caller gets JSON.

function safeBack(v: unknown): string {
  return typeof v === "string" && /^\/admin\/card-builder(\/approve|\/(call|edit|send)\/[0-9a-f-]{36})?$/i.test(v) ? v : "/admin/card-builder";
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
    if (isJson) return NextResponse.json({ ok: !error && done !== "failed" && done !== "held", done, ...(error ? { error } : {}) }, { status });
    const url = new URL(safeBack(input.back), req.nextUrl.origin);
    if (error) url.searchParams.set("error", error.slice(0, 300));
    else url.searchParams.set("done", done);
    // The Approve queue shows which card the answer is about.
    if (url.pathname.endsWith("/approve")) url.searchParams.set("id", id);
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
      // The quality gate: a draft that could have been written for any office
      // doesn't go out. The save above stands; the owner fixes it or overrides it.
      const saved = await getPreviewById(id);
      if (!saved) return reply("failed", 404);
      if (saved.status !== "live" && !assessQuality(saved).mayPublish) return reply("held", 409);
      // Already live: the save above is all "publish" has left to do.
      await publishPreview(id);
      return reply("published");
    }
    case "approve": {
      const p = await getPreviewById(id);
      if (!p) return reply("failed", 404);
      // The same gate as the edit screen's Publish: a too-generic draft is held.
      if (p.status !== "live" && !assessQuality(p).mayPublish) return reply("held", 409);
      if (p.status !== "live" && !(await publishPreview(id))) return reply("failed", 500);
      return reply("approved");
    }
    case "skip": {
      const on = input.on !== "0" && input.on !== false;
      const ok = await setSkipped(id, on);
      return reply(ok ? (on ? "skipped" : "unskipped") : "failed", ok ? 200 : 500);
    }
    case "outreach": {
      const p = await getPreviewById(id);
      if (!p) return reply("failed", 404);
      const outreach = parseOutreachForm((k) => input[k], p.outreach ?? null);
      const problems = checkOutreach(outreach, { link: `${APP_URL}/p/${p.slug}`, specifics: p.specifics });
      if (problems.length) return reply("failed", 400, problems.join(" "));
      const ok = await setOutreach(id, outreach);
      return reply(ok ? "messages" : "failed", ok ? 200 : 500);
    }
    case "override": {
      const on = input.on === "1" || input.on === true;
      const ok = await setQualityOverride(id, on);
      return reply(ok ? (on ? "override_on" : "override_off") : "failed", ok ? 200 : 500);
    }
    case "unpublish": {
      const ok = await unpublishPreview(id);
      return reply(ok ? "unpublished" : "failed", ok ? 200 : 500);
    }
    case "outcome": {
      if (!isCallOutcome(input.outcome)) return reply("failed", 400);
      const ok = await logOutcome(id, input.outcome);
      return reply(ok ? "logged" : "failed", ok ? 200 : 500);
    }
    case "reopen": {
      const ok = await reopenPreview(id);
      return reply(ok ? "saved" : "failed", ok ? 200 : 500);
    }
    case "sent": {
      const kind = input.kind;
      if (!isMessageKind(kind)) return reply("failed", 400);
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
