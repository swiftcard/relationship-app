import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { pullBrandColors } from "@/lib/prospect-preview/colors-server";
import { clean, parsePreviewFields, UUID_RE } from "@/lib/prospect-preview/input";
import { isCallOutcome } from "@/lib/prospect-preview/call";
import { isMessageKind } from "@/lib/prospect-preview/messages";
import { recordEvents } from "@/lib/prospect-preview/desk";
import { checkOutreach, outreachEdits, parseOutreachForm, resolveOutreach, staleNumbers } from "@/lib/prospect-preview/outreach";
import { assessQuality } from "@/lib/prospect-preview/quality";
import { checkOpenerText, openerFacts, openerHook, openerMessage, openerSentVariant, openerText } from "@/lib/prospect-preview/opener";
import { cancelQueuedFor, QUEUE_RESULT_TEXT, queueOpener, segmentOf, suppressNumber } from "@/lib/prospect-preview/outbox";
import { isSendWith } from "@/lib/prospect-preview/google-voice";
import { nanp } from "@/lib/prospect-preview/phone-type";
import { setSendWith, clearSent, deletePreview, logOutcome, reopenPreview, getPreviewById, markSent, publishPreview, setBrandColors, setLinkedinAccepted, setOpeners, setOutreach, setQualityOverride, setSkipped, unpublishPreview, updateCall, updatePreview } from "@/lib/prospect-preview/store";

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
//              IT IS (no fields are posted). Held by the same quality gate.
//              pick = a | b saves which first text the owner chose
//              queue = 1 also puts their opener in the Mac's outbox
//   opener     text = the owner's rewording of the opening text. Refused, with
//              what to fix, when it breaks a rule (lib/prospect-preview/opener.ts)
//   opener_pick  i = which written opener is the default (the old one becomes
//              the alternate); clears an edit
//   queue      put their opener in the Mac's outbox (lib/prospect-preview/outbox.ts)
//   pick       pick = a | b on its own (a published preview, before sending)
//   linkedin_accepted  on = 1 | 0: they accepted the connection request, so
//              the message for that moment shows under follow-ups
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
//              channel = google_voice: it went from the owner's Google Voice
//              number, pasted by hand (GoogleVoiceButton). An opener or link
//              sent by hand takes back anything the Mac had queued for that number.
//   send_with  value = imessage | google_voice | "" (follow the batch): how
//              this one prospect's opener goes. Google Voice takes back
//              anything queued for them on the Mac
//   stop       "They said stop": their number goes on the do-not-contact list
//              and anything queued for it is canceled (the Mac can't see
//              replies that come to Google Voice)
//   unsent     "I didn't send that after all"
//   colors     read the brand colours from the logo (or the site's theme colour)
//   delete     removes the preview and every view of it; its link then 404s
//
// Posted by plain <form method="post">s on /admin/card-builder, the edit screen
// and the Call screen, so it answers with a 303 back to where the button was
// (?done=…, or ?error=… with what to fix); a JSON caller gets JSON.

function safeBack(v: unknown): string {
  return typeof v === "string" && /^\/admin\/card-builder(\/approve|\/follow-up|\/sender|\/google-voice|\/(call|edit|send)\/[0-9a-f-]{36})?$/i.test(v) ? v : "/admin/card-builder";
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
    case "pick":
    case "approve": {
      const p = await getPreviewById(id);
      if (!p) return reply("failed", 404);
      // Which of the two first texts goes out. Saved before publishing, so the
      // send button that appears next already carries the chosen words.
      const pick = input.pick === "a" || input.pick === "b" ? input.pick : null;
      if (pick && p.outreach?.first_text_b && p.outreach.first_pick !== pick) {
        if (!(await setOutreach(id, { ...p.outreach, first_pick: pick }))) return reply("failed", 500);
        await recordEvents([{ preview_id: id, kind: "pick", message: "first_text", variant: pick, before: null, after: pick === "b" ? p.outreach.first_text_b : p.outreach.first_text }]);
      }
      if (input.action === "pick") return reply("saved");
      // The same gate as the edit screen's Publish: a too-generic draft is held.
      if (p.status !== "live" && !assessQuality(p).mayPublish) return reply("held", 409);
      if (p.status !== "live" && !(await publishPreview(id))) return reply("failed", 500);
      if (input.queue === "1" || input.queue === true) {
        const live = await getPreviewById(id);
        const got = live ? await queueOpener(live, APP_URL, await segmentOf(live)) : "failed";
        return got === "queued" ? reply("approved_queued") : reply("approved", 200, `Published, but not queued: ${QUEUE_RESULT_TEXT[got]}`);
      }
      return reply("approved");
    }
    case "opener": {
      const p = await getPreviewById(id);
      if (!p?.openers) return reply("failed", 404);
      const text = typeof input.text === "string" ? input.text.replace(/\s+/g, " ").trim().slice(0, 400) : "";
      const current = openerText(p.openers) ?? "";
      if (text === current) return reply("saved");
      const problems = checkOpenerText(text, { owner_name: p.owner_name, facts: openerFacts(p), stale: staleNumbers(p) });
      if (problems.length) return reply("failed", 400, problems.join(" "));
      const ok = await setOpeners(id, { ...p.openers, edited: text });
      if (ok) await recordEvents([{ preview_id: id, kind: "edit", message: "opener", variant: openerHook(p.openers), before: current, after: text }]);
      return reply(ok ? "saved" : "failed", ok ? 200 : 500);
    }
    case "opener_pick": {
      const p = await getPreviewById(id);
      const i = Number(input.i);
      if (!p?.openers || !Number.isInteger(i) || !p.openers.candidates[i]) return reply("failed", 400);
      if (i === p.openers.pick) return reply("saved");
      const ok = await setOpeners(id, { ...p.openers, pick: i, alt: p.openers.pick, edited: null });
      if (ok) await recordEvents([{ preview_id: id, kind: "pick", message: "opener", variant: p.openers.candidates[i].hook, before: null, after: p.openers.candidates[i].text }]);
      return reply(ok ? "saved" : "failed", ok ? 200 : 500);
    }
    case "queue": {
      const p = await getPreviewById(id);
      if (!p) return reply("failed", 404);
      const got = await queueOpener(p, APP_URL, await segmentOf(p));
      return got === "queued" || got === "already" ? reply(got === "queued" ? "queued" : "saved") : reply("failed", 409, QUEUE_RESULT_TEXT[got]);
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
      const problems = checkOutreach(outreach, { link: `${APP_URL}/p/${p.slug}`, specifics: p.specifics, stale: staleNumbers(p) });
      if (problems.length) return reply("failed", 400, problems.join(" "));
      const ok = await setOutreach(id, outreach);
      // What the owner changed is how the next drafts learn their voice.
      if (ok) await recordEvents(outreachEdits(p.outreach ?? null, outreach).map((e) => ({ preview_id: id, kind: "edit" as const, message: e.message, variant: null, before: e.before, after: e.after })));
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
      const channel = input.channel === "google_voice" ? "google_voice" : null;
      const got = await markSent(id, kind, new Date(), channel);
      if (got === "not_live") return reply("failed", 409, "That message has the link in it, and the link doesn't open yet. Publish the preview first.");
      if (got === "ok") {
        // What went, and (when the owner reworded it on the Send screen) what it was changed from.
        const p = await getPreviewById(id);
        if (p) {
          const m = resolveOutreach(p, { link: `${APP_URL}/p/${p.slug}`, sender: null });
          const opener = openerText(p.openers);
          const saved = kind === "opener" ? (opener ? openerMessage(opener, `${APP_URL}/p/${p.slug}`) : "") : kind === "ask" ? m.ask : kind === "text" ? m.text : kind === "email" ? m.email.body : kind === "linkedin_note" ? m.linkedin?.note ?? "" : kind === "linkedin_dm" ? m.linkedin?.dm ?? "" : m[kind as "nudge_no_view" | "nudge_viewed"];
          const words = typeof input.words === "string" ? input.words.trim().slice(0, 4000) : "";
          // An opener records whose words went: the model's (its hook) or the owner's edit ("edit:<hook>"), saved or reworded here.
          const variant = kind === "opener" ? openerSentVariant(p.openers, !!words && words !== saved) : kind === "ask" && m.versions ? m.versions.picked : null;
          await recordEvents([{ preview_id: id, kind: "sent", message: kind, variant, before: m.written || kind === "opener" ? saved : null, after: words || (m.written || kind === "opener" ? saved : null), channel: channel ?? (kind === "email" ? "email" : kind.startsWith("linkedin") ? null : "text") }]);
          // One text per number: what went by hand is never sent again by the Mac.
          if (kind === "opener" || kind === "text") await cancelQueuedFor(nanp(p.phone), channel === "google_voice" ? "texted from Google Voice" : "texted by hand", id);
        }
      }
      return reply(got === "ok" ? "sent" : "failed", got === "ok" ? 200 : 500);
    }
    case "send_with": {
      const v = input.value === "" || input.value === null ? null : input.value;
      if (v !== null && !isSendWith(v)) return reply("failed", 400);
      const ok = await setSendWith(id, v);
      if (ok && v === "google_voice") await cancelQueuedFor(null, "switched to Google Voice", id);
      return reply(ok ? (v === "google_voice" ? "send_gv" : "send_imessage") : "failed", ok ? 200 : 500);
    }
    case "stop": {
      const p = await getPreviewById(id);
      if (!p) return reply("failed", 404);
      const e164 = nanp(p.phone);
      if (!e164) return reply("failed", 400, "That number can't be read, so it can't go on the list. Add it by hand in Crew's do-not-contact list.");
      const ok = await suppressNumber(e164, `said stop to ${p.sent_channel === "google_voice" ? "a Google Voice text" : "a text"}, marked by hand`);
      return reply(ok ? "stopped" : "failed", ok ? 200 : 500);
    }
    case "linkedin_accepted": {
      const on = input.on !== "0" && input.on !== false;
      const ok = await setLinkedinAccepted(id, on);
      return reply(ok ? (on ? "accepted" : "saved") : "failed", ok ? 200 : 500);
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
