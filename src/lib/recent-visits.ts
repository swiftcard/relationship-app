import type { SupabaseClient } from "@supabase/supabase-js";
import { isLockedLead } from "@/lib/lead-access";
import { locationLabel } from "@/lib/location-display";
import type { GeoAccuracy } from "@/lib/request-geo";
import { sourcePhrase } from "@/lib/source-labels";
import { VIEW_VISIT_WINDOW_MS } from "@/lib/view-window";
import { describeDevice, formatDuration, openedIn, referrerName } from "@/lib/visit-device";

// ── "Recent visits" on the dashboard ─────────────────────────────────────────
//
// Owner, 2026-10-18: every open of the card or Swift Links should say what it
// was opened on, where it came from, how long it stayed and what the visitor
// did — listed under the Traffic chart, newest first, for the same window the
// chart shows. Pro sees all of it; Free sees that the visit happened, with the
// details withheld ON THE SERVER (the Locations rule: a blur in CSS is not a
// lock).
//
// ONE VISIT = ONE viewed_card EVENT. The ingest route writes exactly one per
// recorded view per surface (visit window), which is why a row here is a visit
// and its "2nd visit" is a count of those rows. A visit that was ONLY a contact
// download (the desktop QR's ?save=1 hands over the vCard before the page's
// view can be counted — see the events route) has a downloaded_vcard event and
// no view event, so it is listed from that event instead of going missing.
//
// Nothing here is new data about a person: device_info, referrer_url and the
// location were already on every event row. This reads them properly.

export type RecentVisit = {
  id: string;
  /** ISO time the visit started. */
  at: string;
  surface: "card" | "links";
  /** "Someone", a contact's name, or null when the name is locked (Free). */
  who: string | null;
  /** The details are withheld (Free): render the blurred line. */
  locked: boolean;
  place: string | null;
  device: string | null;
  openedIn: string | null;
  /** "from LinkedIn", "from a QR code". */
  from: string | null;
  duration: string | null;
  /** 1 for a first visit; null when the browser kept no identity to count by. */
  visitNumber: number | null;
  /** "Saved your contact", "Tapped Instagram". */
  actions: string[];
};

/** The event columns this needs. The last three arrive with visit-details.sql. */
export type VisitEventRow = {
  id: string;
  created_at: string;
  event_type: string;
  surface?: string | null;
  visitor_id?: string | null;
  location?: string | null;
  geo_accuracy?: string | null;
  source?: string | null;
  referrer_url?: string | null;
  device_info?: string | null;
  target?: string | null;
  target_label?: string | null;
  lead_id?: string | null;
  lead_confidence?: string | null;
  visitor_name?: string | null;
  device_model?: string | null;
  device_os?: string | null;
  duration_s?: number | null;
};

export type VisitLead = { id: string; name?: string | null; tags?: unknown };

const surfaceOf = (r: { surface?: string | null }): "card" | "links" => (r.surface === "links" ? "links" : "card");
const ms = (iso: string) => new Date(iso).getTime();

/**
 * Pure: the events of one window (newest first) → the visit rows.
 *
 * `history` is every viewed_card event, all time, for the visitors in the
 * window — what the visit number counts. `leads` names the contacts the events
 * are stamped with.
 */
export function buildRecentVisits(input: {
  events: VisitEventRow[];
  history: Pick<VisitEventRow, "visitor_id" | "surface" | "created_at">[];
  leads: VisitLead[];
  paid: boolean;
  limit: number;
}): RecentVisit[] {
  const { events, paid, limit } = input;
  const leadById = new Map(input.leads.map((l) => [l.id, l]));
  const sameVisitor = (a: VisitEventRow, b: VisitEventRow) =>
    !!a.visitor_id && a.visitor_id === b.visitor_id && surfaceOf(a) === surfaceOf(b);

  // The visit starts: every view, and every save no view of the same visitor
  // opened within the visit window before it.
  const views = events.filter((e) => e.event_type === "viewed_card");
  const starts = events.filter((e) => {
    if (e.event_type === "viewed_card") return true;
    if (e.event_type !== "downloaded_vcard") return false;
    return !views.some((v) => sameVisitor(v, e) && ms(v.created_at) <= ms(e.created_at) + 60_000 && ms(e.created_at) - ms(v.created_at) < VIEW_VISIT_WINDOW_MS);
  });

  const visits: RecentVisit[] = [];
  for (const start of starts.slice(0, limit)) {
    const surface = surfaceOf(start);
    const t0 = ms(start.created_at);
    // The visit ends at the same visitor's next start on this page, or after
    // the visit window — whichever comes first.
    const next = starts
      .filter((s) => s !== start && sameVisitor(s, start) && ms(s.created_at) > t0)
      .reduce((min, s) => Math.min(min, ms(s.created_at)), Infinity);
    const end = Math.min(next, t0 + VIEW_VISIT_WINDOW_MS);
    const inVisit = start.visitor_id
      ? events.filter((e) => e !== start && sameVisitor(e, start) && ms(e.created_at) >= t0 - 60_000 && ms(e.created_at) < end)
      : [];

    const actions: string[] = [];
    if (start.event_type === "downloaded_vcard" || inVisit.some((e) => e.event_type === "downloaded_vcard")) {
      actions.push("Saved your contact");
    }
    const tapped = new Set<string>();
    for (const e of [...inVisit].reverse()) {
      if (e.event_type !== "clicked_link") continue;
      const name = (e.target_label || e.target || "").trim();
      if (name) tapped.add(name);
    }
    for (const name of tapped) actions.push(`Tapped ${name}`);

    // WHO. A contact this owner knows, from the stamp on the event — never a
    // forwarded link's opener (the notifications don't name them either).
    // Locked on Free: the Contacts page doesn't list them, so neither does this.
    let who: string | null = "Someone";
    const lead = start.lead_id && start.lead_confidence !== "forwarded" ? leadById.get(start.lead_id) : undefined;
    if (lead?.name?.trim()) who = isLockedLead(lead) && !paid ? null : lead.name.trim();
    else if (!start.lead_id && start.visitor_name?.trim()) who = start.visitor_name.trim();

    const visitNumber = start.visitor_id
      ? Math.max(
          1,
          input.history.filter(
            (h) => h.visitor_id === start.visitor_id && surfaceOf(h) === surface && ms(h.created_at) <= t0,
          ).length + (start.event_type === "downloaded_vcard" ? 1 : 0),
        )
      : null;

    if (!paid) {
      visits.push({
        id: start.id, at: start.created_at, surface, who, locked: true,
        place: null, device: null, openedIn: null, from: null, duration: null, visitNumber, actions: [],
      });
      continue;
    }

    const device = describeDevice(start.device_info, { model: start.device_model, os: start.device_os });
    const app = openedIn(start.device_info);
    const ref = referrerName(start.referrer_url);
    // Where the link was tapped: the referring site when there is one, else
    // SwiftCard's own source tag (a QR code, an NFC tap). A plain card link
    // with no referrer says nothing rather than "direct". The Swift Links page
    // stamps "swift_links" on its OWN events, which is the page itself, not
    // where it was opened from.
    const viaSource = surface === "links" && start.source === "swift_links" ? "" : sourcePhrase(start.source).trim();
    const from = ref && ref !== app?.name ? `from ${ref}` : viaSource || null;
    visits.push({
      id: start.id,
      at: start.created_at,
      surface,
      who,
      locked: false,
      place: start.location?.trim() ? locationLabel(start.location, (start.geo_accuracy ?? null) as GeoAccuracy | null) : null,
      device: device?.label ?? null,
      openedIn: app ? (app.inApp ? app.name.replace(/^an app's/, "An app's") : app.name) : null,
      from,
      duration: formatDuration(start.duration_s ?? null),
      visitNumber,
      actions,
    });
  }
  return visits;
}

const BASE_COLS =
  "id, created_at, event_type, surface, visitor_id, location, geo_accuracy, source, referrer_url, device_info, target, target_label, lead_id, lead_confidence, visitor_name";

/**
 * Read one card's visits in a window and build the rows. Never throws: a failed
 * read is an empty list, and the chart above it is untouched either way.
 */
export async function loadRecentVisits(
  admin: SupabaseClient,
  opts: { slug: string; sinceIso: string; paid: boolean; limit?: number },
): Promise<RecentVisit[]> {
  const limit = opts.limit ?? 25;
  try {
    const read = (cols: string) =>
      admin
        .from("card_events")
        .select(cols)
        .eq("card_owner_username", opts.slug)
        .in("event_type", ["viewed_card", "downloaded_vcard", "clicked_link"])
        .gte("created_at", opts.sinceIso)
        .order("created_at", { ascending: false })
        .limit(600);
    // visit-details.sql adds the last three; until it is applied, read without.
    let { data, error } = await read(`${BASE_COLS}, device_model, device_os, duration_s`);
    if (error && (error.code === "42703" || error.code === "PGRST204")) ({ data, error } = await read(BASE_COLS));
    if (error || !data?.length) return [];
    const events = data as unknown as VisitEventRow[];

    const visitorIds = [...new Set(events.map((e) => e.visitor_id).filter((v): v is string => !!v))].slice(0, 200);
    const leadIds = [...new Set(events.map((e) => e.lead_id).filter((v): v is string => !!v))].slice(0, 200);
    const [historyRes, leadsRes] = await Promise.all([
      visitorIds.length
        ? admin
            .from("card_events")
            .select("visitor_id, surface, created_at")
            .eq("card_owner_username", opts.slug)
            .eq("event_type", "viewed_card")
            .in("visitor_id", visitorIds)
            .limit(5000)
        : Promise.resolve({ data: [] as VisitEventRow[] }),
      leadIds.length
        ? admin.from("leads").select("id, name, tags").in("id", leadIds)
        : Promise.resolve({ data: [] as VisitLead[] }),
    ]);
    return buildRecentVisits({
      events,
      history: (historyRes.data ?? []) as VisitEventRow[],
      leads: (leadsRes.data ?? []) as VisitLead[],
      paid: opts.paid,
      limit,
    });
  } catch {
    return [];
  }
}
