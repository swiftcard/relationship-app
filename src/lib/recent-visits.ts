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
  /** "Columbia University" — the organisation whose own network it was
   *  (lib/work-network.ts). Never an internet provider. Pro only. */
  network: string | null;
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

/** The event columns this needs. The last four arrive with visit-details.sql. */
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
  network_org?: string | null;
};

export type VisitLead = {
  id: string;
  name?: string | null;
  tags?: unknown;
  email?: string | null;
  phone?: string | null;
  created_at?: string | null;
};

/**
 * A browser this owner has EARNED the right to name, from when (feature 3,
 * owner 2026-10-18: turn anonymous visits into named ones). The same evidence
 * and the same lead-in the contact's own activity timeline uses
 * (api/card-events GET): an active contact_devices binding from shortly
 * before it was made, or — for a contact from before bindings — the browser
 * they shared from. Never a forwarded link, a superseded binding or one the
 * owner marked "Wrong person" (the loader leaves those out).
 */
export type VisitBinding = { visitor_id: string; lead_id: string; from: string };

/** A share of details on this card, for "Shared their details" in its visit. */
export type VisitShare = { visitor_id: string; created_at: string; surface: "card" | "links" };

const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "").slice(-10);
const mail = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

/**
 * The person these contacts are, or undefined when they are not one person.
 * lib/known-contact's rule 2: several contacts on one browser are the SAME
 * person only when they share an email or a phone (they submitted twice) —
 * then the newest. Otherwise it is a shared device, and nobody is named.
 */
export function onePerson(leads: VisitLead[]): VisitLead | undefined {
  const unique = [...new Map(leads.map((l) => [l.id, l])).values()];
  if (unique.length <= 1) return unique[0];
  const [first, ...rest] = unique;
  const same = rest.every((l) =>
    (!!mail(l.email) && mail(l.email) === mail(first.email)) || (!!digits(l.phone) && digits(l.phone).length >= 7 && digits(l.phone) === digits(first.phone)));
  if (!same) return undefined;
  return unique.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0];
}

const surfaceOf = (r: { surface?: string | null }): "card" | "links" => (r.surface === "links" ? "links" : "card");
const ms = (iso: string) => new Date(iso).getTime();

/** How far before a visit's recorded start its own taps and saves can land. */
const LEAD_IN_EVENT_MS = 60_000;
/** The longest one sitting is taken to last when no later visit ends it. */
const SITTING_MS = 2 * 60 * 60 * 1000;

type StartRow = { visitor_id?: string | null; surface?: string | null; created_at: string; event_type?: string };
const sameVisitorOn = (a: StartRow, b: StartRow) =>
  !!a.visitor_id && a.visitor_id === b.visitor_id && surfaceOf(a) === surfaceOf(b);

/**
 * Which rows START a visit: every view, and every contact download that no
 * view by the same visitor on the same page opened — none in the visit window
 * before it, or in the minute after it (the human gate can record the view a
 * moment after the save). A download with no such view is a visit of its own:
 * the desktop QR's ?save=1 hands over the contact before the page can count a
 * view. A view LATER than that is a later visit, never a reason to hide the
 * save: the server records no second view inside one visit window (a save
 * records the visit's view itself — api/card-events), so that case is a real
 * return. Nothing is ever dropped by this rule. A row with no event_type is a
 * view.
 */
export function visitStarts<T extends StartRow>(rows: T[]): T[] {
  const isView = (r: StartRow) => (r.event_type ?? "viewed_card") === "viewed_card";
  const views = rows.filter(isView);
  return rows.filter((r) => {
    if (isView(r)) return true;
    if (r.event_type !== "downloaded_vcard") return false;
    return !views.some((v) => sameVisitorOn(v, r)
      && ms(v.created_at) <= ms(r.created_at) + LEAD_IN_EVENT_MS
      && ms(r.created_at) - ms(v.created_at) < VIEW_VISIT_WINDOW_MS);
  });
}

/**
 * Pure: the events of one window (newest first) → the visit rows.
 *
 * `history` is every viewed_card event, all time, for the visitors in the
 * window — what the visit number counts. `leads` names the contacts the events
 * are stamped with.
 */
export function buildRecentVisits(input: {
  events: VisitEventRow[];
  /** All-time views and saves of the visitors in the window. A row with no
   *  event_type is a view. */
  history: (Pick<VisitEventRow, "visitor_id" | "surface" | "created_at"> & { event_type?: string })[];
  leads: VisitLead[];
  bindings?: VisitBinding[];
  shares?: VisitShare[];
  paid: boolean;
  limit: number;
}): RecentVisit[] {
  const { events, paid, limit } = input;
  const leadById = new Map(input.leads.map((l) => [l.id, l]));
  const sameVisitor = sameVisitorOn;

  const starts = visitStarts(events);

  const visits: RecentVisit[] = [];
  for (const start of starts.slice(0, limit)) {
    const surface = surfaceOf(start);
    const t0 = ms(start.created_at);
    // EVERY EVENT BELONGS TO EXACTLY ONE VISIT (2026-10-18 review). A visit
    // takes what happened from a minute before it started (a tap or save can
    // land just ahead of the view the human gate records) until a minute
    // before the same visitor's next visit on this page — or, with no next
    // visit, for as long as one sitting can last (a tab kept open past the
    // visit window still taps links, and those taps are this visit's).
    const next = starts
      .filter((s) => s !== start && sameVisitor(s, start) && ms(s.created_at) > t0)
      .reduce((min, s) => Math.min(min, ms(s.created_at)), Infinity);
    const end = Math.min(next - LEAD_IN_EVENT_MS, t0 + SITTING_MS);
    const inVisit = start.visitor_id
      ? events.filter((e) => e !== start && sameVisitor(e, start) && ms(e.created_at) >= t0 - LEAD_IN_EVENT_MS && ms(e.created_at) < end)
      : [];

    const actions: string[] = [];
    // They handed over their name and number in this very visit — the thing
    // that turns an anonymous visit into a named one.
    const sharedHere = start.visitor_id
      ? (input.shares ?? []).filter((sh) =>
          sh.visitor_id === start.visitor_id && sh.surface === surface && ms(sh.created_at) >= t0 - LEAD_IN_EVENT_MS && ms(sh.created_at) < end)
      : [];
    if (sharedHere.length) actions.push("Shared their details");
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
    // A visit made BEFORE the binding existed (the visit in which they shared,
    // or the first view of a link the owner sent) carries no stamp: it is named
    // from the binding, exactly as the contact's timeline credits it to them.
    let who: string | null = "Someone";
    let lead = start.lead_id && start.lead_confidence !== "forwarded" ? leadById.get(start.lead_id) : undefined;
    if (!start.lead_id && start.visitor_id) {
      const bound = (input.bindings ?? [])
        .filter((b) => b.visitor_id === start.visitor_id && ms(b.from) <= t0)
        .map((b) => leadById.get(b.lead_id))
        .filter((l): l is VisitLead => !!l);
      lead = onePerson(bound);
    }
    if (lead?.name?.trim()) who = isLockedLead(lead) && !paid ? null : lead.name.trim();
    else if (!start.lead_id && start.visitor_name?.trim()) who = start.visitor_name.trim();

    // Which visit this is, all time, counted by the SAME rule that decides what
    // a visit is above — so a visit that was only a contact download counts,
    // and the view after it is the 2nd visit, not another 1st.
    const visitNumber = start.visitor_id
      ? Math.max(
          1,
          visitStarts(input.history.filter((h) => h.visitor_id === start.visitor_id && surfaceOf(h) === surface))
            .filter((h) => ms(h.created_at) <= t0).length,
        )
      : null;

    if (!paid) {
      visits.push({
        id: start.id, at: start.created_at, surface, who, locked: true,
        place: null, network: null, device: null, openedIn: null, from: null, duration: null, visitNumber, actions: [],
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
      network: start.network_org?.trim() || null,
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
  /** ownerId: the card owner's user id — contact_devices bindings are theirs. */
  opts: { slug: string; sinceIso: string; paid: boolean; ownerId?: string | null; limit?: number },
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
    // visit-details.sql adds the last four; until it is applied, read without.
    let { data, error } = await read(`${BASE_COLS}, device_model, device_os, duration_s, network_org`);
    if (error && (error.code === "42703" || error.code === "PGRST204")) ({ data, error } = await read(BASE_COLS));
    if (error || !data?.length) return [];
    const events = data as unknown as VisitEventRow[];

    const visitorIds = [...new Set(events.map((e) => e.visitor_id).filter((v): v is string => !!v))].slice(0, 200);
    const leadIds = [...new Set(events.map((e) => e.lead_id).filter((v): v is string => !!v))].slice(0, 200);
    type BindingRow = {
      visitor_id: string; lead_id: string; bound_via: string; link_device_index: number | null;
      bound_at: string | null; superseded_at: string | null; wrong_at: string | null;
    };
    type ShareRow = { id: string; visitor_id: string | null; created_at: string; source: string | null };
    const none = <T,>() => Promise.resolve({ data: [] as T[], error: null });
    const [historyRes, bindingsRes, sharesRes] = await Promise.all([
      visitorIds.length
        ? admin
            .from("card_events")
            // Views AND saves: a visit that was only a contact download is a
            // visit too, and the numbering must count it (visitStarts).
            .select("visitor_id, surface, created_at, event_type")
            .eq("card_owner_username", opts.slug)
            .in("event_type", ["viewed_card", "downloaded_vcard"])
            .in("visitor_id", visitorIds)
            .limit(5000)
        : none<VisitEventRow>(),
      // Every binding of these browsers, superseded and wrong ones included:
      // a browser with ANY binding never falls back to the share rule below.
      visitorIds.length && opts.ownerId
        ? admin
            .from("contact_devices")
            .select("visitor_id, lead_id, bound_via, link_device_index, bound_at, superseded_at, wrong_at")
            .eq("owner_id", opts.ownerId)
            .in("visitor_id", visitorIds)
            .limit(2000)
        : none<BindingRow>(),
      // Details shared on THIS card from these browsers.
      visitorIds.length
        ? admin
            .from("leads")
            .select("id, visitor_id, created_at, source")
            .eq("card_owner", opts.slug)
            .in("visitor_id", visitorIds)
            .limit(2000)
        : none<ShareRow>(),
    ]);
    const bindingRows = ((bindingsRes.error ? [] : bindingsRes.data) ?? []) as BindingRow[];
    const shareRows = ((sharesRes.error ? [] : sharesRes.data) ?? []) as ShareRow[];
    const LEAD_IN_MS = 2 * 60 * 60 * 1000;
    const bindings: VisitBinding[] = [];
    for (const b of bindingRows) {
      if (b.superseded_at || b.wrong_at || !b.bound_at) continue;
      if (b.bound_via === "link" && (b.link_device_index ?? 1) > 1) continue; // forwarded
      // The visit that led to sharing starts before the share; a link is
      // evidence only from the moment it was opened.
      const lead = b.bound_via === "link" ? 0 : LEAD_IN_MS;
      bindings.push({ visitor_id: b.visitor_id, lead_id: b.lead_id, from: new Date(ms(b.bound_at) - lead).toISOString() });
    }
    const everBound = new Set(bindingRows.map((b) => b.visitor_id));
    for (const sh of shareRows) {
      if (!sh.visitor_id || everBound.has(sh.visitor_id)) continue;
      bindings.push({ visitor_id: sh.visitor_id, lead_id: sh.id, from: new Date(ms(sh.created_at) - LEAD_IN_MS).toISOString() });
    }

    const allLeadIds = [...new Set([...leadIds, ...bindings.map((b) => b.lead_id)])].slice(0, 400);
    const leadsRes = allLeadIds.length
      ? await admin.from("leads").select("id, name, tags, email, phone, created_at").in("id", allLeadIds)
      : { data: [] as VisitLead[] };
    return buildRecentVisits({
      events,
      history: (historyRes.data ?? []) as VisitEventRow[],
      leads: (leadsRes.data ?? []) as VisitLead[],
      bindings,
      shares: shareRows
        .filter((sh): sh is ShareRow & { visitor_id: string } => !!sh.visitor_id)
        // The Swift Links page's form is the only one there; every other form
        // is on the card.
        .map((sh) => ({ visitor_id: sh.visitor_id, created_at: sh.created_at, surface: sh.source === "swift_connect" ? "links" as const : "card" as const })),
      paid: opts.paid,
      limit,
    });
  } catch {
    return [];
  }
}
