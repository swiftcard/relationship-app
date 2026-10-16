import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── The integration routes, run for real ─────────────────────────────────────
//
// Until now no connect, save, test or disconnect route had ever been executed
// by a test — only grepped. These call the actual handlers with a signed-in
// (or signed-out) user, a fake database and a fake network, and check what the
// person pressing the button would see.

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
let failDeletes = false;
let user: { id: string } | null = { id: "u1" };

function makeQuery(name: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: { kind: string; value?: Row; conflict?: string[] } = { kind: "select" };
  const rows = () => (db[name] ??= []);
  const matches = () => rows().filter((r) => filters.every((f) => f(r)));
  const run = () => {
    if (op.kind === "delete") {
      if (failDeletes) return { data: null, error: { message: "db down" } };
      const hit = new Set(matches());
      db[name] = rows().filter((r) => !hit.has(r));
      return { data: null, error: null };
    }
    if (op.kind === "update") {
      const hit = matches();
      hit.forEach((r) => Object.assign(r, op.value));
      return { data: hit, error: null };
    }
    if (op.kind === "upsert") {
      const v = op.value!;
      const ex = rows().find((r) => (op.conflict ?? []).every((k) => r[k] === v[k]));
      if (ex) Object.assign(ex, v); else rows().push({ ...v });
      return { data: null, error: null };
    }
    return { data: matches(), error: null };
  };
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return chain; },
    in: (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return chain; },
    order: () => chain,
    limit: () => chain,
    update: (v: Row) => { op = { kind: "update", value: v }; return chain; },
    delete: () => { op = { kind: "delete" }; return chain; },
    upsert: (v: Row, o?: { onConflict?: string }) => { op = { kind: "upsert", value: v, conflict: o?.onConflict?.split(",") }; return chain; },
    maybeSingle: async () => ({ data: run().data?.[0] ?? null, error: null }),
    single: async () => ({ data: run().data?.[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return chain;
}

// merge_customization (supabase/merge-customization.sql): `(customization - remove) || set` on the one row.
const rpc = async (_fn: string, a: { p_user: string; p_set: Record<string, unknown>; p_remove: string[] }) => {
  const row = (db.profiles ?? []).find((r) => r.id === a.p_user);
  if (!row) return { data: null, error: null };
  const next = { ...((row.customization as Record<string, unknown> | null) ?? {}) };
  for (const k of a.p_remove ?? []) delete next[k];
  row.customization = { ...next, ...(a.p_set ?? {}) };
  return { data: row.customization, error: null };
};
vi.mock("@/lib/supabase-admin", () => ({ getAdminSupabase: () => ({ from: (t: string) => makeQuery(t), rpc }) }));
vi.mock("@/lib/supabase-server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }) }));
vi.mock("@/lib/token-crypto", () => ({ encryptToken: (s: string) => `enc:${s}`, decryptToken: (s: string) => s.replace(/^enc:/, "") }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: async () => false }));
vi.mock("@/lib/office-roles", () => ({ resolveOfficeContext: async () => null }));
vi.mock("@/lib/report-error", () => ({ reportError: async () => {} }));

import { crmRetry } from "@/lib/crm-http";

let respond: (url: string, method: string) => Response = () => new Response("{}");
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const req = (url: string, method = "GET", body?: unknown) =>
  new NextRequest(`https://swiftcard.me${url}`, { method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  failDeletes = false;
  user = { id: "u1" };
  crmRetry.delaysMs = [0, 0];
  db.profiles = [{ id: "u1", plan: "pro", customization: {} }];
  db.cards = [{ id: "11111111-1111-4111-8111-111111111111", user_id: "u1", username: "maya", name: "Maya Rep" }];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => respond(String(url), (init?.method ?? "GET").toUpperCase()));
});

describe("Send test contact", () => {
  const load = async () => (await import("@/app/api/integrations/test/route")).POST;

  it("signed out → 401; Free → 402; not connected → says so", async () => {
    const POST = await load();
    user = null;
    expect((await POST(req("/api/integrations/test", "POST", { provider: "hubspot" }))).status).toBe(401);
    user = { id: "u1" };
    db.profiles = [{ id: "u1", plan: "free" }];
    expect((await POST(req("/api/integrations/test", "POST", { provider: "hubspot" }))).status).toBe(402);
    db.profiles = [{ id: "u1", plan: "pro" }];
    const r = await POST(req("/api/integrations/test", "POST", { provider: "hubspot" }));
    expect(r.status).toBe(404);
    expect((await r.json()).message).toBe("Connect HubSpot first.");
  });

  it("an unknown provider is refused", async () => {
    const POST = await load();
    expect((await POST(req("/api/integrations/test", "POST", { provider: "myspace" }))).status).toBe(400);
  });

  it("success says what happened and links to it", async () => {
    const POST = await load();
    db.integrations = [{ user_id: "u1", provider: "hubspot", access_token: "tok", metadata: { portal_id: 7 }, card_ids: null }];
    respond = (url, method) =>
      url.endsWith("/contacts/search") ? json({ results: [] }) : method === "POST" && url.endsWith("/objects/contacts") ? json({ id: "h1" }, 201) : json({});
    const d = await (await POST(req("/api/integrations/test", "POST", { provider: "hubspot" }))).json();
    expect(d).toEqual({ ok: true, message: 'Added "SwiftCard Test" in HubSpot.', recordUrl: "https://app.hubspot.com/contacts/7/record/0-1/h1" });
  });

  it("pressing it again UPDATES the same test contact — the no-duplicates check people want", async () => {
    const POST = await load();
    db.integrations = [{ user_id: "u1", provider: "hubspot", access_token: "tok", metadata: {}, card_ids: null }];
    respond = (url) =>
      url.endsWith("/contacts/search") ? json({ results: [{ id: "h1", properties: { email: "swiftcard-test@example.com", firstname: "SwiftCard", lastname: "Test" } }] }) : json({ id: "h1" });
    const d = await (await POST(req("/api/integrations/test", "POST", { provider: "hubspot" }))).json();
    expect(d.message).toBe('Updated "SwiftCard Test" in HubSpot.');
  });

  it("a CRM that doesn't answer is reported without promising a retry that won't happen", async () => {
    const POST = await load();
    db.integrations = [{ user_id: "u1", provider: "pipedrive", access_token: "tok", metadata: { api_domain: "https://a.pipedrive.com" }, card_ids: null }];
    respond = () => json({}, 503);
    const d = await (await POST(req("/api/integrations/test", "POST", { provider: "pipedrive" }))).json();
    expect(d.ok).toBe(false);
    expect(d.message).toMatch(/wait a moment and send the test again/);
    expect(db.crm_sync_outbox ?? []).toHaveLength(0);
  });
});

describe("Zapier settings", () => {
  const load = async () => await import("@/app/api/settings/zapier/route");
  const HOOK = "https://hooks.zapier.com/hooks/catch/1/abc/";

  it("a lapsed account can still REMOVE its webhook, but not add one", async () => {
    const { PATCH } = await load();
    db.profiles = [{ id: "u1", plan: "free", zapier_webhook_url: HOOK }];
    expect((await PATCH(req("/api/settings/zapier", "PATCH", { zapier_webhook_url: HOOK }))).status).toBe(402);
    expect((await PATCH(req("/api/settings/zapier", "PATCH", { zapier_webhook_url: "" }))).status).toBe(200);
    expect(db.profiles[0].zapier_webhook_url).toBeNull();
  });

  it("a non-Zapier URL is refused with words that say what to paste", async () => {
    const { PATCH } = await load();
    const r = await PATCH(req("/api/settings/zapier", "PATCH", { zapier_webhook_url: "https://example.com/hook" }));
    expect(r.status).toBe(400);
    expect((await r.json()).message).toMatch(/hooks\.zapier\.com/);
  });

  it("saving a new webhook clears the old one's error", async () => {
    const { PATCH } = await load();
    db.profiles = [{ id: "u1", plan: "pro", zapier_error: "Zapier says this Zap is turned off" }];
    await PATCH(req("/api/settings/zapier", "PATCH", { zapier_webhook_url: HOOK }));
    expect(db.profiles[0]).toMatchObject({ zapier_webhook_url: HOOK, zapier_error: null });
  });

  it("Test reports ZAPIER's answer: a switched-off Zap is a failure, not \"Sent ✓\"", async () => {
    const { POST } = await load();
    respond = () => json({}, 410);
    const off = await (await POST(req("/api/settings/zapier", "POST", { webhookUrl: HOOK }))).json();
    expect(off.ok).toBe(false);
    expect(off.message).toMatch(/turned off or was deleted/);
    respond = () => json({ status: "success" });
    const on = await (await POST(req("/api/settings/zapier", "POST", { webhookUrl: HOOK }))).json();
    expect(on.ok).toBe(true);
  });

  it("the test sample fills every field, so every field can be mapped in the Zap", async () => {
    const { POST } = await load();
    let sent: Row = {};
    vi.stubGlobal("fetch", async (_u: string, init?: RequestInit) => { sent = JSON.parse(String(init?.body)); return json({}); });
    await POST(req("/api/settings/zapier", "POST", { webhookUrl: HOOK }));
    for (const [k, v] of Object.entries(sent)) expect(v, `${k} is empty in the sample`).not.toBeNull();
    expect(Object.keys(sent)).toEqual(expect.arrayContaining(["lead_id", "card_id", "notes", "where_met", "tags"]));
  });
});

describe("Zapier event switches", () => {
  const load = async () => (await import("@/app/api/settings/crm/route")).PATCH;

  it("turning events OFF works on any plan; turning them ON needs Pro", async () => {
    const PATCH = await load();
    db.profiles = [{ id: "u1", plan: "free", customization: { crm: { views: true, notifications: true }, _usage: { leads: 4 } } }];
    expect((await PATCH(req("/api/settings/crm", "PATCH", { notifications: true, views: false }))).status).toBe(402);
    expect((await PATCH(req("/api/settings/crm", "PATCH", { notifications: false, views: false }))).status).toBe(200);
    // Only its own key changes — the free-contact meter beside it survives.
    expect(db.profiles[0].customization).toEqual({ crm: { notifications: false, views: false }, _usage: { leads: 4 } });
  });
});

describe("Disconnect", () => {
  const routes = [
    ["hubspot", "@/app/api/integrations/hubspot/route"],
    ["google", "@/app/api/integrations/google/route"],
    ["salesforce", "@/app/api/integrations/salesforce/route"],
    ["pipedrive", "@/app/api/integrations/pipedrive/token/route"],
    ["highlevel", "@/app/api/integrations/highlevel/token/route"],
  ] as const;

  for (const [provider, path] of routes) {
    it(`${provider}: works on a lapsed account, and a failed delete is reported — never "disconnected"`, async () => {
      const { DELETE } = (await import(/* @vite-ignore */ path)) as { DELETE: () => Promise<Response> };
      db.profiles = [{ id: "u1", plan: "free" }];
      db.integrations = [{ user_id: "u1", provider }];
      failDeletes = true;
      const bad = await DELETE();
      expect(bad.status).toBe(500);
      expect((await bad.json()).message).toMatch(/Couldn't disconnect/);
      failDeletes = false;
      expect((await DELETE()).status).toBe(200);
      expect(db.integrations).toHaveLength(0);
    });
  }
});

describe("Connecting", () => {
  it("HubSpot: a refused token says so; an accepted one is stored with the portal for deep links", async () => {
    const { POST } = await import("@/app/api/integrations/hubspot/token/route");
    respond = () => json({}, 401);
    const bad = await POST(req("/api/integrations/hubspot/token", "POST", { token: "pat-bad" }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).message).toMatch(/wasn't accepted by HubSpot/);
    respond = (url) => (url.includes("account-info") ? json({ portalId: 123 }) : json({}));
    expect((await POST(req("/api/integrations/hubspot/token", "POST", { token: "pat-good" }))).status).toBe(200);
    expect(db.integrations[0]).toMatchObject({ provider: "hubspot", access_token: "enc:pat-good", metadata: { portal_id: 123 }, sync_error: null });
  });

  it("an expired timed grant can't connect (it can't send either)", async () => {
    const { POST } = await import("@/app/api/integrations/pipedrive/token/route");
    db.profiles = [{ id: "u1", plan: "pro", plan_expires_at: "2020-01-01T00:00:00Z" }];
    expect((await POST(req("/api/integrations/pipedrive/token", "POST", { token: "x" }))).status).toBe(402);
  });

  it("Google: pressing Cancel comes back as \"cancelled\", not \"connection failed\"", async () => {
    const { GET } = await import("@/app/api/integrations/google/callback/route");
    const r = await GET(req("/api/integrations/google/callback?error=access_denied&state=x"));
    expect(r.headers.get("location")).toMatch(/integration=google&status=cancelled/);
  });

  it("Google: a deployment without the app secret says \"not switched on\" instead of crashing", async () => {
    const saved = process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_CLIENT_SECRET;
    const { GET } = await import("@/app/api/integrations/google/callback/route");
    const r = await GET(req("/api/integrations/google/callback?code=c&state=s"));
    expect(r.headers.get("location")).toMatch(/status=unconfigured/);
    process.env.GOOGLE_CLIENT_SECRET = saved;
  });

  it("Salesforce: Cancel and a missing secret are told apart from a failure", async () => {
    const { GET } = await import("@/app/api/integrations/salesforce/callback/route");
    expect((await GET(req("/api/integrations/salesforce/callback?error=access_denied"))).headers.get("location")).toMatch(/status=cancelled/);
    const saved = process.env.SALESFORCE_CLIENT_SECRET;
    delete process.env.SALESFORCE_CLIENT_SECRET;
    expect((await GET(req("/api/integrations/salesforce/callback?code=c&state=s"))).headers.get("location")).toMatch(/status=unconfigured/);
    process.env.SALESFORCE_CLIENT_SECRET = saved;
  });
});
