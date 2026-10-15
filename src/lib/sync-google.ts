import {
  describeCapture,
  mayOverwrite,
  pushFailure,
  splitName,
  samePhone,
  phoneDigits,
  CAPTURE_NOTE_SIGNATURE,
  type CrmLead,
  type CrmConnection,
  type CrmProvider,
  type PushOptions,
  type PushResult,
  type CrmSyncOptions,
} from "./crm-connection";
import { crmFetch, errorDetail, CrmNoAnswerError, type CrmBudget } from "./crm-http";
import { runCrmSync, type SyncOutcome } from "./crm-run";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const PEOPLE_API = "https://people.googleapis.com/v1";
const LABEL = "Google Contacts";
const READ_MASK = "names,emailAddresses,phoneNumbers,organizations,biographies";

type Person = {
  resourceName?: string;
  etag?: string;
  names?: { givenName?: string; familyName?: string }[];
  emailAddresses?: { value?: string; type?: string }[];
  phoneNumbers?: { value?: string; type?: string }[];
  organizations?: { name?: string; title?: string }[];
  biographies?: { value?: string; contentType?: string }[];
};

class Unauthorized extends Error {
  constructor(public status: number) { super(String(status)); }
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function getPerson(token: string, resourceName: string, budget: CrmBudget): Promise<Person | null> {
  const res = await crmFetch(`${PEOPLE_API}/${resourceName}?personFields=${READ_MASK}`, { headers: auth(token) }, budget);
  if (res.status === 401) throw new Unauthorized(401);
  return res.ok ? ((await res.json()) as Person) : null;
}

/**
 * searchContacts is a prefix search over a CACHE, and Google's own docs say the
 * cache has to be warmed with an empty query before results can be trusted —
 * so the warm-up call is not optional. The cache also lags a new contact by a
 * few minutes, which is why a contact we created is found again by the id we
 * remembered (crm_links), not by searching.
 *
 * Any failure returns no results and the caller creates: a search problem can
 * cost a duplicate, never a lost contact.
 */
async function searchPeople(token: string, query: string, budget: CrmBudget): Promise<Person[]> {
  const url = (q: string) => `${PEOPLE_API}/people:searchContacts?query=${encodeURIComponent(q)}&readMask=${READ_MASK}&pageSize=10`;
  await crmFetch(url(""), { headers: auth(token) }, budget).then((r) => r.body?.cancel()).catch(() => {});
  const res = await crmFetch(url(query), { headers: auth(token) }, budget);
  if (res.status === 401) throw new Unauthorized(401);
  if (!res.ok) return [];
  return (((await res.json()) as { results?: { person?: Person }[] }).results ?? []).map((r) => r.person ?? {});
}

async function findByEmail(token: string, email: string, budget: CrmBudget): Promise<Person | null> {
  const want = email.trim().toLowerCase();
  // Only an EXACT email match counts: a prefix hit on "jo@acme.co" must never
  // update "jo@acme.com".
  return (await searchPeople(token, email, budget)).find((p) =>
    p.emailAddresses?.some((e) => (e.value ?? "").trim().toLowerCase() === want)) ?? null;
}

async function findByPhone(token: string, phone: string, budget: CrmBudget): Promise<Person | null> {
  const d = phoneDigits(phone);
  if (d.length < 7) return null;
  return (await searchPeople(token, d, budget)).find((p) => p.phoneNumbers?.some((n) => samePhone(n.value, phone))) ?? null;
}

/** The contact as it should be after this sync, built on what's already there. */
function mergedPerson(existing: Person, lead: CrmLead, note: string | null, opts: PushOptions): Person {
  const { first, last } = splitName(lead.name);
  const hasName = !!existing.names?.some((n) => n.givenName?.trim() || n.familyName?.trim());
  // Every field named in updatePersonFields is replaced WHOLESALE, so each
  // list is the contact's existing entries plus ours — a second number or a
  // work email someone saved by hand survives.
  const names = hasName && !mayOverwrite("name", opts)
    ? existing.names!
    : [{ ...(existing.names?.[0] ?? {}), givenName: first, familyName: last ?? "" }];

  let emails = [...(existing.emailAddresses ?? [])];
  if (lead.email) {
    const lc = lead.email.toLowerCase();
    const prev = opts.previousEmail?.toLowerCase();
    if (!emails.some((e) => (e.value ?? "").toLowerCase() === lc)) {
      // An edit that CHANGED the email replaces the old entry in place;
      // anything else is added alongside.
      const i = prev && mayOverwrite("email", opts) ? emails.findIndex((e) => (e.value ?? "").toLowerCase() === prev) : -1;
      if (i >= 0) emails[i] = { ...emails[i], value: lead.email };
      else emails = [...emails, { value: lead.email }];
    }
  }

  let phones = [...(existing.phoneNumbers ?? [])];
  if (lead.phone && !phones.some((p) => samePhone(p.value, lead.phone))) {
    const i = opts.previousPhone && mayOverwrite("phone", opts) ? phones.findIndex((p) => samePhone(p.value, opts.previousPhone)) : -1;
    if (i >= 0) phones[i] = { ...phones[i], value: lead.phone };
    else phones = [...phones, { value: lead.phone }];
  }

  const orgs = [...(existing.organizations ?? [])];
  if (lead.company) {
    if (!orgs.length) orgs.push({ name: lead.company });
    else if (!orgs[0].name?.trim() || mayOverwrite("company", opts)) orgs[0] = { ...orgs[0], name: lead.company };
  }

  // Notes are only written when they are EMPTY or ours. Someone's own notes in
  // their address book are theirs; overwriting them to refresh a capture
  // summary would be data loss.
  const currentBio = existing.biographies?.[0]?.value ?? "";
  const bioIsOurs = !currentBio.trim() || currentBio.trim().endsWith(CAPTURE_NOTE_SIGNATURE);
  return {
    etag: existing.etag,
    names,
    emailAddresses: emails,
    phoneNumbers: phones,
    organizations: orgs,
    biographies: note && bioIsOurs ? [{ value: note, contentType: "TEXT_PLAIN" }] : existing.biographies ?? [],
  };
}

const recordUrl = (resourceName: string) => `https://contacts.google.com/person/${resourceName.replace(/^people\//, "")}`;

// Google Contacts is an address book, not a CRM, so the capture context lives
// in the contact's Notes (the People API calls it "biographies").
export async function pushToGoogle(conn: CrmConnection, lead: CrmLead, opts: PushOptions): Promise<PushResult> {
  const { budget } = opts;
  const note = describeCapture(lead);
  try {
    let existing: Person | null = null;
    if (opts.knownRecord?.id) existing = await getPerson(conn.token, opts.knownRecord.id, budget);
    if (!existing && opts.previousEmail && opts.previousEmail.toLowerCase() !== (lead.email ?? "").toLowerCase()) {
      existing = await findByEmail(conn.token, opts.previousEmail, budget);
    }
    if (!existing && lead.email) existing = await findByEmail(conn.token, lead.email, budget);
    if (!existing && !lead.email && lead.phone) existing = await findByPhone(conn.token, lead.phone, budget);

    if (existing?.resourceName && existing.etag) {
      const res = await crmFetch(`${PEOPLE_API}/${existing.resourceName}:updateContact?updatePersonFields=${READ_MASK}`, {
        method: "PATCH",
        headers: { ...auth(conn.token), "Content-Type": "application/json" },
        body: JSON.stringify(mergedPerson(existing, lead, note, opts)),
      }, budget);
      // A VALID token can still be refused — most often because the People API
      // isn't enabled on the Google Cloud project, or the user never granted
      // the contacts scope. Both 403 on every contact until fixed.
      if (!res.ok) return pushFailure(LABEL, res.status, await errorDetail(res));
      return { ok: true, action: "updated", recordId: existing.resourceName, recordKind: "person", recordUrl: recordUrl(existing.resourceName) };
    }

    const { first, last } = splitName(lead.name);
    const body: Record<string, unknown> = { names: [{ givenName: first, ...(last ? { familyName: last } : {}) }] };
    if (lead.email) body.emailAddresses = [{ value: lead.email }];
    if (lead.phone) body.phoneNumbers = [{ value: lead.phone }];
    if (lead.company) body.organizations = [{ name: lead.company }];
    if (note) body.biographies = [{ value: note, contentType: "TEXT_PLAIN" }];
    const res = await crmFetch(`${PEOPLE_API}/people:createContact`, {
      method: "POST",
      headers: { ...auth(conn.token), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, budget);
    if (!res.ok) return pushFailure(LABEL, res.status, await errorDetail(res));
    const created = (await res.json()) as Person;
    return {
      ok: true,
      action: "created",
      recordId: created.resourceName,
      recordKind: "person",
      recordUrl: created.resourceName ? recordUrl(created.resourceName) : undefined,
    };
  } catch (e) {
    if (e instanceof Unauthorized) return pushFailure(LABEL, e.status);
    if (e instanceof CrmNoAnswerError) return pushFailure(LABEL, null);
    throw e;
  }
}

export const googleProvider: CrmProvider = {
  key: "google",
  label: LABEL,
  refresh: () => ({ tokenUrl: GOOGLE_TOKEN_URL, clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }),
  push: pushToGoogle,
};

export function syncLeadToGoogle(lead: CrmLead, capturedBy: string, opts?: CrmSyncOptions): Promise<SyncOutcome> {
  return runCrmSync(googleProvider, lead, capturedBy, opts);
}
