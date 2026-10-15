import {
  describeCapture,
  mayOverwrite,
  pushFailure,
  splitName,
  samePhone,
  phoneDigits,
  CAPTURE_NOTE_SIGNATURE,
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

const SF_TOKEN_URL = "https://login.salesforce.com/services/oauth2/token";
const SF_API = "/services/data/v62.0";
const LABEL = "Salesforce";

/** Every API call goes to the org's own host — accept only Salesforce's (SSRF). */
export function isSalesforceInstanceUrl(url: unknown): boolean {
  if (typeof url !== "string") return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (
      u.hostname.endsWith(".salesforce.com") || u.hostname.endsWith(".my.salesforce.com")
    );
  } catch {
    return false;
  }
}

// Leads arrive as Salesforce LEADS — the object sales teams already route,
// assign and work — with LeadSource "SwiftCard" and the full capture context
// in Description (where met, location, capture channel, the capturing card's
// URL and rep, tags, their message). Standard fields ONLY: the HubSpot
// lesson — writing a field an org hasn't defined 400s every sync.
//
// Salesforce requires LastName and Company on a NEW Lead. A person sharing
// just "Maya" from a card with no company must still land: LastName falls back
// to the whole name, Company to the person's name — never a hard failure over
// a sparse capture. Those fallbacks are for creation only.
//
// Finding the person: the record we wrote last time (crm_links) → an open
// Lead with this email → an existing CONTACT with this email (someone already
// a customer, who was never a Lead) → with no email, any Lead or Contact with
// this phone number. A converted Lead is followed to the Contact it became:
// Salesforce rejects every write to a converted Lead
// (CANNOT_UPDATE_CONVERTED_LEAD), which used to raise a permanent banner for
// one returning customer.
//
// Meeting an existing Contact again is logged as a completed Task on them —
// the rep sees they met again, and no duplicate Lead is created for a customer.

// Standard-field lengths. A longer value 400s the whole write (STRING_TOO_LONG).
const MAX = { FirstName: 40, LastName: 80, Company: 255, Email: 80, Phone: 40, Description: 32000 } as const;
const clip = (v: string, n: number) => (v.length > n ? v.slice(0, n) : v);

/** A SOQL string literal: backslash escaped BEFORE the quote, or a trailing "\\" would neutralise the closing quote's escape. */
export const soqlString = (v: string) => `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

type SfRecord = {
  Id?: string;
  attributes?: { type?: string };
  IsConverted?: boolean;
  ConvertedContactId?: string | null;
  FirstName?: string | null;
  LastName?: string | null;
  Company?: string | null;
  Email?: string | null;
  Phone?: string | null;
  MobilePhone?: string | null;
  Description?: string | null;
};
type Found = { kind: "Lead" | "Contact"; rec: SfRecord };

const LEAD_FIELDS = "Id, IsConverted, ConvertedContactId, FirstName, LastName, Company, Email, Phone, MobilePhone, Description";
const CONTACT_FIELDS = "Id, FirstName, LastName, Email, Phone, MobilePhone, Description";

class Unauthorized extends Error {
  constructor(public status: number) { super(String(status)); }
}

type Ctx = { base: string; headers: Record<string, string>; budget: CrmBudget };

async function getJson<T>(ctx: Ctx, path: string): Promise<T | null> {
  const res = await crmFetch(`${ctx.base}${SF_API}${path}`, { headers: ctx.headers }, ctx.budget);
  // 403 is how an org without API access (Professional Edition) or a session
  // without the api scope answers — a connection problem, same as 401.
  if (res.status === 401 || res.status === 403) throw new Unauthorized(res.status);
  if (!res.ok) return null;
  return (await res.json()) as T;
}

async function query(ctx: Ctx, soql: string): Promise<SfRecord[]> {
  return (await getJson<{ records?: SfRecord[] }>(ctx, `/query?q=${encodeURIComponent(soql)}`))?.records ?? [];
}

async function byId(ctx: Ctx, kind: string | null, id: string): Promise<Found | null> {
  const k = kind === "contact" ? "Contact" : "Lead";
  const rec = await getJson<SfRecord>(ctx, `/sobjects/${k}/${encodeURIComponent(id)}?fields=${encodeURIComponent((k === "Lead" ? LEAD_FIELDS : CONTACT_FIELDS).replace(/\s/g, ""))}`);
  return rec?.Id ? { kind: k, rec } : null;
}

async function byEmail(ctx: Ctx, email: string): Promise<Found | null> {
  const lead = (await query(ctx, `SELECT ${LEAD_FIELDS} FROM Lead WHERE Email = ${soqlString(email)} ORDER BY IsConverted ASC, CreatedDate DESC LIMIT 1`))[0];
  if (lead?.Id) return { kind: "Lead", rec: lead };
  const contact = (await query(ctx, `SELECT ${CONTACT_FIELDS} FROM Contact WHERE Email = ${soqlString(email)} ORDER BY CreatedDate DESC LIMIT 1`))[0];
  return contact?.Id ? { kind: "Contact", rec: contact } : null;
}

/**
 * SOSL searches phone fields by their digits whatever the formatting, which a
 * SOQL equality on Phone can't. Digits only in the search term, so nothing in
 * it needs SOSL escaping.
 */
async function byPhone(ctx: Ctx, phone: string): Promise<Found | null> {
  let d = phoneDigits(phone);
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length < 7) return null;
  const sosl = `FIND {${d}} IN PHONE FIELDS RETURNING Lead(${LEAD_FIELDS} WHERE IsConverted = false), Contact(${CONTACT_FIELDS}) LIMIT 5`;
  const res = await getJson<{ searchRecords?: SfRecord[] }>(ctx, `/search?q=${encodeURIComponent(sosl)}`);
  const hit = (res?.searchRecords ?? []).find((r) => samePhone(r.Phone, phone) || samePhone(r.MobilePhone, phone));
  if (!hit?.Id) return null;
  return { kind: hit.attributes?.type === "Contact" ? "Contact" : "Lead", rec: hit };
}

/** Blanks filled; a value someone set in Salesforce replaced only when the owner just changed it. */
function patchFields(found: Found, lead: CrmLead, note: string | null, opts: CrmSyncOptions): Record<string, string> {
  const cur = found.rec;
  const f: Record<string, string> = {};
  const fill = (field: ContactField, key: keyof SfRecord, value: string | null | undefined, max: number) => {
    if (!value) return;
    const now = (cur[key] ?? "").toString();
    const v = clip(value, max);
    if ((!now.trim() || mayOverwrite(field, opts)) && now !== v) f[key] = v;
  };
  if (mayOverwrite("name", opts)) {
    // A one-word name clears FirstName rather than doubling up: "Maya" must
    // not become "Maya Maya" (FirstName kept, LastName set to the same word).
    const { first, last } = splitName(lead.name);
    f.FirstName = last ? clip(first, MAX.FirstName) : "";
    f.LastName = clip(last ?? (first || "Unknown"), MAX.LastName);
  }
  fill("email", "Email", lead.email, MAX.Email);
  if (lead.phone && !samePhone(cur.Phone, lead.phone) && !samePhone(cur.MobilePhone, lead.phone)) {
    if (!cur.Phone?.trim() || mayOverwrite("phone", opts)) f.Phone = clip(lead.phone, MAX.Phone);
    else if (!cur.MobilePhone?.trim()) f.MobilePhone = clip(lead.phone, MAX.Phone);
  }
  // Contacts have no Company field (they belong to an Account); only a REAL
  // company replaces what a rep has, never the name fallback.
  if (found.kind === "Lead" && lead.company?.trim()) fill("company", "Company", lead.company.trim(), MAX.Company);
  // Description is ours to refresh only while it is empty or still the note we
  // wrote. Once a rep has written in it, it is theirs.
  const desc = (cur.Description ?? "").trim();
  if (note && (!desc || desc.endsWith(CAPTURE_NOTE_SIGNATURE))) f.Description = clip(note, MAX.Description);
  return f;
}

const recordUrl = (base: string, kind: string, id: string) => `${base}/lightning/r/${kind}/${id}/view`;

export async function pushToSalesforce(conn: CrmConnection, lead: CrmLead, opts: PushOptions): Promise<PushResult> {
  const instanceUrl = conn.metadata?.instance_url;
  if (!isSalesforceInstanceUrl(instanceUrl)) {
    return { ok: false, status: 400, retryable: false, message: "Connection is missing its Salesforce org URL — reconnect Salesforce." };
  }
  const base = String(instanceUrl).replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${conn.token}`, "Content-Type": "application/json" };
  const ctx: Ctx = { base, headers, budget: opts.budget };
  // Orgs ship with fuzzy duplicate rules (similar name + company blocks the
  // save with a 400 DUPLICATES_DETECTED) — which drops real leads: two people
  // from the same company scanning the same card LOOK like duplicates. We
  // match exactly ourselves, so tell Salesforce to save anyway.
  const writeHeaders = { ...headers, "Sforce-Duplicate-Rule-Header": "allowSave=true" };
  const note = describeCapture(lead);
  const isCapture = (opts.mode ?? "capture") === "capture";

  try {
    let found: Found | null = null;
    if (opts.knownRecord?.id) found = await byId(ctx, opts.knownRecord.kind, opts.knownRecord.id);
    if (!found && opts.previousEmail && opts.previousEmail.toLowerCase() !== (lead.email ?? "").toLowerCase()) found = await byEmail(ctx, opts.previousEmail);
    if (!found && lead.email) found = await byEmail(ctx, lead.email);
    if (!found && !lead.email && lead.phone) found = await byPhone(ctx, lead.phone);

    // A converted Lead can't be written to — follow it to its Contact.
    if (found?.kind === "Lead" && found.rec.IsConverted) {
      const contactId = found.rec.ConvertedContactId;
      found = contactId ? (await byId(ctx, "contact", contactId)) ?? { kind: "Contact", rec: { Id: contactId } } : null;
      if (!found) return { ok: true, action: "logged" };
    }

    if (found?.rec.Id) {
      const id = found.rec.Id;
      // An existing customer met again: a completed Task on their record is
      // what a rep scans. Their Description is left alone — it is the
      // customer's history, not our capture summary.
      if (found.kind === "Contact" && isCapture && note) {
        const t = await crmFetch(`${base}${SF_API}/sobjects/Task`, {
          method: "POST",
          headers: writeHeaders,
          body: JSON.stringify({
            WhoId: id,
            Subject: "Met again — captured with SwiftCard",
            Status: "Completed",
            ActivityDate: new Date().toISOString().slice(0, 10),
            Description: clip(note, MAX.Description),
          }),
        }, ctx.budget);
        if (!t.ok) console.warn("[sync-salesforce] Met-again task failed:", t.status, await errorDetail(t));
      }
      const fields = patchFields(found, lead, found.kind === "Lead" ? note : null, opts);
      if (Object.keys(fields).length) {
        const res = await crmFetch(`${base}${SF_API}/sobjects/${found.kind}/${id}`, { method: "PATCH", headers: writeHeaders, body: JSON.stringify(fields) }, ctx.budget);
        if (!res.ok && res.status !== 204) return pushFailure(LABEL, res.status, await errorDetail(res));
      }
      return {
        ok: true,
        action: found.kind === "Contact" && isCapture ? "logged" : "updated",
        recordId: id,
        recordKind: found.kind.toLowerCase(),
        recordUrl: recordUrl(base, found.kind, id),
      };
    }

    const { first, last } = splitName(lead.name);
    const fields: Record<string, string> = {
      FirstName: last ? clip(first, MAX.FirstName) : "",
      LastName: clip(last ?? (first || "Unknown"), MAX.LastName),
      Company: clip(lead.company?.trim() || lead.name || "Unknown", MAX.Company),
      LeadSource: "SwiftCard",
    };
    if (lead.email) fields.Email = clip(lead.email, MAX.Email);
    if (lead.phone) fields.Phone = clip(lead.phone, MAX.Phone);
    if (note) fields.Description = clip(note, MAX.Description);
    let res = await crmFetch(`${base}${SF_API}/sobjects/Lead`, { method: "POST", headers: writeHeaders, body: JSON.stringify(fields) }, ctx.budget);
    if (res.status === 400) {
      // Orgs that RESTRICT the Lead Source picklist reject any value they
      // haven't defined — and the whole Lead with it. The lead matters more
      // than the label: save it without one.
      const detail = await errorDetail(res);
      if (/LeadSource|restricted picklist/i.test(detail)) {
        const { LeadSource: _drop, ...rest } = fields;
        void _drop;
        res = await crmFetch(`${base}${SF_API}/sobjects/Lead`, { method: "POST", headers: writeHeaders, body: JSON.stringify(rest) }, ctx.budget);
      } else {
        return pushFailure(LABEL, 400, detail);
      }
    }
    if (!res.ok) return pushFailure(LABEL, res.status, await errorDetail(res));
    const id = ((await res.json().catch(() => ({}))) as { id?: string }).id;
    return { ok: true, action: "created", recordId: id, recordKind: "lead", recordUrl: id ? recordUrl(base, "Lead", id) : undefined };
  } catch (e) {
    if (e instanceof Unauthorized) return pushFailure(LABEL, e.status);
    if (e instanceof CrmNoAnswerError) return pushFailure(LABEL, null);
    throw e;
  }
}

export const salesforceProvider: CrmProvider = {
  key: "salesforce",
  label: LABEL,
  refresh: () => ({ tokenUrl: SF_TOKEN_URL, clientId: process.env.SALESFORCE_CLIENT_ID, clientSecret: process.env.SALESFORCE_CLIENT_SECRET }),
  push: pushToSalesforce,
};

export function syncLeadToSalesforce(lead: CrmLead, capturedBy: string, opts?: CrmSyncOptions): Promise<SyncOutcome> {
  return runCrmSync(salesforceProvider, lead, capturedBy, opts);
}
