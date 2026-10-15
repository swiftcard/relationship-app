// Reserved lead tags are SERVER-OWNED — they drive org visibility, the Free
// paywall, and automation state, so a client must never set or clear them by
// PATCHing a lead's `tags` array. Without this, a user could:
//   • inject `sc-office-<otherOrgId>` to plant a lead in another company's
//     Leads tab (cross-org pollution), or
//   • strip `sc-locked` from their own capped Free lead to unlock it for free,
//     or pause/unpause automation (`flow-paused`, `email-paused`, `sms-paused`,
//     `sms-ok`, `preset-*`) they aren't meant to touch directly.
// `sms-ok` is the affirmative SMS-consent marker (TCPA opt-in): the cron sends
// an automated text ONLY when it's present. It is server-owned so a client
// can't forge consent by PATCHing it, and so it survives unrelated tag edits.
export const RESERVED_LEAD_TAG = /^(sc-office-|sc-locked$|flow-|email-paused$|sms-paused$|sms-ok$|preset-)/;

// Merge a client-supplied tag array with the row's existing tags so that the
// server-owned (reserved) tags are preserved exactly as they were and only
// non-reserved tags from the client are honored. Order: kept reserved tags
// first, then the client's own tags (de-duplicated).
export function mergeClientTags(
  incoming: unknown,
  existing: string[] | null | undefined,
): string[] {
  const incomingClean = (Array.isArray(incoming) ? incoming : [])
    .filter((t): t is string => typeof t === "string")
    .filter((t) => !RESERVED_LEAD_TAG.test(t));
  const keptReserved = (existing ?? []).filter((t) => RESERVED_LEAD_TAG.test(t));
  return Array.from(new Set([...keptReserved, ...incomingClean]));
}

/**
 * SwiftCard's own bookkeeping tags — never meaningful outside the app. "unread"
 * is the inbox dot, "demo" marks the sample contact every account starts with.
 */
const INTERNAL_LEAD_TAGS = new Set(["unread", "demo"]);

/**
 * May this tag leave SwiftCard for a CRM or Zapier? Only the owner's own
 * labels (plus "scanned", the one capture-time tag that means something to
 * them). In HighLevel a tag is a workflow trigger, so a bookkeeping marker
 * there could start a customer's automation — and since CRM tagging only ever
 * ADDS, an "unread" sent once would never come off when the owner reads it.
 */
export function isCrmVisibleTag(tag: unknown): tag is string {
  return typeof tag === "string" && !!tag.trim() && !RESERVED_LEAD_TAG.test(tag) && !INTERNAL_LEAD_TAGS.has(tag);
}
