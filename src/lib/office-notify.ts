import { getAdminSupabase } from "@/lib/supabase-admin";
import { isOfficePlan } from "@/lib/plan";

// ── Office "team inbox" notifications ────────────────────────────────────────
// Deliberately SEPARATE from the personal per-user notifications (public
// notifications table, keyed by user_id). These live in office_notifications,
// keyed by office_id, and surface ONLY on the /office/admin bell — never in the
// admin's own dashboard bell. Two different tables = zero chance of bleed.
//
// This inbox is intentionally LOW-NOISE: only team-level events an owner
// actually needs. It must NEVER carry small per-lead activity like "a contact
// was saved" — that belongs on the individual member's personal bell. Rolled-up
// team news (leads waiting, a first lead, milestones, the weekly recap) comes
// from lib/team-alerts.ts, which also decides what reaches the admin's phone.

export type OfficeNotificationType =
  | "member_joined"       // an invited sub-user accepted and is now on the team
  | "member_left"         // a member left this team (e.g. moved to another office)
  | "invite_declined"     // an invitee declined the invitation (seat freed)
  | "invite_expired"      // an invitation ran out unanswered (bell only)
  | "member_first_lead"   // a teammate captured their first-ever lead
  | "leads_waiting"       // team leads with no follow-up a day after they arrived
  | "members_no_card"     // teammates who joined but still have no card
  | "team_milestone"      // the team crossed a round number of views or leads
  | "team_weekly_recap";  // Monday: the team's week

export type OfficeNotification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  created_at: string;
};

/**
 * Is this team LIVE — its owner still on the Office plan?
 *
 * The offices row outlives the subscription on purpose (re-subscribing restores
 * the team), so its existence proves nothing. Nobody can open a lapsed team's
 * inbox (requireOfficeCapability refuses it), and its owner was still being
 * sent team alerts about their own cards (2026-10-02 notification audit). The
 * same test requireOfficeCapability makes, for the same reason.
 *
 * Fails OPEN on a read error: a real team missing one alert during a database
 * blip is worse than a lapsed one getting one.
 */
export async function officeIsLive(officeId: string): Promise<boolean> {
  if (!officeId) return false;
  try {
    const admin = getAdminSupabase();
    const { data: office, error } = await admin.from("offices").select("owner_id").eq("id", officeId).maybeSingle();
    if (error) return true;
    if (!office?.owner_id) return false;
    const { data: owner, error: ownerErr } = await admin.from("profiles").select("plan").eq("id", office.owner_id).maybeSingle();
    if (ownerErr) return true;
    return isOfficePlan((owner?.plan as string | null) ?? null);
  } catch {
    return true;
  }
}

// Emit one important team-inbox notification. Best-effort: a failure here must
// never break the action that triggered it (join, decline, …). Service-role.
// Only for a LIVE team (officeIsLive): a lapsed team's inbox can't be opened.
export async function notifyOffice(
  officeId: string,
  n: { type: OfficeNotificationType; title: string; body?: string | null; meta?: Record<string, unknown> },
): Promise<void> {
  if (!officeId) return;
  if (!(await officeIsLive(officeId))) return;
  try {
    await getAdminSupabase().from("office_notifications").insert({
      office_id: officeId,
      type: n.type,
      title: n.title,
      body: n.body ?? null,
      meta: n.meta ?? null,
    });
  } catch {
    /* best-effort — never block the triggering action on a notification write */
  }
}

// The team inbox for one office, newest first. Service-role; callers gate access
// by office capability first.
export async function listOfficeNotifications(officeId: string, limit = 30): Promise<OfficeNotification[]> {
  if (!officeId) return [];
  try {
    const { data } = await getAdminSupabase()
      .from("office_notifications")
      .select("id, type, title, body, read, created_at")
      .eq("office_id", officeId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data ?? []) as OfficeNotification[];
  } catch {
    // Table not migrated yet, etc. — degrade to an empty inbox rather than 500
    // the whole admin shell (the bell just shows "no team updates").
    return [];
  }
}

// First name (or email local-part) for a human label in a team notification.
export function displayLabelFrom(name?: string | null, email?: string | null): string {
  const n = (name ?? "").trim();
  if (n) return n;
  const e = (email ?? "").trim();
  if (e) return e.split("@")[0];
  return "A teammate";
}
