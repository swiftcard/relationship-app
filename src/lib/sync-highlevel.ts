import {
  describeCapture,
  shouldAttachNote,
  mayOverwrite,
  pushFailure,
  splitName,
  samePhone,
  type ContactField,
  type CrmLead,
  type CrmConnection,
  type CrmProvider,
  type PushOptions,
  type PushResult,
  type CrmSyncOptions,
} from "./crm-connection";
import { crmFetch, errorDetail, CrmNoAnswerError, type CrmBudget } from "./crm-http";
import { runCrmSync, type SyncOutcome } from "./crm-run";
import { isCrmVisibleTag } from "./lead-tags";

// ── HighLevel (GoHighLevel) ──────────────────────────────────────────────────
//
// Connected with a Private Integration token the user creates in their own
// account (Settings → Private Integrations), scoped to contacts.write. Static
// token, no OAuth app, so nothing waits on marketplace review.
//
// TWO values are needed, not one. A Private Integration token is NOT implicitly
// scoped to a sub-account — HighLevel requires locationId on every request — so
// the connect form asks for the Location ID as well. Both are validated
// together on save.
//
// Finding the contact: the record we wrote last time (crm_links), then
// HighLevel's own duplicate lookup by email, then by phone. A contact found
// that way is UPDATED with only blanks filled (a rep's edits in HighLevel win).
// Only when nothing matches is /contacts/upsert used to create — upsert still
// honours the location's "Allow Duplicate Contact" preference, so two captures
// racing each other land on one record.

const HL_BASE = "https://services.leadconnectorhq.com";
// HighLevel requires an explicit API version header on every request; without
// it the call is rejected outright.
const HL_VERSION = "2021-07-28";
const LABEL = "HighLevel";

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Version: HL_VERSION,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export type HighLevelCheck = "ok" | "missing_scope" | "rejected";

/**
 * Confirm a token + location pair really work together, before storing them.
 *
 * Validating the PAIR matters: a valid token with someone else's location id
 * would otherwise be accepted here and then fail on every single lead.
 *
 * Private Integration scopes are independent — contacts.write does NOT grant
 * any read — so no single call is guaranteed to be allowed. Reading the
 * sub-account needs locations.readonly; listing one contact of it needs
 * contacts.readonly. Either one proves the token reaches that location, so
 * both are tried. When both are refused for SCOPE rather than for a bad token,
 * the user is told exactly which box to tick instead of "check your token",
 * which sent people round in circles with a token that was fine.
 */
export async function checkHighLevelConnection(token: string, locationId: string): Promise<HighLevelCheck> {
  let scopeRefused = false;
  const attempt = async (url: string): Promise<boolean> => {
    try {
      const res = await crmFetch(url, { headers: headers(token) });
      if (res.ok) return true;
      const text = await res.text().catch(() => "");
      if ((res.status === 401 || res.status === 403) && /scope/i.test(text)) scopeRefused = true;
      return false;
    } catch {
      return false;
    }
  };
  if (await attempt(`${HL_BASE}/locations/${encodeURIComponent(locationId)}`)) return "ok";
  if (await attempt(`${HL_BASE}/contacts/?locationId=${encodeURIComponent(locationId)}&limit=1`)) return "ok";
  return scopeRefused ? "missing_scope" : "rejected";
}

type HlContact = {
  id?: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
};

class Unauthorized extends Error {
  constructor(public status: number) { super(String(status)); }
}

async function getContact(token: string, id: string, budget: CrmBudget): Promise<HlContact | null> {
  const res = await crmFetch(`${HL_BASE}/contacts/${encodeURIComponent(id)}`, { headers: headers(token) }, budget);
  if (res.status === 401) throw new Unauthorized(401);
  if (!res.ok) return null;
  return ((await res.json()) as { contact?: HlContact }).contact ?? null;
}

/** HighLevel's own "is there already a contact with this email / number" lookup. */
async function findDuplicate(token: string, locationId: string, by: "email" | "number", value: string, budget: CrmBudget): Promise<HlContact | null> {
  const res = await crmFetch(
    `${HL_BASE}/contacts/search/duplicate?locationId=${encodeURIComponent(locationId)}&${by}=${encodeURIComponent(value)}`,
    { headers: headers(token) },
    budget,
  );
  if (res.status === 401) throw new Unauthorized(401);
  // A token granted only contacts.write can't read — fall through to upsert,
  // which still deduplicates on HighLevel's side.
  if (!res.ok) return null;
  return ((await res.json()) as { contact?: HlContact | null }).contact ?? null;
}

/** What to change on a contact HighLevel already has — blanks, plus what the owner just edited. */
function updateBody(cur: HlContact, lead: CrmLead, opts: CrmSyncOptions): Record<string, string> {
  const b: Record<string, string> = {};
  const fill = (field: ContactField, key: keyof HlContact, value: string | null | undefined) => {
    if (!value) return;
    const now = (cur[key] ?? "").toString();
    if ((!now.trim() || mayOverwrite(field, opts)) && now !== value) b[key] = value;
  };
  const { first, last } = splitName(lead.name);
  if (mayOverwrite("name", opts)) {
    b.firstName = first;
    b.lastName = last ?? "";
  } else {
    fill("name", "firstName", first);
    fill("name", "lastName", last);
  }
  fill("email", "email", lead.email);
  if (lead.phone && !samePhone(cur.phone, lead.phone)) fill("phone", "phone", lead.phone);
  fill("company", "companyName", lead.company);
  return b;
}

export async function pushToHighLevel(conn: CrmConnection, lead: CrmLead, opts: PushOptions): Promise<PushResult> {
  const { budget } = opts;
  const locationId = typeof conn.metadata.location_id === "string" ? conn.metadata.location_id : "";
  if (!locationId) {
    return { ok: false, status: 400, retryable: false, message: `Reconnect ${LABEL} — the sub-account it points at is missing.` };
  }
  try {
    let existing: HlContact | null = null;
    if (opts.knownRecord?.id) existing = await getContact(conn.token, opts.knownRecord.id, budget);
    if (!existing && opts.previousEmail && opts.previousEmail.toLowerCase() !== (lead.email ?? "").toLowerCase()) {
      existing = await findDuplicate(conn.token, locationId, "email", opts.previousEmail, budget);
    }
    if (!existing && lead.email) existing = await findDuplicate(conn.token, locationId, "email", lead.email, budget);
    if (!existing && lead.phone) existing = await findDuplicate(conn.token, locationId, "number", lead.phone, budget);

    let contactId: string | undefined;
    let created = false;

    if (existing?.id) {
      contactId = existing.id;
      const body = updateBody(existing, lead, opts);
      if (Object.keys(body).length) {
        // PUT /contacts/{id} — WITHOUT tags: that field replaces every tag the
        // customer's own pipeline put on them. Tags are added separately below.
        const res = await crmFetch(`${HL_BASE}/contacts/${encodeURIComponent(existing.id)}`, { method: "PUT", headers: headers(conn.token), body: JSON.stringify(body) }, budget);
        if (!res.ok) return pushFailure(LABEL, res.status, await errorDetail(res));
      }
    } else {
      const { first, last } = splitName(lead.name);
      // source is a first-class HighLevel field. NO tags here either:
      // HighLevel documents that field as "will overwrite all current tags".
      const body: Record<string, unknown> = {
        locationId,
        firstName: first,
        ...(last ? { lastName: last } : {}),
        ...(lead.email ? { email: lead.email } : {}),
        ...(lead.phone ? { phone: lead.phone } : {}),
        ...(lead.company ? { companyName: lead.company } : {}),
        source: lead.source ? `SwiftCard – ${lead.source}` : "SwiftCard",
      };
      // 401 here is most often a rotated token; 403 a missing contacts.write
      // scope. Both fail every lead until someone reconnects.
      const res = await crmFetch(`${HL_BASE}/contacts/upsert`, { method: "POST", headers: headers(conn.token), body: JSON.stringify(body) }, budget);
      if (!res.ok) return pushFailure(LABEL, res.status, await errorDetail(res));
      const payload = (await res.json().catch(() => ({}))) as { contact?: { id?: string }; id?: string; new?: boolean };
      contactId = payload?.contact?.id ?? payload?.id;
      // Only HighLevel knows whether upsert matched someone (its duplicate
      // rules can be wider than our lookups). A note goes on when it says
      // the contact is new, so an edit never stacks one on an old record.
      created = payload?.new === true;
    }

    if (contactId) {
      // Tags are what fire the customer's own workflows — welcome text,
      // pipeline placement, task assignment. Additive only, and never our
      // internal markers ("unread", the sample contact's "demo").
      const tags = [
        "swiftcard",
        ...(lead.capturedByCard ? [`swiftcard-${lead.capturedByCard}`] : []),
        ...(lead.tags ?? []).filter(isCrmVisibleTag),
      ];
      try {
        const t = await crmFetch(`${HL_BASE}/contacts/${encodeURIComponent(contactId)}/tags`, { method: "POST", headers: headers(conn.token), body: JSON.stringify({ tags }) }, budget);
        if (!t.ok) console.warn("[sync-highlevel] add tags failed:", t.status, await errorDetail(t));
      } catch { /* logged above when it answers at all */ }

      // The capture context as a note: always on a new contact, and on an
      // existing one when this is a capture or the edit changed what a note
      // says. Best-effort — the contact itself is saved.
      const note = describeCapture(lead);
      if (note && (created || shouldAttachNote(opts))) {
        try {
          const n = await crmFetch(`${HL_BASE}/contacts/${encodeURIComponent(contactId)}/notes`, { method: "POST", headers: headers(conn.token), body: JSON.stringify({ body: note }) }, budget);
          if (!n.ok) console.warn("[sync-highlevel] note failed:", n.status, await errorDetail(n));
        } catch { /* bonus */ }
      }
    }

    return {
      ok: true,
      action: created ? "created" : "updated",
      recordId: contactId,
      recordKind: "contact",
      recordUrl: contactId ? `https://app.gohighlevel.com/v2/location/${encodeURIComponent(locationId)}/contacts/detail/${encodeURIComponent(contactId)}` : undefined,
    };
  } catch (e) {
    if (e instanceof Unauthorized) return pushFailure(LABEL, e.status);
    if (e instanceof CrmNoAnswerError) return pushFailure(LABEL, null);
    throw e;
  }
}

export const highlevelProvider: CrmProvider = { key: "highlevel", label: LABEL, push: pushToHighLevel };

export function syncLeadToHighLevel(lead: CrmLead, capturedBy: string, opts?: CrmSyncOptions): Promise<SyncOutcome> {
  return runCrmSync(highlevelProvider, lead, capturedBy, opts);
}
