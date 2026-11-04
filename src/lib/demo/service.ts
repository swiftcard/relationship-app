import { notifyAdmin } from "@/lib/admin-notify";
import { reportError } from "@/lib/report-error";
import { autoTextable } from "@/lib/sms-number";
import { DEMO_DURATION_MS, DEMO_RULES, DEMO_TIME_ZONE } from "./config";
import { fmtWhenShort } from "./format";
import { planReminders, withinTextHours } from "./reminders";
import { isOpenDemoSlot, openDemoSlots, type Busy } from "./slots";
import { manageUrl, newManageToken } from "./token";
import {
  createDemoEvent, deleteDemoEvent, forgetFreeBusy, freeBusy, getDemoEvent, moveDemoEvent,
} from "./google-calendar";
import {
  REMINDER_KINDS, SLOT_TAKEN, DUPLICATE, bookedBusy, getBooking, insertBooking, queueMessages,
  skipPending, updateBooking, type DemoBooking, type MessageKind,
} from "./store";

// ── What a booking does ─────────────────────────────────────────────────────
// Book, move, cancel, reconfirm, and keep in step with the owner's Google
// Calendar. The API routes and the clock call these; nothing here knows HTTP.
// Server-only.

const DAY_MS = 86_400_000;

export type CalendarState = "ok" | "not_connected" | "revoked" | "unavailable";

/** Every busy block in the booking window: confirmed demos + the owner's calendar. */
async function busyWindow(now: Date, { fresh = false, exceptId }: { fresh?: boolean; exceptId?: string } = {}): Promise<{ busy: Busy[]; calendar: CalendarState }> {
  const from = now;
  const to = new Date(now.getTime() + (DEMO_RULES.horizonDays + 1) * DAY_MS);
  // A move leaves its own booking out of the database's blocks. The calendar
  // still shows its event, but on the 30-minute grid that block only ever
  // covers the time it is moving away from.
  const [booked, fb] = await Promise.all([bookedBusy(from, to, exceptId), freeBusy(from, to, { fresh })]);
  return { busy: [...booked, ...(fb.ok ? fb.busy : [])], calendar: fb.ok ? "ok" : fb.reason };
}

export async function listOpenSlots(now = new Date()): Promise<{ slots: Date[]; calendar: CalendarState }> {
  const { busy, calendar } = await busyWindow(now);
  return { slots: openDemoSlots(now, busy), calendar };
}

export type BookInput = {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  teamSize: string;
  role: string | null;
  crm: string | null;
  notes: string | null;
  start: Date;
  timezone: string;
  smsOptIn: boolean;
  source: string;
  ipHash: string | null;
};

export type BookResult =
  | { ok: true; booking: DemoBooking; replay: boolean }
  | { ok: false; error: "slot_taken" | "not_open" | "save_failed" };

function eventText(b: Pick<DemoBooking, "name" | "email" | "phone" | "company" | "team_size" | "role" | "crm" | "notes" | "manage_token_enc">): { summary: string; description: string } {
  const lines = [
    `SwiftCard Office demo with ${b.name} (${b.company}).`,
    "",
    `Need a different time? Reschedule or cancel: ${manageUrl(b)}`,
    "",
    `Name: ${b.name}`,
    `Email: ${b.email}`,
    `Phone: ${b.phone}`,
    `Company: ${b.company}`,
    `Team size: ${b.team_size}`,
    b.role ? `Role: ${b.role}` : "",
    b.crm ? `CRM: ${b.crm}` : "",
    b.notes ? `Notes: ${b.notes}` : "",
  ].filter((l, i, all) => l !== "" || (all[i - 1] ?? "") !== "");
  return { summary: `SwiftCard demo: ${b.name} (${b.company})`, description: lines.join("\n").trim() };
}

/** Make the Google Calendar event (with Meet) and store what came back. */
export async function ensureCalendarEvent(b: DemoBooking): Promise<DemoBooking> {
  if (b.status !== "confirmed" || b.calendar_status === "created") return b;
  const { summary, description } = eventText(b);
  const r = await createDemoEvent({
    bookingId: b.id, start: new Date(b.starts_at), end: new Date(b.ends_at), summary, description,
    attendee: { email: b.email, name: b.name },
  });
  const patch: Partial<DemoBooking> = r.ok
    ? { google_event_id: r.eventId, meet_url: r.meetUrl, calendar_html_link: r.htmlLink, calendar_status: "created", calendar_error: null, calendar_checked_at: new Date().toISOString() }
    : { calendar_status: r.reason === "not_connected" ? "not_connected" : "failed", calendar_error: `${r.reason}${r.detail ? `: ${r.detail}` : ""}`.slice(0, 500) };
  patch.calendar_attempts = b.calendar_attempts + 1;
  await updateBooking(b.id, patch);
  forgetFreeBusy();
  return { ...b, ...patch } as DemoBooking;
}

/** The reminder rows for a booking, counted from `from` (booking or move time). */
function reminderRows(b: DemoBooking, from: Date): { booking_id: string; kind: MessageKind; channel: "email" | "sms"; send_at: Date }[] {
  const start = new Date(b.starts_at);
  const planned = planReminders(from, start, b.timezone);
  const rows: { booking_id: string; kind: MessageKind; channel: "email" | "sms"; send_at: Date }[] =
    planned.map((r) => ({ booking_id: b.id, kind: r.kind, channel: "email" as const, send_at: r.sendAt }));
  const dayOf = planned.find((r) => r.kind === "day_of");
  if (b.sms_opt_in && dayOf && autoTextable(b.phone) && withinTextHours(dayOf.sendAt, b.timezone)) {
    rows.push({ booking_id: b.id, kind: "sms_day_of", channel: "sms", send_at: dayOf.sendAt });
  }
  return rows;
}

export async function bookDemo(input: BookInput, now = new Date()): Promise<BookResult> {
  // A second press of Confirm (same client id): hand back the first booking.
  const existing = await getBooking(input.id);
  if (existing) {
    if (existing.email === input.email) return { ok: true, booking: existing, replay: true };
    return { ok: false, error: "save_failed" };
  }

  const { busy } = await busyWindow(now, { fresh: true });
  if (!isOpenDemoSlot(input.start, now, busy)) {
    // On the grid and in the hours, but busy: someone (or the owner) has it.
    const onGrid = isOpenDemoSlot(input.start, now, []);
    return { ok: false, error: onGrid ? "slot_taken" : "not_open" };
  }

  const tok = newManageToken();
  const row: DemoBooking = {
    id: input.id, status: "confirmed",
    starts_at: input.start.toISOString(), ends_at: new Date(input.start.getTime() + DEMO_DURATION_MS).toISOString(),
    name: input.name, email: input.email, phone: input.phone, company: input.company, team_size: input.teamSize,
    role: input.role, crm: input.crm, notes: input.notes, timezone: input.timezone, sms_opt_in: input.smsOptIn,
    source: input.source, manage_token_hash: tok.hash, manage_token_enc: tok.enc,
    google_event_id: null, meet_url: null, calendar_html_link: null, calendar_status: "pending", calendar_attempts: 0,
    calendar_error: null, calendar_checked_at: null, attendee_response: null, reconfirmed_at: null,
    canceled_at: null, canceled_by: null, cancel_reason: null, ip_hash: input.ipHash,
    created_at: now.toISOString(), updated_at: now.toISOString(),
  };
  const saved = await insertBooking(row);
  if (!saved.ok) {
    if (saved.code === SLOT_TAKEN) return { ok: false, error: "slot_taken" };
    if (saved.code === DUPLICATE) {
      const again = await getBooking(input.id);
      if (again && again.email === input.email) return { ok: true, booking: again, replay: true };
    }
    await reportError("demo.book.insert", saved.message, { code: saved.code });
    return { ok: false, error: "save_failed" };
  }

  const booking = await ensureCalendarEvent(row);
  if (booking.calendar_status !== "created" && booking.calendar_status !== "not_connected") {
    await reportError("demo.calendar.create", booking.calendar_error ?? "unknown", { booking: booking.id });
  }

  await queueMessages([
    { booking_id: booking.id, kind: "confirmation", send_at: now },
    { booking_id: booking.id, kind: "owner_new", send_at: now },
    ...reminderRows(booking, now),
  ]);
  await notifyAdmin({
    kind: "demos",
    title: `Demo booked: ${booking.name}, ${booking.company}`,
    body: `${fmtWhenShort(new Date(booking.starts_at), DEMO_TIME_ZONE)} · team of ${booking.team_size}${booking.calendar_status === "created" ? "" : " · calendar event not made yet"}`,
    href: "/admin/demos",
    dedupeKey: `demo:new:${booking.id}`,
  });
  return { ok: true, booking, replay: false };
}

export type CanceledBy = "prospect" | "admin" | "declined" | "calendar";

export async function cancelDemo(b: DemoBooking, by: CanceledBy, reason: string | null = null, now = new Date()): Promise<DemoBooking> {
  if (b.status !== "confirmed") return b;
  const patch: Partial<DemoBooking> = { status: "canceled", canceled_at: now.toISOString(), canceled_by: by, cancel_reason: reason };
  await updateBooking(b.id, patch);
  forgetFreeBusy();
  const next = { ...b, ...patch } as DemoBooking;
  await skipPending(b.id, [...REMINDER_KINDS, "meet_link", "confirmation", "rescheduled"], "canceled");
  // The calendar first, so Google's own cancellation reaches the guest. When
  // the owner deleted it there already, there is nothing left to delete.
  if (b.google_event_id && by !== "calendar") {
    const gone = await deleteDemoEvent(b.google_event_id);
    if (!gone) await reportError("demo.calendar.delete", "delete failed", { booking: b.id });
  }
  const rows: { booking_id: string; kind: MessageKind; send_at: Date }[] = [{ booking_id: b.id, kind: "owner_canceled", send_at: now }];
  // A guest who pressed No on Google's invite already knows; everyone else hears from us.
  if (by !== "declined" && new Date(b.starts_at).getTime() > now.getTime()) rows.push({ booking_id: b.id, kind: "canceled", send_at: now });
  await queueMessages(rows);
  await notifyAdmin({
    kind: "demos",
    title: `Demo canceled: ${b.name}, ${b.company}`,
    body: `Was ${fmtWhenShort(new Date(b.starts_at), DEMO_TIME_ZONE)} · ${by === "prospect" ? "canceled by them" : by === "declined" ? "they declined the invite" : by === "calendar" ? "deleted in Google Calendar" : "canceled in admin"}${reason ? ` · "${reason.slice(0, 120)}"` : ""}`,
    href: "/admin/demos",
    dedupeKey: `demo:canceled:${b.id}`,
  });
  return next;
}

export type MoveResult = { ok: true; booking: DemoBooking } | { ok: false; error: "slot_taken" | "not_open" | "not_movable" | "save_failed" };

export async function rescheduleDemo(b: DemoBooking, newStart: Date, now = new Date()): Promise<MoveResult> {
  if (b.status !== "confirmed" || new Date(b.starts_at).getTime() <= now.getTime()) return { ok: false, error: "not_movable" };
  const { busy } = await busyWindow(now, { fresh: true, exceptId: b.id });
  if (!isOpenDemoSlot(newStart, now, busy)) {
    return { ok: false, error: isOpenDemoSlot(newStart, now, []) ? "slot_taken" : "not_open" };
  }
  const patch: Partial<DemoBooking> = {
    starts_at: newStart.toISOString(),
    ends_at: new Date(newStart.getTime() + DEMO_DURATION_MS).toISOString(),
    reconfirmed_at: null,
  };
  const saved = await updateBooking(b.id, patch);
  if (!saved.ok) return { ok: false, error: saved.code === SLOT_TAKEN ? "slot_taken" : "save_failed" };
  forgetFreeBusy();
  let next = { ...b, ...patch } as DemoBooking;
  if (b.google_event_id) {
    const moved = await moveDemoEvent(b.google_event_id, newStart, new Date(next.ends_at));
    if (!moved) await reportError("demo.calendar.move", "move failed", { booking: b.id });
  } else {
    next = await ensureCalendarEvent(next);
  }
  await skipPending(b.id, REMINDER_KINDS, "rescheduled");
  await queueMessages([
    { booking_id: b.id, kind: "rescheduled", send_at: now },
    { booking_id: b.id, kind: "owner_rescheduled", send_at: now },
    ...reminderRows(next, now),
  ]);
  await notifyAdmin({
    kind: "demos",
    title: `Demo moved: ${b.name}, ${b.company}`,
    body: `Now ${fmtWhenShort(newStart, DEMO_TIME_ZONE)} (was ${fmtWhenShort(new Date(b.starts_at), DEMO_TIME_ZONE)})`,
    href: "/admin/demos",
    dedupeKey: `demo:moved:${b.id}:${newStart.toISOString()}`,
  });
  return { ok: true, booking: next };
}

export async function reconfirmDemo(b: DemoBooking, now = new Date()): Promise<DemoBooking> {
  if (b.status !== "confirmed" || b.reconfirmed_at || new Date(b.starts_at).getTime() <= now.getTime()) return b;
  const patch: Partial<DemoBooking> = { reconfirmed_at: now.toISOString() };
  await updateBooking(b.id, patch);
  return { ...b, ...patch } as DemoBooking;
}

/**
 * Bring a booking in line with what the owner's calendar says now:
 *   deleted there        → canceled here (the time opens again);
 *   moved there          → moved here, reminders rebuilt (Google told the guest);
 *   guest pressed No     → canceled, the owner is told.
 * Returns the booking as it now stands. Leaves it alone when Google can't be asked.
 */
export async function reconcileWithCalendar(b: DemoBooking, now = new Date()): Promise<DemoBooking> {
  if (b.status !== "confirmed" || !b.google_event_id) return b;
  const ev = await getDemoEvent(b.google_event_id, b.email);
  if (!ev.ok) return b;
  if (ev.gone) return cancelDemo(b, "calendar", null, now);
  const checked: Partial<DemoBooking> = { calendar_checked_at: now.toISOString(), attendee_response: ev.attendeeResponse };
  if (ev.meetUrl && ev.meetUrl !== b.meet_url) checked.meet_url = ev.meetUrl;
  if (ev.attendeeResponse === "declined") {
    await updateBooking(b.id, checked);
    return cancelDemo({ ...b, ...checked } as DemoBooking, "declined", null, now);
  }
  const movedTo = ev.start && ev.start.getTime() !== new Date(b.starts_at).getTime() ? ev.start : null;
  if (movedTo && ev.end) {
    checked.starts_at = movedTo.toISOString();
    checked.ends_at = ev.end.toISOString();
    checked.reconfirmed_at = null;
  }
  const saved = await updateBooking(b.id, checked);
  if (!saved.ok && movedTo) {
    // Moved onto another demo's time in the calendar: keep ours, tell the owner.
    await updateBooking(b.id, { calendar_checked_at: now.toISOString(), attendee_response: ev.attendeeResponse });
    await notifyAdmin({ kind: "demos", severity: "urgent", title: `Two demos overlap: ${b.name}`, body: "A demo was moved in Google Calendar onto another demo's time. Move one of them.", href: "/admin/demos", dedupeKey: `demo:overlap:${b.id}:${movedTo.toISOString()}` });
    return b;
  }
  const next = { ...b, ...checked } as DemoBooking;
  if (movedTo) {
    forgetFreeBusy();
    await skipPending(b.id, REMINDER_KINDS, "moved_in_calendar");
    await queueMessages([{ booking_id: b.id, kind: "owner_rescheduled", send_at: now }, ...reminderRows(next, now)]);
  }
  return next;
}
