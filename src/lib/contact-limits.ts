// How long a contact's fields may be (audit F-CONTACTS-05). Nothing bounded
// them, on the client or the server: a name, a note or "Where we met" took any
// length, and a non-text name threw on .trim() — an uncaught 500. Generous:
// they stop abuse and accidents, never a real contact.
export const CONTACT_FIELD_MAX = {
  name: 120,
  email: 254,
  phone: 40,
  company: 120,
  where_met: 200,
  notes: 5000,
  convo_details: 5000,
  company_description: 2000,
  message: 6000,
} as const;

export type ContactField = keyof typeof CONTACT_FIELD_MAX;

/**
 * The first problem with these values, in words a person can act on, or null.
 * null and undefined are allowed (clearing a field); anything else must be text
 * within its limit.
 */
export function contactFieldProblem(values: Record<string, unknown>): string | null {
  for (const [field, max] of Object.entries(CONTACT_FIELD_MAX)) {
    if (!(field in values)) continue;
    const v = values[field];
    if (v === null || v === undefined) continue;
    if (typeof v !== "string") return `"${field.replace(/_/g, " ")}" must be text.`;
    if (v.length > max) return `That ${field === "where_met" ? "\"Where we met\"" : field.replace(/_/g, " ")} is too long — keep it under ${max.toLocaleString("en-US")} characters.`;
  }
  return null;
}
