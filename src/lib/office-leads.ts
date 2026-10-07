import { getAdminSupabase } from "@/lib/supabase-admin";
import { getOfficeUserIds } from "@/lib/office-cards";
import { followUpState, type FollowUpState, type FollowUpStep } from "@/lib/lead-followup";

// ── Org-wide leads, with attribution that survives member removal ───────────
// Leads are keyed by card slug, and a removed member's slugs drop out of the
// team set — which used to silently delete their leads from the office view the
// moment they were removed, contradicting the removal promise ("the leads they
// captured stay with your company"). At removal time the members route stamps
// each of their existing leads with this tag; the office view is the union of
// current-team leads and tagged leads. Leads the ex-member captures AFTER
// leaving carry no tag, so nothing new leaks to the old employer.

export const officeLeadTag = (officeId: string) => `sc-office-${officeId}`;

export type OfficeLead = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string | null;
  created_at: string;
  card_owner: string;
  capturedBy: string; // the PERSON's display name — never a URL slug
  tags: string[] | null;
  /**
   * What the team has actually done about this lead — DERIVED from the contact's
   * follow-up sequence, never set by hand (lib/lead-followup.ts).
   *
   * It replaced a CRM status column (New / Contacted / Closed / Not interested)
   * that nothing in the product could write: two of those four had no writer
   * anywhere, and the one an admin could set appeared on no other screen. See
   * the note at the top of the Leads table.
   */
  followUp: FollowUpState;
};

/** One page of the office's leads, plus the exact total behind it. */
export type OfficeLeadPage = {
  leads: OfficeLead[];
  /** EXACT number of leads this office has, not the number loaded. */
  total: number;
  hasMore: boolean;
};

/** Default page size for the Leads tab. */
export const OFFICE_LEADS_PAGE = 200;

/**
 * The PostgREST filter matching every lead this office can see: one captured
 * by somebody currently on the team, or one stamped with the office tag when
 * its capturer left.
 *
 * Built as a single `or` rather than two queries because the two used to be
 * run separately, each capped at 300, then merged and de-duplicated in memory.
 * That made an exact total impossible, silently truncated at 600, and — worse —
 * meant a lead past the cap could not be found at all, so marking it contacted
 * answered "That lead isn't part of your team."
 *
 * Slugs are [a-z0-9-] by construction (normalizeSlug), and every one in the
 * database today matches — but they are interpolated into a filter STRING, so
 * a single malformed row (a legacy import, a hand-inserted record) containing
 * a comma or a paren would not merely break the query: it would silently
 * widen it, and this filter is the boundary between one office's leads and
 * another's. Re-checked here rather than trusted, because the failure mode is
 * a cross-tenant disclosure that nothing would surface.
 */
const SAFE_SLUG = /^[a-z0-9-]+$/;

function officeLeadFilter(slugs: string[], tag: string): string {
  const byTag = `tags.cs.{${tag}}`;
  const safe = slugs.filter((s) => SAFE_SLUG.test(s));
  // `in.()` with an empty list is not valid PostgREST — an office whose members
  // have no slugs yet still has to match its departed-member leads.
  return safe.length ? `card_owner.in.(${safe.join(",")}),${byTag}` : byTag;
}

/** Who a card slug belongs to: the person's display name and account id. */
export type OfficeSlugOwner = { name: string; userId: string };

/** Everyone on the team, as slug → the person (display name + account id). */
async function officeSlugMap(officeId: string): Promise<Map<string, OfficeSlugOwner>> {
  const admin = getAdminSupabase();
  const teamIds = await getOfficeUserIds(officeId);
  const bySlug = new Map<string, OfficeSlugOwner>();
  if (!teamIds.length) return bySlug;
  const [{ data: profiles }, { data: cards }] = await Promise.all([
    admin.from("profiles").select("id, username, name").in("id", teamIds),
    admin.from("cards").select("user_id, username, name").in("user_id", teamIds),
  ]);
  const nameByUser = new Map((profiles ?? []).map((p) => [p.id as string, (p.name as string) || ""]));
  for (const p of profiles ?? []) {
    if (p.username) bySlug.set(p.username as string, { name: (p.name as string) || (p.username as string), userId: p.id as string });
  }
  for (const c of cards ?? []) {
    if (!c.username) continue;
    // The CARD's name before the account handle: profiles.name is empty for
    // every account created through normal signup.
    const person = nameByUser.get(c.user_id as string) || (c.name as string) || (c.username as string);
    bySlug.set(c.username as string, { name: person, userId: c.user_id as string });
  }
  return bySlug;
}

/**
 * The team's slug map, for callers outside this module that need to answer
 * "whose card is this?" the same way the Contacts tab does (the contact detail
 * drawer). One resolution, one definition of the team.
 */
export async function resolveOfficeContactScope(officeId: string): Promise<Map<string, OfficeSlugOwner>> {
  return officeSlugMap(officeId);
}

/**
 * THE office boundary, as a query: every contact this office can see, minus the
 * sample contact. The Contacts table, its export and the single-contact drawer
 * all start here, so the rule that separates one office's contacts from
 * another's exists exactly once — the drawer adds `.eq("id", …)` on top and can
 * never drift into a looser copy of the filter.
 */
export function scopedOfficeLeads(
  officeId: string,
  slugs: string[],
  select: string,
) {
  return getAdminSupabase()
    .from("leads")
    .select(select, { count: "exact" })
    .or(officeLeadFilter(slugs, officeLeadTag(officeId)))
    // Not the sample contact every new card starts with (lib/demo-contact) —
    // it listed "Jordan Rivera" as the new team's first lead.
    .not("tags", "cs", "{demo}");
}

/**
 * One page, given an ALREADY-RESOLVED team map.
 *
 * Split out so the export can resolve the team once and page through, instead
 * of re-deriving it for every block: officeSlugMap costs five queries, and an
 * export of twenty thousand leads is forty pages — two hundred round trips
 * spent re-answering a question whose answer cannot change mid-export.
 */
async function fetchLeadPage(
  officeId: string,
  bySlug: Map<string, OfficeSlugOwner>,
  opts: { limit?: number; offset?: number },
): Promise<OfficeLeadPage> {
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? OFFICE_LEADS_PAGE)), 500);
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const slugs = Array.from(bySlug.keys());

  const select = "id, name, email, phone, status, created_at, card_owner, tags, follow_up_sequence";
  const { data: rows, count } = await scopedOfficeLeads(officeId, slugs, select)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  // `select` is a variable, so PostgREST can't infer the row type from it.
  const data = rows as unknown as Record<string, unknown>[] | null;

  const leads: OfficeLead[] = (data ?? []).map((row) => {
    const slug = (row.card_owner as string) ?? "";
    return {
      id: row.id as string,
      name: (row.name as string) || "Unnamed contact",
      email: (row.email as string | null) ?? null,
      phone: (row.phone as string | null) ?? null,
      status: (row.status as string | null) ?? null,
      created_at: row.created_at as string,
      card_owner: slug,
      // A departed member's slug isn't in the map — label honestly instead of
      // leaking the slug.
      capturedBy: bySlug.get(slug)?.name ?? "Former team member",
      tags: (row.tags as string[] | null) ?? null,
      followUp: followUpState(
        row.follow_up_sequence as FollowUpStep[] | null,
        (row.tags as string[] | null) ?? null,
      ),
    };
  });

  const total = count ?? leads.length;
  return { leads, total, hasMore: offset + leads.length < total };
}

export async function getOfficeLeads(
  officeId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<OfficeLeadPage> {
  return fetchLeadPage(officeId, await officeSlugMap(officeId), opts);
}


/**
 * Every lead the office owns, oldest last, for CSV export. Pages through in
 * blocks rather than taking a cap: an export that silently stops at 600 rows
 * is worse than no export, because nobody can tell it happened.
 */
export async function getAllOfficeLeads(officeId: string, hardCap = 20_000): Promise<OfficeLead[]> {
  // Resolved ONCE for the whole export — see fetchLeadPage.
  const bySlug = await officeSlugMap(officeId);
  const out: OfficeLead[] = [];
  const seen = new Set<string>();
  for (let offset = 0; offset < hardCap; offset += 500) {
    const page = await fetchLeadPage(officeId, bySlug, { limit: 500, offset });
    // De-duplicated for the same reason the table is: a lead captured during
    // the export shifts later rows down, and a CSV with a row twice is worse
    // than one built a moment earlier.
    for (const l of page.leads) {
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      out.push(l);
    }
    if (!page.hasMore || !page.leads.length) break;
  }
  return out;
}

// How many team leads nobody has worked yet — drives the "new leads waiting"
// item in Needs attention. Counted the same way the Leads tab labels them, so
// the number and the list can never disagree.

// ── Plain-English lead status ────────────────────────────────────────────────
// The app's real status values are new_contact | touch | dissolved (see
// ContactsClient.tsx). The old office Leads page colour-coded "hot/warm/closed" —
// values that can never occur, so every row fell through to grey. Map the real
// vocabulary to owner-readable labels, with anything unknown treated as New.

// The status vocabulary now lives in lib/lead-status (client-safe). Re-exported
// so server callers that already import it from here keep working — but a
// CLIENT component must import from "@/lib/lead-status" directly, or it pulls
// this module, and the service-role client, onto its bundle path.
export {
  LEAD_STATUS_VALUES,
  isLeadStatusValue,
  leadStatusView,
  LEAD_STATUS_OPTIONS,
} from "@/lib/lead-status";
export type { LeadStatusLabel, LeadStatusView, LeadStatusValue } from "@/lib/lead-status";
