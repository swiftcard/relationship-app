import { getAdminSupabase } from "@/lib/supabase-admin";
import { decryptToken, encryptToken } from "@/lib/token-crypto";
import { youtubeClient } from "@/lib/agent-connections";
import { DEMO_CALENDAR_EMAIL_DEFAULT, DEMO_TIME_ZONE } from "./config";
import type { Busy } from "./slots";

// ── The owner's Google Calendar, for demos ──────────────────────────────────
// The owner connects hello@swiftcard.me once at /admin/demos (the same
// owner-only OAuth leg as the agents' YouTube connection, lib/agent-connect-
// oauth, provider "google_calendar"). The refresh token lives encrypted in
// agent_connections. Calls are raw fetch, like every other Google call here.
//
// Every demo is an event on that calendar, created with:
//   • a client-chosen id ("scdemo" + the booking id), so a retry after a
//     timeout finds the event it already made instead of making a second;
//   • a Google Meet link (conferenceData.createRequest, hangoutsMeet);
//   • the prospect as the guest and sendUpdates=all, so GOOGLE sends the real
//     calendar invitation (Accept / Decline) and, later, the update or the
//     cancellation. It works in Gmail, Outlook and Apple Mail alike.
//
// Server-only: imports the service-role client.

// The scopes it asks for live with the rest of the OAuth leg, in
// lib/agent-connect-oauth (calendar.events + calendar.freebusy + openid email).
export const CALENDAR_PROVIDER = "google_calendar" as const;

const API = "https://www.googleapis.com/calendar/v3";
const REFRESH_SKEW_MS = 2 * 60 * 1000;

/** The only account the calendar may be connected as (DEMO_CALENDAR_EMAIL). */
export function demoCalendarEmail(): string {
  return (process.env.DEMO_CALENDAR_EMAIL || DEMO_CALENDAR_EMAIL_DEFAULT).trim().toLowerCase();
}

export type CalendarAuth =
  | { ok: true; token: string; account: string | null }
  | { ok: false; reason: "not_connected" | "revoked" | "unavailable"; detail?: string };

type ConnRow = {
  access_token: string; refresh_token: string | null; expires_at: string | null;
  account_label: string | null; connected_at: string; meta: Record<string, unknown> | null;
};

async function loadRow(): Promise<ConnRow | null> {
  try {
    const { data } = await getAdminSupabase().from("agent_connections")
      .select("access_token, refresh_token, expires_at, account_label, connected_at, meta")
      .eq("provider", CALENDAR_PROVIDER).maybeSingle();
    return (data as ConnRow | null) ?? null;
  } catch {
    return null;
  }
}

/** A working access token, refreshed when it is about to expire. Says WHY when
 *  there is none: "revoked" (Google said invalid_grant: connect again) is not
 *  the same as "unavailable" (Google or the network failed: try again). */
export async function calendarAuth(): Promise<CalendarAuth> {
  const row = await loadRow();
  if (!row) return { ok: false, reason: "not_connected" };
  let access: string;
  let refresh: string | null;
  try {
    access = decryptToken(row.access_token);
    refresh = row.refresh_token ? decryptToken(row.refresh_token) : null;
  } catch {
    return { ok: false, reason: "revoked", detail: "stored token can't be decrypted" };
  }
  const fresh = row.expires_at && new Date(row.expires_at).getTime() - Date.now() > REFRESH_SKEW_MS;
  if (fresh) return { ok: true, token: access, account: row.account_label };
  if (!refresh) return { ok: false, reason: "revoked", detail: "no refresh token" };

  const { id, secret } = youtubeClient();
  let res: Response;
  try {
    res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, client_id: id ?? "", client_secret: secret ?? "" }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    return { ok: false, reason: "unavailable", detail: e instanceof Error ? e.message : String(e) };
  }
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; refresh_token?: string; error?: string };
  if (!res.ok || !j.access_token) {
    const revoked = j.error === "invalid_grant" || j.error === "unauthorized_client";
    return { ok: false, reason: revoked ? "revoked" : "unavailable", detail: `${res.status} ${j.error ?? ""}`.trim() };
  }
  const expires_at = new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString();
  await getAdminSupabase().from("agent_connections").update({
    access_token: encryptToken(j.access_token),
    refresh_token: encryptToken(j.refresh_token ?? refresh),
    expires_at, updated_at: new Date().toISOString(),
  }).eq("provider", CALENDAR_PROVIDER);
  return { ok: true, token: j.access_token, account: row.account_label };
}

/** For the admin page: connected as whom, and whether it still works. */
export async function calendarConnection(): Promise<{ state: "ok" | "not_connected" | "revoked" | "unavailable"; account: string | null; connectedAt: string | null; detail?: string }> {
  const row = await loadRow();
  if (!row) return { state: "not_connected", account: null, connectedAt: null };
  const auth = await calendarAuth();
  return auth.ok
    ? { state: "ok", account: row.account_label, connectedAt: row.connected_at }
    : { state: auth.reason, account: row.account_label, connectedAt: row.connected_at, detail: auth.detail };
}

type GResult = { status: number; json: Record<string, unknown> };

async function gfetch(token: string, url: string, init: RequestInit = {}, timeoutMs = 8000): Promise<GResult> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = res.status === 204 ? {} : ((await res.json().catch(() => ({}))) as Record<string, unknown>);
  return { status: res.status, json };
}

function errText(r: GResult): string {
  const e = r.json.error as { message?: string } | string | undefined;
  return `${r.status} ${typeof e === "string" ? e : e?.message ?? ""}`.trim().slice(0, 300);
}

// ── Free/busy ───────────────────────────────────────────────────────────────
// One query covers the whole booking horizon. The slot list reuses it for a
// minute (one lambda), so a burst of visitors opening the popup is one call;
// the booking itself always asks Google fresh.
let fbCache: { at: number; from: number; to: number; busy: Busy[] } | null = null;
const FB_TTL_MS = 60_000;

export type FreeBusy = { ok: true; busy: Busy[] } | { ok: false; reason: "not_connected" | "revoked" | "unavailable" };

export async function freeBusy(from: Date, to: Date, { fresh = false } = {}): Promise<FreeBusy> {
  const now = Date.now();
  if (!fresh && fbCache && now - fbCache.at < FB_TTL_MS && fbCache.from <= from.getTime() && fbCache.to >= to.getTime()) {
    return { ok: true, busy: fbCache.busy };
  }
  const auth = await calendarAuth();
  if (!auth.ok) return { ok: false, reason: auth.reason };
  try {
    const r = await gfetch(auth.token, `${API}/freeBusy`, {
      method: "POST",
      body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), timeZone: "UTC", items: [{ id: "primary" }] }),
    });
    if (r.status !== 200) return { ok: false, reason: "unavailable" };
    const cal = (r.json.calendars as Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }> | undefined)?.primary;
    if (!cal || cal.errors?.length) return { ok: false, reason: "unavailable" };
    const busy = (cal.busy ?? []).map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }))
      .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end));
    fbCache = { at: now, from: from.getTime(), to: to.getTime(), busy };
    return { ok: true, busy };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** Forget the cached free/busy (after a booking, a move or a cancel). */
export function forgetFreeBusy(): void {
  fbCache = null;
}

// ── Events ──────────────────────────────────────────────────────────────────

/** Google event ids are base32hex (0-9, a-v), 5–1024 characters. */
export function eventIdFor(bookingId: string): string {
  return `scdemo${bookingId.replace(/-/g, "").toLowerCase()}`;
}

export type DemoEventInput = {
  bookingId: string;
  start: Date;
  end: Date;
  summary: string;
  description: string;
  attendee: { email: string; name: string };
};

export type EventResult =
  | { ok: true; eventId: string; meetUrl: string | null; htmlLink: string | null }
  | { ok: false; reason: "not_connected" | "revoked" | "unavailable" | "rejected"; detail?: string };

function meetFrom(ev: Record<string, unknown>): string | null {
  if (typeof ev.hangoutLink === "string") return ev.hangoutLink;
  const points = ((ev.conferenceData as { entryPoints?: { entryPointType?: string; uri?: string }[] } | undefined)?.entryPoints) ?? [];
  return points.find((p) => p.entryPointType === "video")?.uri ?? null;
}

function meetPending(ev: Record<string, unknown>): boolean {
  const s = (ev.conferenceData as { createRequest?: { status?: { statusCode?: string } } } | undefined)?.createRequest?.status?.statusCode;
  return s === "pending";
}

export async function createDemoEvent(input: DemoEventInput): Promise<EventResult> {
  const auth = await calendarAuth();
  if (!auth.ok) return { ok: false, reason: auth.reason, detail: auth.detail };
  const id = eventIdFor(input.bookingId);
  const body = {
    id,
    summary: input.summary,
    description: input.description,
    start: { dateTime: input.start.toISOString(), timeZone: DEMO_TIME_ZONE },
    end: { dateTime: input.end.toISOString(), timeZone: DEMO_TIME_ZONE },
    attendees: [{ email: input.attendee.email, displayName: input.attendee.name }],
    guestsCanInviteOthers: false,
    guestsCanModify: false,
    reminders: { useDefault: true },
    conferenceData: { createRequest: { requestId: input.bookingId, conferenceSolutionKey: { type: "hangoutsMeet" } } },
    extendedProperties: { private: { swiftcardDemo: input.bookingId } },
  };
  try {
    let r = await gfetch(auth.token, `${API}/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all`, { method: "POST", body: JSON.stringify(body) });
    if (r.status === 409) {
      // Already made on an earlier try that timed out on our side.
      r = await gfetch(auth.token, `${API}/calendars/primary/events/${id}`);
    }
    if (r.status < 200 || r.status >= 300) {
      return { ok: false, reason: r.status >= 500 || r.status === 429 ? "unavailable" : "rejected", detail: errText(r) };
    }
    let ev = r.json;
    // Google usually has the Meet link at once; if it says "pending", look again.
    for (let i = 0; i < 2 && !meetFrom(ev) && meetPending(ev); i++) {
      await new Promise((res) => setTimeout(res, 1200));
      const again = await gfetch(auth.token, `${API}/calendars/primary/events/${id}`);
      if (again.status === 200) ev = again.json;
    }
    return { ok: true, eventId: id, meetUrl: meetFrom(ev), htmlLink: typeof ev.htmlLink === "string" ? ev.htmlLink : null };
  } catch (e) {
    return { ok: false, reason: "unavailable", detail: e instanceof Error ? e.message : String(e) };
  }
}

export type EventState =
  | { ok: true; gone: true }
  | { ok: true; gone: false; start: Date | null; end: Date | null; attendeeResponse: string | null; meetUrl: string | null }
  | { ok: false; reason: "not_connected" | "revoked" | "unavailable" };

/** What the calendar says now: deleted, moved, or the guest's reply. */
export async function getDemoEvent(eventId: string, guestEmail: string): Promise<EventState> {
  const auth = await calendarAuth();
  if (!auth.ok) return { ok: false, reason: auth.reason };
  try {
    const r = await gfetch(auth.token, `${API}/calendars/primary/events/${encodeURIComponent(eventId)}`);
    if (r.status === 404 || r.status === 410) return { ok: true, gone: true };
    if (r.status !== 200) return { ok: false, reason: "unavailable" };
    const ev = r.json;
    if (ev.status === "cancelled") return { ok: true, gone: true };
    const start = (ev.start as { dateTime?: string } | undefined)?.dateTime;
    const end = (ev.end as { dateTime?: string } | undefined)?.dateTime;
    const guest = ((ev.attendees as { email?: string; responseStatus?: string }[] | undefined) ?? [])
      .find((a) => (a.email ?? "").toLowerCase() === guestEmail.toLowerCase());
    return {
      ok: true, gone: false,
      start: start ? new Date(start) : null,
      end: end ? new Date(end) : null,
      attendeeResponse: guest?.responseStatus ?? null,
      meetUrl: meetFrom(ev),
    };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** Move the event; Google tells the guest. */
export async function moveDemoEvent(eventId: string, start: Date, end: Date): Promise<boolean> {
  const auth = await calendarAuth();
  if (!auth.ok) return false;
  try {
    const r = await gfetch(auth.token, `${API}/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`, {
      method: "PATCH",
      body: JSON.stringify({ start: { dateTime: start.toISOString(), timeZone: DEMO_TIME_ZONE }, end: { dateTime: end.toISOString(), timeZone: DEMO_TIME_ZONE } }),
    });
    return r.status === 200;
  } catch {
    return false;
  }
}

/** Delete the event; Google sends the guest the cancellation. Already gone counts as done. */
export async function deleteDemoEvent(eventId: string): Promise<boolean> {
  const auth = await calendarAuth();
  if (!auth.ok) return false;
  try {
    const r = await gfetch(auth.token, `${API}/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`, { method: "DELETE" });
    return r.status === 204 || r.status === 200 || r.status === 404 || r.status === 410;
  } catch {
    return false;
  }
}
