import {
  describeCapture,
  shouldAttachNote,
  mayOverwrite,
  pushFailure,
  splitName,
  phoneDigits,
  samePhone,
  type CrmLead,
  type CrmConnection,
  type CrmProvider,
  type ContactField,
  type PushOptions,
  type PushResult,
  type CrmSyncOptions,
} from "./crm-connection";
import { crmFetch, errorDetail, CrmNoAnswerError, type CrmBudget } from "./crm-http";
import { runCrmSync, type SyncOutcome } from "./crm-run";

// ── HubSpot ──────────────────────────────────────────────────────────────────
//
// Connected with a pasted service key / private-app token (pat-…), which never
// expires — so there is no refresh here. HubSpot's self-serve OAuth was closed
// when this was built, and the leftover OAuth refresh config this file used to
// carry pointed at env vars nothing set.
//
// Only the standard properties are sent. HubSpot REJECTS a write to a property
// that doesn't exist on the portal, so capture context goes in a Note (a
// standard object every portal has), never in custom fields.
//
// Finding the existing contact, in order: the record we wrote last time
// (crm_links) → the contact's previous email, when an edit just changed it →
// their email → their phone, when there is no email. Only when all of those
// miss is a contact created.

const API = "https://api.hubapi.com";
const CONTACTS = `${API}/crm/v3/objects/contacts`;
const LABEL = "HubSpot";
const PROPS = ["firstname", "lastname", "email", "phone", "mobilephone", "company"];

type HsContact = { id: string; properties: Record<string, string | null | undefined> };

function headers(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

/** A 401 from a lookup means the token is dead — stop, don't create blind. */
class Unauthorized extends Error {
  constructor(public status: number) { super(String(status)); }
}

async function getById(token: string, id: string, budget: CrmBudget): Promise<HsContact | null> {
  const res = await crmFetch(`${CONTACTS}/${encodeURIComponent(id)}?properties=${PROPS.join(",")}`, { headers: headers(token) }, budget);
  if (res.status === 401) throw new Unauthorized(401);
  if (!res.ok) return null;
  return (await res.json()) as HsContact;
}

/**
 * Search. A failure that isn't a dead token (a key granted only the WRITE
 * scope gets 403 here; the search index can lag a few seconds) reads as "not
 * found" — the create below then hits HubSpot's own unique-email check, which
 * catches the duplicate server-side.
 */
async function search(token: string, filterGroups: unknown[], budget: CrmBudget): Promise<HsContact[]> {
  const res = await crmFetch(`${CONTACTS}/search`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ filterGroups, properties: PROPS, limit: 5 }),
  }, budget);
  if (res.status === 401) throw new Unauthorized(401);
  if (!res.ok) return [];
  return ((await res.json()) as { results?: HsContact[] }).results ?? [];
}

async function findByEmail(token: string, email: string, budget: CrmBudget): Promise<HsContact | null> {
  const want = email.trim().toLowerCase();
  const hits = await search(token, [{ filters: [{ propertyName: "email", operator: "EQ", value: want }] }], budget);
  return hits.find((c) => (c.properties.email ?? "").toLowerCase() === want) ?? null;
}

async function findByPhone(token: string, phone: string, budget: CrmBudget): Promise<HsContact | null> {
  // HubSpot stores phones as typed, so an exact match on the raw value finds
  // only one formatting. hs_searchable_calculated_phone_number is HubSpot's
  // digits-only copy WITHOUT the country code — the national number.
  let national = phoneDigits(phone);
  if (national.length === 11 && national.startsWith("1")) national = national.slice(1);
  const groups = [
    { filters: [{ propertyName: "phone", operator: "EQ", value: phone }] },
    { filters: [{ propertyName: "mobilephone", operator: "EQ", value: phone }] },
    ...(national.length >= 7 ? [{ filters: [{ propertyName: "hs_searchable_calculated_phone_number", operator: "EQ", value: national }] }] : []),
  ];
  const hits = await search(token, groups, budget);
  return hits.find((c) => samePhone(c.properties.phone, phone) || samePhone(c.properties.mobilephone, phone)) ?? null;
}

/** Everything a brand-new contact gets. */
function createProps(lead: CrmLead): Record<string, string> {
  const { first, last } = splitName(lead.name);
  const p: Record<string, string> = { firstname: first };
  if (last) p.lastname = last;
  if (lead.email) p.email = lead.email;
  if (lead.phone) p.phone = lead.phone;
  if (lead.company) p.company = lead.company;
  return p;
}

/**
 * What to change on a contact HubSpot already has. Blanks are filled; a value
 * someone set in HubSpot is replaced only when the owner just changed that
 * field in SwiftCard (mayOverwrite). A second phone number goes to the
 * mobile field instead of replacing the first.
 */
function updateProps(cur: HsContact["properties"], lead: CrmLead, opts: CrmSyncOptions): Record<string, string> {
  const p: Record<string, string> = {};
  const fill = (field: ContactField, prop: string, value: string | null | undefined) => {
    if (!value) return;
    if (!cur[prop]?.trim() || mayOverwrite(field, opts)) {
      if (cur[prop] !== value) p[prop] = value;
    }
  };
  const { first, last } = splitName(lead.name);
  if (mayOverwrite("name", opts)) {
    p.firstname = first;
    p.lastname = last ?? "";
  } else {
    fill("name", "firstname", first);
    fill("name", "lastname", last);
  }
  fill("email", "email", lead.email);
  if (lead.phone && !samePhone(cur.phone, lead.phone) && !samePhone(cur.mobilephone, lead.phone)) {
    if (!cur.phone?.trim() || mayOverwrite("phone", opts)) p.phone = lead.phone;
    else if (!cur.mobilephone?.trim()) p.mobilephone = lead.phone;
  }
  fill("company", "company", lead.company);
  return p;
}

function recordUrl(conn: CrmConnection, id: string): string | undefined {
  const portal = conn.metadata.portal_id;
  return portal ? `https://app.hubspot.com/contacts/${portal}/record/0-1/${id}` : undefined;
}

export async function pushToHubSpot(conn: CrmConnection, lead: CrmLead, opts: PushOptions): Promise<PushResult> {
  const { budget } = opts;
  try {
    let existing: HsContact | null = null;
    if (opts.knownRecord?.id) existing = await getById(conn.token, opts.knownRecord.id, budget);
    if (!existing && opts.previousEmail && opts.previousEmail.toLowerCase() !== (lead.email ?? "").toLowerCase()) {
      existing = await findByEmail(conn.token, opts.previousEmail, budget);
    }
    if (!existing && lead.email) existing = await findByEmail(conn.token, lead.email, budget);
    if (!existing && !lead.email && lead.phone) existing = await findByPhone(conn.token, lead.phone, budget);

    let id: string | undefined;
    let action: "created" | "updated" = "updated";

    if (existing) {
      const props = updateProps(existing.properties, lead, opts);
      if (Object.keys(props).length) {
        const res = await crmFetch(`${CONTACTS}/${existing.id}`, { method: "PATCH", headers: headers(conn.token), body: JSON.stringify({ properties: props }) }, budget);
        if (!res.ok) return pushFailure(LABEL, res.status, await errorDetail(res));
      }
      id = existing.id;
    } else {
      const res = await crmFetch(CONTACTS, { method: "POST", headers: headers(conn.token), body: JSON.stringify({ properties: createProps(lead) }) }, budget);
      if (res.ok) {
        id = ((await res.json()) as { id?: string }).id;
        action = "created";
      } else if (res.status === 409 && lead.email) {
        // HubSpot's own unique-email check caught a contact our search missed
        // (its index lags a few seconds behind a create). Read it by email
        // and update it like any other match.
        const byEmail = await crmFetch(`${CONTACTS}/${encodeURIComponent(lead.email)}?idProperty=email&properties=${PROPS.join(",")}`, { headers: headers(conn.token) }, budget);
        if (!byEmail.ok) return pushFailure(LABEL, byEmail.status, await errorDetail(byEmail));
        const found = (await byEmail.json()) as HsContact;
        const props = updateProps(found.properties, lead, opts);
        if (Object.keys(props).length) {
          const upd = await crmFetch(`${CONTACTS}/${found.id}`, { method: "PATCH", headers: headers(conn.token), body: JSON.stringify({ properties: props }) }, budget);
          if (!upd.ok) return pushFailure(LABEL, upd.status, await errorDetail(upd));
        }
        id = found.id;
      } else {
        return pushFailure(LABEL, res.status, await errorDetail(res));
      }
    }

    // Always on a record we just created (a first send from an edit is still
    // its first appearance in HubSpot); on an existing one only for a capture
    // or an edit that changed what the note says.
    if (id && (action === "created" || shouldAttachNote(opts))) await attachContextNote(conn.token, id, lead, budget);
    return { ok: true, action, recordId: id, recordKind: "contact", recordUrl: id ? recordUrl(conn, id) : undefined };
  } catch (e) {
    if (e instanceof Unauthorized) return pushFailure(LABEL, e.status);
    if (e instanceof CrmNoAnswerError) return pushFailure(LABEL, null);
    throw e;
  }
}

// The capture context as a HubSpot Note, associated to the contact.
// Association type 202 is HubSpot's standard note→contact link. Best-effort:
// the contact is saved, and a lost note must not report the sync as failed.
async function attachContextNote(token: string, contactId: string, lead: CrmLead, budget: CrmBudget): Promise<void> {
  const note = describeCapture(lead);
  if (!note) return;
  try {
    const res = await crmFetch(`${API}/crm/v3/objects/notes`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({
        properties: { hs_note_body: note, hs_timestamp: new Date().toISOString() },
        associations: [{ to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }] }],
      }),
    }, budget);
    if (!res.ok) console.warn("[sync-hubspot] note failed:", res.status, await errorDetail(res));
  } catch { /* note is a bonus, never a failure */ }
}

export const hubspotProvider: CrmProvider = { key: "hubspot", label: LABEL, push: pushToHubSpot };

export function syncLeadToHubSpot(lead: CrmLead, capturedBy: string, opts?: CrmSyncOptions): Promise<SyncOutcome> {
  return runCrmSync(hubspotProvider, lead, capturedBy, opts);
}
