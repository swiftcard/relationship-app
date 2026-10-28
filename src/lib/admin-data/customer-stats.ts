import { getAdminSupabase } from "@/lib/supabase-admin";
import { paged } from "@/lib/crew/paged";
import { ALL_TIME_SINCE, allTimeUntil, getOfficeDailyViews, getOfficeEmployeeMetricsForTeam, flattenOfficeKeys, type OfficeTeamMember } from "@/lib/office-analytics";
import { LOCKED_LEAD_TAG } from "@/lib/plan";
import { hasLegacyProfileCard, type Account } from "./accounts";
import { BUSINESS_TZ, emptyDaySeries, nyDayKey, startOfNyDay } from "./time";

// ── A customer's numbers, counted the way the customer sees them ────────────
// The admin used to count contacts and views itself: one unpaged select of
// every lead and every view on the site (so each stopped at 1,000 rows), the
// sample contact every new card starts with counted as a real one, and card
// and Swift Links views added together. These go through the same database
// functions the Office console and the member's own pages use
// (office_employee_view_stats / _lead_stats / _contact_stats: GROUP BY in the
// database, no row cap, the sample contact left out), so the admin, the Office
// console and the customer all read the same number.

export type CustomerTotals = {
  cards: number;
  /** Card page views (the card itself). */
  views: number;
  /** Swift Links page views. */
  swiftlinkViews: number;
  /** Real contacts captured, sample contact left out. Includes locked ones. */
  leads: number;
  /** Of `leads`, captured past the Free limit and hidden from a Free owner. */
  lockedLeads: number;
  contactsSaved: number;
};

/** The slugs an account's numbers live under: its cards, plus a legacy profile card if it really has one. */
export function accountSlugs(a: Pick<Account, "cards" | "username" | "profileName" | "customization">): string[] {
  const cardSlugs = a.cards.map((c) => c.username);
  const legacy = hasLegacyProfileCard({ username: a.username, profileName: a.profileName, customization: a.customization, cardSlugs });
  return legacy && a.username ? [...cardSlugs, a.username] : cardSlugs;
}

function asMember(a: Account): OfficeTeamMember {
  const slugs = accountSlugs(a);
  return {
    userId: a.id,
    name: a.name ?? "",
    // memberSlugs() adds `username` to the card slugs; pass the first real slug
    // so an account with no card never counts rows left under its profile slug.
    username: slugs[0] ?? "",
    isOwner: false,
    cardSlugs: slugs.map((username) => ({ username, label: null, name: null })),
  };
}

/** All-time totals for each account, in one round of database aggregates. */
export async function totalsFor(accounts: Account[]): Promise<Map<string, CustomerTotals>> {
  const out = new Map<string, CustomerTotals>();
  const withSlugs = accounts.filter((a) => accountSlugs(a).length > 0);
  for (const a of accounts) out.set(a.id, { cards: a.cards.length, views: 0, swiftlinkViews: 0, leads: 0, lockedLeads: 0, contactsSaved: 0 });
  if (!withSlugs.length) return out;

  const [metrics, locked] = await Promise.all([
    getOfficeEmployeeMetricsForTeam(withSlugs.map(asMember), ALL_TIME_SINCE, allTimeUntil()),
    lockedLeadsBySlug(withSlugs.flatMap(accountSlugs)),
  ]);
  for (const m of metrics) {
    const t = out.get(m.userId);
    if (!t) continue;
    t.views = m.views;
    t.swiftlinkViews = m.swiftlinkViews;
    t.leads = m.leads;
    t.contactsSaved = m.contactsSaved;
  }
  for (const a of withSlugs) {
    const t = out.get(a.id)!;
    t.lockedLeads = accountSlugs(a).reduce((n, s) => n + (locked.get(s) ?? 0), 0);
  }
  return out;
}

/** Contacts over the Free limit (tagged sc-locked), per slug — paged, sample contact left out. */
async function lockedLeadsBySlug(slugs: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!slugs.length) return map;
  const admin = getAdminSupabase();
  const rows = await paged<{ card_owner: string }>(
    (from, to) => admin.from("leads").select("card_owner").in("card_owner", slugs)
      .contains("tags", [LOCKED_LEAD_TAG]).not("tags", "cs", "{demo}").order("id").range(from, to),
    500_000, "admin locked leads");
  for (const r of rows) map.set(r.card_owner, (map.get(r.card_owner) ?? 0) + 1);
  return map;
}

/** Views and contacts per New York day for the last `days` days, for one account. */
export async function dailyActivity(a: Account, days = 30): Promise<{ date: string; views: number; leads: number }[]> {
  const slugs = accountSlugs(a);
  const since = startOfNyDay(days - 1).toISOString();
  const until = allTimeUntil();
  const views = emptyDaySeries(days);
  const leads = emptyDaySeries(days);
  if (slugs.length) {
    const admin = getAdminSupabase();
    const [viewDays, leadRows] = await Promise.all([
      getOfficeDailyViews(flattenOfficeKeys(slugs), since, until, BUSINESS_TZ),
      paged<{ created_at: string }>(
        (from, to) => admin.from("leads").select("created_at").in("card_owner", slugs).not("tags", "cs", "{demo}")
          .gte("created_at", since).order("created_at").range(from, to),
        200_000, "admin daily leads"),
    ]);
    for (const d of viewDays) if (views.has(d.date)) views.set(d.date, (views.get(d.date) ?? 0) + d.views);
    for (const l of leadRows) {
      const k = nyDayKey(l.created_at);
      if (leads.has(k)) leads.set(k, (leads.get(k) ?? 0) + 1);
    }
  }
  return [...views.keys()].map((date) => ({ date, views: views.get(date) ?? 0, leads: leads.get(date) ?? 0 }));
}

/** The latest real contacts on an account's cards (sample contact left out). */
export async function recentContacts(a: Account, limit = 12) {
  const slugs = accountSlugs(a);
  if (!slugs.length) return [];
  const { data } = await getAdminSupabase()
    .from("leads")
    .select("id, name, email, phone, source, card_owner, created_at, tags")
    .in("card_owner", slugs)
    .not("tags", "cs", "{demo}")
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as { id: string; name: string | null; email: string | null; phone: string | null; source: string | null; card_owner: string; created_at: string; tags: string[] | null }[])
    .map(({ tags, ...l }) => ({ ...l, locked: Array.isArray(tags) && tags.includes(LOCKED_LEAD_TAG) }));
}

/** Per-card all-time numbers for one account, through the same aggregates. */
export async function perCardTotals(a: Account): Promise<Map<string, { views: number; swiftlinkViews: number; leads: number }>> {
  const map = new Map<string, { views: number; swiftlinkViews: number; leads: number }>();
  if (!a.cards.length) return map;
  const rows = await getOfficeEmployeeMetricsForTeam(
    a.cards.map((c) => ({ userId: c.id, name: c.name ?? "", username: c.username, isOwner: false, cardSlugs: [{ username: c.username, label: c.label, name: c.name }] })),
    ALL_TIME_SINCE, allTimeUntil());
  for (const r of rows) map.set(r.userId, { views: r.views, swiftlinkViews: r.swiftlinkViews, leads: r.leads });
  return map;
}
