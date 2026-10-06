// ── A repeat share from someone the owner already has ────────────────────────
//
// api/leads treats the same phone to the same card as the SAME contact
// (owner, 2026-10-06): no second row, no second "new lead" alert, no Free
// contact used up. What the second send can still add is what the contact
// lacked. Pure, so the rule is testable without a database.

/** Longest a contact's message grows to by appending repeat sends. */
export const MAX_MERGED_MESSAGE = 6000;

type Known = { email?: unknown; company?: unknown; message?: unknown };
type Incoming = { email?: unknown; company?: unknown; message?: unknown };

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * The fields to write onto the existing contact, or null for nothing.
 * Fills a missing email or company; appends a message that isn't already
 * there. Never replaces a value the contact has — the owner may have edited
 * it since.
 */
export function sameContactFill(known: Known, incoming: Incoming): Record<string, string> | null {
  const fill: Record<string, string> = {};
  if (!text(known.email) && text(incoming.email)) fill.email = text(incoming.email);
  if (!text(known.company) && text(incoming.company)) fill.company = text(incoming.company);
  const had = text(known.message);
  const said = text(incoming.message);
  if (said && !had.includes(said)) {
    // Newest kept when the cap bites: it is the one the owner hasn't seen.
    fill.message = (had ? `${had}\n\n${said}` : said).slice(-MAX_MERGED_MESSAGE);
  }
  return Object.keys(fill).length ? fill : null;
}
