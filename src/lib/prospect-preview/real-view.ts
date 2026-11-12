import { isLikelyBot } from "@/lib/bot-detection";
import { MAX_TITLE_CHARS } from "@/lib/push-policy";
import type { DeviceType } from "./types";

// ── Card Builder: is this a real view, and should it ring the phone? ────────
//
// The alert this feeds says "[Owner] is viewing their card. Call [phone]." and
// someone picks up the phone on the strength of it, so a false one is worse
// than a missed one. A page REQUEST is therefore never a view: iMessage,
// WhatsApp, Slack and every mail scanner request the page the instant a link
// is pasted, long before a person looks. A view is only what the page's own
// beacon reports once a person has demonstrably been there (lib/prospect-
// preview/gate.ts), and then only if nothing below says otherwise.
//
// Pure, so every rule is tested without a database (tests/prospect-preview-
// real-view.test.ts). Deliberately separate from the card-view pipeline
// (lib/record-view.ts, /api/card-events): that one counts customers' cards and
// tells their OWNERS; this one counts sales previews and tells STAFF. They
// share the bot list and nothing else.

/** Speculative loads: the browser fetching a page nobody has asked to see. */
export const PREFETCH_RE = /prefetch|prerender|preview/i;

export type RealViewVerdict =
  | "record"
  | "missing"   // no such preview, or it is paused
  | "expired"
  | "bot"       // crawler, link-preview fetcher, automation, monitor, script
  | "prefetch"
  | "internal"  // a staff device (sc_internal) or a signed-in admin
  | "hosting";  // a datacenter address: no person is on the other end

export type RealViewInput = {
  userAgent: string | null | undefined;
  /** sec-purpose / purpose / x-purpose, whichever the browser sent. */
  purposeHeader?: string | null;
  /** The sc_internal cookie: this device was marked as staff's own. */
  internalCookie: boolean;
  /** The browser is signed in as a site admin. */
  adminSession: boolean;
  /** The address belongs to a cloud host (lib/request-geo isHosting). */
  isHosting: boolean;
  preview: { status: string; expires_at: string } | null;
  now?: number;
};

/** A preview that should be served: live, and not past its expiry. */
export function previewState(preview: { status: string; expires_at: string } | null, now: number = Date.now()): "live" | "missing" | "expired" {
  if (!preview || preview.status !== "live") return "missing";
  const until = Date.parse(preview.expires_at);
  if (!Number.isFinite(until) || until <= now) return "expired";
  return "live";
}

export function decideRealView(input: RealViewInput): RealViewVerdict {
  const state = previewState(input.preview, input.now);
  if (state !== "live") return state;

  // The beacon is sent by a browser running the page's script, and every
  // browser names itself. No User-Agent at all is a script.
  const ua = (input.userAgent ?? "").trim();
  if (!ua || isLikelyBot(ua)) return "bot";
  if (input.purposeHeader && PREFETCH_RE.test(input.purposeHeader)) return "prefetch";
  if (input.internalCookie || input.adminSession) return "internal";
  if (input.isHosting) return "hosting";
  return "record";
}

// ── When a view rings the phone ─────────────────────────────────────────────

/**
 * How many "new device" alerts one preview may raise in 24 hours.
 *
 * Alerts go out at any hour (owner, 2026-11-11), and a "device" is a browser's
 * own cookie, which anyone holding the link can throw away and mint again.
 * Without a ceiling the link itself would be a button that rings the owner's
 * phone at 3am as often as someone cares to press it. Views past the ceiling
 * are still recorded and still show in Card Builder; they just don't ring.
 */
export const NEW_DEVICE_ALERTS_PER_DAY = 5;

/**
 * The first real view rings, and so does the first view from each device
 * after that (the owner forwarding it to a partner is the best news there
 * is). The first view ever is by definition the first from its device, so one
 * test covers both. The same device looking again never rings.
 */
export function shouldAlert(input: { firstFromDevice: boolean; alertsToday: number }): boolean {
  return input.firstFromDevice && input.alertsToday < NEW_DEVICE_ALERTS_PER_DAY;
}

/** Phone, tablet or computer, from the User-Agent (and the tracker's iPad hint). */
export function deviceTypeOf(userAgent: string | null | undefined, touchMac = false): DeviceType {
  const ua = userAgent ?? "";
  if (/iPad|Tablet|SM-T|Kindle|Silk|PlayBook/i.test(ua) || (touchMac && /Macintosh/i.test(ua))) return "tablet";
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "phone" : "tablet";
  if (/iPhone|iPod|Mobile|Windows Phone/i.test(ua)) return "phone";
  return "desktop";
}

/**
 * The words on the lock screen.
 *
 * Asked for as one sentence: "[Owner] is viewing their card. Call [phone]."
 * It is sent as title + body because a lock screen cuts each line (40 and
 * about 60 characters, lib/push-policy) and the one thing that must never be
 * cut is the phone number. So the number LEADS the body, and a long name
 * gives way before the verb does.
 */
export function alertText(p: { owner_name: string; office_name: string; phone: string }): { title: string; body: string } {
  const tail = " is viewing their card";
  const full = p.owner_name.trim();
  const first = full.split(/\s+/)[0] ?? "";
  const who = [full, first, "Your prospect"].find((n) => n && n.length + tail.length <= MAX_TITLE_CHARS) ?? "Your prospect";
  return { title: `${who}${tail}`, body: `Call ${p.phone.trim()} · ${p.office_name.trim()}` };
}
