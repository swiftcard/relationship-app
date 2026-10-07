// ── One contact, as an Office admin reads it ─────────────────────────────────
//
// The admin console's Contacts tab opens a drawer for a single contact: when
// they were added, how, which teammate they belong to, and what has passed
// between that teammate and them. lib/office-contact-detail builds the payload
// on the server; this module turns it into sentences and is CLIENT-SAFE — pure,
// no database client on its import path (tests/server-only-boundary).
//
// The member's own Conversation tab (components/ContactsClient) tells the same
// story in the second person — "Jordan viewed your card". An admin is a third
// party, so every line here names the teammate instead: "Jordan viewed Jane's
// card". The rules about WHAT counts as this contact's activity are not
// re-decided here; they come from the server, matched the same way as the
// member's own timeline.

import { getSourceLabel } from "@/lib/source-labels";
import type { FollowUpState } from "@/lib/lead-followup";

export type ContactTimelineEvent = {
  id: string;
  event_type: string;
  source: string | null;
  created_at: string;
  surface?: string | null;
  target?: string | null;
  target_label?: string | null;
  lead_confidence?: string | null;
};

export type ContactTimelineMessage = {
  id: string;
  direction: "in" | "out";
  channel: string | null;
  body: string;
  status: string | null;
  created_at: string;
};

/**
 * Why the drawer shows no messages or activity, when it shows none:
 *  - "owner_private": the office owner's own contacts, seen by someone else on
 *    the team. Their conversations are theirs (owner decision, 2026-10-07).
 *  - "no_record": the dates the teammate was on the team can't be established
 *    (no join or removal record) — so nothing is shown rather than a guess that
 *    could reach into their life before or after this team.
 */
export type ContactHistoryHidden = "owner_private" | "no_record";

export type OfficeContactDetail = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  location: string | null;
  createdAt: string;
  /** leads.source — how they reached the card, or "manual" when typed/scanned. */
  source: string | null;
  /**
   * For sources that name a BUTTON rather than a channel (swift_connect,
   * save_contact_conversion), the channel they first arrived through, from
   * their earliest matched card event. Null when unknown.
   */
  arrivalSource: string | null;
  /** What they typed when they shared — null when hidden or never written. */
  message: string | null;
  owner: {
    name: string;
    /** Null for someone who has left the team: their pages 404 for the office. */
    userId: string | null;
    isFormer: boolean;
    isOfficeOwner: boolean;
  };
  followUp: FollowUpState;
  /** Follow-up steps still to go, with the moment the daily send will run. */
  upcomingSteps: { channel: "email" | "sms"; sendsAt: string; paused: boolean }[];
  history: {
    shown: boolean;
    hiddenBecause: ContactHistoryHidden | null;
    /** History starts here because the teammate joined after this contact arrived. */
    from: string | null;
    /** History stops here because the teammate left the team. */
    until: string | null;
  };
  events: ContactTimelineEvent[];
  messages: ContactTimelineMessage[];
};

export function firstName(name: string | null | undefined, fallback: string): string {
  const f = (name ?? "").trim().split(/\s+/)[0];
  return f || fallback;
}

/** "Jane's" — or "the" for someone who has left, whose name the office no longer holds. */
function teammatePossessive(d: OfficeContactDetail): string {
  return d.owner.isFormer ? "the" : `${firstName(d.owner.name, "the")}'s`;
}

/** Who the arrival line credits for a contact added by hand. */
function teammateName(d: OfficeContactDetail): string {
  return d.owner.isFormer ? "a former teammate" : d.owner.name;
}

// The sources that mean "a teammate put this contact in", not "the contact
// shared their info". Only "manual" is written today (typing AND the card
// scanner both save as manual — the two can't be told apart); the other two
// have labels and may exist on older rows.
const ADDED_BY_TEAMMATE = new Set(["manual", "scanner", "imported"]);

export function addedByTeammate(source: string | null | undefined): boolean {
  return ADDED_BY_TEAMMATE.has(source ?? "");
}

/**
 * How the contact arrived, as a headline and the channel underneath it:
 *   { title: "Shared their info on Jane's card", via: "QR code scan" }
 *   { title: "Added by Jane Doe", via: "Typed in or scanned from a business card" }
 * Only what really happened — a contact the teammate typed in never "shared
 * their info".
 */
export function describeArrival(d: OfficeContactDetail): { title: string; via: string | null } {
  const P = teammatePossessive(d);
  switch (d.source) {
    case "manual":
      return { title: `Added by ${teammateName(d)}`, via: "Typed in or scanned from a business card" };
    case "scanner":
      return { title: `Added by ${teammateName(d)}`, via: "Scanned from a business card" };
    case "imported":
      return { title: `Added by ${teammateName(d)}`, via: "Imported from a spreadsheet" };
    case "swift_connect":
      // The Connect button lives on the Swift Links page, so the arrival
      // channel adds nothing unless it is something other than that page.
      return {
        title: `Tapped Connect on ${P} Swift Links and shared their info`,
        via: d.arrivalSource && d.arrivalSource !== "swift_links" && d.arrivalSource !== "unknown" ? getSourceLabel(d.arrivalSource) : null,
      };
    case "save_contact_conversion":
      return {
        title: `Downloaded ${P} contact card, then shared their info`,
        via: d.arrivalSource && d.arrivalSource !== "unknown" ? getSourceLabel(d.arrivalSource) : null,
      };
    default:
      return {
        title: `Shared their info on ${P} card`,
        via: d.source && d.source !== "unknown" ? getSourceLabel(d.source) : null,
      };
  }
}

// What a card event says, with the contact's first name in front. A view
// carries WHICH page was opened (surface), and a link tap names the link the
// teammate gave it when the row knows — the same distinctions the teammate's
// own timeline makes.
function eventPhrase(ev: ContactTimelineEvent, P: string): string | null {
  switch (ev.event_type) {
    case "viewed_card":
      return ev.surface === "links" ? `viewed ${P} Swift Links` : `viewed ${P} card`;
    case "downloaded_vcard":
      // A download, not a save: whether they tapped Add in their phone's
      // contacts sheet is something no app can see.
      return `downloaded ${P} contact card`;
    case "clicked_link":
      if (ev.target_label) return `tapped ${P} ${ev.target_label} link`;
      if (ev.target) return `tapped ${P} ${ev.target} link`;
      return P === "the" ? "tapped one of the links" : `tapped one of ${P} links`;
    default:
      // shared_info is the arrival line's job; clicked_save_contact always
      // fired alongside downloaded_vcard and was retired. Anything unknown is
      // left out rather than printed as a raw event name.
      return null;
  }
}

/** Delivery state of an outbound message — the carrier's verdict wins over our optimistic "sent". */
export function deliveryLabel(status: string | null | undefined): { text: string; tone: string } {
  switch ((status ?? "").toLowerCase()) {
    case "delivered": return { text: "Delivered", tone: "text-emerald-500" };
    case "undelivered":
    case "bounced": return { text: "Not delivered", tone: "text-red-400" };
    case "failed": return { text: "Failed", tone: "text-red-400" };
    case "not_configured":
    case "canceled":
    case "cancelled": return { text: "Not sent", tone: "text-amber-400" };
    case "accepted":
    case "scheduled":
    case "queued":
    case "sending": return { text: "Sending", tone: "text-gray-500" };
    default: return { text: "Sent", tone: "text-gray-500" };
  }
}

export type TimelineItem =
  | { kind: "event"; key: string; at: string; icon: string; text: string; via: string | null }
  | { kind: "in"; key: string; at: string; body: string; who: string }
  | { kind: "out"; key: string; at: string; body: string; who: string; channel: "email" | "sms"; status: string | null };

/** Everything that has passed between the teammate and the contact, oldest first. */
export function buildContactTimeline(d: OfficeContactDetail): TimelineItem[] {
  const f = firstName(d.name, "They");
  const P = teammatePossessive(d);
  const T = d.owner.isFormer ? "Their former teammate" : firstName(d.owner.name, "Your teammate");
  const items: TimelineItem[] = [];

  // The arrival is part of WHEN and HOW, which the admin always sees.
  const arrival = describeArrival(d);
  items.push(addedByTeammate(d.source)
    ? { kind: "event", key: "arrival", at: d.createdAt, icon: "+", text: arrival.title, via: null }
    : { kind: "event", key: "arrival", at: d.createdAt, icon: "✓", text: `${f} ${arrival.title.charAt(0).toLowerCase()}${arrival.title.slice(1)}`, via: arrival.via });

  if (!d.history.shown) return items;

  // The note they typed when they shared — theirs, so only when they did share.
  if (d.message && !addedByTeammate(d.source)) {
    items.push({ kind: "in", key: "note", at: d.createdAt, body: d.message, who: f });
  }
  for (const ev of d.events) {
    const phrase = eventPhrase(ev, P);
    if (!phrase) continue;
    // A link the teammate sent this contact, opened on a device that isn't
    // theirs (forwarded): say who did what without pinning it on the contact.
    const text = ev.lead_confidence === "forwarded"
      ? (ev.event_type === "viewed_card"
        ? `${T}'s link to ${f} was opened on another device`
        : `Someone with ${T}'s link to ${f} ${phrase}`)
      : `${f} ${phrase}`;
    items.push({ kind: "event", key: `ev-${ev.id}`, at: ev.created_at, icon: "·", text, via: null });
  }
  for (const m of d.messages) {
    items.push(m.direction === "in"
      ? { kind: "in", key: `m-${m.id}`, at: m.created_at, body: m.body, who: f }
      : { kind: "out", key: `m-${m.id}`, at: m.created_at, body: m.body, who: T, channel: m.channel === "sms" ? "sms" : "email", status: m.status });
  }
  // Stable: the arrival stays ahead of anything stamped the same instant.
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => (Date.parse(a.it.at) - Date.parse(b.it.at)) || (a.i - b.i))
    .map(({ it }) => it);
}
