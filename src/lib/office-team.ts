import { getAdminSupabase } from "@/lib/supabase-admin";
import { getOfficeAnalytics, type EmployeeAnalytics } from "@/lib/office-analytics";
import { getOfficeSeatUsage, type SeatUsage } from "@/lib/office-seats";
import { isInviteExpired } from "@/lib/office-invite";
import type { MemberStatus } from "@/lib/member-status";

// ── Team-tab data: monthly stats, per-person activity, setup progress ───────
// Everything the Team tab shows beyond what getOfficeAnalytics already counts.
// Scoped to ONE office; callers must have passed requireOfficeAdmin first.
//
// "This month" is the CALENDAR month (what a small-business owner means by it),
// compared against the previous calendar month.

export const ACTIVE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // idle after 14 quiet days

// A month-over-month arrow needs a baseline worth comparing against. Going from
// 1 lead to 2 is "+100%", which reads like a trend and is really just noise —
// so below this many events last month we show the number with no delta at all.
const MIN_BASELINE_FOR_DELTA = 5;

export type MonthStat = {
  current: number;
  previous: number;
  // null when last month is zero or too thin to draw a conclusion from.
  deltaPct: number | null;
};

// The status vocabulary now lives in lib/member-status (client-safe).
// Re-exported so existing server-side importers are untouched — but a CLIENT
// component must import from "@/lib/member-status" directly, or it pulls this
// module, and the service-role client, onto its bundle path.
export { MEMBER_STATUS_LABEL } from "@/lib/member-status";
export type { MemberStatus } from "@/lib/member-status";

export type TeamPerson = EmployeeAnalytics & {
  kind: "member";
  memberRowId: string | null; // office_members.id — null for the owner (no row)
  title: string | null;
  email: string | null;
  photoUrl: string | null;
  // Latest card view or captured lead on any of their cards. Null = never.
  lastActiveAt: string | null;
  liveCards: number;
  totalCards: number;
  status: MemberStatus;
};

export type TeamInvite = {
  kind: "invite";
  memberRowId: string;
  /** The name the admin typed when inviting (null if they gave only an email). */
  name: string | null;
  email: string;
  inviteToken: string | null;
  sentAt: string | null;
  status: "invite_sent" | "invite_expired";
};

export type TeamOverview = {
  stats: {
    leadsThisMonth: MonthStat;
    viewsThisMonth: MonthStat;
    activation: ActivationRate;
    seats: SeatUsage;
  };
  people: TeamPerson[];
  invites: TeamInvite[];
  totals: { members: number; cards: number; views: number; leads: number };
};

function monthStartIso(offset: 0 | 1, now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
  return d.toISOString();
}

export function deltaPct(current: number, previous: number): number | null {
  if (previous < MIN_BASELINE_FOR_DELTA) return null;
  return Math.round(((current - previous) / previous) * 100);
}

// ── Team activation rate ─────────────────────────────────────────────────────
// "Team members with a completed live card ÷ total invited team members."
// The OWNER is excluded from both sides: they aren't invited, and they always
// have a card (their card is the brand), so including them would inflate the
// rate toward 100% and hide the exact problem this measures — people who were
// invited and never finished. Pure so it's unit-testable.

export type ActivationRate = {
  activated: number;
  invited: number;
  // null when nobody has been invited yet — 0/0 is not "0% activated".
  pct: number | null;
};

export function computeActivation(input: { activatedMembers: number; invitedTotal: number }): ActivationRate {
  const activated = Math.max(0, input.activatedMembers);
  const invited = Math.max(0, input.invitedTotal);
  return { activated, invited, pct: invited > 0 ? Math.round((activated / invited) * 100) : null };
}

export function memberStatus(input: {
  liveCards: number;
  totalCards: number;
  lastActiveAt: string | null;
  now?: number;
}): MemberStatus {
  const now = input.now ?? Date.now();
  if (input.totalCards === 0) return "card_incomplete";
  if (input.liveCards === 0) return "card_deactivated";
  const active = !!input.lastActiveAt && now - new Date(input.lastActiveAt).getTime() < ACTIVE_WINDOW_MS;
  return active ? "active" : "idle";
}

// All public slugs a set of users own (profile handle + every card), keyed per
// user — the same union every other office query uses, built once.
async function slugsByUser(userIds: string[]): Promise<Map<string, string[]>> {
  const admin = getAdminSupabase();
  const map = new Map<string, string[]>();
  if (!userIds.length) return map;
  const [{ data: profiles }, { data: cards }] = await Promise.all([
    admin.from("profiles").select("id, username").in("id", userIds),
    admin.from("cards").select("user_id, username").in("user_id", userIds),
  ]);
  for (const p of profiles ?? []) {
    if (p.username) map.set(p.id as string, [p.username as string]);
  }
  for (const c of cards ?? []) {
    const arr = map.get(c.user_id as string) ?? [];
    if (c.username && !arr.includes(c.username as string)) arr.push(c.username as string);
    map.set(c.user_id as string, arr);
  }
  return map;
}

const viewKeys = (slugs: string[]) => slugs.flatMap((s) => [s, `${s}__links`]);

type MemberRow = {
  id: string;
  user_id: string | null;
  invite_email: string | null;
  invite_name: string | null;
  invite_token: string | null;
  status: string;
  invited_at?: string | null;
  expires_at?: string | null;
};

export async function getTeamOverview(
  officeId: string,
  ownerId: string,
  purchasedSeats: number,
): Promise<TeamOverview> {
  const admin = getAdminSupabase();
  const analytics = await getOfficeAnalytics(officeId, ownerId);

  const userIds = analytics.employees.map((e) => e.userId);
  const perUserSlugs = await slugsByUser(userIds);
  const allSlugs = Array.from(new Set(userIds.flatMap((id) => perUserSlugs.get(id) ?? [])));

  const now = new Date();
  const thisMonth = monthStartIso(0, now);
  const lastMonth = monthStartIso(1, now);

  // Month counts: cheap head-count queries instead of pulling rows.
  const countViews = async (from: string, to?: string) => {
    if (!allSlugs.length) return 0;
    let q = admin.from("card_views").select("*", { count: "exact", head: true })
      .in("username", viewKeys(allSlugs)).gte("viewed_at", from);
    if (to) q = q.lt("viewed_at", to);
    const { count } = await q;
    return count ?? 0;
  };
  const countLeads = async (from: string, to?: string) => {
    if (!allSlugs.length) return 0;
    let q = admin.from("leads").select("*", { count: "exact", head: true })
      .in("card_owner", allSlugs).not("tags", "cs", "{demo}").gte("created_at", from);
    if (to) q = q.lt("created_at", to);
    const { count } = await q;
    return count ?? 0;
  };

  // Per-person latest activity: newest view + newest lead on their slugs.
  //
  // TWO QUERIES FOR THE WHOLE TEAM, not two per person. This used to be two
  // `limit 1` queries per member, "all in parallel — team size is bounded by
  // purchased seats, so this stays small". Measured on a real 15-seat office,
  // that is 30 round-trips and the admin console — the first screen an owner
  // opens — took 2.4 to 5.8 seconds to render. The bound grows with exactly
  // the thing we are selling.
  //
  // Rows come back newest-first, so the FIRST time a slug appears is its most
  // recent activity. The cap is a backstop against an enormous office, and it
  // degrades in the safe direction: a slug beyond it simply reads as older
  // activity, and any team busy enough to hit it is active by definition.
  const ACTIVITY_SCAN_CAP = 5000;
  const newestBySlug = new Map<string, string>();
  const noteNewest = (slug: string | null | undefined, at: string | null | undefined) => {
    if (!slug || !at) return;
    // A view key carries the "__links" suffix; both surfaces belong to the
    // same person, so they collapse onto the owning slug.
    const key = slug.endsWith("__links") ? slug.slice(0, -"__links".length) : slug;
    const prev = newestBySlug.get(key);
    if (!prev || at > prev) newestBySlug.set(key, at);
  };
  {
    const [v, l] = await Promise.all([
      admin.from("card_views").select("username, viewed_at").in("username", viewKeys(allSlugs))
        .order("viewed_at", { ascending: false }).limit(ACTIVITY_SCAN_CAP),
      admin.from("leads").select("card_owner, created_at").in("card_owner", allSlugs).not("tags", "cs", "{demo}")
        .order("created_at", { ascending: false }).limit(ACTIVITY_SCAN_CAP),
    ]);
    for (const r of v.data ?? []) noteNewest(r.username as string, r.viewed_at as string);
    for (const r of l.data ?? []) noteNewest(r.card_owner as string, r.created_at as string);
  }

  const lastActive = (uid: string): string | null => {
    const slugs = perUserSlugs.get(uid) ?? [];
    let newest: string | null = null;
    for (const slug of slugs) {
      const at = newestBySlug.get(slug);
      if (at && (!newest || at > newest)) newest = at;
    }
    return newest;
  };

  const [
    viewsCur, viewsPrev, leadsCur, leadsPrev,
    { data: memberRows }, { data: profileRows }, { data: cardRows },
    seats,
  ] = await Promise.all([
    countViews(thisMonth),
    countViews(lastMonth, thisMonth),
    countLeads(thisMonth),
    countLeads(lastMonth, thisMonth),
    admin.from("office_members")
      // invited_at, NOT created_at: office_members has no created_at column, and
      // naming a missing column fails the ENTIRE select — which returned null
      // here and silently emptied both the member list and the pending invites.
      .select("id, user_id, invite_email, invite_name, invite_token, status, invited_at, expires_at")
      .eq("office_id", officeId),
    admin.from("profiles").select("id, title, email, photo_url").in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]),
    admin.from("cards").select("user_id, is_offline, title, is_office_card, created_at").in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]).order("created_at", { ascending: true }),
    getOfficeSeatUsage(officeId, purchasedSeats),
  ]);

  const rows = (memberRows ?? []) as MemberRow[];
  const rowByUser = new Map(rows.filter((r) => r.user_id).map((r) => [r.user_id as string, r]));
  const profById = new Map((profileRows ?? []).map((p) => [p.id as string, p]));

  // is_offline may be missing pre-migration → treat an unreadable flag as live
  // rather than telling an owner their whole team is deactivated.
  // The title people actually show the world is on their CARD; profiles.title
  // is empty for every modern signup, so the list said "No job title yet" for
  // everyone. The company card wins, else their oldest card.
  const cardTitle = new Map<string, string>();
  for (const c of cardRows ?? []) {
    const uid = c.user_id as string;
    const t = ((c.title as string | null) ?? "").trim();
    if (!t) continue;
    if (!cardTitle.has(uid) || c.is_office_card === true) cardTitle.set(uid, t);
  }
  const cardCounts = new Map<string, { total: number; live: number }>();
  for (const c of cardRows ?? []) {
    const uid = c.user_id as string;
    const cur = cardCounts.get(uid) ?? { total: 0, live: 0 };
    cur.total++;
    if (c.is_offline !== true) cur.live++;
    cardCounts.set(uid, cur);
  }

  // The OWNER's signup address, and only the owner's — one lookup.
  //
  // This used to be getAccountEmailMap(), which pages through EVERY auth user
  // in the project (up to 50 pages of 1000) on every single admin console load,
  // to resolve fifteen addresses. It is a management-API call, not a query, and
  // its cost grows with total signups rather than with team size — so the
  // console gets slower for this customer every time an unrelated person signs
  // up for SwiftCard.
  //
  // Members do not need it at all: office_members.invite_email IS the address
  // they were invited at, and /api/join enforces that the accepting account
  // matches it, so it is exactly as authoritative as the auth record. Only the
  // owner has no member row.
  let ownerAuthEmail: string | null = null;
  try {
    const { data: ownerUser } = await admin.auth.admin.getUserById(ownerId);
    ownerAuthEmail = ownerUser?.user?.email ?? null;
  } catch { /* falls back to profiles.email below */ }
  const people: TeamPerson[] = analytics.employees.map((e) => {
    const counts = cardCounts.get(e.userId) ?? { total: 0, live: 0 };
    const prof = profById.get(e.userId);
    const lastActiveAt = lastActive(e.userId);
    // A member who joined but has not built a card yet has no card name to
    // fall back to, so the analytics name lands on the account handle. The
    // admin typed a real name when inviting them — office_members.invite_name —
    // and it was being dropped the moment they accepted, so the row visibly
    // degraded from "Dana Lee" to "dana-3f9a2c".
    const memberRow = rowByUser.get(e.userId);
    // No username column in this select — and none is needed: when the
    // analytics name fell through to the account handle it equals the member's
    // public slug, which IS on the record.
    // Last resort before the handle: the address they were invited at. A
    // generated handle ("helloqamue78p1lm2-7b955b") read as garbage in the
    // roster and in "Remove …?" / "Delete …'s account?" (seen live 2026-09-23).
    const inviteEmail = (memberRow?.invite_email as string | null) || (prof?.email as string | null) || null;
    const displayName = e.name && e.name !== e.username
      ? e.name
      : (memberRow?.invite_name as string | null) || inviteEmail || e.name;
    return {
      ...e,
      name: displayName,
      kind: "member" as const,
      memberRowId: memberRow?.id ?? null,
      title: cardTitle.get(e.userId) || (prof?.title as string | null) || null,
      // A member's identity is their AUTH signup email — profiles.email drifts
      // to the card's public contact email and is only the fallback.
      // profiles.email drifts to the card's public contact address, so it is
      // the last resort for both branches.
      email: (e.isOwner ? ownerAuthEmail : (memberRow?.invite_email as string | null))
        || (prof?.email as string | null) || null,
      photoUrl: (prof?.photo_url as string | null) || null,
      lastActiveAt,
      liveCards: counts.live,
      totalCards: counts.total,
      status: memberStatus({ liveCards: counts.live, totalCards: counts.total, lastActiveAt }),
    };
  });
  // The owner-first pin made sense on the old Overview; the Team table sorts by
  // results instead — highest leads first, views as the tiebreak.
  people.sort((a, b) => b.leads - a.leads || b.views - a.views);

  const invites: TeamInvite[] = rows
    .filter((r) => r.status === "pending")
    .map((r) => ({
      kind: "invite" as const,
      memberRowId: r.id,
      name: (r.invite_name as string | null) ?? null,
      email: (r.invite_email as string) ?? "",
      inviteToken: (r.invite_token as string | null) ?? null,
      sentAt: r.invited_at ?? null,
      status: isInviteExpired(r) ? ("invite_expired" as const) : ("invite_sent" as const),
    }));

  // Activation: everyone invited (accepted or still pending), against those who
  // actually got a live card up. The owner is on neither side — see computeActivation.
  const invitedTotal = people.filter((p) => !p.isOwner).length + invites.length;
  const activatedMembers = people.filter((p) => !p.isOwner && p.liveCards > 0).length;

  return {
    stats: {
      leadsThisMonth: { current: leadsCur, previous: leadsPrev, deltaPct: deltaPct(leadsCur, leadsPrev) },
      viewsThisMonth: { current: viewsCur, previous: viewsPrev, deltaPct: deltaPct(viewsCur, viewsPrev) },
      activation: computeActivation({ activatedMembers, invitedTotal }),
      seats,
    },
    people,
    invites,
    totals: analytics.totals,
  };
}

// ── First-time setup checklist ───────────────────────────────────────────────
// Derived from durable facts rather than a stored flag: once all three are true
// they stay true, and the checklist never renders again. There is no "capture
// your first lead" step: a team whose clients only save their contacts is fully
// set up, and a card is not a lead funnel (owner, 2026-10-06).

export type SetupProgress = {
  brandingDone: boolean;
  invitedDone: boolean;
  cardLiveDone: boolean;
  completed: number;
  total: number;
  allDone: boolean;
};

export function computeSetupProgress(input: {
  hasBrand: boolean;
  memberRowCount: number;   // any status — an invite that was sent counts, even if later revoked
  liveEmployeeCards: number; // employees (not the owner) with a live card
}): SetupProgress {
  const brandingDone = input.hasBrand;
  const invitedDone = input.memberRowCount > 0;
  const cardLiveDone = input.liveEmployeeCards > 0;
  const steps = [brandingDone, invitedDone, cardLiveDone];
  const completed = steps.filter(Boolean).length;
  return {
    brandingDone, invitedDone, cardLiveDone,
    completed, total: steps.length, allDone: completed === steps.length,
  };
}
