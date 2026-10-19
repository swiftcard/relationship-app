import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── What every CRM, Google Contacts and Zapier actually receive ─────────────
//
// The integrations were built and pinned by reading source; almost none of it
// had ever run against anything shaped like the real APIs (audit 2026-10-12:
// every CRM/Zapier cell "never verified"). These tests drive the REAL sync
// code — the runner, each provider, the retry queue, the Zapier sender —
// against a fake database and a fake network that answer the way each API
// does, and check the outcome a customer would see: in their CRM (no
// duplicates, nothing of theirs overwritten) and in Settings (the right line,
// or none).
//
// tests/crm-sync-behaviour.test.ts holds the older per-provider cases; this
// file is the contract every provider has to keep.

// ── Fake database ────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
let officeCtx: { officeId: string; ownerId: string; role: string; isOwner: boolean } | null = null;

function table(name: string): Row[] {
  return (db[name] ??= []);
}

function makeQuery(name: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: { kind: "select" | "update" | "upsert" | "insert" | "delete"; value?: Row; conflict?: string[] } = { kind: "select" };
  let limit = Infinity;
  const matches = () => table(name).filter((r) => filters.every((f) => f(r)));
  const run = () => {
    if (op.kind === "update") {
      const hit = matches();
      for (const r of hit) Object.assign(r, op.value);
      return { data: hit, error: null };
    }
    if (op.kind === "delete") {
      const hit = new Set(matches());
      db[name] = table(name).filter((r) => !hit.has(r));
      return { data: [...hit], error: null };
    }
    if (op.kind === "upsert" || op.kind === "insert") {
      const v = op.value!;
      const keys = op.conflict ?? [];
      const existing = keys.length ? table(name).find((r) => keys.every((k) => r[k] === v[k])) : undefined;
      if (existing) Object.assign(existing, v);
      else table(name).push({ id: `${name}-${table(name).length + 1}`, attempts: 0, created_at: new Date().toISOString(), ...v });
      return { data: null, error: null };
    }
    return { data: matches().slice(0, limit), error: null };
  };
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return chain; },
    in: (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return chain; },
    lte: (k: string, v: string) => { filters.push((r) => String(r[k] ?? "") <= v); return chain; },
    not: () => chain,
    order: () => chain,
    limit: (n: number) => { limit = n; return chain; },
    update: (v: Row) => { op = { kind: "update", value: v }; return chain; },
    delete: () => { op = { kind: "delete" }; return chain; },
    upsert: (v: Row, o?: { onConflict?: string }) => { op = { kind: "upsert", value: v, conflict: o?.onConflict?.split(",") }; return chain; },
    insert: (v: Row) => { op = { kind: "insert", value: v }; return chain; },
    maybeSingle: async () => ({ data: run().data?.[0] ?? null, error: null }),
    single: async () => ({ data: run().data?.[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return chain;
}

vi.mock("@/lib/supabase-admin", () => ({ getAdminSupabase: () => ({ from: (t: string) => makeQuery(t) }) }));
vi.mock("@/lib/token-crypto", () => ({ encryptToken: (s: string) => s, decryptToken: (s: string) => s }));
vi.mock("@/lib/office-roles", () => ({ resolveOfficeContext: async () => officeCtx }));
vi.mock("@/lib/report-error", () => ({ reportError: async () => {} }));

import { crmFetch, crmRetry, newCrmBudget, CrmNoAnswerError } from "@/lib/crm-http";
import { connectionErrorMessage, splitName, samePhone, mayOverwrite } from "@/lib/crm-connection";
import { runCrmSync } from "@/lib/crm-run";
import { hubspotProvider } from "@/lib/sync-hubspot";
import { pipedriveProvider, pipedriveHost } from "@/lib/sync-pipedrive";
import { googleProvider } from "@/lib/sync-google";
import { salesforceProvider } from "@/lib/sync-salesforce";
import { highlevelProvider } from "@/lib/sync-highlevel";
import { syncLeadToAllCrms, sendLeadToZapier, resolveZapierTarget, zapierLeadPayload, zapierStatusMessage } from "@/lib/crm-sync";
import { dispatchCrmEvent } from "@/lib/crm-events";
import { drainCrmOutbox } from "@/lib/crm-outbox-drain";
import { loadCrmLead, crmChanges } from "@/lib/crm-lead";
import { isCrmVisibleTag } from "@/lib/lead-tags";
import { dropCardFromScopes } from "@/lib/crm-scope-server";
import { getAdminSupabase } from "@/lib/supabase-admin";

// ── Fake network ─────────────────────────────────────────────────────────────
type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let respond: (url: string, method: string, body: unknown) => Response | Promise<Response>;
const json = (b: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", ...headers } });

const USER = "u1";
const CARD = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  officeCtx = null;
  calls = [];
  crmRetry.delaysMs = [0, 0];
  respond = () => json({});
  table("profiles").push({ id: USER, plan: "pro", zapier_webhook_url: null });
  table("cards").push({ id: CARD, user_id: USER, username: "maya-card", name: "Dana Rep", is_office_card: false });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown;
    try { body = init?.body ? JSON.parse(String(init.body)) : undefined; } catch { body = String(init?.body); }
    calls.push({ url: String(url), method, body });
    return respond(String(url), method, body);
  });
});
afterEach(() => { crmRetry.delaysMs = [1000, 3000]; });

const lead = {
  leadId: "L1",
  name: "Maya Cohen",
  email: "maya@acme.co",
  phone: "+1 555 010 0100",
  company: "Acme",
  source: "QR code",
  capturedByCard: "maya-card",
  capturedByName: "Dana Rep",
  capturedByCardId: CARD,
};

function connect(provider: string, extra: Row = {}) {
  table("integrations").push({
    user_id: USER, provider, access_token: "tok", refresh_token: null, expires_at: null,
    sync_error: null, metadata: {}, card_ids: null, updated_at: "2026-10-14T00:00:00.000Z", ...extra,
  });
}
const integration = (provider: string) => table("integrations").find((r) => r.provider === provider)!;
const writes = (method: string, needle: string) => calls.filter((c) => c.method === method && c.url.includes(needle));

// ─────────────────────────────────────────────────────────────────────────────

describe("crmFetch: bounded, and retried only when retrying can help", () => {
  it("a 429 is retried (honouring Retry-After) and the success is returned", async () => {
    let n = 0;
    respond = () => (++n === 1 ? json({}, 429, { "retry-after": "0" }) : json({ ok: true }));
    const res = await crmFetch("https://api.example/x", {}, newCrmBudget());
    expect(res.status).toBe(200);
    expect(n).toBe(2);
  });

  it("a 503 twice then success still lands", async () => {
    let n = 0;
    respond = () => (++n < 3 ? json({}, 503) : json({}));
    expect((await crmFetch("https://api.example/x")).status).toBe(200);
    expect(n).toBe(3);
  });

  it("a 400 or 401 is never retried — repeating it changes nothing", async () => {
    let n = 0;
    respond = () => { n++; return json({}, 400); };
    expect((await crmFetch("https://api.example/x")).status).toBe(400);
    respond = () => { n++; return json({}, 401); };
    expect((await crmFetch("https://api.example/x")).status).toBe(401);
    expect(n).toBe(2);
  });

  it("a CRM that never answers throws CrmNoAnswerError within the contact's budget", async () => {
    // Never answers: only the abort signal ends it.
    vi.stubGlobal("fetch", (_url: string, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted")))));
    const started = Date.now();
    await expect(crmFetch("https://api.example/x", {}, newCrmBudget(600))).rejects.toBeInstanceOf(CrmNoAnswerError);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe("what the user is told", () => {
  it("connection, busy and data problems each get their own advice", () => {
    expect(connectionErrorMessage("HubSpot", 401)).toMatch(/reconnect HubSpot/);
    expect(connectionErrorMessage("HubSpot", 403)).toMatch(/reconnect/);
    expect(connectionErrorMessage("HubSpot", 503)).toMatch(/will try again/);
    expect(connectionErrorMessage("HubSpot", null)).toMatch(/didn't answer/);
    const data = connectionErrorMessage("HubSpot", 400, "Email address maya@ is invalid");
    expect(data).toMatch(/connection is fine/);
    expect(data).not.toMatch(/reconnect/);
    expect(data).toContain("maya@ is invalid");
  });

  it("Zapier: a switched-off Zap is named as such, busy is retried, success is silent", () => {
    expect(zapierStatusMessage(200)).toEqual({ ok: true, retryable: false, message: null });
    expect(zapierStatusMessage(410).message).toMatch(/turned off or was deleted/);
    expect(zapierStatusMessage(410).retryable).toBe(false);
    expect(zapierStatusMessage(503).retryable).toBe(true);
    expect(zapierStatusMessage(null).retryable).toBe(true);
  });
});

describe("small rules every provider shares", () => {
  it("names split without inventing a last name", () => {
    expect(splitName("Maya")).toEqual({ first: "Maya", last: null });
    expect(splitName("  Maya   de la Cruz ")).toEqual({ first: "Maya", last: "de la Cruz" });
    expect(splitName("")).toEqual({ first: "", last: null });
  });

  it("phone numbers match across formatting and a country code, never on short digits", () => {
    expect(samePhone("+1 (415) 555-0148", "415.555.0148")).toBe(true);
    expect(samePhone("4155550148", "4155550149")).toBe(false);
    expect(samePhone("123", "123")).toBe(false);
  });

  it("a capture never overwrites; an edit overwrites only what it changed", () => {
    expect(mayOverwrite("company", { mode: "capture" })).toBe(false);
    expect(mayOverwrite("company", { mode: "update" })).toBe(false);
    expect(mayOverwrite("company", { mode: "update", changedFields: ["company"] })).toBe(true);
    expect(mayOverwrite("name", { mode: "update", changedFields: ["company"] })).toBe(false);
  });

  it("only the owner's own tags may leave SwiftCard", () => {
    for (const t of ["unread", "demo", "sc-locked", "sms-ok", "flow-paused", "preset-x", "sc-office-1", "", 3]) expect(isCrmVisibleTag(t)).toBe(false);
    for (const t of ["scanned", "hot lead", "vip"]) expect(isCrmVisibleTag(t)).toBe(true);
  });
});

describe("the runner records what happened, the same way for every CRM", () => {
  it("a delivered contact stamps Last sent and remembers the record — and doesn't write a banner it doesn't need", async () => {
    connect("hubspot");
    respond = (url, method) =>
      url.endsWith("/contacts/search") ? json({ results: [] }) : method === "POST" && url.endsWith("/objects/contacts") ? json({ id: "h1" }, 201) : json({});
    const out = await runCrmSync(hubspotProvider, lead, USER);
    expect(out.status).toBe("sent");
    expect(integration("hubspot").last_synced_at).toBeTruthy();
    expect(integration("hubspot").sync_error).toBeNull();
    expect(table("crm_links")).toEqual([expect.objectContaining({ lead_id: "L1", provider: "hubspot", owner_id: USER, record_id: "h1" })]);
  });

  it("a later success clears a banner that was showing", async () => {
    connect("hubspot", { sync_error: "HubSpot refused SwiftCard (401)" });
    respond = (url, method) => (method === "POST" && url.endsWith("/objects/contacts") ? json({ id: "h1" }, 201) : json({ results: [] }));
    await runCrmSync(hubspotProvider, lead, USER);
    expect(integration("hubspot").sync_error).toBeNull();
  });

  // It used to queue nothing, so a contact captured while revoked was lost
  // even after the user reconnected (audit I-02). The banner still asks them
  // to reconnect; the contact waits for it.
  it("a revoked token sets the reconnect banner and keeps the contact for the reconnect", async () => {
    connect("pipedrive", { metadata: { api_domain: "https://acme.pipedrive.com" } });
    respond = () => json({ error: "unauthorized" }, 401);
    const out = await runCrmSync(pipedriveProvider, lead, USER);
    expect(out).toMatchObject({ status: "failed", retryable: false, queued: true });
    expect(String(integration("pipedrive").sync_error)).toMatch(/reconnect Pipedrive/);
    expect(table("crm_sync_outbox")).toEqual([expect.objectContaining({ lead_id: "L1", provider: "pipedrive", owner_id: USER })]);
  });

  it("…but the Settings test of a revoked token queues nothing", async () => {
    connect("pipedrive", { metadata: { api_domain: "https://acme.pipedrive.com" } });
    respond = () => json({ error: "unauthorized" }, 401);
    await runCrmSync(pipedriveProvider, lead, USER, { test: true });
    expect(table("crm_sync_outbox")).toHaveLength(0);
  });

  it("a CRM that is down queues the contact for the daily retry — no banner for a blip", async () => {
    connect("pipedrive", { metadata: { api_domain: "https://acme.pipedrive.com" } });
    respond = () => json({}, 503);
    const out = await runCrmSync(pipedriveProvider, lead, USER);
    expect(out).toMatchObject({ status: "failed", retryable: true, queued: true });
    expect(integration("pipedrive").sync_error).toBeNull();
    expect(table("crm_sync_outbox")).toEqual([expect.objectContaining({ lead_id: "L1", provider: "pipedrive", owner_id: USER, mode: "capture" })]);
  });

  it("…and a contact that can't be queued (no lead id) still tells the user", async () => {
    connect("pipedrive", { metadata: { api_domain: "https://acme.pipedrive.com" } });
    respond = () => json({}, 503);
    await runCrmSync(pipedriveProvider, { ...lead, leadId: null }, USER);
    expect(String(integration("pipedrive").sync_error)).toMatch(/busy \(503\)/);
  });

  it("the same contact failing twice is queued once", async () => {
    connect("pipedrive", { metadata: { api_domain: "https://acme.pipedrive.com" } });
    respond = () => json({}, 503);
    await runCrmSync(pipedriveProvider, lead, USER);
    await runCrmSync(pipedriveProvider, lead, USER, { mode: "update" });
    expect(table("crm_sync_outbox")).toHaveLength(1);
  });

  it("a Salesforce 401 is answered with ONE forced refresh and a retry, not a reconnect banner", async () => {
    process.env.SALESFORCE_CLIENT_ID = "id";
    process.env.SALESFORCE_CLIENT_SECRET = "secret";
    connect("salesforce", { refresh_token: "r1", expires_at: Date.now() + 60 * 60 * 1000, metadata: { instance_url: "https://acme.my.salesforce.com" } });
    let stale = true;
    respond = (url, method) => {
      if (url.includes("/oauth2/token")) { stale = false; return json({ access_token: "fresh" }); }
      if (stale) return json([{ errorCode: "INVALID_SESSION_ID" }], 401);
      if (url.includes("/query")) return json({ records: [] });
      if (method === "POST" && url.endsWith("/sobjects/Lead")) return json({ id: "00Qnew" }, 201);
      return json({});
    };
    const out = await runCrmSync(salesforceProvider, lead, USER);
    expect(out.status).toBe("sent");
    expect(calls.filter((c) => c.url.includes("/oauth2/token"))).toHaveLength(1);
    expect(integration("salesforce").sync_error).toBeNull();
    expect(integration("salesforce").access_token).toBe("fresh");
  });

  it("a refresh the provider rejects for good asks the user to reconnect", async () => {
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    connect("google", { refresh_token: "r1", expires_at: Date.now() - 1000 });
    respond = (url) => (url.includes("oauth2.googleapis.com/token") ? json({ error: "invalid_grant" }, 400) : json({}));
    const out = await runCrmSync(googleProvider, lead, USER);
    expect(out.status).toBe("skipped");
    expect(String(integration("google").sync_error)).toMatch(/signed SwiftCard out — reconnect Google Contacts/);
  });

  it("a deployment WITHOUT the app secret never marks a working connection broken", async () => {
    const saved = process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_CLIENT_SECRET;
    connect("google", { refresh_token: "r1", expires_at: Date.now() - 1000 });
    respond = (url) => (url.includes("searchContacts") ? json({ results: [] }) : json({ resourceName: "people/c1" }));
    await runCrmSync(googleProvider, lead, USER);
    expect(calls.some((c) => c.url.includes("oauth2.googleapis.com/token"))).toBe(false);
    expect(integration("google").sync_error).toBeNull();
    process.env.GOOGLE_CLIENT_SECRET = saved;
  });

  // Audit I-04: the 401 that follows used to write "refused SwiftCard —
  // reconnect" onto a connection that works fine where the secret exists.
  it("…and when the CRM then refuses that token, the contact is queued, not a reconnect banner", async () => {
    const saved = process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_CLIENT_SECRET;
    connect("google", { refresh_token: "r1", expires_at: Date.now() + 60 * 60 * 1000 });
    respond = () => json({ error: { code: 401 } }, 401);
    const out = await runCrmSync(googleProvider, lead, USER);
    expect(out).toMatchObject({ status: "failed", retryable: true, queued: true });
    expect(calls.some((c) => c.url.includes("oauth2.googleapis.com/token"))).toBe(false);
    expect(integration("google").sync_error).toBeNull();
    expect(table("crm_sync_outbox")).toEqual([expect.objectContaining({ lead_id: "L1", provider: "google" })]);
    process.env.GOOGLE_CLIENT_SECRET = saved;
  });

  it("the Settings test ignores card scope (there is no card) and never queues", async () => {
    connect("hubspot", { card_ids: ["99999999-9999-4999-8999-999999999999"] });
    respond = () => json({}, 503);
    const out = await runCrmSync(hubspotProvider, { ...lead, capturedByCardId: null }, USER, { test: true });
    expect(out.status).toBe("failed");
    expect(table("crm_sync_outbox")).toHaveLength(0);
  });

  it("a card left out of the scope sends nothing and raises nothing", async () => {
    connect("hubspot", { card_ids: ["99999999-9999-4999-8999-999999999999"] });
    const out = await runCrmSync(hubspotProvider, lead, USER);
    expect(out.status).toBe("skipped");
    expect(calls).toHaveLength(0);
    expect(integration("hubspot").sync_error).toBeNull();
  });
});

describe("HubSpot", () => {
  beforeEach(() => connect("hubspot", { metadata: { portal_id: 42 } }));

  it("a phone-only contact met twice is ONE contact — found by number the second time", async () => {
    respond = (url, method, body) => {
      if (url.endsWith("/contacts/search")) {
        const groups = (body as { filterGroups: { filters: { propertyName: string }[] }[] }).filterGroups;
        const byPhone = groups.some((g) => g.filters.some((f) => f.propertyName === "hs_searchable_calculated_phone_number"));
        return json({ results: byPhone ? [{ id: "h7", properties: { phone: "(555) 010-0100" } }] : [] });
      }
      return json({ id: "h7" });
    };
    await runCrmSync(hubspotProvider, { ...lead, leadId: "L2", email: null }, USER);
    expect(writes("POST", "/crm/v3/objects/contacts").filter((c) => !c.url.endsWith("/search"))).toHaveLength(0);
  });

  it("an edit that CHANGED the email updates the remembered record — no second contact", async () => {
    table("crm_links").push({ lead_id: "L1", provider: "hubspot", owner_id: USER, record_id: "h1", record_kind: "contact" });
    respond = (url, method) =>
      method === "GET" && url.includes("/objects/contacts/h1")
        ? json({ id: "h1", properties: { email: "old@acme.co", firstname: "Maya", lastname: "Cohen" } })
        : json({ id: "h1" });
    await runCrmSync(hubspotProvider, { ...lead, email: "new@acme.co" }, USER, { mode: "update", changedFields: ["email"], previousEmail: "old@acme.co" });
    expect(writes("POST", "/crm/v3/objects/contacts").filter((c) => !c.url.includes("search"))).toHaveLength(0);
    const patch = writes("PATCH", "/objects/contacts/h1")[0];
    expect((patch.body as { properties: Row }).properties.email).toBe("new@acme.co");
  });

  it("meeting someone again fills blanks and adds a second number — never replaces the rep's", async () => {
    respond = (url) =>
      url.endsWith("/contacts/search")
        ? json({ results: [{ id: "h1", properties: { email: "maya@acme.co", firstname: "Maya", lastname: "Cohen", company: "Acme Holdings", phone: "+1 555 999 0000" } }] })
        : json({ id: "h1" });
    await runCrmSync(hubspotProvider, lead, USER);
    const props = (writes("PATCH", "/objects/contacts/h1")[0].body as { properties: Row }).properties;
    expect(props.company).toBeUndefined();
    expect(props.phone).toBeUndefined();
    expect(props.mobilephone).toBe("+1 555 010 0100");
  });

  it("an edit to the name replaces it, and clears a last name that is gone", async () => {
    table("crm_links").push({ lead_id: "L1", provider: "hubspot", owner_id: USER, record_id: "h1", record_kind: "contact" });
    respond = (url, method) =>
      method === "GET" ? json({ id: "h1", properties: { firstname: "Maya", lastname: "Cohen" } }) : json({ id: "h1" });
    await runCrmSync(hubspotProvider, { ...lead, name: "Maya" }, USER, { mode: "update", changedFields: ["name"] });
    const props = (writes("PATCH", "/objects/contacts/h1")[0].body as { properties: Row }).properties;
    expect(props).toMatchObject({ firstname: "Maya", lastname: "" });
  });

  it("a duplicate caught by HubSpot itself (409) is updated, not lost", async () => {
    respond = (url, method) => {
      if (url.endsWith("/contacts/search")) return json({ results: [] }); // index lag
      if (method === "POST" && url.endsWith("/objects/contacts")) return json({ message: "Contact already exists" }, 409);
      if (method === "GET" && url.includes("idProperty=email")) return json({ id: "h9", properties: { email: "maya@acme.co" } });
      return json({ id: "h9" });
    };
    const out = await runCrmSync(hubspotProvider, lead, USER);
    expect(out.status).toBe("sent");
    expect(writes("PATCH", "/objects/contacts/h9")).toHaveLength(1);
  });

  it("the test result links straight to the record", async () => {
    respond = (url, method) =>
      url.endsWith("/contacts/search") ? json({ results: [] }) : method === "POST" && url.endsWith("/objects/contacts") ? json({ id: "h5" }, 201) : json({});
    const out = await runCrmSync(hubspotProvider, lead, USER, { test: true });
    expect(out).toMatchObject({ status: "sent", recordUrl: "https://app.hubspot.com/contacts/42/record/0-1/h5" });
  });

  it("an invalid email is reported in HubSpot's own words, without blaming the connection", async () => {
    respond = (url, method) =>
      url.endsWith("/contacts/search") ? json({ results: [] }) : method === "POST" ? json({ message: "Property values were not valid: email" }, 400) : json({});
    await runCrmSync(hubspotProvider, lead, USER);
    const banner = String(integration("hubspot").sync_error);
    expect(banner).toMatch(/Property values were not valid/);
    expect(banner).not.toMatch(/reconnect/i);
  });
});

describe("Pipedrive", () => {
  it("only ever sends the token to a pipedrive.com host", () => {
    expect(pipedriveHost({ api_domain: "https://acme.pipedrive.com" })).toBe("https://acme.pipedrive.com");
    expect(pipedriveHost({ api_domain: "acme.pipedrive.com" })).toBe("https://acme.pipedrive.com");
    expect(pipedriveHost({ api_domain: "https://evil.example/pipedrive.com" })).toBe("https://api.pipedrive.com");
    expect(pipedriveHost({ api_domain: "http://acme.pipedrive.com" })).toBe("https://api.pipedrive.com");
    expect(pipedriveHost({ api_domain: "https://pipedrive.com.evil.io" })).toBe("https://api.pipedrive.com");
  });

  it("an email changed on edit replaces the old one in place, keeping its label", async () => {
    connect("pipedrive", { metadata: { api_domain: "https://acme.pipedrive.com" } });
    table("crm_links").push({ lead_id: "L1", provider: "pipedrive", owner_id: USER, record_id: "7", record_kind: "person" });
    respond = (url, method) =>
      method === "GET" && url.endsWith("/persons/7")
        ? json({ data: { id: 7, name: "Maya Cohen", org_id: 3, emails: [{ value: "old@acme.co", primary: true, label: "work" }] } })
        : json({ data: { id: 7 } });
    await runCrmSync(pipedriveProvider, { ...lead, email: "new@acme.co" }, USER, { mode: "update", changedFields: ["email"], previousEmail: "old@acme.co" });
    const patch = writes("PATCH", "/persons/7")[0].body as { emails: Row[] };
    expect(patch.emails).toEqual([{ value: "new@acme.co", primary: true, label: "work" }]);
    expect(writes("POST", "/api/v2/persons")).toHaveLength(0);
  });

  it("a phone-only contact is matched by number instead of duplicated", async () => {
    connect("pipedrive", { metadata: { api_domain: "https://acme.pipedrive.com" } });
    respond = (url, method) => {
      if (url.includes("/persons/search")) return json({ data: { items: [{ item: { id: 9, phones: ["555-010-0100"] } }] } });
      if (method === "GET" && url.endsWith("/persons/9")) return json({ data: { id: 9, name: "Maya", phones: [{ value: "555-010-0100", primary: true }] } });
      return json({ data: { id: 9 } });
    };
    await runCrmSync(pipedriveProvider, { ...lead, email: null }, USER);
    expect(writes("POST", "/api/v2/persons")).toHaveLength(0);
    expect(writes("PATCH", "/persons/9")).toHaveLength(1);
  });
});

describe("Google Contacts", () => {
  beforeEach(() => connect("google"));

  it("a one-word name creates no empty family name", async () => {
    respond = (url) => (url.includes("searchContacts") ? json({ results: [] }) : json({ resourceName: "people/c1" }));
    await runCrmSync(googleProvider, { ...lead, name: "Maya" }, USER);
    const create = writes("POST", "people:createContact")[0].body as { names: Row[] };
    expect(create.names[0]).toEqual({ givenName: "Maya" });
  });

  it("meeting someone again keeps the name already in the address book", async () => {
    respond = (url) =>
      url.includes("searchContacts")
        ? json({ results: [{ person: { resourceName: "people/c9", etag: "e", names: [{ givenName: "Maya", familyName: "Cohen-Levi" }], emailAddresses: [{ value: "maya@acme.co" }] } }] })
        : json({});
    await runCrmSync(googleProvider, lead, USER);
    const upd = writes("PATCH", "people/c9:updateContact")[0].body as { names: Row[] };
    expect(upd.names[0]).toEqual({ givenName: "Maya", familyName: "Cohen-Levi" });
  });

  it("a contact created now is remembered, so the next edit doesn't depend on Google's lagging search", async () => {
    respond = (url) => (url.includes("searchContacts") ? json({ results: [] }) : json({ resourceName: "people/c77" }));
    await runCrmSync(googleProvider, lead, USER);
    expect(table("crm_links")[0]).toMatchObject({ provider: "google", record_id: "people/c77" });
  });
});

describe("Salesforce", () => {
  beforeEach(() => connect("salesforce", { metadata: { instance_url: "https://acme.my.salesforce.com" } }));

  it("renaming to one word gives LastName only — never \"Maya Maya\"", async () => {
    table("crm_links").push({ lead_id: "L1", provider: "salesforce", owner_id: USER, record_id: "00Q1", record_kind: "lead" });
    respond = (url, method) =>
      method === "GET" && url.includes("/sobjects/Lead/00Q1")
        ? json({ Id: "00Q1", FirstName: "Maya", LastName: "Cohen", IsConverted: false })
        : new Response(null, { status: 204 });
    await runCrmSync(salesforceProvider, { ...lead, name: "Maya" }, USER, { mode: "update", changedFields: ["name"] });
    expect(writes("PATCH", "/sobjects/Lead/00Q1")[0].body).toMatchObject({ FirstName: "", LastName: "Maya" });
  });

  it("someone already a CONTACT (never a Lead) gets a Met-again Task, not a duplicate Lead", async () => {
    respond = (url) => {
      if (url.includes("FROM%20Lead")) return json({ records: [] });
      if (url.includes("FROM%20Contact")) return json({ records: [{ Id: "003c", Email: "maya@acme.co" }] });
      return json({ id: "00T" }, 201);
    };
    const out = await runCrmSync(salesforceProvider, lead, USER);
    expect(out).toMatchObject({ status: "sent", action: "logged" });
    expect(writes("POST", "/sobjects/Lead")).toHaveLength(0);
    expect((writes("POST", "/sobjects/Task")[0].body as Row).WhoId).toBe("003c");
  });

  it("an org that restricts Lead Source still gets the lead — saved without the label", async () => {
    let first = true;
    respond = (url, method) => {
      if (url.includes("/query")) return json({ records: [] });
      if (method === "POST" && url.endsWith("/sobjects/Lead")) {
        if (first) { first = false; return json([{ message: "bad value for restricted picklist field: SwiftCard", errorCode: "INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST", fields: ["LeadSource"] }], 400); }
        return json({ id: "00Qok" }, 201);
      }
      return json({});
    };
    const out = await runCrmSync(salesforceProvider, lead, USER);
    expect(out.status).toBe("sent");
    const posts = writes("POST", "/sobjects/Lead");
    expect(posts).toHaveLength(2);
    expect((posts[1].body as Row).LeadSource).toBeUndefined();
  });

  it("a phone-only contact is searched across phone fields (SOSL), whatever the formatting", async () => {
    respond = (url) => (url.includes("/search?q=") ? json({ searchRecords: [{ Id: "00Qp", attributes: { type: "Lead" }, Phone: "(555) 010-0100" }] }) : new Response(null, { status: 204 }));
    await runCrmSync(salesforceProvider, { ...lead, email: null }, USER);
    expect(writes("POST", "/sobjects/Lead")).toHaveLength(0);
    expect(writes("PATCH", "/sobjects/Lead/00Qp")).toHaveLength(1);
  });
});

describe("GoHighLevel", () => {
  beforeEach(() => connect("highlevel", { metadata: { location_id: "loc1" } }));

  it("an existing contact is updated with PUT — never with tags, which would replace theirs", async () => {
    respond = (url) =>
      url.includes("/search/duplicate") ? json({ contact: { id: "c1", firstName: "Maya", email: "maya@acme.co" } }) : json({});
    await runCrmSync(highlevelProvider, { ...lead, tags: ["vip", "unread", "demo"] }, USER);
    expect(writes("POST", "/contacts/upsert")).toHaveLength(0);
    const put = writes("PUT", "/contacts/c1")[0].body as Row;
    expect(put.tags).toBeUndefined();
    const tags = (writes("POST", "/contacts/c1/tags")[0].body as { tags: string[] }).tags;
    expect(tags).toEqual(["swiftcard", "swiftcard-maya-card", "vip"]);
  });

  it("an upsert HighLevel says matched someone gets no second note", async () => {
    respond = (url) => (url.endsWith("/contacts/upsert") ? json({ new: false, contact: { id: "c2" } }) : json({}));
    await runCrmSync(highlevelProvider, lead, USER, { mode: "update" });
    expect(calls.some((c) => c.url.endsWith("/notes"))).toBe(false);
  });
});

describe("Zapier", () => {
  const HOOK = "https://hooks.zapier.com/hooks/catch/1/abc/";

  it("an expired timed grant is Free: no Zap fires, matching the native CRMs", async () => {
    db.profiles = [{ id: USER, plan: "pro", plan_expires_at: "2020-01-01T00:00:00Z", zapier_webhook_url: HOOK }];
    expect(await resolveZapierTarget(USER, CARD)).toBeNull();
  });

  it("a switched-off Zap (410) is shown in Settings, and not retried", async () => {
    db.profiles = [{ id: USER, plan: "pro", zapier_webhook_url: HOOK }];
    respond = () => json({}, 410);
    const out = await sendLeadToZapier(lead, USER);
    expect(out).toMatchObject({ status: "failed", retryable: false, queued: false });
    expect(String(db.profiles[0].zapier_error)).toMatch(/turned off or was deleted/);
    expect(table("crm_sync_outbox")).toHaveLength(0);
  });

  it("a busy Zapier queues the contact, quietly", async () => {
    db.profiles = [{ id: USER, plan: "pro", zapier_webhook_url: HOOK }];
    respond = () => json({}, 503);
    const out = await sendLeadToZapier(lead, USER);
    expect(out).toMatchObject({ status: "failed", queued: true });
    expect(db.profiles[0].zapier_error).toBeUndefined();
    expect(table("crm_sync_outbox")[0]).toMatchObject({ provider: "zapier", lead_id: "L1" });
  });

  it("a delivered lead clears the error and stamps Last sent", async () => {
    db.profiles = [{ id: USER, plan: "pro", zapier_webhook_url: HOOK, zapier_error: "old" }];
    respond = () => json({ status: "success" });
    expect((await sendLeadToZapier(lead, USER)).status).toBe("sent");
    expect(db.profiles[0].zapier_error).toBeNull();
    expect(db.profiles[0].zapier_last_sent_at).toBeTruthy();
  });

  it("the payload carries stable ids a Zap can key on", () => {
    const p = zapierLeadPayload(lead);
    expect(p).toMatchObject({ type: "lead.created", lead_id: "L1", card_id: CARD });
  });

  it("an Office member's leads reach the agency's Zap only from their COMPANY card", async () => {
    const OWNER = "owner-1";
    const MEMBER = "member-1";
    const COMPANY = "22222222-2222-4222-8222-222222222222";
    const PERSONAL = "33333333-3333-4333-8333-333333333333";
    db.profiles = [{ id: OWNER, plan: "enterprise", zapier_webhook_url: HOOK }, { id: MEMBER, plan: "enterprise", zapier_webhook_url: null }];
    db.cards = [{ id: COMPANY, user_id: MEMBER, is_office_card: true }, { id: PERSONAL, user_id: MEMBER, is_office_card: false }];
    officeCtx = { officeId: "o1", ownerId: OWNER, role: "employee", isOwner: false };
    expect((await resolveZapierTarget(MEMBER, COMPANY))?.url).toBe(HOOK);
    expect(await resolveZapierTarget(MEMBER, PERSONAL)).toBeNull();
  });
});

describe("card activity events to Zapier", () => {
  const HOOK = "https://hooks.zapier.com/hooks/catch/1/abc/";
  beforeEach(() => {
    db.profiles = [{ id: USER, plan: "pro", zapier_webhook_url: HOOK, customization: { crm: { notifications: true, views: false } } }];
  });

  it("with Views off, an anonymous view doesn't sneak through as a notification", async () => {
    await dispatchCrmEvent("maya-card", { type: "conversation.notification", event: "card_viewed", title: "Someone viewed your card" });
    expect(calls).toHaveLength(0);
  });

  it("…but a known contact's activity and a contact save still go", async () => {
    await dispatchCrmEvent("maya-card", { type: "conversation.notification", event: "card_viewed", contact: { name: "Maya" } });
    await dispatchCrmEvent("maya-card", { type: "conversation.notification", event: "contact_saved" });
    expect(calls).toHaveLength(2);
  });

  it("a dead Zap is reported from the event stream too", async () => {
    respond = () => json({}, 410);
    await dispatchCrmEvent("maya-card", { type: "conversation.notification", event: "contact_saved" });
    expect(String(db.profiles[0].zapier_error)).toMatch(/turned off/);
  });
});

describe("contacts read back for a later sync", () => {
  beforeEach(() => {
    db.leads = [
      { id: "L1", name: "Maya Cohen", email: "maya@acme.co", card_owner: "maya-card", tags: ["vip", "unread", "sms-ok"], source: "qr_code" },
      { id: "Ldemo", name: "Jordan Rivera", email: "jordan.rivera@example.com", card_owner: "maya-card", tags: ["demo", "unread"] },
      { id: "Llocked", name: "Locked", card_owner: "maya-card", tags: ["sc-locked"] },
    ];
  });

  it("the sample contact and a Free-locked contact are never sent anywhere", async () => {
    expect(await loadCrmLead("Ldemo")).toBeNull();
    expect(await loadCrmLead("Llocked")).toBeNull();
  });

  it("only the owner's own tags travel, and the card resolves to its owner", async () => {
    const got = await loadCrmLead("L1");
    expect(got?.capturedBy).toBe(USER);
    expect(got?.lead).toMatchObject({ leadId: "L1", capturedByCardId: CARD, capturedByName: "Dana Rep", tags: ["vip"], source: "QR code scan" });
  });

  it("opening a contact (clearing \"unread\") is not a change a CRM needs to hear about", () => {
    const before = { name: "Maya", email: "m@a.co", tags: ["vip", "unread"] };
    const after = { name: "Maya", email: "m@a.co", tags: ["vip"] };
    expect(crmChanges(before, after)).toEqual({ fields: [], note: false, tags: false });
    expect(crmChanges(before, { ...after, email: "new@a.co", notes: "x" })).toEqual({ fields: ["email"], note: true, tags: false });
  });

  it("the sample contact never syncs even through the fan-out", async () => {
    connect("hubspot");
    const loaded = await loadCrmLead("Ldemo");
    expect(loaded).toBeNull();
    await syncLeadToAllCrms({ ...lead, leadId: "Ldemo" }, "nobody"); // unknown account → not paid → nothing
    expect(calls).toHaveLength(0);
  });
});

describe("the daily catch-up", () => {
  beforeEach(() => {
    db.leads = [{ id: "L1", name: "Maya Cohen", email: "maya@acme.co", card_owner: "maya-card", tags: [] }];
    connect("pipedrive", { metadata: { api_domain: "https://acme.pipedrive.com" } });
  });
  const queue = (extra: Row = {}) =>
    table("crm_sync_outbox").push({ id: "q1", lead_id: "L1", provider: "pipedrive", user_id: USER, owner_id: USER, mode: "capture", attempts: 0, next_attempt_at: "2000-01-01T00:00:00Z", created_at: new Date().toISOString(), ...extra });

  it("a queued contact is delivered once the CRM is back, and leaves the queue", async () => {
    queue();
    respond = (url) => (url.includes("/search") ? json({ data: { items: [] } }) : json({ data: { id: 5 } }));
    const r = await drainCrmOutbox();
    expect(r).toMatchObject({ tried: 1, sent: 1 });
    expect(table("crm_sync_outbox")).toHaveLength(0);
  });

  it("still refused (401): it keeps its place until they reconnect", async () => {
    queue();
    respond = () => json({ error: "unauthorized" }, 401);
    const r = await drainCrmOutbox();
    expect(r.waiting).toBe(1);
    expect(table("crm_sync_outbox")).toHaveLength(1);
    expect(String(integration("pipedrive").sync_error)).toMatch(/reconnect Pipedrive/);
  });

  it("reconnecting sends what waited at once, without waiting for its slot — and only for that CRM", async () => {
    queue({ next_attempt_at: "2999-01-01T00:00:00Z" });
    table("crm_sync_outbox").push({ id: "q2", lead_id: "L1", provider: "hubspot", user_id: USER, owner_id: USER, mode: "capture", attempts: 0, next_attempt_at: "2999-01-01T00:00:00Z", created_at: new Date().toISOString() });
    respond = (url) => (url.includes("/search") ? json({ data: { items: [] } }) : json({ data: { id: 5 } }));
    expect((await drainCrmOutbox()).tried).toBe(0);
    const r = await drainCrmOutbox({ ownerId: USER, provider: "pipedrive", dueNow: true });
    expect(r).toMatchObject({ tried: 1, sent: 1 });
    expect(table("crm_sync_outbox").map((x) => x.provider)).toEqual(["hubspot"]);
  });

  it("still down: it waits for tomorrow", async () => {
    queue();
    respond = () => json({}, 503);
    const r = await drainCrmOutbox();
    expect(r.waiting).toBe(1);
    expect(table("crm_sync_outbox")[0].attempts).toBe(1);
  });

  it("after five days it stops trying and SAYS so on the connection", async () => {
    queue({ created_at: new Date(Date.now() - 6 * 24 * 3600 * 1000).toISOString() });
    respond = () => json({}, 503);
    const r = await drainCrmOutbox();
    expect(r.gaveUp).toBe(1);
    expect(table("crm_sync_outbox")).toHaveLength(0);
    expect(String(integration("pipedrive").sync_error)).toMatch(/1 contact couldn't be sent to Pipedrive after 5 days/);
  });

  it("a contact deleted meanwhile, or an account no longer paid, is dropped — not sent", async () => {
    queue();
    db.profiles = [{ id: USER, plan: "free" }];
    const r = await drainCrmOutbox();
    expect(r.dropped).toBe(1);
    expect(calls).toHaveLength(0);
    queue({ id: "q2", lead_id: "gone" });
    expect((await drainCrmOutbox()).dropped).toBe(1);
  });
});

describe("deleting a card", () => {
  it("leaves every \"only these cards\" choice it was in — and an emptied choice says so", async () => {
    const OTHER = "55555555-5555-4555-8555-555555555555";
    connect("hubspot", { card_ids: [CARD, OTHER] });
    connect("pipedrive", { card_ids: [CARD] });
    db.profiles = [{ id: USER, plan: "pro", zapier_card_ids: [CARD] }];
    await dropCardFromScopes(getAdminSupabase(), USER, CARD);
    expect(integration("hubspot").card_ids).toEqual([OTHER]);
    expect(integration("hubspot").sync_error).toBeNull();
    expect(integration("pipedrive").card_ids).toEqual([]);
    expect(String(integration("pipedrive").sync_error)).toMatch(/pick which cards/);
    expect(String(db.profiles[0].zapier_error)).toMatch(/pick which cards/);
  });
});
