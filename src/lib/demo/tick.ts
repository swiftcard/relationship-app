import { timingSafeEqual } from "node:crypto";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { notifyAdmin } from "@/lib/admin-notify";
import { reportError } from "@/lib/report-error";
import { calendarAuth } from "./google-calendar";
import { drainDue, overdueCount, type DrainResult } from "./outbox";
import { ensureCalendarEvent, reconcileWithCalendar, type CalendarState } from "./service";
import { queueMessages, wasSent, type DemoBooking } from "./store";

// ── The demo clock's one pass ───────────────────────────────────────────────
// pg_cron calls /api/demo/tick every 5 minutes (supabase/demo-bookings.sql);
// the daily /api/reminders cron and the hourly GitHub catch-up workflow call
// it too as backups. Every step is safe to run twice at once.

const DAY_MS = 86_400_000;
const RECHECK_MS = 60 * 60 * 1000;
const MAX_CALENDAR_ATTEMPTS = 30;

const db = () => getAdminSupabase();

/** Bearer <secret>, constant-time, any of the accepted secrets. None set → nothing passes. */
export function demoTickAuthorized(header: string | null): boolean {
  const secrets = [process.env.DEMO_TICK_SECRET, process.env.PUSH_CATCHUP_SECRET, process.env.CRON_SECRET].filter((s): s is string => !!s);
  const got = Buffer.from(header ?? "");
  return secrets.some((s) => {
    const want = Buffer.from(`Bearer ${s}`);
    return got.length === want.length && timingSafeEqual(got, want);
  });
}

export type TickResult = DrainResult & { calendar: CalendarState; calendarMade: number; checked: number; completed: number };

export async function runDemoTick(now = new Date()): Promise<TickResult> {
  const auth = await calendarAuth();
  const calendar: CalendarState = auth.ok ? "ok" : auth.reason;

  // 1. Events Google didn't make at booking time.
  let calendarMade = 0;
  const { data: pending } = await db().from("demo_bookings").select("*")
    .eq("status", "confirmed").neq("calendar_status", "created").gt("starts_at", now.toISOString())
    .lt("calendar_attempts", MAX_CALENDAR_ATTEMPTS).order("starts_at").limit(10);
  if (calendar === "ok") {
    for (const b of (pending ?? []) as DemoBooking[]) {
      const next = await ensureCalendarEvent(b);
      if (next.calendar_status === "created") {
        calendarMade++;
        // The confirmation already went without a link: send the link now.
        if (next.meet_url && (await wasSent(b.id, "confirmation"))) {
          await queueMessages([{ booking_id: b.id, kind: "meet_link", send_at: now }]);
        }
      }
    }
  }

  // 2. Changes the owner made in Google Calendar, or the guest's reply.
  let checked = 0;
  if (calendar === "ok") {
    const { data: upcoming } = await db().from("demo_bookings").select("*")
      .eq("status", "confirmed").eq("calendar_status", "created")
      .gt("starts_at", now.toISOString()).lt("starts_at", new Date(now.getTime() + 14 * DAY_MS).toISOString())
      .or(`calendar_checked_at.is.null,calendar_checked_at.lt.${new Date(now.getTime() - RECHECK_MS).toISOString()}`)
      .order("starts_at").limit(20);
    for (const b of (upcoming ?? []) as DemoBooking[]) {
      await reconcileWithCalendar(b, now);
      checked++;
    }
  }

  // 3. Everything due.
  const drained = await drainDue({ now });

  // 4. Demos that are over.
  const { data: done } = await db().from("demo_bookings").update({ status: "completed", updated_at: now.toISOString() })
    .eq("status", "confirmed").lt("ends_at", new Date(now.getTime() - 30 * 60_000).toISOString()).select("id");

  // 5. A calendar that stopped working is worth knowing the same day.
  if (calendar === "revoked" || (calendar === "not_connected" && (pending ?? []).length > 0)) {
    const day = now.toISOString().slice(0, 10);
    await notifyAdmin({
      kind: "demos", severity: "urgent",
      title: calendar === "revoked" ? "Google Calendar needs reconnecting" : "Google Calendar isn't connected",
      body: "Demos still book and emails still go, but no calendar events or Meet links are made until it's connected on the Demos page.",
      href: "/admin/demos",
      dedupeKey: `demo:calendar:${calendar}:${day}`,
    });
    if (calendar === "revoked") await reportError("demo.calendar.revoked", auth.ok ? "" : auth.detail ?? "invalid_grant");
  }

  return { ...drained, calendar, calendarMade, checked, completed: (done ?? []).length };
}

/** For the uptime check: is the calendar working, and is anything stuck? */
export async function demoHealth(now = new Date()): Promise<{ calendar: CalendarState; overdue: number }> {
  const auth = await calendarAuth();
  return { calendar: auth.ok ? "ok" : auth.reason, overdue: await overdueCount(now) };
}
