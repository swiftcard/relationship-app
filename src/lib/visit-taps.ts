// ── What a visitor TAPPED, said the same way everywhere ─────────────────────
//
// Owner, 2026-11-05: "If they tap on an additional link or my Instagram or
// something like that, only if I have them as a contact will it save in the
// activity and messages. If not it will just tell me in my notification
// center." So a tap has to be nameable in three places — a saved contact's
// Activity & Messages, the dashboard's Recent visits, and the bell — and the
// three must never call the same tap different things.
//
// A tap is a card_events `clicked_link` row. `target` is the destination host
// ("instagram.com"), or one of the CONTACT ACTION targets below for a tel:,
// mailto: or sms: button (lib/track-link-click.ts); `target_label` is the
// link's own name as the owner wrote it ("Listings", "Instagram").
//
// Pure, no imports beyond the marks: the bell, the timeline and Recent visits
// all call it, server and client.

import { TAPS_MARK } from "@/lib/location-privacy";

/** What a tel:, mailto: or sms: tap records as its target instead of a host.
 *  Never the number or the address itself — only that the button was pressed. */
export const CONTACT_ACTION_TARGETS = { phone: "phone number", email: "email", text: "Text button" } as const;
export type ContactActionTarget = keyof typeof CONTACT_ACTION_TARGETS;

export function isContactActionTarget(target: string | null | undefined): target is ContactActionTarget {
  return !!target && Object.prototype.hasOwnProperty.call(CONTACT_ACTION_TARGETS, target);
}

export type TapRow = { target?: string | null; target_label?: string | null };

/** What the tap is called inside a sentence: "Instagram", "Listings",
 *  "calendly.com", "phone number". Null when the row names nothing. */
export function tapName(t: TapRow): string | null {
  const target = (t.target ?? "").trim().toLowerCase();
  if (isContactActionTarget(target)) return CONTACT_ACTION_TARGETS[target];
  const name = (t.target_label ?? "").trim() || (t.target ?? "").trim();
  return name || null;
}

/** One action line: "Tapped Instagram", "Tapped your phone number". */
export function tapAction(t: TapRow): string | null {
  const target = (t.target ?? "").trim().toLowerCase();
  if (isContactActionTarget(target)) return `Tapped your ${CONTACT_ACTION_TARGETS[target]}`;
  const name = tapName(t);
  return name ? `Tapped ${name}` : null;
}

/** For a contact's timeline: "tapped your phone number", "tapped your Listings link". */
export function tapPhrase(t: TapRow, possessive = "your"): string {
  const target = (t.target ?? "").trim().toLowerCase();
  if (isContactActionTarget(target)) return `tapped ${possessive} ${CONTACT_ACTION_TARGETS[target]}`;
  const name = tapName(t);
  if (name) return `tapped ${possessive} ${name} link`;
  return possessive === "the" ? "tapped one of the links" : `tapped one of ${possessive} links`;
}

/** "a", "a and b", "a, b and c". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The distinct names of a visit's taps, in the order they happened. */
export function tapNames(taps: TapRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of taps) {
    const n = tapName(t);
    if (!n) continue;
    const k = n.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out;
}

/**
 * The bell's sentence about a visit's taps, marked so the reader's plan picks
 * its half (lib/location-privacy TAPS_MARK): Pro and Office read "They tapped
 * your Instagram and Website.", Free reads "They tapped a link." — which link
 * is a Pro detail, like the place and the device (owner, 2026-11-05).
 * Empty when there is nothing to say.
 */
export function tapSentence(names: string[]): string {
  if (!names.length) return "";
  const pro = ` They tapped your ${joinNames(names)}.`;
  const free = names.length === 1 ? " They tapped a link." : ` They tapped ${names.length} links.`;
  return `${TAPS_MARK}${pro}${TAPS_MARK}${free}${TAPS_MARK}`;
}

const MARKS = /[⁡-⁤⁭]/;

/**
 * `body` with its tap sentence set to `sentence`: an existing one is replaced
 * (a later tap adds to the list, never a second sentence), otherwise it goes
 * right after the first sentence — the one that says who and what — so a
 * milestone's "That's 50 views…" and its tip stay after it.
 */
export function withTapSentence(body: string, sentence: string): string {
  const existing = new RegExp(`${TAPS_MARK}[^${TAPS_MARK}]*${TAPS_MARK}[^${TAPS_MARK}]*${TAPS_MARK}`);
  if (existing.test(body)) return body.replace(existing, sentence);
  if (!sentence) return body;
  // The end of the first sentence, outside every marked span (a place, a
  // device, a name and a host can all hold a full stop of their own), and
  // never an initial ("J. Doe").
  const open = new Set<string>();
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (MARKS.test(ch)) {
      if (open.has(ch)) open.delete(ch); else open.add(ch);
      continue;
    }
    if (ch !== "." || open.size) continue;
    const next = body[i + 1];
    if (next !== undefined && next !== " ") continue;
    const initial = i >= 1 && /[A-Z]/.test(body[i - 1]) && (i < 2 || /\s/.test(body[i - 2]));
    if (initial) continue;
    return body.slice(0, i + 1) + sentence + body.slice(i + 1);
  }
  return body + sentence;
}
