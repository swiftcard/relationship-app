// ── Locations are a Pro feature, including inside a sentence ─────────────────
//
// The Locations tab is Pro-gated (a lock on the tab, an upsell behind it), and
// the lead list a Free account is handed never includes a location column. The
// notification body walked straight past both: "Sam viewed your Swift Links in
// the New York area" told a Free owner exactly what the paid tab exists to
// show, several times a day, for free. Owner, 2026-09-11: blur it — and say
// nothing about Pro or upgrading, just blur the place.
//
// A blur in CSS over real text is not a lock: anyone can read it in devtools.
// So the redaction happens on the SERVER — the place is replaced with blocks
// before the row is handed to a Free account — and the blur is only what makes
// the redaction look deliberate rather than broken.
//
// HOW THE PLACE IS FOUND AGAIN LATER. The body is one string in one column, so
// the location is marked when the sentence is composed, with two invisible
// separators:
//
//   Sam viewed your Swift Links⟨ in the ⟪New York⟫ area⟩.
//   ⟨…⟩  PHRASE — the whole fragment, preposition included. A lock screen
//         cannot blur anything, so for a Free account the push drops this
//         entire span and the sentence still reads as a sentence.
//   ⟪…⟫  PLACE  — just the name. This is the part that gets blocked out and
//         blurred in the app, so "in the ███ area" keeps its shape.
//
// Both marks are real Unicode invisible separators. If a surface forgets to
// strip them, nothing is visible and nothing is broken — the worst case is an
// invisible character in an email, which is why they are not "[" and "]".

/** U+2063 INVISIBLE SEPARATOR — wraps the whole location fragment. */
export const PHRASE_MARK = "⁣";
/** U+2062 INVISIBLE TIMES — wraps the place name inside it. */
export const PLACE_MARK = "⁢";

/** The block used for a redacted place. Blurred in the app; already unreadable without. */
const REDACT_CHAR = "█";
/**
 * Every hidden place is the SAME width. Sized to the name, the blocks told a
 * Free account how long the place was — eight for "New York", four for
 * "Waco" (2026-09-23 notification review). The lock screen already uses one
 * fixed shape (teaseLocation); the app now matches.
 */
const REDACTED_PLACE = REDACT_CHAR.repeat(8);

export function markPhrase(fragment: string): string {
  return `${PHRASE_MARK}${fragment}${PHRASE_MARK}`;
}

export function markPlace(name: string): string {
  return `${PLACE_MARK}${name}${PLACE_MARK}`;
}

/** Plain text, for every surface that is not the app's own notification list. */
export function stripLocationMarks(text: string): string {
  return text.split(PHRASE_MARK).join("").split(PLACE_MARK).join("");
}

/**
 * Drop the location fragment entirely — the push notification for a Free
 * account, where there is no way to blur anything.
 *
 * Tidies the space the fragment leaves behind so the sentence never reads
 * "viewed your card ." or "viewed your  card".
 */
export function withoutLocation(text: string): string {
  const parts = text.split(PHRASE_MARK);
  // Even indexes are outside the marks, odd indexes are the fragment(s).
  const kept = parts.filter((_, i) => i % 2 === 0).join("");
  return stripLocationMarks(kept).replace(/\s+([.!?,])/g, "$1").replace(/\s{2,}/g, " ").trim();
}

/**
 * The Free LOCK SCREEN: the place stays in the sentence, shaded out.
 *
 * A push can't blur, so this used to drop the fragment and the banner read
 * "Someone viewed your card." — which hid that there was a where at all.
 * Owner, 2026-09-22: "Someone viewed your SwiftCard link in … and it'll have
 * the state blurred on the phone." Every place becomes the SAME shape, so the
 * banner shows there is a place without leaking how long its name is, or
 * whether it was a city, a region or a country. Still says nothing about Pro.
 */
export const TEASED_PLACE = " in ▒▒▒▒▒, ▒▒";

export function teaseLocation(text: string): string {
  const parts = text.split(PHRASE_MARK);
  const out = parts.map((p, i) => (i % 2 === 1 ? TEASED_PLACE : p)).join("");
  return stripLocationMarks(out).replace(/\s+([.!?,])/g, "$1").replace(/\s{2,}/g, " ").trim();
}

/**
 * Replace every marked place with blocks, keeping the marks so the app can
 * still blur what is left. THIS is what a Free account is actually sent: the
 * real place name never reaches the browser.
 */
export function redactPlaces(text: string): string {
  // The WHOLE phrase becomes one shape first. Blocking only the name left the
  // words around it — "near ████" for a city, "in the ████ area" for a region,
  // "in the ████" for some countries — which told a Free account how precise
  // the location was and hinted at the country (2026-09-23 analytics audit).
  // Same idea as the lock screen's TEASED_PLACE: there is a place, nothing more.
  const phrased = text.replace(
    new RegExp(`${PHRASE_MARK}[^${PHRASE_MARK}]*${PHRASE_MARK}`, "g"),
    (frag) => (frag.includes(PLACE_MARK) ? markPhrase(` in ${markPlace(REDACTED_PLACE)}`) : frag),
  );
  return phrased.replace(
    new RegExp(`${PLACE_MARK}([^${PLACE_MARK}]*)${PLACE_MARK}`, "g"),
    () => markPlace(REDACTED_PLACE),
  );
}

/**
 * Redact a BARE place label — a lead's `location` column, not a sentence.
 *
 * The contacts panel prints that column straight out ("Zzyzx, California"),
 * which handed a Free account the very thing the Locations tab charges for,
 * on every contact they open. Same treatment as a notification: the real name
 * is replaced here, on the server, and the app blurs what is left.
 */
export function redactPlaceLabel(label: string | null | undefined): string | null {
  const raw = (label ?? "").trim();
  if (!raw) return null;
  return markPlace(REDACTED_PLACE);
}

/**
 * Split a body into the pieces a renderer needs: plain text, and the place
 * spans it should blur. Marks are removed from every piece.
 */
export function splitLocationParts(text: string): { text: string; place: boolean }[] {
  const out: { text: string; place: boolean }[] = [];
  for (const [i, chunk] of text.split(PLACE_MARK).entries()) {
    if (!chunk) continue;
    out.push({ text: chunk.split(PHRASE_MARK).join(""), place: i % 2 === 1 });
  }
  return out;
}

/** True if this body carries a place the app would blur. */
export function hasMarkedPlace(text: string): boolean {
  return text.includes(PLACE_MARK);
}

// ── Rows written before the marks existed ────────────────────────────────────
//
// Every notification already in the database says the place in plain text, and
// a Free account would keep reading those forever. They were written by ONE
// composer (lib/card-event-notify.ts) in three fixed shapes, always at the end
// of the sentence:
//
//   "… viewed your card near Great Neck, NY."
//   "… viewed your Swift Links in the New York area."
//   "… downloaded your contact card from a QR code in the United States."
//
// Matching a trailing fragment is only safe because the caller applies this to
// those types alone (lib/notification-privacy.ts) — "in" is far too common a
// word to go hunting for in an arbitrary sentence.
//
// THE NAME MAY CONTAIN A PERIOD (2026-10-06). It used to be [^.!?], so "near
// St. Louis, MO." / "Ft. Lauderdale" / "Washington, D.C." could not match at
// all and the place went to a Free account in plain text. And because the
// match is anchored to the END but starts at the FIRST "near"/"in", a sentence
// that carries more after the place (the 09-09→09-11 milestone rows: "…near
// Austin, TX. That's 50 views on /slug. …") now over-redacts the rest of the
// sentence instead of under-redacting the place. Losing a tip is fine; leaking
// the place is the bug.
const LEGACY_TAIL = /(\s)(near\s+|in\s+the\s+|in\s+)([^!?]+?)(\s+area)?([.!?]?)$/;

export function redactLegacyPlace(text: string): string {
  return text.replace(LEGACY_TAIL, (_m, space: string, prep: string, name: string, area = "", end = "") =>
    `${space}${prep}${markPlace(REDACTED_PLACE)}${area}${end}`,
  );
}
