import { getAdminSupabase } from "@/lib/supabase-admin";
import { getAccountEmail } from "@/lib/account-email";
import { defaultEmployeeSort } from "@/lib/office-analytics-metrics";

type Admin = ReturnType<typeof getAdminSupabase>;

// One team member's identity + every card-slug they control (their legacy
// profile handle plus each card's username). Shared by getOfficeAnalytics and
// the newer per-range dashboard metrics below so the owner+active-member
// resolution logic (and its cross-check against profiles.office_id) lives in
// exactly one place.
type OfficeTeamMember = {
  userId: string;
  name: string;
  username: string;
  isOwner: boolean;
  cardSlugs: { username: string; label: string | null; name: string | null }[];
};

async function getOfficeTeam(admin: Admin, officeId: string, ownerId: string): Promise<OfficeTeamMember[]> {
  // Team = owner + members whose profile STILL points at this office.
  const { data: memberRows } = await admin
    .from("office_members")
    .select("user_id")
    .eq("office_id", officeId)
    .eq("status", "active")
    .not("user_id", "is", null);
  const memberIds = (memberRows ?? []).map((m) => m.user_id as string);

  let verified: string[] = [];
  if (memberIds.length) {
    const { data } = await admin.from("profiles").select("id").in("id", memberIds).eq("office_id", officeId);
    verified = (data ?? []).map((p) => p.id as string);
  }
  const teamIds = Array.from(new Set([ownerId, ...verified]));

  // Cards in a FIXED order — the company card first, then oldest first. With
  // no order the database could hand them back differently on each load, and
  // slugs[0] below is the card a person's row shows and links to (View, Copy
  // and the QR code), so it could swap to another of the owner's cards between
  // two refreshes.
  const [{ data: profiles }, { data: cards }] = await Promise.all([
    admin.from("profiles").select("id, name, username").in("id", teamIds),
    admin.from("cards").select("user_id, username, label, name").in("user_id", teamIds)
      .order("is_office_card", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: true }),
  ]);
  const profileById = new Map((profiles ?? []).map((p) => [p.id as string, p]));
  const cardsByUser = new Map<string, { username: string; label: string | null; name: string | null }[]>();
  for (const c of cards ?? []) {
    const arr = cardsByUser.get(c.user_id as string) ?? [];
    arr.push({ username: c.username as string, label: (c.label as string | null) ?? null, name: (c.name as string | null) ?? null });
    cardsByUser.set(c.user_id as string, arr);
  }

  return teamIds.map((uid) => {
    const prof = profileById.get(uid);
    const slugs = cardsByUser.get(uid) ?? [];
    return {
      userId: uid,
      // The CARD's name before the account handle. profiles.name is empty for
      // every account created through normal signup — the wizard writes the
      // person's name to their CARD, and /profile is not linked from anywhere —
      // so this fell through to profiles.username and the admin's Team list
      // read "dana-3f9a2c" instead of "Dana Lee". Same reasoning as the slug
      // below: prefer the real card over the account handle.
      name: (prof?.name as string) || (slugs[0]?.name as string) || (prof?.username as string) || "Member",
      // The member's PUBLIC card slug, preferring a real card over the account
      // handle. The team drawer builds /<this> for its View, Copy and QR
      // actions — including a QR the admin is invited to print — and every one
      // of them 404'd for members provisioned with a blank profile handle and
      // a separate card slug. Pre-migration accounts, where the two coincide,
      // worked and hid it.
      username: (slugs[0]?.username as string) || (prof?.username as string) || "",
      isOwner: uid === ownerId,
      cardSlugs: slugs,
    };
  });
}

// Every slug this member's traffic could be recorded under, including the
// legacy profile handle (card_views/card_events/leads predate multi-card
// accounts and some still key by the bare profile username).
function memberSlugs(m: OfficeTeamMember): string[] {
  return Array.from(new Set([m.username, ...m.cardSlugs.map((c) => c.username)].filter(Boolean)));
}

// card_views/card_events also log the Swift Links surface under
// "<slug>__links" — flatten every slug into both keys so a single query
// covers card views and link views together.
function flattenOfficeKeys(slugs: string[]): string[] {
  return slugs.flatMap((u) => [u, `${u}__links`]);
}

function laterTimestamp(a: string | null, b: string | null | undefined): string | null {
  if (!b) return a;
  if (!a) return b;
  return new Date(b) > new Date(a) ? b : a;
}

// ── Organization + per-employee analytics (spec §10) ─────────────────────────
// Strictly scoped to ONE office. Membership is cross-checked against
// profiles.office_id (not just an office_members row) so a removed/suspended
// member or a stale row can never leak into another org's numbers. Card views
// are keyed by card username; leads by card_owner (username). Historical rows
// for ex-members simply drop out of the current team set (they left with their
// cards) — nothing is deleted.
//
// ONE SOURCE FOR EVERY NUMBER (owner, 2026-10-06). The Team tab, a person's
// page, a card's page and the Analytics tab all count through
// getOfficeEmployeeMetricsForTeam — the same SQL functions, the same rules.
// Before, the Team side ran its own head counts that folded Swift Links views
// into "Card views" while the Analytics table kept them apart, so the same
// person showed two different view counts on two tabs and neither matched the
// "SwiftCard views" on their own dashboard. Every console number now means
// exactly what the member's dashboard means: card views and Swift Link views
// separately, contacts without the sample contact, contact downloads.

// "All time" for the Team tab and the person/card pages: from before the first
// SwiftCard row existed to tomorrow, so a view recorded while the page renders
// is still inside the window.
export const ALL_TIME_SINCE = "2000-01-01T00:00:00.000Z";
export function allTimeUntil(now = Date.now()): string {
  return new Date(now + 24 * 60 * 60 * 1000).toISOString();
}

export type OfficeTotals = {
  members: number;
  cards: number;
  /** Card views only — Swift Link views are their own number. */
  views: number;
  swiftlinkViews: number;
  /** Contacts captured (not the sample contact). */
  leads: number;
  /** Contact downloads. */
  contactsSaved: number;
};

export type OfficeAnalytics = {
  totals: OfficeTotals;
  employees: EmployeeMetrics[];
};

export function sumOfficeTotals(rows: EmployeeMetrics[]): Omit<OfficeTotals, "members"> {
  return {
    cards: rows.reduce((s, e) => s + e.cardCount, 0),
    views: rows.reduce((s, e) => s + e.views, 0),
    swiftlinkViews: rows.reduce((s, e) => s + e.swiftlinkViews, 0),
    leads: rows.reduce((s, e) => s + e.leads, 0),
    contactsSaved: rows.reduce((s, e) => s + e.contactsSaved, 0),
  };
}

// A single card as a one-card "member", so per-card figures go through the
// same metrics function as everything else.
function cardAsMember(c: { id: string; username: string; label: string | null; name: string | null }): OfficeTeamMember {
  return { userId: c.id, name: c.name || c.username, username: c.username, isOwner: false, cardSlugs: [{ username: c.username, label: c.label, name: c.name }] };
}

// ── One person's detail ──────────────────────────────────────────────────────
// Everything the admin sees when they click into a team member. Scoped by the
// caller having already proven this user belongs to their office (see
// office-cards.getOfficeUserIds) — this helper does no authorization itself.

export type MemberCardStat = {
  id: string;
  username: string;
  name: string | null;
  label: string | null;
  isOffline: boolean;
  views: number;
  swiftlinkViews: number;
  leads: number;
  contactsSaved: number;
};

export type MemberDetail = {
  userId: string;
  name: string;
  email: string | null;
  username: string;
  totals: { cards: number; views: number; swiftlinkViews: number; leads: number; contactsSaved: number };
  cards: MemberCardStat[];
  recentLeads: { id: string; name: string; email: string | null; created_at: string; card_owner: string }[];
};

export async function getMemberDetail(userId: string): Promise<MemberDetail | null> {
  const admin = getAdminSupabase();

  const [{ data: prof }, { data: cardRows }, { data: memberRow }] = await Promise.all([
    admin.from("profiles").select("id, name, username, email").eq("id", userId).maybeSingle(),
    // is_offline may not exist pre-migration → select * and read defensively.
    // Same order as getOfficeTeam, so this page and the Team tab pick the same
    // card first and count the same slugs.
    admin.from("cards").select("*").eq("user_id", userId)
      .order("is_office_card", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: true }),
    admin.from("office_members").select("invite_name, invite_email").eq("user_id", userId).eq("status", "active").limit(1).maybeSingle(),
  ]);
  if (!prof) return null;
  const cards = (cardRows ?? []) as Record<string, unknown>[];
  const slugs = cards.map((c) => ({
    id: c.id as string,
    username: c.username as string,
    label: (c.label as string | null) ?? null,
    name: (c.name as string | null) ?? null,
  }));

  // Built exactly as getOfficeTeam builds a person, so the slugs counted here
  // are the slugs the Team tab counted for this same row.
  const member: OfficeTeamMember = {
    userId,
    name: (prof.name as string) || "",
    username: slugs[0]?.username || (prof.username as string) || "",
    isOwner: false,
    cardSlugs: slugs.map(({ username, label, name }) => ({ username, label, name })),
  };
  const until = allTimeUntil();
  const [[mine], perCardRows, recentLeads] = await Promise.all([
    getOfficeEmployeeMetricsForTeam([member], ALL_TIME_SINCE, until),
    getOfficeEmployeeMetricsForTeam(slugs.map(cardAsMember), ALL_TIME_SINCE, until),
    getRecentLeadsForSlugs(memberSlugs(member), ALL_TIME_SINCE, until, 10),
  ]);
  const perCardById = new Map(perCardRows.map((r) => [r.userId, r]));

  // The same name the Team tab shows: profiles.name is empty for normal
  // signups, so the page header read "dana-3f9a2c" while the roster said
  // "Dana Lee". The card's name, then the name and address they were invited
  // with, and the account handle only as a last resort.
  const name =
    (prof.name as string) ||
    slugs[0]?.name ||
    (memberRow?.invite_name as string | null) ||
    (memberRow?.invite_email as string | null) ||
    (prof.username as string) ||
    "Member";

  return {
    userId,
    name,
    // Auth signup email — the account's identity, not the card's contact email.
    email: await getAccountEmail(userId, prof.email as string | null),
    username: member.username,
    totals: {
      cards: cards.length,
      views: mine?.views ?? 0,
      swiftlinkViews: mine?.swiftlinkViews ?? 0,
      leads: mine?.leads ?? 0,
      contactsSaved: mine?.contactsSaved ?? 0,
    },
    cards: cards.map((c) => {
      const r = perCardById.get(c.id as string);
      return {
        id: c.id as string,
        username: c.username as string,
        name: (c.name as string | null) ?? null,
        label: (c.label as string | null) ?? null,
        isOffline: c.is_offline === true,
        views: r?.views ?? 0,
        swiftlinkViews: r?.swiftlinkViews ?? 0,
        leads: r?.leads ?? 0,
        contactsSaved: r?.contactsSaved ?? 0,
      };
    }),
    recentLeads,
  };
}

// Stats for ONE card slug, all time — the card-detail page. No authorization
// here; the caller must already have proven the card belongs to their office.
export async function getCardStats(card: { id: string; username: string; label?: string | null; name?: string | null }): Promise<{ views: number; swiftlinkViews: number; leads: number; contactsSaved: number }> {
  const [r] = await getOfficeEmployeeMetricsForTeam(
    [cardAsMember({ id: card.id, username: card.username, label: card.label ?? null, name: card.name ?? null })],
    ALL_TIME_SINCE,
    allTimeUntil(),
  );
  return { views: r?.views ?? 0, swiftlinkViews: r?.swiftlinkViews ?? 0, leads: r?.leads ?? 0, contactsSaved: r?.contactsSaved ?? 0 };
}

// The Team tab: every person's ALL-TIME numbers, plus the team's totals, which
// are the sum of those rows — so the four tiles can never disagree with the
// roster under them. `ownerId` is offices.owner_id.
export async function getOfficeAnalytics(officeId: string, ownerId: string): Promise<OfficeAnalytics> {
  const admin = getAdminSupabase();
  const team = await getOfficeTeam(admin, officeId, ownerId);
  const employees = await getOfficeEmployeeMetricsForTeam(team, ALL_TIME_SINCE, allTimeUntil());

  // A to Z, like a directory — never ranked by views or leads. The console is
  // not a race between teammates (owner, 2026-10-06); this is the Team tab's
  // order, the same one the Analytics table opens on.
  const sorted = defaultEmployeeSort(employees);

  const totals = { members: team.length, ...sumOfficeTotals(employees) };

  return { totals, employees: sorted };
}

// ── Office Analytics Dashboard (date-ranged, RPC-backed) ─────────────────────
// Real GROUP BY aggregates (via the SQL functions in
// supabase/office-analytics-dashboard.sql), so this stays fast for an office
// with hundreds of employees — one query per function call, independent of
// team size. The all-time Team-tab figures above go through the same function.

export type EmployeeMetrics = {
  userId: string;
  name: string;
  username: string;
  isOwner: boolean;
  cardName: string; // label of their one card, "N cards" for multiple, "—" for none yet
  cardCount: number;
  views: number;
  swiftlinkViews: number;
  scans: number; // views attributed to source qr_code or nfc_card
  uniqueVisitors: number;
  leads: number;
  contactsSaved: number;
  lastActivityAt: string | null;
};

function cardNameFor(m: OfficeTeamMember): string {
  if (m.cardSlugs.length === 0) return "—";
  if (m.cardSlugs.length === 1) return m.cardSlugs[0].label || m.cardSlugs[0].name || m.cardSlugs[0].username;
  return `${m.cardSlugs.length} cards`;
}

// Per-employee metrics for a date range — the Employee Performance table.
// NOTE: uniqueVisitors is summed across an employee's card slugs, so a
// visitor who viewed two of the SAME employee's cards is counted twice in
// that sum (rare — most accounts have one card). Summing these PER-EMPLOYEE
// figures across the team does double-count a visitor who viewed several
// colleagues' cards — the office-wide tile must use getOfficeUniqueVisitors
// (one DISTINCT over all keys), never a reduce over this.
export async function getOfficeEmployeeMetrics(
  officeId: string,
  ownerId: string,
  since: string,
  until: string
): Promise<EmployeeMetrics[]> {
  const team = await getOfficeTeam(getAdminSupabase(), officeId, ownerId);
  return getOfficeEmployeeMetricsForTeam(team, since, until);
}

// Same as getOfficeEmployeeMetrics, but for a team ALREADY resolved by the
// caller — lets a page that needs the team for multiple purposes (e.g. two
// date ranges for a period-over-period delta, or a member lookup plus
// metrics) resolve it once instead of once per call (code review — the
// office analytics pages were each triggering 2-3 redundant getOfficeTeam
// resolutions per load).
export async function getOfficeEmployeeMetricsForTeam(
  team: OfficeTeamMember[],
  since: string,
  until: string
): Promise<EmployeeMetrics[]> {
  const admin = getAdminSupabase();
  const allSlugs = team.flatMap((m) => memberSlugs(m));
  const keys = flattenOfficeKeys(allSlugs);

  const [viewStats, leadStats, contactStats] = await Promise.all([
    admin.rpc("office_employee_view_stats", { p_keys: keys, p_since: since, p_until: until }),
    admin.rpc("office_employee_lead_stats", { p_usernames: allSlugs, p_since: since, p_until: until }),
    admin.rpc("office_employee_contact_stats", { p_usernames: allSlugs, p_since: since, p_until: until }),
  ]);
  if (viewStats.error) console.error("office_employee_view_stats failed:", viewStats.error.message);
  if (leadStats.error) console.error("office_employee_lead_stats failed:", leadStats.error.message);
  if (contactStats.error) console.error("office_employee_contact_stats failed:", contactStats.error.message);

  type ViewRow = { username: string; views: number; swiftlink_views: number; scans: number; unique_visitors: number; last_view_at: string | null };
  type LeadRow = { username: string; leads: number; last_lead_at: string | null };
  type ContactRow = { username: string; contacts_saved: number; last_contact_at: string | null };

  const viewsBySlug = new Map(((viewStats.data ?? []) as ViewRow[]).map((r) => [r.username, r]));
  const leadsBySlug = new Map(((leadStats.data ?? []) as LeadRow[]).map((r) => [r.username, r]));
  const contactsBySlug = new Map(((contactStats.data ?? []) as ContactRow[]).map((r) => [r.username, r]));

  return team.map((m) => {
    let views = 0, swiftlinkViews = 0, scans = 0, uniqueVisitors = 0, leads = 0, contactsSaved = 0;
    let lastActivityAt: string | null = null;
    for (const slug of memberSlugs(m)) {
      const v = viewsBySlug.get(slug);
      if (v) {
        views += Number(v.views) || 0;
        swiftlinkViews += Number(v.swiftlink_views) || 0;
        scans += Number(v.scans) || 0;
        uniqueVisitors += Number(v.unique_visitors) || 0;
        lastActivityAt = laterTimestamp(lastActivityAt, v.last_view_at);
      }
      const l = leadsBySlug.get(slug);
      if (l) {
        leads += Number(l.leads) || 0;
        lastActivityAt = laterTimestamp(lastActivityAt, l.last_lead_at);
      }
      const c = contactsBySlug.get(slug);
      if (c) {
        contactsSaved += Number(c.contacts_saved) || 0;
        lastActivityAt = laterTimestamp(lastActivityAt, c.last_contact_at);
      }
    }
    return {
      userId: m.userId,
      name: m.name,
      username: m.username,
      isOwner: m.isOwner,
      cardName: cardNameFor(m),
      cardCount: m.cardSlugs.length,
      views,
      swiftlinkViews,
      scans,
      uniqueVisitors,
      leads,
      contactsSaved,
      lastActivityAt,
    };
  });
}

// Every slug this office controls, flattened for the __links surface too —
// what callers pass into getOfficeDailyViews/getOfficeTrafficSources for an
// office-wide chart, or narrow to one member's memberSlugs() for their detail view.
export async function getOfficeKeys(officeId: string, ownerId: string): Promise<string[]> {
  const admin = getAdminSupabase();
  const team = await getOfficeTeam(admin, officeId, ownerId);
  return flattenOfficeKeys(team.flatMap((m) => memberSlugs(m)));
}

export { flattenOfficeKeys, memberSlugs, getOfficeTeam };
export type { OfficeTeamMember };

// TRUE distinct visitors across every office key — one count(DISTINCT) over
// the whole slug set. Summing per-employee uniques counted one trade-show
// prospect who opened three reps' cards as three visitors. Returns null when
// the RPC isn't migrated yet (supabase/view-visit-window.sql) so the caller
// can fall back — an approximate number beats a zero.
export async function getOfficeUniqueVisitors(keys: string[], since: string, until: string): Promise<number | null> {
  if (!keys.length) return 0;
  const admin = getAdminSupabase();
  const { data, error } = await admin.rpc("office_unique_visitors", { p_keys: keys, p_since: since, p_until: until });
  if (error) {
    console.error("office_unique_visitors failed:", error.message);
    return null;
  }
  return Number(data) || 0;
}

export async function getOfficeDailyViews(keys: string[], since: string, until: string, tz?: string): Promise<{ date: string; views: number }[]> {
  if (!keys.length) return [];
  const admin = getAdminSupabase();
  // Local calendar days (supabase/office-analytics-accuracy.sql); UTC only when
  // no zone is known or the function is missing.
  if (tz) {
    const local = await admin.rpc("office_daily_views_tz", { p_keys: keys, p_since: since, p_until: until, p_tz: tz });
    if (!local.error) return ((local.data ?? []) as { day: string; views: number }[]).map((r) => ({ date: r.day, views: Number(r.views) || 0 }));
  }
  const { data, error } = await admin.rpc("office_daily_views", { p_keys: keys, p_since: since, p_until: until });
  if (error) { console.error("office_daily_views failed:", error.message); return []; }
  return ((data ?? []) as { day: string; views: number }[]).map((r) => ({ date: r.day, views: Number(r.views) || 0 }));
}

export async function getOfficeTrafficSources(keys: string[], since: string, until: string): Promise<{ source: string; views: number }[]> {
  if (!keys.length) return [];
  const admin = getAdminSupabase();
  const { data, error } = await admin.rpc("office_traffic_sources", { p_keys: keys, p_since: since, p_until: until });
  if (error) { console.error("office_traffic_sources failed:", error.message); return []; }
  return ((data ?? []) as { source: string; views: number }[]).map((r) => ({ source: r.source, views: Number(r.views) || 0 }));
}

// Per-card view breakdown for ONE member's detail page ("most active card").
// Reuses office_employee_view_stats scoped to just that member's own card
// slugs, so a multi-card employee's cards come back as separate rows instead
// of the summed total getOfficeEmployeeMetrics returns.
export async function getEmployeeCardBreakdown(
  cardSlugs: { username: string; label: string | null; name: string | null }[],
  since: string,
  until: string
): Promise<{ username: string; label: string; views: number }[]> {
  if (!cardSlugs.length) return [];
  const admin = getAdminSupabase();
  const keys = flattenOfficeKeys(cardSlugs.map((c) => c.username));
  const { data, error } = await admin.rpc("office_employee_view_stats", { p_keys: keys, p_since: since, p_until: until });
  if (error) { console.error("office_employee_view_stats (per-card) failed:", error.message); return []; }
  const viewsBySlug = new Map(((data ?? []) as { username: string; views: number }[]).map((r) => [r.username, Number(r.views) || 0]));
  return cardSlugs
    .map((c) => ({ username: c.username, label: c.label || c.name || c.username, views: viewsBySlug.get(c.username) ?? 0 }))
    .sort((a, b) => b.views - a.views);
}

// Recent lead activity for a member's detail page. Same PII exposure level
// the existing Leads and Team-detail pages already grant view_org_analytics —
// nothing new is surfaced here that an office admin couldn't already see.
export async function getRecentLeadsForSlugs(
  slugs: string[],
  since: string,
  until: string,
  limit = 10
): Promise<{ id: string; name: string; email: string | null; created_at: string; card_owner: string }[]> {
  if (!slugs.length) return [];
  const admin = getAdminSupabase();
  const { data } = await admin
    .from("leads")
    .select("id, name, email, created_at, card_owner")
    .in("card_owner", slugs)
    .not("tags", "cs", "{demo}")
    .gte("created_at", since)
    .lt("created_at", until)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as { id: string; name: string; email: string | null; created_at: string; card_owner: string }[];
}
