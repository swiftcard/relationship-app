import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { calendarConnection } from "@/lib/demo/google-calendar";
import { manageUrl } from "@/lib/demo/token";
import type { DemoBooking } from "@/lib/demo/store";
import DemosView, { type DemoRow } from "./DemosView";

export const metadata = { title: "Demos — SwiftCard Admin" };
export const dynamic = "force-dynamic";

// ── Office demos booked from the pricing page ───────────────────────────────
// Upcoming and past demos, every detail the visitor gave, the Meet link, and
// the Google Calendar connection the whole thing runs on.

const SHOW = 150;

export default async function AdminDemosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (!(await requireAdmin())) notFound();
  const sp = await searchParams;
  const tab = sp.tab === "past" ? "past" : "upcoming";
  const now = new Date();
  const cutoff = new Date(now.getTime() - 30 * 60_000).toISOString();

  const admin = getAdminSupabase();
  let q = admin.from("demo_bookings").select("*").limit(SHOW);
  q = tab === "upcoming"
    ? q.eq("status", "confirmed").gte("ends_at", cutoff).order("starts_at", { ascending: true })
    : q.or(`status.neq.confirmed,ends_at.lt.${cutoff}`).order("starts_at", { ascending: false });

  const [{ data, error }, connection, { count: upcomingCount }] = await Promise.all([
    q,
    calendarConnection(),
    admin.from("demo_bookings").select("id", { count: "exact", head: true }).eq("status", "confirmed").gte("ends_at", cutoff),
  ]);

  const rows: DemoRow[] = ((data ?? []) as DemoBooking[]).map((b) => {
    let link: string | null = null;
    if (b.status === "confirmed" && new Date(b.starts_at).getTime() > now.getTime()) {
      try { link = manageUrl(b); } catch { link = null; }
    }
    return {
      id: b.id, status: b.status, starts_at: b.starts_at, ends_at: b.ends_at, created_at: b.created_at,
      name: b.name, email: b.email, phone: b.phone, company: b.company, team_size: b.team_size,
      role: b.role, crm: b.crm, notes: b.notes, timezone: b.timezone, sms_opt_in: b.sms_opt_in,
      meet_url: b.meet_url, calendar_status: b.calendar_status, calendar_error: b.calendar_error,
      attendee_response: b.attendee_response, reconfirmed_at: b.reconfirmed_at,
      canceled_by: b.canceled_by, cancel_reason: b.cancel_reason, manage_link: link,
    };
  });

  return (
    <DemosView
      tab={tab}
      rows={rows}
      loadFailed={!!error}
      upcomingCount={upcomingCount ?? 0}
      connection={connection}
      connectMessage={sp.connected ? { ok: true, text: sp.connected } : sp.connect_error ? { ok: false, text: sp.connect_error } : null}
      actionMessage={sp.done ?? null}
      now={now.getTime()}
    />
  );
}
