import { getAdminSupabase } from "@/lib/supabase-admin";
import { resolveOfficeContactScope, scopedOfficeLeads } from "@/lib/office-leads";
import { followUpState, type FollowUpStep } from "@/lib/lead-followup";
import { CRON_HOUR_UTC } from "@/lib/cron-schedule";
import type {
  ContactTimelineEvent,
  ContactTimelineMessage,
  ContactHistoryHidden,
  OfficeContactDetail,
} from "@/lib/office-contact-timeline";

// ── One contact, for the Office admin console ────────────────────────────────
//
// Owner, 2026-10-07: an admin clicking a contact should see when it was added,
// how, which teammate it belongs to, and the activity and messages between that
// teammate and the contact. Display lives in lib/office-contact-timeline.
//
// THE BOUNDARY. The contact is looked up through scopedOfficeLeads — the very
// query the Contacts table pages through — plus its id. A contact id from
// another office, a deleted one, or the sample contact is simply not found.
//
// THE HISTORY WINDOW (owner decisions, 2026-10-07):
//   • A teammate's messages and activity are visible from the day they JOINED
//     until the day they LEFT. A contact they brought from before joining shows
//     when, how and whose — but not the conversation they had before this team
//     existed for them. A contact of someone who has left stops at the removal,
//     so nothing that happens on their now-personal card reaches the old
//     employer (the same promise the removal tag in api/office/members keeps).
//   • The office OWNER's own contacts: their history is the owner's alone.
//     Admins and managers see when, how and whose, never the owner's messages.
//   • Unknown dates FAIL CLOSED: no join or removal record → no history.
//
// NEVER SELECTED: notes, where_met, convo_details — the teammate's private
// "Notes & Context". The join page promises "your private notes stay yours".
//
// Contacts locked behind the Free cap (sc-locked) are shown: the office plan is
// paid, and lib/lead-access only hides them from an unpaid account.

const CONTACT_ID = /^[0-9a-f-]{36}$/i;

const DETAIL_COLUMNS =
  "id, name, email, phone, company, location, created_at, source, message, follow_up_sequence, tags, card_owner, visitor_id";

type Window = { from: string | null; until: string | null };

function inWindow(at: string, w: Window): boolean {
  const t = Date.parse(at);
  if (w.from && t < Date.parse(w.from)) return false;
  if (w.until && t > Date.parse(w.until)) return false;
  return true;
}

/**
 * When a teammate who has since LEFT was on the team: [joined, removed], from
 * the audit trail. Only the latest stint — a remove → rejoin → remove cycle
 * never exposes the gap in between. Null when either end is missing.
 */
async function formerStint(officeId: string, slug: string): Promise<{ userId: string | null; window: Window | null }> {
  const admin = getAdminSupabase();
  const [{ data: card }, { data: prof }] = await Promise.all([
    admin.from("cards").select("user_id").eq("username", slug).maybeSingle(),
    admin.from("profiles").select("id").eq("username", slug).maybeSingle(),
  ]);
  let userId = ((card?.user_id as string | null) ?? (prof?.id as string | null)) ?? null;

  type Removal = { created_at: string; target_id: string | null };
  let removal: Removal | null = null;
  if (userId) {
    const { data } = await admin
      .from("audit_logs")
      .select("created_at, target_id")
      .eq("org_id", officeId)
      .eq("action", "member.removed")
      .eq("target_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    removal = (data as Removal | null) ?? null;
  }
  if (!removal) {
    // The card was renamed or deleted since: removals record the slugs the
    // person held at the time (api/office/members).
    const { data } = await admin
      .from("audit_logs")
      .select("created_at, target_id")
      .eq("org_id", officeId)
      .eq("action", "member.removed")
      .contains("metadata", { slugs: [slug] })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    removal = (data as Removal | null) ?? null;
    if (removal?.target_id) userId = removal.target_id;
  }
  if (!removal || !userId) return { userId: null, window: null };

  const { data: joined } = await admin
    .from("audit_logs")
    .select("created_at")
    .eq("org_id", officeId)
    .eq("action", "invite.accepted")
    .eq("actor_id", userId)
    .lt("created_at", removal.created_at)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!joined?.created_at) return { userId, window: null };
  return { userId, window: { from: joined.created_at as string, until: removal.created_at } };
}

/**
 * This contact's card activity — the SAME three rules as the teammate's own
 * timeline, GET in src/app/api/card-events/route.ts. Duplicated rather than
 * shared because that route is pinned as text by a couple of dozen tests;
 * tests/office-contact-detail.test.ts checks the two copies still agree. If
 * you change the rules there, change them here.
 *   1. events stamped with this contact's id;
 *   2. events from a browser still bound to them (not superseded, not marked
 *      wrong, not a forwarded link's extra device), from shortly before the
 *      binding onward — never an event already stamped as ANOTHER contact's;
 *   3. for a contact from before bindings existed, the browser they shared
 *      from, under the same two limits.
 * Scoped to the slugs of the teammate the contact belongs to.
 */
async function contactEvents(
  contactId: string,
  visitorId: string | null,
  createdAt: string,
  slugs: string[],
): Promise<ContactTimelineEvent[]> {
  if (!slugs.length) return [];
  const admin = getAdminSupabase();

  // Requested defensively, like the member's route: selecting a column that
  // isn't migrated yet fails the whole query.
  const WANT = "id, event_type, source, created_at";
  let cols = `${WANT}, surface, target`;
  {
    const probe = await admin.from("card_events").select("surface").limit(1);
    if (probe.error && (probe.error.code === "42703" || probe.error.code === "PGRST204")) cols = WANT;
  }
  if (cols !== WANT) {
    const probe = await admin.from("card_events").select("lead_confidence").limit(1);
    if (!probe.error) cols = `${cols}, lead_confidence, target_label`;
  }

  // The visit that led to sharing starts before the share itself.
  const LEAD_IN_MS = 2 * 60 * 60 * 1000;
  const since = (iso: string | null | undefined, leadIn: boolean) =>
    iso ? new Date(new Date(iso).getTime() - (leadIn ? LEAD_IN_MS : 0)).toISOString() : null;
  // contactId is a validated UUID (CONTACT_ID) before it reaches this string.
  const notAnotherContact = `lead_id.is.null,lead_id.eq.${contactId}`;

  const lookups: PromiseLike<{ data: unknown }>[] = [];
  lookups.push(admin.from("card_events").select(cols).in("card_owner_username", slugs).eq("lead_id", contactId));

  const { data: bindings } = await admin
    .from("contact_devices")
    .select("visitor_id, bound_via, link_device_index, bound_at, superseded_at, wrong_at")
    .eq("lead_id", contactId);
  const active = (bindings ?? []).filter((bd) =>
    !bd.superseded_at && !bd.wrong_at &&
    !(bd.bound_via === "link" && ((bd.link_device_index as number | null) ?? 1) > 1));
  for (const bd of active) {
    const from = since((bd.bound_at as string | null) ?? createdAt, bd.bound_via !== "link");
    let q = admin.from("card_events").select(cols).in("card_owner_username", slugs)
      .eq("visitor_id", bd.visitor_id as string).or(notAnotherContact);
    if (from) q = q.gte("created_at", from);
    lookups.push(q);
  }
  if (visitorId && !(bindings ?? []).some((bd) => bd.visitor_id === visitorId)) {
    let q = admin.from("card_events").select(cols).in("card_owner_username", slugs)
      .eq("visitor_id", visitorId).or(notAnotherContact);
    const from = since(createdAt, true);
    if (from) q = q.gte("created_at", from);
    lookups.push(q);
  }

  const results = await Promise.all(lookups);
  const byId = new Map<string, ContactTimelineEvent>();
  for (const r of results) {
    for (const row of (r.data ?? []) as unknown as Record<string, unknown>[]) {
      byId.set(row.id as string, {
        id: row.id as string,
        event_type: row.event_type as string,
        source: (row.source as string | null) ?? null,
        created_at: row.created_at as string,
        surface: (row.surface as string | null | undefined) ?? null,
        target: (row.target as string | null | undefined) ?? null,
        target_label: (row.target_label as string | null | undefined) ?? null,
        lead_confidence: (row.lead_confidence as string | null | undefined) ?? null,
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** The moment the once-a-day sender will run for a step — what "sends Oct 9" names. */
function stepRunsAt(anchor: string, day: number): string {
  const due = new Date(new Date(anchor).getTime() + day * 86400000);
  return new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate(), CRON_HOUR_UTC)).toISOString();
}

type SequenceStep = FollowUpStep & { day?: number; anchor?: string; not_sent?: string };

export async function getOfficeContactDetail(opts: {
  officeId: string;
  ownerId: string;
  viewerId: string;
  contactId: string;
}): Promise<OfficeContactDetail | null> {
  const { officeId, ownerId, viewerId, contactId } = opts;
  // Before anything is interpolated into a filter string.
  if (!CONTACT_ID.test(contactId)) return null;

  const bySlug = await resolveOfficeContactScope(officeId);
  const { data: found } = await scopedOfficeLeads(officeId, Array.from(bySlug.keys()), DETAIL_COLUMNS)
    .eq("id", contactId)
    .maybeSingle();
  if (!found) return null;
  const row = found as unknown as Record<string, unknown>;

  const slug = (row.card_owner as string) ?? "";
  const createdAt = row.created_at as string;
  const tags = (row.tags as string[] | null) ?? null;
  const admin = getAdminSupabase();

  // Whose contact, and the window their history is visible in.
  const current = bySlug.get(slug) ?? null;
  let owner: OfficeContactDetail["owner"];
  let window: Window | null = null;
  let hiddenBecause: ContactHistoryHidden | null = null;
  let ownerSlugs: string[] = [slug];

  if (current) {
    ownerSlugs = Array.from(bySlug.entries()).filter(([, o]) => o.userId === current.userId).map(([s]) => s);
    const isOfficeOwner = current.userId === ownerId;
    owner = { name: current.name, userId: current.userId, isFormer: false, isOfficeOwner };
    if (isOfficeOwner) {
      if (viewerId === ownerId) window = { from: null, until: null };
      else hiddenBecause = "owner_private";
    } else {
      const { data: membership } = await admin
        .from("office_members")
        .select("joined_at")
        .eq("office_id", officeId)
        .eq("user_id", current.userId)
        .eq("status", "active")
        .order("joined_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const joinedAt = (membership?.joined_at as string | null) ?? null;
      if (joinedAt) window = { from: joinedAt, until: null };
      else hiddenBecause = "no_record";
    }
  } else {
    // A teammate who has left: the contact stayed with the office (removal tag).
    owner = { name: "Former team member", userId: null, isFormer: true, isOfficeOwner: false };
    const stint = await formerStint(officeId, slug);
    if (stint.window) window = stint.window;
    else hiddenBecause = "no_record";
  }

  const source = (row.source as string | null) ?? null;
  // The arrival CHANNEL is part of "how they were added", which the admin always
  // sees — so events are read whenever it is needed, even when the history
  // itself is not shown.
  const needsArrival = source === "swift_connect" || source === "save_contact_conversion";
  const [events, messageRows] = await Promise.all([
    window || needsArrival
      ? contactEvents(contactId, (row.visitor_id as string | null) ?? null, createdAt, ownerSlugs)
      : Promise.resolve([] as ContactTimelineEvent[]),
    window
      ? (() => {
          let q = admin
            .from("lead_messages")
            .select("id, direction, channel, body, status, created_at")
            .eq("lead_id", contactId);
          if (window.from) q = q.gte("created_at", window.from);
          if (window.until) q = q.lte("created_at", window.until);
          return q.order("created_at", { ascending: true }).limit(500);
        })()
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const arrivalSource = needsArrival ? (events.find((e) => !!e.source)?.source ?? null) : null;
  const shown = !!window;
  const w: Window = window ?? { from: null, until: null };

  const messages: ContactTimelineMessage[] = shown
    ? ((messageRows.data ?? []) as Record<string, unknown>[]).map((m) => ({
        id: m.id as string,
        direction: m.direction === "in" ? "in" : "out",
        channel: (m.channel as string | null) ?? null,
        body: (m.body as string) ?? "",
        status: (m.status as string | null) ?? null,
        created_at: m.created_at as string,
      }))
    : [];

  // Follow-up still to go. Sent steps are not listed: every send already wrote
  // a message row, which the timeline shows.
  const steps = (Array.isArray(row.follow_up_sequence) ? row.follow_up_sequence : []) as SequenceStep[];
  const t = tags ?? [];
  const upcomingSteps = shown && !owner.isFormer
    ? steps
        .filter((s) => !s.sent_at && !s.not_sent && typeof s.day === "number")
        .map((s) => {
          const channel: "email" | "sms" = s.channel === "sms" ? "sms" : "email";
          return {
            channel,
            sendsAt: stepRunsAt(s.anchor ?? createdAt, s.day as number),
            paused: t.includes("flow-paused") || t.includes(channel === "sms" ? "sms-paused" : "email-paused"),
          };
        })
        .sort((a, b) => a.sendsAt.localeCompare(b.sendsAt))
    : [];

  return {
    id: row.id as string,
    name: (row.name as string) || "Unnamed contact",
    email: (row.email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    company: (row.company as string | null) ?? null,
    location: (row.location as string | null) ?? null,
    createdAt,
    source,
    arrivalSource,
    // The share-time note is part of the history: shown only inside the window.
    message: shown && inWindow(createdAt, w) ? ((row.message as string | null) || null) : null,
    owner,
    followUp: followUpState(steps, tags),
    upcomingSteps,
    history: {
      shown,
      hiddenBecause: shown ? null : hiddenBecause,
      // Only worth saying when it actually cut something off.
      from: shown && w.from && Date.parse(w.from) > Date.parse(createdAt) ? w.from : null,
      until: shown ? w.until : null,
    },
    events: shown ? events.filter((e) => inWindow(e.created_at, w)) : [],
    messages,
  };
}

// Exported for tests: the window arithmetic is the privacy rule.
export const __test = { inWindow, stepRunsAt };
