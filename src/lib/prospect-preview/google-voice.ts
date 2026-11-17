import { nanp } from "./phone-type";
import { localClock } from "./send-window";
import { stageOf } from "./pipeline";
import type { PreviewListRow } from "./types";

// ── Card Builder: openers sent from Google Voice, by hand (owner, 2026-11-17) ─
// A second way to send an opener, next to iMessage: one tap copies the opener
// with its link and opens Google Voice on this prospect's number; the owner
// pastes and presses send there. SwiftCard never drives Google Voice: no
// browser automation, no scraping, no unofficial API (the same rule as
// LinkedIn, 2026-11-13). Nothing here sends anything.
//
// Which way a prospect's opener goes is chosen per batch ("Send with") and
// can be switched per prospect (prospect_previews.send_with). A number off
// iMessage gets Google Voice as its main button whatever the batch says. An
// office line gets neither: it can't take a text.
//
// Pure, tested in tests/card-builder-google-voice.test.ts.

export const SEND_WITH = ["imessage", "google_voice"] as const;
export type SendWith = (typeof SEND_WITH)[number];
export const isSendWith = (v: unknown): v is SendWith => (SEND_WITH as readonly unknown[]).includes(v);
export const SEND_WITH_LABELS: Record<SendWith, string> = { imessage: "iMessage (my Mac)", google_voice: "Google Voice" };

/** Default for how many openers a day go from Google Voice. Changed in the sender settings. */
export const DEFAULT_GV_DAILY_CAP = 20;

/** Shown above the Google Voice list. Google's own rules for personal Voice numbers. */
export const GV_LIMIT_NOTE = "Google can restrict a personal Google Voice number that texts a lot of people who haven't texted it before, so keep the daily number modest.";

/**
 * Where the button goes: Google Voice's web app, on the messages view for
 * this number. The `itemId=t.+1…` form is the address the web app itself
 * shows for a conversation with one number. It isn't documented by Google,
 * so if it ever stops opening the thread, the Messages tab still opens and
 * the number is printed beside the button.
 *
 * The same address on iPhone: the Google Voice app publishes no documented
 * link for "text this number", so a guessed app scheme could open nothing.
 */
export function googleVoiceHref(phone: string): string {
  const e164 = nanp(phone);
  return e164 ? `https://voice.google.com/u/0/messages?itemId=t.${encodeURIComponent(e164)}` : "https://voice.google.com/u/0/messages";
}

type Channeled = Pick<PreviewListRow, "batch_id" | "phone_kind" | "not_imessage_at"> & { send_with?: SendWith | null };

/** The prospect's own choice, then their batch's, then iMessage. */
export function sendWithFor(r: Channeled, batchSendWith: ReadonlyMap<string, SendWith>): SendWith {
  if (r.send_with) return r.send_with;
  return (r.batch_id && batchSendWith.get(r.batch_id)) || "imessage";
}

/**
 * Which send button leads on their card: Google Voice when that is their way,
 * or when the number isn't on iMessage (today those only got "call, or use
 * the email"). Never for an office line.
 */
export function mainSendButton(r: Channeled, batchSendWith: ReadonlyMap<string, SendWith>): "imessage" | "google_voice" | "none" {
  if (r.phone_kind === "office") return "none";
  if (r.not_imessage_at) return "google_voice";
  return sendWithFor(r, batchSendWith);
}

/** Google Voice openers sent today, in the owner's time zone. */
export function gvSentToday(rows: Pick<PreviewListRow, "sent_at" | "sent_channel">[], tz: string, now: Date): number {
  const today = localClock(now, tz).date;
  return rows.filter((r) => r.sent_channel === "google_voice" && r.sent_at && localClock(new Date(r.sent_at), tz).date === today).length;
}

// ── Who may get a text, by number ───────────────────────────────────────────

/**
 * Why a number can't get an opener from here: on the do-not-contact list,
 * already texted (by the Mac, by hand, or from Google Voice, on any preview
 * with that number), or waiting in the Mac's outbox.
 */
export type NumberBlock = "do_not_contact" | "texted" | "with_mac";
export const NUMBER_BLOCK_TEXT: Record<NumberBlock, string> = {
  do_not_contact: "On the do-not-contact list.",
  texted: "This number was already texted.",
  with_mac: "Queued for your Mac to send.",
};

export type OutboxBit = { phone: string; status: string; error: string | null; preview_id: string };

/**
 * One block per preview id. `all` is every preview (for twins: the same
 * number on another card that already went), `outbox` the Mac's rows for
 * these numbers, `dnc` the do-not-contact values found (tel:+1…, emails, @domains).
 */
export function numberBlocks(
  rows: Pick<PreviewListRow, "id" | "phone" | "email">[],
  ctx: { all: Pick<PreviewListRow, "id" | "phone" | "sent_at">[]; outbox: OutboxBit[]; dnc: ReadonlySet<string> },
): Map<string, NumberBlock> {
  const sentNumbers = new Map<string, Set<string>>();
  for (const p of ctx.all) {
    const e = p.sent_at ? nanp(p.phone) : null;
    if (e) sentNumbers.set(e, (sentNumbers.get(e) ?? new Set()).add(p.id));
  }
  const out = new Map<string, NumberBlock>();
  for (const r of rows) {
    const e164 = nanp(r.phone);
    if (!e164) continue;
    const email = (r.email ?? "").trim().toLowerCase();
    if (ctx.dnc.has(`tel:${e164}`) || (email.includes("@") && (ctx.dnc.has(email) || ctx.dnc.has(`@${email.split("@")[1]}`)))) { out.set(r.id, "do_not_contact"); continue; }
    const mine = ctx.outbox.filter((o) => o.phone === e164);
    const went = mine.some((o) => o.status === "sending" || o.status === "sent" || (o.status === "failed" && /^interrupted|may have/i.test(o.error ?? "")));
    const twin = [...(sentNumbers.get(e164) ?? [])].some((id) => id !== r.id);
    if (went || twin) { out.set(r.id, "texted"); continue; }
    if (mine.some((o) => o.status === "scheduled" || o.status === "queued")) out.set(r.id, "with_mac");
  }
  return out;
}

/**
 * "Send from Google Voice": approved, published, nothing sent yet, Google
 * Voice is their way, an opener is written, and the number may be texted.
 * Oldest approval first, so nobody waits at the bottom forever.
 */
export function googleVoiceQueue<T extends PreviewListRow & { send_with?: SendWith | null }>(rows: T[], ctx: { batchSendWith: ReadonlyMap<string, SendWith>; blocks: ReadonlyMap<string, NumberBlock>; now: number; hasOpener: (r: T) => boolean }): T[] {
  return rows
    .filter((r) => stageOf(r) === "ready" && !r.asked_at && Date.parse(r.expires_at) > ctx.now)
    .filter((r) => r.phone_kind !== "office" && !!nanp(r.phone) && ctx.hasOpener(r))
    .filter((r) => sendWithFor(r, ctx.batchSendWith) === "google_voice")
    .filter((r) => !ctx.blocks.has(r.id))
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at));
}

/** Sent from Google Voice in the last `days` days, newest first: where "They said stop" lives. */
export function googleVoiceSent<T extends Pick<PreviewListRow, "sent_at" | "sent_channel">>(rows: T[], now: number, days = 14): T[] {
  const since = now - days * 86_400_000;
  return rows.filter((r) => r.sent_channel === "google_voice" && r.sent_at && Date.parse(r.sent_at) >= since).sort((a, b) => b.sent_at!.localeCompare(a.sent_at!));
}
