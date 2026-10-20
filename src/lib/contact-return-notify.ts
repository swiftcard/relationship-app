import type { KnownContact } from "@/lib/known-contact";
import { markName } from "@/lib/contact-privacy";
import { LOCKED_LEAD_TAG } from "@/lib/plan";
import { VIEW_VISIT_WINDOW_MS } from "@/lib/view-window";
import type { PushCategory } from "@/lib/push-policy";

// ── "Priya re-opened your card" ─────────────────────────────────────────────
//
// The copy for a visit by a contact the owner already knows
// (lib/known-contact.ts), and the rules for whether it may interrupt.
// docs/plans/warm-lead-alerts.md §2.4.
//
// Names are wrapped in NAME marks (lib/contact-privacy.ts): Pro reads "Priya",
// a Free bell shows a blurred block, a Free lock screen says "A contact".
//
// Never selling language, never a location (the name is the news; a place
// would be a second Pro feature smuggled into the same sentence).

/** Contacts whose visits reach the bell but never the lock screen (D5). */
export const CLOSED_STATUSES = new Set(["not_interested", "dissolved"]);

/**
 * May this contact's return reach the LOCK SCREEN at all? Not when the owner
 * closed them (D5). One rule, used at produce time here and again by the 8am
 * catch-up (api/push/catchup), which re-reads the bell row and would otherwise
 * announce a closed contact anyway.
 */
/** The forwarded-link row's title. It shares contact_returned with the real
 *  return, so the morning catch-up tells the bell-only one apart by this. */
export const FORWARDED_OPEN_TITLE = "Your link was opened on another device";

export function contactMayPush(contact: { status?: string | null }): boolean {
  return !CLOSED_STATUSES.has(contact.status ?? "");
}

export type ContactReturnNotice = {
  type: "contact_returned" | "contact_engaged" | "contact_saved";
  title: string;
  body: string;
  pushTitle?: string;
  pushBody?: string;
  pushCategory?: PushCategory;
};

/**
 * Is this the contact COMING BACK, rather than the visit they were captured
 * in? The capture visit was already announced as "New contact".
 */
export function isReturnVisit(contact: Pick<KnownContact, "capturedAt">, now = Date.now()): boolean {
  const at = Date.parse(contact.capturedAt);
  return Number.isFinite(at) && now - at > VIEW_VISIT_WINDOW_MS;
}

/** A Free lead over the monthly cap: its name is exactly what is being withheld. */
export function isLockedContact(contact: Pick<KnownContact, "tags">): boolean {
  return contact.tags.includes(LOCKED_LEAD_TAG);
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function firstName(full: string): string {
  return (full.trim().split(/\s+/)[0] || "Your contact").slice(0, 24);
}

/** "met at RE/MAX Summit" when the owner said where; otherwise the day. */
export function metContext(contact: Pick<KnownContact, "whereMet" | "capturedAt">): string | null {
  const where = (contact.whereMet ?? "").trim();
  if (where) return `met at ${where.slice(0, 40)}`;
  const at = new Date(contact.capturedAt);
  if (Number.isNaN(at.getTime())) return null;
  return `met ${at.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
}

export function contactReturnNotice(input: {
  contact: KnownContact;
  eventType: "viewed_card" | "downloaded_vcard" | "clicked_link";
  surface: "card" | "links";
  /** The link's own name, else its host (clicked_link). */
  linkName?: string | null;
  /** Distinct visits by this contact in the last 7 days, this one included. */
  visitsThisWeek: number;
  paid: boolean;
}): ContactReturnNotice | null {
  const { contact, eventType, surface, visitsThisWeek, paid } = input;
  const full = contact.name || "Your contact";
  const first = markName(firstName(full));
  const fullMarked = markName(full);
  const page = surface === "links" ? "Swift Links" : "card";
  const mayPush = contactMayPush(contact);

  // A browser that opened a link AFTER another browser already had: someone
  // the contact passed it to, perhaps. Said as what it is, bell only (D3).
  if (contact.confidence === "forwarded") {
    if (eventType !== "viewed_card") return null;
    return {
      type: "contact_returned",
      title: FORWARDED_OPEN_TITLE,
      body: `Your link to ${fullMarked} was opened on another device.`,
    };
  }

  const context = metContext(contact);
  const visits = visitsThisWeek >= 2 ? `${ordinal(visitsThisWeek)} visit this week` : null;

  if (eventType === "viewed_card") {
    const lock = [
      context ? context[0].toUpperCase() + context.slice(1) : null,
      visits,
    ].filter(Boolean).join(" · ");
    return {
      type: "contact_returned",
      title: `${first} re-opened your ${page}`,
      body: `${fullMarked}${context ? ` (${context})` : ""} re-opened your ${page}${visits ? ` — ${visits}` : ""}.`,
      // Pro: who, from where you met, how often. Free: the fact, and a reason
      // to open the app — never a price, never "upgrade" (iOS shell rule).
      pushBody: paid ? lock || "Tap to see their activity" : "Open SwiftCard to see who",
      ...(mayPush ? { pushCategory: "contact_return" as const } : {}),
    };
  }

  if (eventType === "clicked_link") {
    const link = (input.linkName ?? "").trim() || "a";
    // Upgrades the visit's row in silence: one person's visit is one buzz.
    return {
      type: "contact_engaged",
      title: `${first} tapped your ${link} link`,
      body: `${fullMarked}${context ? ` (${context})` : ""} re-opened your ${page} and tapped your ${link} link.`,
    };
  }

  // Downloaded the contact card again: the existing contact_saved rank and
  // category, with the name the owner already has for them.
  return {
    type: "contact_saved",
    title: `${first} downloaded your contact card`,
    body: `${fullMarked} downloaded your contact card again.`,
    ...(mayPush ? { pushCategory: "contact_saved" as const } : {}),
  };
}
