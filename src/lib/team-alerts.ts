import { getAdminSupabase } from "@/lib/supabase-admin";
import { notifyOffice, officeIsLive, type OfficeNotificationType } from "@/lib/office-notify";
import { sendPushToUser } from "@/lib/push";
import { isAssignableRole, roleHasCapability } from "@/lib/office-roles";
import { officeNotificationPath } from "@/lib/office-notification-links";

// ── What an Office admin hears about their TEAM ─────────────────────────────
//
// Owner, 2026-09-22: "in their admin account do they get any notifications to
// their phones if their team hits any certain milestones … We obviously don't
// want their account to get spammed because they're going to have multiple
// subusers under them."
//
// So the admin hears about the TEAM, never about each member's events. A
// teammate's views and leads keep going to THAT teammate (their own bell and
// phone); the admin's own card keeps its own personal alerts. What reaches the
// admin is short, rolled up and worth acting on:
//
//   bell (office_notifications, the /office/admin bell) — everything below
//   phone (category team_alert, ≤2 a day, lib/push-policy) — only when `push`
//     is set: a teammate joined, a teammate's first lead, leads with no
//     follow-up a day on, teammates with no card yet, a team milestone.
//     Expired invites are bell-only. Every team push says "Team · <office>".
//   Monday (category weekly_recap) — the team's week (api/push/recap).
//
// WHO IS AN ADMIN HERE: the owner, and any active member whose role can see the
// team's numbers (view_org_analytics — admin, manager, billing admin). The same
// capability that opens this bell in the console.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

/** The office owner plus every active member whose role sees team analytics —
 *  nobody at all once the team is no longer live (owner off the Office plan). */
export async function teamAlertRecipients(officeId: string): Promise<string[]> {
  if (!(await officeIsLive(officeId))) return [];
  const admin = getAdminSupabase();
  const { data: office } = await admin.from("offices").select("owner_id").eq("id", officeId).maybeSingle();
  const ids = new Set<string>();
  if (office?.owner_id) ids.add(office.owner_id as string);
  const { data: members } = await admin
    .from("office_members")
    .select("user_id, role")
    .eq("office_id", officeId)
    .eq("status", "active");
  for (const m of members ?? []) {
    const role = typeof m.role === "string" && isAssignableRole(m.role) ? m.role : "employee";
    if (m.user_id && roleHasCapability(role, "view_org_analytics")) ids.add(m.user_id as string);
  }
  return [...ids];
}

/** Is this person someone who receives team alerts for some LIVE office? A
 *  lapsed owner is not: they get their own recap and no Team alerts switch. */
export async function isTeamAlertRecipient(userId: string): Promise<boolean> {
  const admin = getAdminSupabase();
  const { data: owned } = await admin.from("offices").select("id").eq("owner_id", userId).limit(1).maybeSingle();
  if (owned) return officeIsLive(owned.id as string);
  const { data: m } = await admin
    .from("office_members").select("role, office_id").eq("user_id", userId).eq("status", "active").limit(1).maybeSingle();
  const role = typeof m?.role === "string" && isAssignableRole(m.role) ? m.role : "employee";
  if (!m || !roleHasCapability(role, "view_org_analytics")) return false;
  return officeIsLive(m.office_id as string);
}

export type TeamAlert = {
  type: OfficeNotificationType;
  title: string;
  body: string;
  meta?: Record<string, unknown>;
  /** Also to the admins' phones (team_alert). Omit for bell-only news. */
  push?: { title?: string; body?: string; path?: string };
  /** Don't notify these users' phones (e.g. the teammate the news is about). */
  skipPushFor?: string[];
};

// ── Telling a TEAM push apart from a personal one ───────────────────────────
//
// An admin gets two kinds of push on the same phone: their own card's ("New
// contact: Jordan Rivera") and their team's. The bell has two separate inboxes
// to tell them apart; a lock screen has none. So every team push carries a
// line naming the team — iOS shows it as the subtitle between title and body,
// a browser as the body's first line — and sits in its own notification
// group (the iOS thread), away from the personal ones.

/** "Team · Harbor Realty" — the line every team push carries. */
export function teamPushContext(officeName: string | null | undefined): string {
  const name = (officeName ?? "").replace(/\s+/g, " ").trim();
  return name ? `Team · ${name}` : "Team";
}

/** One notification group per office on iOS, apart from the personal ones. */
export function teamPushThread(officeId: string): string {
  return `team-${officeId}`;
}

/**
 * The collapse id. A push with the SAME id replaces the one already on the
 * lock screen, so it has to be unique per piece of news: "team-member_joined"
 * for everyone meant a second person joining silently REPLACED the first on
 * the lock screen. Leads-waiting keeps one id on purpose — each day's count
 * supersedes the last.
 */
export function teamPushTag(type: OfficeNotificationType, meta?: Record<string, unknown>): string {
  const m = meta ?? {};
  const key =
    typeof m.userId === "string" ? m.userId
    : typeof m.memberId === "string" ? m.memberId
    : typeof m.kind === "string" && typeof m.n === "number" ? `${m.kind}-${m.n}`
    : null;
  // apns-collapse-id is capped at 64 bytes: the type and a uuid fit.
  return (key ? `team-${type}-${key}` : `team-${type}`).slice(0, 64);
}

/**
 * One team event: a row in the admin bell and, when `push` is set, a push to
 * each admin — through sendPushToUser, so their switch, quiet hours and the
 * two-a-day cap all apply. Best-effort: never throws into the caller.
 */
export async function alertTeam(officeId: string, alert: TeamAlert): Promise<void> {
  if (!officeId) return;
  await notifyOffice(officeId, { type: alert.type, title: alert.title, body: alert.body, meta: alert.meta });
  if (!alert.push) return;
  try {
    const admin = getAdminSupabase();
    const [{ data: office }, recipients] = await Promise.all([
      admin.from("offices").select("name").eq("id", officeId).maybeSingle(),
      teamAlertRecipients(officeId),
    ]);
    const context = teamPushContext(office?.name as string | null | undefined);
    await Promise.all(recipients.filter((id) => !alert.skipPushFor?.includes(id)).map((userId) =>
      sendPushToUser(userId, {
        category: "team_alert",
        title: alert.push!.title ?? alert.title,
        body: alert.push!.body ?? alert.body,
        // The same screen the bell row opens (lib/office-notification-links).
        url: `${APP_URL}${alert.push!.path ?? officeNotificationPath(alert.type)}`,
        tag: teamPushTag(alert.type, alert.meta),
        context,
        thread: teamPushThread(officeId),
      }).catch(() => {}),
    ));
  } catch { /* best-effort */ }
}

/** The active office a user is a MEMBER of (not owner), or null. */
export async function memberOfficeId(userId: string): Promise<string | null> {
  const { data } = await getAdminSupabase()
    .from("office_members").select("office_id").eq("user_id", userId).eq("status", "active").limit(1).maybeSingle();
  return (data?.office_id as string | undefined) ?? null;
}

/**
 * A TEAMMATE's first-ever lead — the moment a new person's card proves itself,
 * and the one per-member event worth an admin's phone (it happens once per
 * person, ever). Not for the owner's own cards: that news is already on the
 * owner's personal phone. Ledgered by the bell row, so a retry or a race
 * cannot announce it twice.
 */
export async function announceFirstLeadIfTeammate(userId: string, memberName: string | null): Promise<void> {
  try {
    const officeId = await memberOfficeId(userId);
    if (!officeId) return;
    const admin = getAdminSupabase();
    const { data: cards } = await admin.from("cards").select("username").eq("user_id", userId);
    const slugs = (cards ?? []).map((c) => c.username as string).filter(Boolean);
    if (!slugs.length) return;
    // Real leads only: the sample contact (lib/demo-contact) made a first
    // real lead count 2, so this never fired for anyone who kept it.
    const { count } = await admin.from("leads").select("id", { count: "exact", head: true }).in("card_owner", slugs).not("tags", "cs", "{demo}");
    if (count !== 1) return;
    const { data: already } = await admin
      .from("office_notifications").select("id")
      .eq("office_id", officeId).eq("type", "member_first_lead").contains("meta", { userId })
      .limit(1);
    if (already?.length) return;
    const first = (memberName ?? "").trim().split(/\s+/)[0] || "A teammate";
    await alertTeam(officeId, {
      type: "member_first_lead",
      title: `First lead for ${first} 🎉`,
      body: `${first}'s card just captured its first lead. It's in the Leads tab.`,
      meta: { userId },
      push: {},
      skipPushFor: [userId],
    });
  } catch { /* best-effort */ }
}

// ── Team milestones ─────────────────────────────────────────────────────────
// Round numbers only, and each announced once per office, ever (the bell row
// is the ledger). Pure so the thresholds are testable.
export const TEAM_VIEW_MILESTONES = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
export const TEAM_LEAD_MILESTONES = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

/** The highest milestone reached that has not been announced, or null. */
export function nextTeamMilestone(total: number, ladder: number[], announced: number[]): number | null {
  const reached = ladder.filter((n) => total >= n && !announced.includes(n));
  return reached.length ? reached[reached.length - 1] : null;
}

export function formatCount(n: number): string {
  return n >= 1000 && n % 1000 === 0 ? `${n / 1000}k` : n.toLocaleString("en-US");
}

// ── Grouped team news: ONE notification that says who ───────────────────────
// A team check that finds four people's leads waiting sends one row, not four,
// and that one row names them — "Mia (2), Sam (1)" — so the admin knows who to
// talk to without opening anything. Pure, so the wording is testable.

/** "Mia", from "Mia Member" — or the fallback when there is no name at all. */
export function firstNameOf(name: string | null | undefined, fallback = "A teammate"): string {
  return (name ?? "").trim().split(/\s+/)[0] || fallback;
}

/** "Mia (2), Sam (1) and 2 others" — most first, at most three names. */
export function whoList(people: { name: string; n?: number }[], max = 3): string {
  const sorted = [...people].sort((a, b) => (b.n ?? 0) - (a.n ?? 0));
  const named = sorted.slice(0, max).map((p) => (p.n ? `${p.name} (${p.n})` : p.name));
  const rest = sorted.length - named.length;
  if (rest > 0) return `${named.join(", ")} and ${rest} ${rest === 1 ? "other" : "others"}`;
  if (named.length <= 1) return named.join("");
  return `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}

/**
 * Leads a day old with NO follow-up set up — the state the admin Leads table
 * shows as "No follow-up" and can filter to. (It used to be "still marked New",
 * a status nothing in the product can change any more, so EVERY lead was
 * announced a day after it arrived.)
 */
export function noFollowUpCopy(people: { name: string; n: number }[]): { title: string; body: string; pushBody: string } {
  const total = people.reduce((s, p) => s + p.n, 0);
  const title = total === 1 ? "1 team lead has no follow-up yet" : `${total} team leads have no follow-up yet`;
  const who = whoList(people);
  return {
    title,
    body: `A day after they came in, nothing is set up for these: ${who}. They're filtered for you in Leads.`,
    pushBody: `Waiting on: ${who}.`,
  };
}

/** Teammates who joined but still have no card — so nothing to share. */
export function noCardCopy(names: string[]): { title: string; body: string } {
  const title = names.length === 1 ? `${names[0]} hasn't made a card yet` : `${names.length} teammates haven't made a card yet`;
  const who = whoList(names.map((name) => ({ name })));
  return {
    title,
    body: `${who} joined your team but can't share a card until they make one. Check in with them from the Team tab.`,
  };
}
