import {
  describeCapture,
  shouldAttachNote,
  mayOverwrite,
  pushFailure,
  samePhone,
  phoneDigits,
  type CrmLead,
  type CrmConnection,
  type CrmProvider,
  type PushOptions,
  type PushResult,
  type CrmSyncOptions,
} from "./crm-connection";
import { crmFetch, errorDetail, CrmNoAnswerError, type CrmBudget } from "./crm-http";
import { runCrmSync, type SyncOutcome } from "./crm-run";

// ── Pipedrive ────────────────────────────────────────────────────────────────
//
// Connected with a personal API token the user pastes (Settings → Personal
// preferences → API). No OAuth app, so nothing here waits on Pipedrive's
// marketplace review.
//
// Two API versions on purpose, and both are current:
//   • Persons  → /api/v2/persons. v1 Persons is being SUNSET, so v2 is the only
//     correct target. v2 also requires the x-api-token HEADER — it does not
//     accept the old ?api_token= query parameter, which keeps the token out of
//     request URLs and logs.
//   • Notes    → /v1/notes. Notes is explicitly NOT in Pipedrive's deprecation
//     list and has no v2 equivalent, so v1 is right here rather than legacy.
//
// The note is what makes this worth having. A Person row holds name, email and
// phone — the same thing any generic connector produces. The note carries where
// you met, how the card was tapped and which rep captured it, on the timeline a
// salesperson actually reads before calling back.

const LABEL = "Pipedrive";
// Fallback host. The company-specific domain is discovered on connect and kept
// in metadata; this is only used if that lookup never ran.
const DEFAULT_HOST = "https://api.pipedrive.com";

/**
 * The account's own API host — only ever a pipedrive.com one. The value comes
 * from Pipedrive at connect time, but it is still a stored string that every
 * request (token included) is sent to, so it is checked like any other host
 * we'd hand a credential to.
 */
export function pipedriveHost(metadata: Record<string, unknown>): string {
  const raw = typeof metadata.api_domain === "string" ? metadata.api_domain.trim() : "";
  if (!raw) return DEFAULT_HOST;
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    if (u.protocol === "https:" && (u.hostname === "pipedrive.com" || u.hostname.endsWith(".pipedrive.com"))) {
      return `https://${u.hostname}`;
    }
  } catch { /* fall through */ }
  return DEFAULT_HOST;
}

/** Look up the account's own API host. Returns null if the token is bad. */
export async function fetchPipedriveDomain(token: string): Promise<string | null> {
  try {
    const res = await crmFetch(`${DEFAULT_HOST}/v1/users/me`, { headers: { "x-api-token": token } });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { company_domain?: string } };
    const domain = body?.data?.company_domain;
    return domain ? `https://${domain}.pipedrive.com` : null;
  } catch {
    return null;
  }
}

type PdContact = { value?: string; primary?: boolean; label?: string };
type PdPerson = { id?: number; name?: string; emails?: PdContact[]; phones?: PdContact[]; org_id?: number | null };

class Unauthorized extends Error {
  constructor(public status: number) { super(String(status)); }
}

async function getPerson(host: string, token: string, id: number | string, budget: CrmBudget): Promise<PdPerson | null> {
  const res = await crmFetch(`${host}/api/v2/persons/${encodeURIComponent(String(id))}`, { headers: { "x-api-token": token } }, budget);
  if (res.status === 401) throw new Unauthorized(401);
  if (!res.ok) return null;
  const p = (await res.json()) as { data?: PdPerson };
  return p?.data?.id ? p.data : null;
}

type SearchItem = { item?: { id?: number; emails?: string[]; phones?: string[] } };

async function searchPersons(host: string, token: string, field: "email" | "phone", term: string, exact: boolean, budget: CrmBudget): Promise<SearchItem[]> {
  const res = await crmFetch(
    `${host}/api/v2/persons/search?term=${encodeURIComponent(term)}&fields=${field}${exact ? "&exact_match=true" : ""}&limit=10`,
    { headers: { "x-api-token": token } },
    budget,
  );
  if (res.status === 401) throw new Unauthorized(401);
  if (!res.ok) return [];
  return ((await res.json()) as { data?: { items?: SearchItem[] } })?.data?.items ?? [];
}

/**
 * The person already in Pipedrive with this email, or null. Without this every
 * repeat capture minted a second Person — meet someone at two events and the
 * pipeline has two of them, each with half the history. Exact match only.
 */
async function findByEmail(host: string, token: string, email: string, budget: CrmBudget): Promise<PdPerson | null> {
  const id = (await searchPersons(host, token, "email", email, true, budget))[0]?.item?.id;
  // The search hit carries bare strings; the update needs the full entries
  // (labels, which one is primary) so nothing the salesperson set is lost.
  return id ? (await getPerson(host, token, id, budget)) ?? { id } : null;
}

/** Same, for a contact who left no email — matched on the number's digits. */
async function findByPhone(host: string, token: string, phone: string, budget: CrmBudget): Promise<PdPerson | null> {
  const d = phoneDigits(phone);
  if (d.length < 7) return null;
  const hits = await searchPersons(host, token, "phone", d.slice(-7), false, budget);
  const id = hits.find((h) => h.item?.phones?.some((p) => samePhone(p, phone)))?.item?.id;
  return id ? (await getPerson(host, token, id, budget)) ?? { id } : null;
}

const headers = (token: string) => ({ "x-api-token": token, "Content-Type": "application/json" });

/**
 * Link the company as a real Organization, not just a line in the note — that
 * is what makes the person filterable by company and lets deals attach to the
 * org. Find an exact-name match first so ten leads from Acme share ONE org
 * row; create it if this is the first. Best-effort: a person without an org
 * link is still a synced lead.
 */
async function orgIdFor(host: string, token: string, company: string, budget: CrmBudget): Promise<number | undefined> {
  try {
    const name = company.trim();
    const found = await crmFetch(`${host}/api/v2/organizations/search?term=${encodeURIComponent(name)}&exact_match=true&limit=1`, { headers: { "x-api-token": token } }, budget);
    if (found.ok) {
      const id = ((await found.json()) as { data?: { items?: { item?: { id?: number } }[] } })?.data?.items?.[0]?.item?.id;
      if (id) return id;
    }
    const made = await crmFetch(`${host}/api/v2/organizations`, { method: "POST", headers: headers(token), body: JSON.stringify({ name }) }, budget);
    if (made.ok) return ((await made.json()) as { data?: { id?: number } })?.data?.id;
  } catch { /* org link is a bonus, never a failure */ }
  return undefined;
}

function listWith(existing: PdContact[] | undefined, value: string | null | undefined, previous: string | null | undefined, replace: boolean, same: (a?: string, b?: string | null) => boolean, label: string): PdContact[] | undefined {
  const list = [...(existing ?? [])];
  if (!value) return existing ? list : undefined;
  if (list.some((e) => same(e.value, value))) return list;
  // An edit that CHANGED this value replaces the old entry in place, keeping
  // its label and primary flag; anything else is added alongside.
  const i = replace && previous ? list.findIndex((e) => same(e.value, previous)) : -1;
  if (i >= 0) list[i] = { ...list[i], value };
  else list.push({ value, primary: list.length === 0, label });
  return list;
}

const sameEmail = (a?: string, b?: string | null) => (a ?? "").toLowerCase() === (b ?? "").toLowerCase();

export async function pushToPipedrive(conn: CrmConnection, lead: CrmLead, opts: PushOptions): Promise<PushResult> {
  const { budget } = opts;
  const host = pipedriveHost(conn.metadata);
  try {
    let existing: PdPerson | null = null;
    if (opts.knownRecord?.id) existing = await getPerson(host, conn.token, opts.knownRecord.id, budget);
    if (!existing && opts.previousEmail && !sameEmail(opts.previousEmail, lead.email)) existing = await findByEmail(host, conn.token, opts.previousEmail, budget);
    if (!existing && lead.email) existing = await findByEmail(host, conn.token, lead.email, budget);
    if (!existing && !lead.email && lead.phone) existing = await findByPhone(host, conn.token, lead.phone, budget);

    const person: Record<string, unknown> = {};
    if (existing?.id) {
      // v2 replaces a person's emails/phones LISTS wholesale, so send what they
      // already have plus ours — a desk line someone added by hand survives.
      if (!existing.name?.trim() || mayOverwrite("name", opts)) person.name = lead.name;
      const emails = listWith(existing.emails, lead.email, opts.previousEmail, mayOverwrite("email", opts), sameEmail, "work");
      if (emails) person.emails = emails;
      const phones = listWith(existing.phones, lead.phone, opts.previousPhone, mayOverwrite("phone", opts), (a, b) => samePhone(a, b), "mobile");
      if (phones) person.phones = phones;
      // A person already linked to an org keeps it — a rep may have linked
      // them to the parent company on purpose — unless the owner just changed
      // the company in SwiftCard.
      if (lead.company?.trim() && (!existing.org_id || mayOverwrite("company", opts))) {
        const orgId = await orgIdFor(host, conn.token, lead.company, budget);
        if (orgId) person.org_id = orgId;
      }
    } else {
      person.name = lead.name;
      if (lead.email) person.emails = [{ value: lead.email, primary: true, label: "work" }];
      if (lead.phone) person.phones = [{ value: lead.phone, primary: true, label: "mobile" }];
      if (lead.company?.trim()) {
        const orgId = await orgIdFor(host, conn.token, lead.company, budget);
        if (orgId) person.org_id = orgId;
      }
    }

    const res = existing?.id
      ? await crmFetch(`${host}/api/v2/persons/${existing.id}`, { method: "PATCH", headers: headers(conn.token), body: JSON.stringify(person) }, budget)
      : await crmFetch(`${host}/api/v2/persons`, { method: "POST", headers: headers(conn.token), body: JSON.stringify(person) }, budget);

    // 401/403 here usually means the token was regenerated (Pipedrive allows
    // only ONE active token per user, so creating a new one silently kills
    // ours) or an admin switched off API access for that permission set.
    if (!res.ok) return pushFailure(LABEL, res.status, await errorDetail(res));

    const personId = ((await res.json().catch(() => ({}))) as { data?: { id?: number } })?.data?.id ?? existing?.id;

    // Attach the capture context: always to a new person, and to an existing
    // one when this sync is a capture or the edit changed what a note says.
    // Best-effort — losing the note is far better than reporting the whole
    // sync as failed and sending someone to reconnect a connection that works.
    const note = describeCapture(lead);
    if (personId && note && (!existing?.id || shouldAttachNote(opts))) {
      try {
        const n = await crmFetch(`${host}/v1/notes`, { method: "POST", headers: headers(conn.token), body: JSON.stringify({ person_id: personId, content: note }) }, budget);
        if (!n.ok) console.warn("[sync-pipedrive] note failed:", n.status, await errorDetail(n));
      } catch { /* note is a bonus, never a failure */ }
    }

    return {
      ok: true,
      action: existing?.id ? "updated" : "created",
      recordId: personId ? String(personId) : undefined,
      recordKind: "person",
      recordUrl: personId && host !== DEFAULT_HOST ? `${host}/person/${personId}` : undefined,
    };
  } catch (e) {
    if (e instanceof Unauthorized) return pushFailure(LABEL, e.status);
    if (e instanceof CrmNoAnswerError) return pushFailure(LABEL, null);
    throw e;
  }
}

export const pipedriveProvider: CrmProvider = { key: "pipedrive", label: LABEL, push: pushToPipedrive };

export function syncLeadToPipedrive(lead: CrmLead, capturedBy: string, opts?: CrmSyncOptions): Promise<SyncOutcome> {
  return runCrmSync(pipedriveProvider, lead, capturedBy, opts);
}
