import { describe, it, expect, vi, beforeEach } from "vitest";

// What each CRM is actually SENT, driven through the real sync functions with
// every provider API replaced by a fake. The source-pin tests elsewhere prove
// the wiring; these prove the behaviour a customer sees in their CRM:
// no duplicates, nothing of theirs overwritten, no stacked notes, and an
// Office team's leads really arriving in the office's CRM.

// ── Fake database ────────────────────────────────────────────────────────────
// Just enough of the supabase-js chain for getCrmConnection and the resolvers:
// from(table).select().eq().eq().maybeSingle() / .update().eq().eq().
type Row = Record<string, unknown>;
const db: Record<string, Row[]> = { integrations: [], profiles: [], cards: [], crm_links: [] };
let officeCtx: { officeId: string; ownerId: string; role: string; isOwner: boolean } | null = null;

vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      const chain = {
        select: () => chain,
        update: () => chain,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return chain; },
        maybeSingle: async () => ({
          data: (db[table] ?? []).find((r) => filters.every(([k, v]) => r[k] === v)) ?? null,
        }),
        then: (res: (v: unknown) => void) => res({ data: null, error: null }),
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/token-crypto", () => ({ encryptToken: (s: string) => s, decryptToken: (s: string) => s }));
vi.mock("@/lib/office-roles", () => ({ resolveOfficeContext: async () => officeCtx }));

import { getCrmConnection, resolveCrmOwnerId, describeCapture } from "@/lib/crm-connection";
import { syncLeadToHighLevel } from "@/lib/sync-highlevel";
import { syncLeadToPipedrive } from "@/lib/sync-pipedrive";
import { syncLeadToGoogle } from "@/lib/sync-google";
import { syncLeadToSalesforce } from "@/lib/sync-salesforce";
import { syncLeadToHubSpot } from "@/lib/sync-hubspot";
import { resolveZapierTarget, zapierLeadPayload } from "@/lib/crm-sync";

const OWNER = "owner-1";
const MEMBER = "member-1";
const OWNER_CARD = "11111111-1111-4111-8111-111111111111";
const MEMBER_CARD = "22222222-2222-4222-8222-222222222222";

// ── Fake network ─────────────────────────────────────────────────────────────
type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let respond: (url: string, method: string) => Response;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

beforeEach(() => {
  calls = [];
  officeCtx = null;
  db.integrations = [];
  db.profiles = [];
  db.cards = [];
  db.crm_links = [];
  respond = () => json({});
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return respond(String(url), method);
  });
});

const lead = {
  name: "Maya Cohen",
  email: "maya@acme.co",
  phone: "+1 555 010 0100",
  company: "Acme",
  source: "QR code",
  capturedByCard: "maya-card",
  capturedByName: "Dana Rep",
  capturedByCardId: OWNER_CARD,
};

function connect(provider: string, userId: string, extra: Row = {}) {
  db.integrations.push({ user_id: userId, provider, access_token: "tok", refresh_token: null, expires_at: null, sync_error: null, metadata: {}, card_ids: null, ...extra });
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Office: the team's leads reach the office CRM", () => {
  beforeEach(() => {
    officeCtx = { officeId: "o1", ownerId: OWNER, role: "employee", isOwner: false };
    db.profiles.push({ id: OWNER, plan: "enterprise" });
    // A member's leads reach the agency's CRM from their COMPANY card.
    db.cards.push({ id: MEMBER_CARD, user_id: MEMBER, is_office_card: true });
  });

  it("…but not from a card the member kept from before they joined", async () => {
    const PERSONAL = "44444444-4444-4444-8444-444444444444";
    db.cards.push({ id: PERSONAL, user_id: MEMBER, is_office_card: false });
    connect("pipedrive", OWNER);
    expect(await getCrmConnection("pipedrive", "Pipedrive", OWNER, PERSONAL, MEMBER)).toBeNull();
  });

  it("a sub-user with no connection of their own inherits the owner's", async () => {
    connect("pipedrive", OWNER);
    expect(await resolveCrmOwnerId("pipedrive", MEMBER)).toBe(OWNER);
  });

  it("the owner's OWN-card scope does not drop a team member's lead", async () => {
    // The owner picked "only my work card". The picker never listed team
    // cards, so this must not mean "and none of my team's leads".
    connect("pipedrive", OWNER, { card_ids: [OWNER_CARD] });
    expect(await getCrmConnection("pipedrive", "Pipedrive", OWNER, MEMBER_CARD, MEMBER)).not.toBeNull();
  });

  it("…while the owner's own other cards are still filtered exactly as before", async () => {
    connect("pipedrive", OWNER, { card_ids: [OWNER_CARD] });
    const OTHER_OWNER_CARD = "33333333-3333-4333-8333-333333333333";
    expect(await getCrmConnection("pipedrive", "Pipedrive", OWNER, OTHER_OWNER_CARD, OWNER)).toBeNull();
    expect(await getCrmConnection("pipedrive", "Pipedrive", OWNER, OWNER_CARD, OWNER)).not.toBeNull();
  });

  it("a lapsed office owner's CRM stops receiving the team's leads", async () => {
    db.profiles = [{ id: OWNER, plan: "free" }];
    connect("pipedrive", OWNER);
    expect(await resolveCrmOwnerId("pipedrive", MEMBER)).toBe(MEMBER);
  });

  it("the team's leads also reach the owner's Zapier webhook", async () => {
    db.profiles.push({ id: MEMBER, plan: "enterprise", zapier_webhook_url: null });
    db.profiles[0] = { id: OWNER, plan: "enterprise", zapier_webhook_url: "https://hooks.zapier.com/hooks/catch/1/abc/", zapier_card_ids: [OWNER_CARD], customization: { crm: { views: true } } };
    const t = await resolveZapierTarget(MEMBER, MEMBER_CARD);
    expect(t?.url).toBe("https://hooks.zapier.com/hooks/catch/1/abc/");
    expect(t?.inherited).toBe(true);
    expect(t?.prefs.views).toBe(true);
  });

  it("a member's OWN webhook wins, and a non-Zapier URL never receives anything", async () => {
    db.profiles.push({ id: MEMBER, plan: "enterprise", zapier_webhook_url: "https://evil.example/hook" });
    db.profiles[0] = { id: OWNER, plan: "enterprise", zapier_webhook_url: "https://hooks.zapier.com/hooks/catch/1/abc/" };
    expect(await resolveZapierTarget(MEMBER, MEMBER_CARD)).toBeNull();
  });
});

describe("the rep's name travels with the lead", () => {
  it("the capture note names the card holder, not just the slug", () => {
    expect(describeCapture(lead)).toContain("Card: https://swiftcard.me/maya-card (Dana Rep)");
  });

  it("the Zapier payload carries it as its own field", () => {
    const p = zapierLeadPayload(lead);
    expect(p.card_name).toBe("Dana Rep");
    expect(p.type).toBe("lead.created");
    expect(p.company).toBe("Acme");
  });
});

describe("HighLevel", () => {
  beforeEach(() => connect("highlevel", "u1", { metadata: { location_id: "loc1" } }));

  it("never sends tags in the upsert (that REPLACES the contact's tags) — adds them after", async () => {
    respond = (url) => (url.endsWith("/contacts/upsert") ? json({ contact: { id: "c1" } }) : json({}));
    await syncLeadToHighLevel({ ...lead, tags: ["scanned"] }, "u1");
    const upsert = calls.find((c) => c.url.endsWith("/contacts/upsert"))!;
    expect((upsert.body as Row).tags).toBeUndefined();
    const tags = calls.find((c) => c.url.endsWith("/contacts/c1/tags"));
    expect(tags?.method).toBe("POST");
    expect((tags!.body as { tags: string[] }).tags).toEqual(["swiftcard", "swiftcard-maya-card", "scanned"]);
    expect(calls.some((c) => c.url.endsWith("/contacts/c1/notes"))).toBe(true);
  });

  it("an edit that didn't touch notes adds no second note", async () => {
    respond = (url) => (url.endsWith("/contacts/upsert") ? json({ contact: { id: "c1" } }) : json({}));
    await syncLeadToHighLevel(lead, "u1", { mode: "update", attachNote: false });
    expect(calls.some((c) => c.url.endsWith("/notes"))).toBe(false);
  });
});

describe("Pipedrive", () => {
  beforeEach(() => connect("pipedrive", "u1", { metadata: { api_domain: "https://acme.pipedrive.com" } }));

  it("a person already in Pipedrive is UPDATED, keeping the numbers they already had", async () => {
    respond = (url, method) => {
      if (url.includes("/persons/search")) return json({ data: { items: [{ item: { id: 7 } }] } });
      if (url.endsWith("/api/v2/persons/7") && method === "GET") {
        return json({ data: { id: 7, org_id: 99, emails: [{ value: "maya@acme.co", primary: true, label: "work" }], phones: [{ value: "+1 555 999 0000", primary: true, label: "work" }] } });
      }
      return json({ data: { id: 7 } });
    };
    await syncLeadToPipedrive(lead, "u1");
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/api/v2/persons"))).toBe(false);
    const patch = calls.find((c) => c.method === "PATCH" && c.url.endsWith("/api/v2/persons/7"))!;
    const body = patch.body as { phones: { value: string }[]; org_id?: number };
    expect(body.phones.map((p) => p.value)).toEqual(["+1 555 999 0000", "+1 555 010 0100"]);
    // Already linked to an org by a rep — not re-linked.
    expect(body.org_id).toBeUndefined();
  });

  it("a new person is created, with the capture note", async () => {
    respond = (url) => (url.includes("/search") ? json({ data: { items: [] } }) : json({ data: { id: 8 } }));
    await syncLeadToPipedrive(lead, "u1");
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/api/v2/persons"))).toBe(true);
    expect(calls.some((c) => c.url.endsWith("/v1/notes"))).toBe(true);
  });
});

describe("Google Contacts", () => {
  beforeEach(() => connect("google", "u1"));

  const existing = {
    resourceName: "people/c9",
    etag: "e1",
    emailAddresses: [{ value: "Maya@Acme.co" }],
    phoneNumbers: [{ value: "(555) 999-0000" }],
    biographies: [{ value: "Her kids are Noa and Ben — ask about the move." }],
  };

  it("an existing contact is updated in place, and the owner's own notes are left alone", async () => {
    respond = (url) => (url.includes("searchContacts") ? json({ results: [{ person: existing }] }) : json({}));
    await syncLeadToGoogle(lead, "u1");
    expect(calls.some((c) => c.url.endsWith("people:createContact"))).toBe(false);
    const upd = calls.find((c) => c.url.includes("people/c9:updateContact"))!;
    const body = upd.body as { etag: string; phoneNumbers: { value: string }[]; biographies: { value: string }[] };
    expect(body.etag).toBe("e1");
    expect(body.phoneNumbers.map((p) => p.value)).toEqual(["(555) 999-0000", "+1 555 010 0100"]);
    expect(body.biographies[0].value).toBe("Her kids are Noa and Ben — ask about the move.");
  });

  it("a prefix hit on a different address is NOT treated as the same person", async () => {
    respond = (url) =>
      url.includes("searchContacts")
        ? json({ results: [{ person: { ...existing, emailAddresses: [{ value: "maya@acme.com" }] } }] })
        : json({});
    await syncLeadToGoogle(lead, "u1");
    expect(calls.some((c) => c.url.endsWith("people:createContact"))).toBe(true);
  });

  // Google's search cache lags a new contact by minutes, so an edit made just
  // after a capture used to be unable to find it — and was made to never
  // create, which left contacts captured before connecting stuck out of
  // Google for good. The record id is now REMEMBERED at capture (crm_links),
  // so the edit updates it directly without searching at all.
  it("an edit updates the remembered contact by id, even while Google's search lags", async () => {
    db.crm_links.push({ lead_id: "L1", provider: "google", owner_id: "u1", record_id: "people/c9", record_kind: "person" });
    respond = (url) =>
      url.includes("searchContacts") ? json({ results: [] }) : url.includes("people/c9?personFields") ? json(existing) : json({});
    await syncLeadToGoogle({ ...lead, leadId: "L1" }, "u1", { mode: "update", changedFields: ["name"] });
    expect(calls.some((c) => c.url.includes("searchContacts"))).toBe(false);
    expect(calls.some((c) => c.url.endsWith("people:createContact"))).toBe(false);
    const upd = calls.find((c) => c.url.includes("people/c9:updateContact"))!;
    expect((upd.body as { names: { givenName: string }[] }).names[0].givenName).toBe("Maya");
  });
});

describe("Salesforce", () => {
  beforeEach(() => connect("salesforce", "u1", { metadata: { instance_url: "https://acme.my.salesforce.com" } }));

  it("a CONVERTED lead gets a Task on its Contact instead of a failed write or a duplicate", async () => {
    respond = (url) =>
      url.includes("/query")
        ? json({ records: [{ Id: "00Qold", IsConverted: true, ConvertedContactId: "003abc" }] })
        : json({ id: "00T1" }, 201);
    await syncLeadToSalesforce(lead, "u1");
    expect(calls.some((c) => c.url.includes("/sobjects/Lead"))).toBe(false);
    const task = calls.find((c) => c.url.endsWith("/sobjects/Task"))!;
    expect((task.body as Row).WhoId).toBe("003abc");
  });

  it("an open lead keeps the rep's Company and Description", async () => {
    respond = (url) =>
      url.includes("/query")
        ? json({ records: [{ Id: "00Qopen", IsConverted: false, LastName: "Cohen-Levi", FirstName: "Maya", Company: "Acme Holdings", Description: "Budget approved Q3 — call Tue" }] })
        : new Response(null, { status: 204 });
    await syncLeadToSalesforce(lead, "u1");
    const patch = calls.find((c) => c.method === "PATCH")!;
    const body = patch.body as Row;
    // Meeting someone again never overwrites what a rep typed in Salesforce —
    // it only fills what's blank (here, the phone).
    expect(body.Company).toBeUndefined();
    expect(body.Description).toBeUndefined();
    expect(body.LastName).toBeUndefined();
    expect(body.Phone).toBe("+1 555 010 0100");
  });

  it("over-long values are clipped instead of failing the whole write", async () => {
    respond = (url) => (url.includes("/query") ? json({ records: [] }) : json({ id: "00Qnew" }, 201));
    await syncLeadToSalesforce({ ...lead, name: `Maya ${"x".repeat(200)}` }, "u1");
    const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/sobjects/Lead"))!;
    expect(String((post.body as Row).LastName).length).toBe(80);
  });
});

describe("HubSpot", () => {
  beforeEach(() => connect("hubspot", "u1"));

  it("an edit that didn't touch notes adds no second note", async () => {
    respond = (url) =>
      url.endsWith("/contacts/search")
        ? json({ results: [{ id: "h1", properties: { email: "maya@acme.co", firstname: "Maya", lastname: "Cohen" } }] })
        : json({ id: "h1" });
    await syncLeadToHubSpot(lead, "u1", { mode: "update", attachNote: false });
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/crm/v3/objects/contacts"))).toBe(false);
    expect(calls.some((c) => c.url.endsWith("/objects/notes"))).toBe(false);
  });

  it("a capture attaches the note", async () => {
    respond = (url) => (url.endsWith("/crm/v3/objects/contacts") ? json({ id: "h1" }, 201) : json({}));
    await syncLeadToHubSpot(lead, "u1");
    expect(calls.some((c) => c.url.endsWith("/objects/notes"))).toBe(true);
  });
});
