import { getAdminSupabase } from "@/lib/supabase-admin";
import type { Busy } from "./slots";

// ── Demo bookings in the database ───────────────────────────────────────────
// Tables: supabase/demo-bookings.sql. Server-only (service role).

export type DemoStatus = "confirmed" | "canceled" | "completed" | "no_show";
export type CalendarStatus = "pending" | "created" | "failed" | "not_connected";

export type DemoBooking = {
  id: string;
  status: DemoStatus;
  starts_at: string;
  ends_at: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  team_size: string;
  role: string | null;
  crm: string | null;
  notes: string | null;
  timezone: string;
  sms_opt_in: boolean;
  source: string;
  manage_token_hash: string;
  manage_token_enc: string;
  google_event_id: string | null;
  meet_url: string | null;
  calendar_html_link: string | null;
  calendar_status: CalendarStatus;
  calendar_attempts: number;
  calendar_error: string | null;
  calendar_checked_at: string | null;
  attendee_response: string | null;
  reconfirmed_at: string | null;
  canceled_at: string | null;
  canceled_by: string | null;
  cancel_reason: string | null;
  ip_hash: string | null;
  created_at: string;
  updated_at: string;
};

export type MessageKind =
  | "confirmation" | "halfway" | "night_before" | "day_of" | "sms_day_of"
  | "rescheduled" | "canceled" | "meet_link"
  | "owner_new" | "owner_rescheduled" | "owner_canceled";

export const REMINDER_KINDS: MessageKind[] = ["halfway", "night_before", "day_of", "sms_day_of"];

export type DemoMessage = {
  id: number;
  booking_id: string;
  kind: MessageKind;
  channel: "email" | "sms";
  send_at: string;
  claimed_at: string | null;
  sent_at: string | null;
  attempts: number;
  last_error: string | null;
  provider_id: string | null;
  skipped_reason: string | null;
};

/** Postgres refused an overlapping confirmed demo (demo_no_overlap). */
export const SLOT_TAKEN = "23P01";
/** A unique key already holds this value. */
export const DUPLICATE = "23505";

const db = () => getAdminSupabase();

export async function getBooking(id: string): Promise<DemoBooking | null> {
  const { data } = await db().from("demo_bookings").select("*").eq("id", id).maybeSingle();
  return (data as DemoBooking | null) ?? null;
}

export async function getBookingByTokenHash(hash: string): Promise<DemoBooking | null> {
  const { data } = await db().from("demo_bookings").select("*").eq("manage_token_hash", hash).maybeSingle();
  return (data as DemoBooking | null) ?? null;
}

/** The confirmed demo this email already has coming up, if any. Emails are
 *  stored lower-cased (api/demo/book). */
export async function upcomingForEmail(email: string, now: Date): Promise<DemoBooking | null> {
  const { data } = await db().from("demo_bookings").select("*")
    .eq("status", "confirmed").eq("email", email.trim().toLowerCase())
    .gt("starts_at", now.toISOString()).order("starts_at").limit(1);
  return ((data ?? [])[0] as DemoBooking | undefined) ?? null;
}

/** Confirmed demos as busy blocks, optionally leaving one booking out (its own move). */
export async function bookedBusy(from: Date, to: Date, exceptId?: string): Promise<Busy[]> {
  let q = db().from("demo_bookings").select("id, starts_at, ends_at")
    .eq("status", "confirmed").lt("starts_at", to.toISOString()).gt("ends_at", from.toISOString());
  if (exceptId) q = q.neq("id", exceptId);
  const { data, error } = await q;
  if (error) throw new Error(`demo_bookings read failed: ${error.message}`);
  return (data ?? []).map((r) => ({ start: new Date(r.starts_at as string).getTime(), end: new Date(r.ends_at as string).getTime() }));
}

/** Bookings made in the last 24 hours, site-wide (the daily cap). */
export async function bookingsLastDay(now: Date): Promise<number> {
  const { count } = await db().from("demo_bookings").select("id", { count: "exact", head: true })
    .gt("created_at", new Date(now.getTime() - 86_400_000).toISOString());
  return count ?? 0;
}

export async function insertBooking(row: Partial<DemoBooking> & { id: string }): Promise<{ ok: true } | { ok: false; code: string | null; message: string }> {
  const { error } = await db().from("demo_bookings").insert(row);
  if (!error) return { ok: true };
  return { ok: false, code: error.code ?? null, message: error.message };
}

export async function updateBooking(id: string, patch: Partial<DemoBooking>): Promise<{ ok: true } | { ok: false; code: string | null; message: string }> {
  const { error } = await db().from("demo_bookings").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (!error) return { ok: true };
  return { ok: false, code: error.code ?? null, message: error.message };
}

/** Queue messages. One pending row per booking + kind: a duplicate is a no-op. */
export async function queueMessages(rows: { booking_id: string; kind: MessageKind; channel?: "email" | "sms"; send_at: Date }[]): Promise<void> {
  for (const r of rows) {
    const { error } = await db().from("demo_messages").insert({
      booking_id: r.booking_id, kind: r.kind, channel: r.channel ?? "email", send_at: r.send_at.toISOString(),
    });
    if (error && error.code !== DUPLICATE) console.error("[demo] queue", r.kind, error.message);
  }
}

/** Retire pending messages of these kinds (a cancel, a move, an opt-out). */
export async function skipPending(bookingId: string, kinds: MessageKind[], reason: string): Promise<void> {
  if (!kinds.length) return;
  const { error } = await db().from("demo_messages").update({ skipped_reason: reason })
    .eq("booking_id", bookingId).in("kind", kinds).is("sent_at", null).is("skipped_reason", null);
  if (error) console.error("[demo] skip", bookingId, error.message);
}

/** Has a message of this kind already gone out for the booking? */
export async function wasSent(bookingId: string, kind: MessageKind): Promise<boolean> {
  const { data } = await db().from("demo_messages").select("id").eq("booking_id", bookingId).eq("kind", kind).not("sent_at", "is", null).limit(1);
  return (data ?? []).length > 0;
}
