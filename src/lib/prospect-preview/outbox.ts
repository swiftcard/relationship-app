import { getAdminSupabase } from "@/lib/supabase-admin";
import { getSetting, setSetting } from "./desk";
import { openerHook, openerMessage, openerText } from "./opener";
import { networkKey } from "./network-key";
import { lookupPhoneKind, nanp } from "./phone-type";
import { previewState } from "./real-view";
import { readSenderSettings, type SenderSettings } from "./send-window";
import type { ProspectPreview } from "./types";

// ── Card Builder: the outbox the Mac sends from (owner, 2026-11-16) ─────────
// "Approve" on the review screen can queue a prospect's opener here. The Mac
// agent (scripts/card-builder-mac/agent.mjs) takes one at a time, inside the
// owner's hours and daily cap (send-window.ts), and sends it through the
// Messages app from the owner's own number. Nothing on the server sends a
// text to a prospect: this table is only the list of what the owner approved.
//
// SERVER ONLY, service role. Callers gate on requireAdmin().
// Schema: supabase/card-builder-imessage.sql.

const db = () => getAdminSupabase();
const OUTBOX = "prospect_outbox";

export type OutboxStatus = "queued" | "sending" | "sent" | "failed" | "not_imessage" | "canceled";
export type OutboxRow = {
  id: string; created_at: string; preview_id: string; phone: string; body: string; hook: string | null; segment: string | null;
  status: OutboxStatus; claimed_at: string | null; sent_at: string | null; error: string | null;
};

export type QueueResult = "queued" | "already" | "maybe_sent" | "not_live" | "no_opener" | "not_mobile" | "not_imessage" | "do_not_contact" | "failed";
export const QUEUE_RESULT_TEXT: Record<QueueResult, string> = {
  queued: "Queued. Your Mac sends it in your sending hours.",
  already: "Already queued or sent to this number.",
  maybe_sent: "An earlier send to this number was interrupted and may have gone. Check your Messages before sending again.",
  not_live: "Publish the card first: the text carries its link.",
  no_opener: "No opening text was written for them yet.",
  not_mobile: "Their number isn't a mobile, so it can't get an iMessage.",
  not_imessage: "That number isn't on iMessage.",
  do_not_contact: "They're on the do-not-contact list.",
  failed: "That didn't save. Try again in a minute.",
};

/** The phone values the do-not-contact list holds for a number (crew_suppression.value). */
export const suppressionKey = (e164: string) => `tel:${e164}`;

/**
 * Put one prospect's opener in the Mac's queue. Checks, in order: the card
 * is live, an opener exists, the number is a mobile (asked of Twilio once,
 * then kept), it isn't known to be off iMessage, they aren't on the
 * do-not-contact list, and nothing is already queued or sent to them.
 */
export async function queueOpener(p: ProspectPreview, appUrl: string, segment: string | null): Promise<QueueResult> {
  if (previewState(p) !== "live") return "not_live";
  const text = openerText(p.openers);
  if (!text) return "no_opener";
  const e164 = nanp(p.phone);
  if (!e164) return "not_mobile";
  if (p.not_imessage_at) return "not_imessage";
  let kind = p.phone_kind ?? null;
  if (!kind) {
    kind = await lookupPhoneKind(p.phone);
    if (kind) await db().from("prospect_previews").update({ phone_kind: kind }).eq("id", p.id);
  }
  if (kind === "office") return "not_mobile";
  if (await doNotContact(e164, p.email)) return "do_not_contact";
  // One opener per PERSON, not per preview: the same number on another preview
  // that was already texted (by the Mac or by hand) is not texted again.
  const { data: others } = await db().from("prospect_previews").select("id, phone, sent_at").neq("id", p.id).not("sent_at", "is", null).ilike("phone", `%${e164.slice(-4)}`).limit(50);
  if ((others ?? []).some((o) => nanp(String(o.phone)) === e164)) return "already";
  const { data: earlier } = await db().from(OUTBOX).select("status, error").eq("phone", e164).in("status", ["queued", "sending", "sent", "failed"]).limit(20);
  if ((earlier ?? []).some((r) => r.status !== "failed")) return "already";
  if ((earlier ?? []).some((r) => r.status === "failed" && /^interrupted|may have/i.test(String(r.error ?? "")))) return "maybe_sent";
  const { error } = await db().from(OUTBOX).insert({
    preview_id: p.id, phone: e164, body: openerMessage(text, `${appUrl}/p/${p.slug}`), hook: openerHook(p.openers), segment, status: "queued",
  });
  // The partial unique index allows one live row per prospect: a second queue is "already".
  if (error) return error.code === "23505" ? "already" : "failed";
  return "queued";
}

/**
 * On the do-not-contact list by number (tel:+1…), by email, or by the email's
 * whole domain (@brokerage.com): the list is mostly emails and domains.
 */
export async function doNotContact(e164: string, email: string | null): Promise<boolean> {
  const values = [suppressionKey(e164)];
  const e = (email ?? "").trim().toLowerCase();
  if (e.includes("@")) values.push(e, `@${e.split("@")[1]}`);
  const { data } = await db().from("crew_suppression").select("value").in("value", values).limit(1);
  return !!data?.length;
}

export async function listOutbox(limit = 200): Promise<OutboxRow[]> {
  const { data } = await db().from(OUTBOX).select("*").order("created_at", { ascending: false }).limit(limit);
  return (data ?? []) as OutboxRow[];
}

/** Only something not yet sent can be taken back. */
export async function cancelOutbox(id: string): Promise<boolean> {
  const { data, error } = await db().from(OUTBOX).update({ status: "canceled" }).eq("id", id).eq("status", "queued").select("id");
  return !error && !!data?.length;
}

// ── The owner's settings, and the Mac's heartbeat ───────────────────────────

export const senderSettings = async (): Promise<SenderSettings> => readSenderSettings(await getSetting("sender"));
export const saveSenderSettings = (s: SenderSettings) => setSetting("sender", s);

export type MacStatus = { at: string | null; note: string | null; next_send_at: string | null };
/** Written by the Mac agent every minute or so. */
export async function macStatus(): Promise<MacStatus> {
  const v = (await getSetting<Partial<MacStatus>>("mac_agent")) ?? {};
  return { at: typeof v.at === "string" ? v.at : null, note: typeof v.note === "string" ? v.note : null, next_send_at: typeof v.next_send_at === "string" ? v.next_send_at : null };
}
/** The Mac is "on" when it checked in within the last five minutes. */
export const macIsOn = (s: MacStatus, now: number = Date.now()) => !!s.at && now - Date.parse(s.at) < 5 * 60_000;

// ── The owner's own networks ────────────────────────────────────────────────
// "My own devices when I paste the link must NOT count as a view." A signed-in
// admin and a device marked internal are already ignored (real-view.ts). What
// that misses is the owner's OTHER devices on the same connection: the Mac
// whose Messages app draws the link preview the moment it sends, the iPad on
// the couch. So the networks the owner's devices use are remembered (as a
// hash, never the address), and a view from one of them never counts.
//
// Recorded from two places: the Mac agent (its public addresses, every few
// minutes) and the admin's own alert banner poll (every signed-in admin
// device). Card Builder only: a customer's card views never look at this.

type Network = { key: string; at: string; from: string };
export const OWNER_NETWORK_DAYS = 30;
const MAX_NETWORKS = 24;

/**
 * How long a network stays "the owner's". The Mac's is home and is refreshed
 * every few minutes, so 30 days is only a ceiling. A network the owner merely
 * opened the admin on (a phone on a carrier that shares addresses, a café, a
 * prospect's own office) lasts 12 hours, so it can't hide a real prospect's
 * views for long.
 */
export const ADMIN_NETWORK_HOURS = 12;
export function readNetworks(v: unknown, now: number = Date.now()): Network[] {
  if (!Array.isArray(v)) return [];
  return v.filter((n): n is Network => !!n && typeof n.key === "string" && typeof n.at === "string"
    && now - Date.parse(n.at) < (n.from === "mac" ? OWNER_NETWORK_DAYS * 86_400_000 : ADMIN_NETWORK_HOURS * 3_600_000));
}

/** Remember the network `ip` belongs to. Writes at most once an hour per network. */
export async function rememberOwnerNetwork(ip: string, from: string, now: Date = new Date()): Promise<void> {
  const key = networkKey(ip);
  if (!key) return;
  const list = readNetworks(await getSetting("owner_networks"), now.getTime());
  const had = list.find((n) => n.key === key);
  if (had && now.getTime() - Date.parse(had.at) < 3_600_000) return;
  // A network the Mac vouched for stays the Mac's: an admin visit never shortens it.
  const source = had?.from === "mac" ? "mac" : from;
  const next = [{ key, at: now.toISOString(), from: source }, ...list.filter((n) => n.key !== key)].slice(0, MAX_NETWORKS);
  await setSetting("owner_networks", next);
}

export async function isOwnerNetwork(ip: string, now: number = Date.now()): Promise<boolean> {
  const key = networkKey(ip);
  if (!key) return false;
  return readNetworks(await getSetting("owner_networks"), now).some((n) => n.key === key);
}

/** The segment a prospect's opener is counted under: the batch that found them ("realtors in Great Neck"), or "One at a time". */
export async function segmentOf(p: Pick<ProspectPreview, "batch_id">): Promise<string> {
  if (!p.batch_id) return "One at a time";
  const { data } = await db().from("prospect_batches").select("label").eq("id", p.batch_id).maybeSingle();
  return typeof data?.label === "string" && data.label ? data.label.slice(0, 120) : "One at a time";
}
