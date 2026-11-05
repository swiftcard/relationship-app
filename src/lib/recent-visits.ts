import type { SupabaseClient } from "@supabase/supabase-js";
import { isLockedLead } from "@/lib/lead-access";
import { locationLabel } from "@/lib/location-display";
import type { GeoAccuracy } from "@/lib/request-geo";
import { sourcePhrase } from "@/lib/source-labels";
import { VIEW_VISIT_WINDOW_MS } from "@/lib/view-window";
import { localDayKey } from "@/lib/tz-days";
import { describeDevice, formatDuration, openedIn, referrerName } from "@/lib/visit-device";
import { tapAction } from "@/lib/visit-taps";

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
  /** "Downloaded your contact card", "Tapped Instagram". */
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
// ONE VISIT IS ONE PERSON ON ONE CARD — the card AND its Swift Links page
// (2026-11-05). Opening the card, tapping "View my Swift Links" and tapping
// Instagram there was two rows, and the Instagram tap belonged to neither when
// the Swift Links view hadn't counted yet. The bell has always called that one
// visit (lib/visit-notify: one row per person per card); now this list does too.
const sameVisitor = (a: StartRow, b: StartRow) => !!a.visitor_id && a.visitor_id === b.visitor_id;

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
 *
 * A LINK TAP with nothing like that around it is a visit too (2026-10-23): a
 * link that opens in the same tab takes the page away before the tracker's
 * 2.5s gate can count the view, so the tap was recorded with no visit behind
 * it and Recent visits never listed it. Several taps in one such sitting are
 * one visit, started by the first.
 */
export function visitStarts<T extends StartRow>(rows: T[]): T[] {
  const isView = (r: StartRow) => (r.event_type ?? "viewed_card") === "viewed_card";
  // A view of the OTHER page inside a visit already open is that visit going
  // on, not a new one: the card at 9:00 and its Swift Links at 9:04 are one
  // visit. (The same page cannot record a second view inside one visit
  // window — the server dedupes it — so this only ever joins the two pages,
  // and the pre-dedupe rows of July–August 2026 minutes apart.)
  const views: T[] = [];
  for (const v of rows.filter(isView).sort((a, b) => ms(a.created_at) - ms(b.created_at))) {
    if (!views.some((w) => sameVisitor(w, v) && ms(v.created_at) - ms(w.created_at) < VIEW_VISIT_WINDOW_MS)) views.push(v);
  }
  const opens = (r: StartRow, by: StartRow[], reach: number) => by.some((v) => sameVisitor(v, r)
    && ms(v.created_at) <= ms(r.created_at) + LEAD_IN_EVENT_MS
    && ms(r.created_at) - ms(v.created_at) < reach);
  const allViews = rows.filter(isView);
  const saves = rows.filter((r) => r.event_type === "downloaded_vcard" && !opens(r, allViews, VIEW_VISIT_WINDOW_MS));
  // A tap belongs to any visit still open — a sitting lasts up to SITTING_MS,
  // the same reach buildRecentVisits gives a visit's taps.
  const tapStarts: T[] = [];
  for (const r of [...rows].filter((x) => x.event_type === "clicked_link").sort((a, b) => ms(a.created_at) - ms(b.created_at))) {
    if (!opens(r, [...views, ...saves, ...tapStarts], SITTING_MS)) tapStarts.push(r);
  }
  const keep = new Set<T>([...views, ...saves, ...tapStarts]);
  return rows.filter((r) => keep.has(r));
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
  /** The card's slug, to recognise a visit that came from its own other page. */
  slug?: string;
  /** False when the all-time history could not be read in full: the visit
   *  number is then left off rather than every row claiming "1st visit". */
  historyComplete?: boolean;
}): RecentVisit[] {
  const { events, paid, limit } = input;
  const historyComplete = input.historyComplete !== false;
  const leadById = new Map(input.leads.map((l) => [l.id, l]));

  const starts = visitStarts(events);

  const visits: RecentVisit[] = [];
  for (const start of starts.slice(0, limit)) {
    const surface = surfaceOf(start);
    const t0 = ms(start.created_at);
    // EVERY EVENT BELONGS TO EXACTLY ONE VISIT (2026-10-18 review). A visit
    // takes what happened from a minute before it started (a tap or save can
    // land just ahead of the view the human gate records) until a minute
    // before the same visitor's next visit to this card — or, with no next
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
          sh.visitor_id === start.visitor_id && ms(sh.created_at) >= t0 - LEAD_IN_EVENT_MS && ms(sh.created_at) < end)
      : [];
    if (sharedHere.length) actions.push("Shared their details");
    // The visit went on to the card's other page.
    const other = surface === "links" ? "card" : "links";
    if (inVisit.some((e) => (e.event_type ?? "viewed_card") === "viewed_card" && surfaceOf(e) === other)) {
      actions.push(other === "links" ? "Opened your Swift Links" : "Opened your card");
    }
    if (start.event_type === "downloaded_vcard" || inVisit.some((e) => e.event_type === "downloaded_vcard")) {
      actions.push("Downloaded your contact card");
    }
    // Each thing tapped once, in order, named the way the bell and the
    // contact's history name it (lib/visit-taps). A visit started by a tap
    // (see visitStarts) lists that tap first.
    const tapped = new Set<string>();
    for (const e of [...inVisit].reverse().concat(start.event_type === "clicked_link" ? [start] : []).sort((a, b) => ms(a.created_at) - ms(b.created_at))) {
      if (e.event_type !== "clicked_link") continue;
      const action = tapAction(e);
      if (action) tapped.add(action);
    }
    actions.push(...tapped);

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
    // The stored name is a signed-in SwiftCard member's only when the event was
    // never a contact's. A contact's event that lost its lead_id ("Wrong
    // person?", or the contact deleted — the FK sets it null) still carries
    // lead_confidence, and its old name must not keep naming the visit.
    else if (!start.lead_id && !start.lead_confidence && start.visitor_name?.trim()) who = start.visitor_name.trim();

    // Which visit this is, all time, counted by the SAME rule that decides what
    // a visit is above — so a visit that was only a contact download counts,
    // and the view after it is the 2nd visit, not another 1st.
    // Rows from before views were deduped (July-August 2026) can sit minutes
    // apart for one sitting: a start inside the visit window of the previous
    // counted one is the same visit and never raises the number.
    const visitNumber = start.visitor_id && historyComplete
      ? Math.max(
          1,
          visitStarts(input.history.filter((h) => h.visitor_id === start.visitor_id))
            .map((h) => ms(h.created_at))
            .filter((t) => t <= t0)
            .sort((a, b) => a - b)
            .reduce<number[]>((kept, t) => (kept.length && t - kept[kept.length - 1] < VIEW_VISIT_WINDOW_MS ? kept : [...kept, t]), [])
            .length,
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
    // FROM ITS OWN OTHER PAGE. referrerName drops swiftcard.me (a visitor's
    // own navigation is not a referral), so a Swift Links visit that came from
    // this card's button said nothing at all — rows from before the button was
    // tagged (?source=swift_card, 2026-10-23) are recognised by the referrer.
    const ownPage = input.slug ? fromOwnPage(start.referrer_url, input.slug, surface) : null;
    const from = ref && ref !== app?.name ? `from ${ref}` : viaSource || ownPage;
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

/** How many visits the dashboard lists; past it, the list says it stopped. */
export const RECENT_VISITS_SHOWN = 100;
/** How far back the list reads — the same whichever tab the chart is on. */
export const RECENT_VISITS_DAYS = 30;

/**
 * When a visit happened, always with its day, on the owner's clock: "Today
 * 9:41 PM", "Yesterday 9:41 PM", "Mon, Nov 3 9:41 PM". The list spans 30 days
 * on every tab, so a bare time could have been any of them.
 */
export function visitWhen(atIso: string, now: Date, tz: string): string {
  const at = new Date(atIso);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(at);
  const day = localDayKey(at, tz);
  if (day === localDayKey(now, tz)) return `Today ${time}`;
  if (day === localDayKey(new Date(now.getTime() - 86_400_000), tz)) return `Yesterday ${time}`;
  const date = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(at);
  return `${date} ${time}`;
}
/** One card's views, saves and taps in a 30-day window — far above any real month. */
const EVENT_READ_CAP = 3000;
const HISTORY_READ_CAP = 5000;

/** "from your SwiftCard" / "from your Swift Links" when the referrer is this
 *  card's own other page on swiftcard.me; null otherwise. */
function fromOwnPage(referrer: string | null | undefined, slug: string, surface: "card" | "links"): string | null {
  try {
    const u = new URL(referrer ?? "");
    if (!/(^|\.)swiftcard\.me$/i.test(u.hostname)) return null;
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    const s = slug.toLowerCase();
    if (surface === "links" && path === `/${s}`) return "from your SwiftCard";
    if (surface === "card" && path === `/links/${s}`) return "from your Swift Links";
    return null;
  } catch {
    return null;
  }
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
  // One row past the cap, so the list can say it stops there instead of
  // implying it is every visit (components/dashboard/RecentVisits).
  const limit = (opts.limit ?? RECENT_VISITS_SHOWN) + 1;
  try {
    const read = (cols: string) =>
      admin
        .from("card_events")
        .select(cols)
        .eq("card_owner_username", opts.slug)
        .in("event_type", ["viewed_card", "downloaded_vcard", "clicked_link"])
        .gte("created_at", opts.sinceIso)
        .order("created_at", { ascending: false })
        .limit(EVENT_READ_CAP);
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
            // Views, saves AND taps: a visit that was only a contact download,
            // or only a link tap, is a visit too, and the numbering must count
            // it (visitStarts).
            .select("visitor_id, surface, created_at, event_type")
            .eq("card_owner_username", opts.slug)
            .in("event_type", ["viewed_card", "downloaded_vcard", "clicked_link"])
            .in("visitor_id", visitorIds)
            .order("created_at", { ascending: true })
            .limit(HISTORY_READ_CAP)
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
      // Never back into another contact's turn on the same browser — it ends
      // one visit window after their binding (the contact's timeline, same rule).
      const priorTurn = bindingRows
        .filter((o) => o.visitor_id === b.visitor_id && o.lead_id !== b.lead_id && o.bound_at && ms(o.bound_at) < ms(b.bound_at!))
        .reduce((max, o) => Math.max(max, ms(o.bound_at!) + VIEW_VISIT_WINDOW_MS), -Infinity);
      bindings.push({ visitor_id: b.visitor_id, lead_id: b.lead_id, from: new Date(Math.max(ms(b.bound_at) - lead, priorTurn)).toISOString() });
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
      // A failed or cut-off history would number a 5th visit "1st".
      historyComplete: !historyRes.error && (historyRes.data?.length ?? 0) < HISTORY_READ_CAP,
      leads: (leadsRes.data ?? []) as VisitLead[],
      bindings,
      shares: shareRows
        .filter((sh): sh is ShareRow & { visitor_id: string } => !!sh.visitor_id)
        // The Swift Links page's form is the only one there; every other form
        // is on the card.
        .map((sh) => ({ visitor_id: sh.visitor_id, created_at: sh.created_at, surface: sh.source === "swift_connect" ? "links" as const : "card" as const })),
      paid: opts.paid,
      limit,
      slug: opts.slug,
    });
  } catch {
    return [];
  }
}
