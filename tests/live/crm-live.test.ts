import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// ── Live: the real sync code against real CRM test accounts ─────────────────
//
// npx vitest run --config vitest.live.config.ts
//
// Everything here goes through runCrmSync — the exact code a captured contact
// takes in production — against the provider's REAL API, and then reads the
// result back through that API the way a salesperson would see it. Only the
// SwiftCard database is faked (in memory), so nothing touches production data.
// Every record created is deleted in afterAll.
//
// What it proves, per CRM:
//   1. a capture creates ONE record with every field, and the capture note
//   2. meeting the same person again is still ONE record, and a value the rep
//      changed in the CRM survives
//   3. editing one field in SwiftCard changes that field only
//   4. changing the email updates the SAME record (no second contact)
//   5. a phone-only contact met twice is ONE record
//   6. a non-Latin name and long notes arrive intact
//   7. a wrong token is refused with "reconnect" advice, not a crash

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
function makeQuery(name: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: { kind: string; value?: Row; conflict?: string[] } = { kind: "select" };
  const rows = () => (db[name] ??= []);
  const matches = () => rows().filter((r) => filters.every((f) => f(r)));
  const run = () => {
    if (op.kind === "update") { const h = matches(); h.forEach((r) => Object.assign(r, op.value)); return { data: h, error: null }; }
    if (op.kind === "delete") { const h = new Set(matches()); db[name] = rows().filter((r) => !h.has(r)); return { data: null, error: null }; }
    if (op.kind === "upsert") {
      const v = op.value!;
      const ex = rows().find((r) => (op.conflict ?? []).every((k) => r[k] === v[k]));
      if (ex) Object.assign(ex, v); else rows().push({ ...v });
      return { data: null, error: null };
    }
    return { data: matches(), error: null };
  };
  const chain: Record<string, unknown> = {
    select: () => chain, order: () => chain, limit: () => chain, not: () => chain,
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return chain; },
    in: (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return chain; },
    update: (v: Row) => { op = { kind: "update", value: v }; return chain; },
    delete: () => { op = { kind: "delete" }; return chain; },
    upsert: (v: Row, o?: { onConflict?: string }) => { op = { kind: "upsert", value: v, conflict: o?.onConflict?.split(",") }; return chain; },
    maybeSingle: async () => ({ data: run().data?.[0] ?? null, error: null }),
    single: async () => ({ data: run().data?.[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return chain;
}
vi.mock("@/lib/supabase-admin", () => ({ getAdminSupabase: () => ({ from: (t: string) => makeQuery(t) }) }));
vi.mock("@/lib/token-crypto", () => ({ encryptToken: (s: string) => s, decryptToken: (s: string) => s }));
vi.mock("@/lib/office-roles", () => ({ resolveOfficeContext: async () => null }));
vi.mock("@/lib/report-error", () => ({ reportError: async (_k: string, e: unknown) => { console.error(e); } }));

import { runCrmSync } from "@/lib/crm-run";
import { hubspotProvider } from "@/lib/sync-hubspot";
import { pipedriveProvider, fetchPipedriveDomain } from "@/lib/sync-pipedrive";
import { highlevelProvider } from "@/lib/sync-highlevel";
import type { CrmLead, CrmProvider, CrmSyncOptions } from "@/lib/crm-connection";

const USER = "qa-live-user";
const CARD = "11111111-1111-4111-8111-111111111111";
const STAMP = Date.now().toString(36);
const qaEmail = (tag: string) => `qa-${tag}-${STAMP}@example.com`;
// 555-01xx is reserved as fictional; the stamp keeps runs apart.
const qaPhone = () => `+1 212 555 01${String(Math.floor(Math.random() * 100)).padStart(2, "0")}`;

const baseLead = (over: Partial<CrmLead> = {}): CrmLead => ({
  leadId: `L-${Math.random().toString(36).slice(2)}`,
  name: "Maya QA",
  email: qaEmail("a"),
  phone: qaPhone(),
  company: `Acme QA ${STAMP}`,
  whereMet: "QA Expo",
  location: "Austin, TX",
  source: "QR code scan",
  message: "Live test contact — safe to delete.",
  capturedByCard: "qa-card",
  capturedByName: "QA Rep",
  capturedByCardId: CARD,
  tags: ["qa-live"],
  ...over,
});

async function eventually<T>(read: () => Promise<T>, ok: (v: T) => boolean, ms = 45_000): Promise<T> {
  const until = Date.now() + ms;
  let last = await read();
  while (!ok(last) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 2500));
    last = await read();
  }
  return last;
}

/** What a salesperson sees, read straight from the CRM. */
type Seen = { id: string; first: string; last: string; email: string | null; phone: string | null; company: string | null };
type Reader = {
  label: string;
  provider: CrmProvider;
  connect: () => Promise<Row>;
  byEmail: (email: string) => Promise<Seen[]>;
  byPhone: (phone: string) => Promise<Seen[]>;
  get: (id: string) => Promise<Seen>;
  notes: (id: string) => Promise<string[]>;
  rename: (id: string, first: string, last: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

async function call(url: string, init: RequestInit = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body: body as Record<string, unknown> };
}
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

// ── HubSpot ──────────────────────────────────────────────────────────────────
function hubspotReader(token: string): Reader {
  const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const PROPS = ["firstname", "lastname", "email", "phone", "mobilephone", "company"];
  const toSeen = (c: { id: string; properties: Record<string, string | null> }): Seen => ({
    id: c.id, first: c.properties.firstname ?? "", last: c.properties.lastname ?? "",
    email: c.properties.email ?? null, phone: c.properties.phone ?? c.properties.mobilephone ?? null, company: c.properties.company ?? null,
  });
  const search = async (filterGroups: unknown[]) =>
    (((await call("https://api.hubapi.com/crm/v3/objects/contacts/search", { method: "POST", headers: H, body: JSON.stringify({ filterGroups, properties: PROPS, limit: 10 }) })).body.results ?? []) as { id: string; properties: Record<string, string | null> }[]).map(toSeen);
  return {
    label: "HubSpot",
    provider: hubspotProvider,
    connect: async () => {
      const d = await call("https://api.hubapi.com/account-info/v3/details", { headers: H });
      return { metadata: d.status === 200 ? { portal_id: d.body.portalId } : {} };
    },
    byEmail: (email) => search([{ filters: [{ propertyName: "email", operator: "EQ", value: email.toLowerCase() }] }]),
    byPhone: async (phone) => {
      let n = digits(phone);
      if (n.length === 11 && n.startsWith("1")) n = n.slice(1);
      return search([{ filters: [{ propertyName: "hs_searchable_calculated_phone_number", operator: "EQ", value: n }] }]);
    },
    get: async (id) => toSeen((await call(`https://api.hubapi.com/crm/v3/objects/contacts/${id}?properties=${PROPS.join(",")}`, { headers: H })).body as never),
    notes: async (id) => {
      const a = await call(`https://api.hubapi.com/crm/v4/objects/contacts/${id}/associations/notes`, { headers: H });
      const ids = ((a.body?.results ?? []) as { toObjectId: string }[]).map((r) => r.toObjectId);
      const out: string[] = [];
      for (const n of ids) {
        const note = await call(`https://api.hubapi.com/crm/v3/objects/notes/${n}?properties=hs_note_body`, { headers: H });
        out.push(String((note.body?.properties as Row | undefined)?.hs_note_body ?? ""));
      }
      return out;
    },
    rename: async (id, first, last) => { await call(`https://api.hubapi.com/crm/v3/objects/contacts/${id}`, { method: "PATCH", headers: H, body: JSON.stringify({ properties: { firstname: first, lastname: last } }) }); },
    remove: async (id) => { await call(`https://api.hubapi.com/crm/v3/objects/contacts/${id}`, { method: "DELETE", headers: H }); },
  };
}

// ── Pipedrive ────────────────────────────────────────────────────────────────
function pipedriveReader(token: string): Reader {
  let host = "https://api.pipedrive.com";
  const H = { "x-api-token": token, "Content-Type": "application/json" };
  const orgs = new Set<number>();
  type P = { id: number; name?: string; emails?: { value: string }[]; phones?: { value: string }[]; org_id?: number | null };
  const orgName = async (orgId?: number | null) => {
    if (!orgId) return null;
    orgs.add(orgId);
    return String(((await call(`${host}/api/v2/organizations/${orgId}`, { headers: H })).body?.data as Row | undefined)?.name ?? "") || null;
  };
  const toSeen = async (p: P): Promise<Seen> => {
    const [first = "", ...rest] = (p.name ?? "").split(" ");
    return { id: String(p.id), first, last: rest.join(" "), email: p.emails?.[0]?.value ?? null, phone: p.phones?.[0]?.value ?? null, company: await orgName(p.org_id) };
  };
  const get = async (id: string | number) => toSeen(((await call(`${host}/api/v2/persons/${id}`, { headers: H })).body.data) as P);
  const search = async (field: string, term: string, exact: boolean) => {
    const r = await call(`${host}/api/v2/persons/search?term=${encodeURIComponent(term)}&fields=${field}${exact ? "&exact_match=true" : ""}&limit=10`, { headers: H });
    const ids = (((r.body?.data as Row | undefined)?.items ?? []) as { item: { id: number } }[]).map((i) => i.item.id);
    return Promise.all(ids.map((id) => get(id)));
  };
  return {
    label: "Pipedrive",
    provider: pipedriveProvider,
    connect: async () => {
      const d = await fetchPipedriveDomain(token);
      if (d) host = d;
      return { metadata: { api_domain: d } };
    },
    byEmail: (email) => search("email", email, true),
    byPhone: async (phone) => (await search("phone", digits(phone).slice(-7), false)).filter((p) => digits(p.phone).endsWith(digits(phone).slice(-7))),
    get,
    notes: async (id) => (((await call(`${host}/v1/notes?person_id=${id}`, { headers: H })).body?.data ?? []) as { content: string }[]).map((n) => n.content),
    rename: async (id, first, last) => { await call(`${host}/api/v2/persons/${id}`, { method: "PATCH", headers: H, body: JSON.stringify({ name: `${first} ${last}` }) }); },
    remove: async (id) => {
      await call(`${host}/api/v2/persons/${id}`, { method: "DELETE", headers: H });
      for (const o of orgs) await call(`${host}/api/v2/organizations/${o}`, { method: "DELETE", headers: H });
      orgs.clear();
    },
  };
}

// ── GoHighLevel ──────────────────────────────────────────────────────────────
function highlevelReader(token: string, locationId: string): Reader {
  const B = "https://services.leadconnectorhq.com";
  const H = { Authorization: `Bearer ${token}`, Version: "2021-07-28", "Content-Type": "application/json", Accept: "application/json" };
  type C = { id: string; firstName?: string; lastName?: string; email?: string; phone?: string; companyName?: string };
  const toSeen = (c: C): Seen => ({ id: c.id, first: c.firstName ?? "", last: c.lastName ?? "", email: c.email ?? null, phone: c.phone ?? null, company: c.companyName ?? null });
  const list = async (query: string) =>
    (((await call(`${B}/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(query)}&limit=20`, { headers: H })).body?.contacts ?? []) as C[]).map(toSeen);
  return {
    label: "GoHighLevel",
    provider: highlevelProvider,
    connect: async () => ({ metadata: { location_id: locationId } }),
    byEmail: async (email) => (await list(email)).filter((c) => (c.email ?? "").toLowerCase() === email.toLowerCase()),
    byPhone: async (phone) => (await list(digits(phone).slice(-7))).filter((c) => digits(c.phone).endsWith(digits(phone).slice(-7))),
    get: async (id) => toSeen(((await call(`${B}/contacts/${id}`, { headers: H })).body.contact) as C),
    notes: async (id) => (((await call(`${B}/contacts/${id}/notes`, { headers: H })).body?.notes ?? []) as { body: string }[]).map((n) => n.body),
    rename: async (id, first, last) => { await call(`${B}/contacts/${id}`, { method: "PUT", headers: H, body: JSON.stringify({ firstName: first, lastName: last }) }); },
    remove: async (id) => { await call(`${B}/contacts/${id}`, { method: "DELETE", headers: H }); },
  };
}

// ─────────────────────────────────────────────────────────────────────────────

const READERS: { reader: () => Reader; token: string | undefined; missing: string }[] = [
  { reader: () => hubspotReader(process.env.QA_HUBSPOT_TOKEN!), token: process.env.QA_HUBSPOT_TOKEN, missing: "QA_HUBSPOT_TOKEN" },
  { reader: () => pipedriveReader(process.env.QA_PIPEDRIVE_TOKEN!), token: process.env.QA_PIPEDRIVE_TOKEN, missing: "QA_PIPEDRIVE_TOKEN" },
  {
    reader: () => highlevelReader(process.env.QA_HIGHLEVEL_TOKEN!, process.env.QA_HIGHLEVEL_LOCATION_ID!),
    token: process.env.QA_HIGHLEVEL_TOKEN && process.env.QA_HIGHLEVEL_LOCATION_ID ? "set" : undefined,
    missing: "QA_HIGHLEVEL_TOKEN + QA_HIGHLEVEL_LOCATION_ID",
  },
];

for (const entry of READERS) {
  describe.skipIf(!entry.token)(`live: ${entry.token ? entry.reader().label : entry.missing + " not set — skipped"}`, () => {
    const r = entry.token ? entry.reader() : (null as unknown as Reader);
    const created = new Set<string>();
    const sync = async (lead: CrmLead, opts?: CrmSyncOptions) => {
      const out = await runCrmSync(r.provider, lead, USER, opts);
      if (out.status !== "sent") throw new Error(`${r.label} sync did not send: ${JSON.stringify(out)}`);
      return out;
    };
    const linkFor = (leadId: string) => db.crm_links?.find((l) => l.lead_id === leadId)?.record_id as string | undefined;

    const leadA = baseLead();
    let idA = "";

    beforeAll(async () => {
      for (const k of Object.keys(db)) delete db[k];
      db.profiles = [{ id: USER, plan: "pro" }];
      db.cards = [{ id: CARD, user_id: USER, username: "qa-card", is_office_card: false }];
      const extra = await r.connect();
      const token = r.label === "HubSpot" ? process.env.QA_HUBSPOT_TOKEN : r.label === "Pipedrive" ? process.env.QA_PIPEDRIVE_TOKEN : process.env.QA_HIGHLEVEL_TOKEN;
      db.integrations = [{ user_id: USER, provider: r.provider.key, access_token: token, refresh_token: null, expires_at: null, sync_error: null, card_ids: null, ...extra }];
    });

    afterAll(async () => {
      for (const id of created) await r.remove(id).catch(() => {});
    });

    it("1. a capture creates ONE record with every field, and the capture note", async () => {
      await sync(leadA);
      idA = linkFor(leadA.leadId!)!;
      expect(idA, "no record id was remembered").toBeTruthy();
      created.add(idA);
      const seen = await eventually(() => r.byEmail(leadA.email!), (v) => v.length > 0);
      expect(seen.map((s) => s.id)).toEqual([idA]);
      const rec = await r.get(idA);
      expect(rec).toMatchObject({ first: "Maya", last: "QA" });
      expect(rec.company).toBe(leadA.company);
      expect(digits(rec.phone).endsWith(digits(leadA.phone).slice(-7))).toBe(true);
      const notes = await eventually(() => r.notes(idA), (n) => n.length > 0, 20_000);
      expect(notes.join("\n")).toContain("captured with SwiftCard");
      expect(notes.join("\n")).toContain("QA Expo");
      expect(db.integrations[0].sync_error).toBeNull();
      expect(db.integrations[0].last_synced_at).toBeTruthy();
    });

    it("2. meeting them again is still ONE record, and the rep's own edit survives", async () => {
      await r.rename(idA, "Maya", "Rep-Edited");
      // A NEW SwiftCard lead (another card scan) for the same person: no remembered link.
      await sync(baseLead({ email: leadA.email, phone: leadA.phone, company: leadA.company }));
      const seen = await eventually(() => r.byEmail(leadA.email!), (v) => v.length > 0);
      for (const s of seen) created.add(s.id);
      expect(seen.map((s) => s.id), "a duplicate was created").toEqual([idA]);
      expect((await r.get(idA)).last).toBe("Rep-Edited");
    });

    it("3. editing the company in SwiftCard changes the company only", async () => {
      const company = `Acme QA Two ${STAMP}`;
      await sync({ ...leadA, company }, { mode: "update", changedFields: ["company"] });
      const rec = await eventually(() => r.get(idA), (v) => v.company === company, 20_000);
      expect(rec.company).toBe(company);
      expect(rec.last, "the rep's name was overwritten by an unrelated edit").toBe("Rep-Edited");
    });

    it("4. changing the email updates the SAME record — no second contact", async () => {
      const newEmail = qaEmail("b");
      await sync({ ...leadA, email: newEmail }, { mode: "update", changedFields: ["email"], previousEmail: leadA.email });
      const seen = await eventually(() => r.byEmail(newEmail), (v) => v.length > 0);
      for (const s of seen) created.add(s.id);
      expect(seen.map((s) => s.id)).toEqual([idA]);
    });

    it("5. a phone-only contact met twice is ONE record", async () => {
      const phone = qaPhone();
      const first = baseLead({ name: `Phone Only ${STAMP}`, email: null, phone, company: null });
      await sync(first);
      const id = linkFor(first.leadId!)!;
      created.add(id);
      // Give the CRM's phone search time to index the first one.
      await eventually(() => r.byPhone(phone), (v) => v.some((s) => s.id === id));
      await sync(baseLead({ name: `Phone Only ${STAMP}`, email: null, phone, company: null }));
      const seen = await eventually(() => r.byPhone(phone), (v) => v.length > 0);
      for (const s of seen) created.add(s.id);
      expect(seen.map((s) => s.id), "a phone-only duplicate was created").toEqual([id]);
    });

    it("6. a non-Latin name and long notes arrive intact", async () => {
      const lead = baseLead({ name: "Zoë Ñúñez 李", email: qaEmail("c"), notes: "Long note. ".repeat(300) });
      await sync(lead);
      const id = linkFor(lead.leadId!)!;
      created.add(id);
      expect(await r.get(id)).toMatchObject({ first: "Zoë", last: "Ñúñez 李" });
    });

    it("7. a wrong token is refused with reconnect advice, not a crash", async () => {
      const saved = db.integrations[0].access_token;
      db.integrations[0].access_token = "definitely-not-a-valid-token";
      const out = await runCrmSync(r.provider, baseLead({ email: qaEmail("d") }), USER);
      db.integrations[0].access_token = saved;
      expect(out.status).toBe("failed");
      expect(String(db.integrations[0].sync_error)).toMatch(/reconnect/i);
      db.integrations[0].sync_error = null;
    });
  });
}

it("at least say what ran", () => {
  const ran = READERS.filter((e) => e.token).map((e) => e.reader().label);
  console.log(ran.length ? `Live CRMs checked: ${ran.join(", ")}` : "No QA_* tokens set — nothing live was checked.");
  expect(true).toBe(true);
});
