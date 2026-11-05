import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  bindFormDevice,
  decideKnownContact,
  isOwnersOwnDetails,
  normalizeEmail,
  normalizePhone,
  resolveKnownContact,
} from "@/lib/known-contact";

// Warm-lead plan PR A4. A named "Priya re-opened your card" is only ever as
// good as the answer to "is this browser Priya?", so every rule in
// lib/known-contact.ts is pinned here against a tiny in-memory database.

type Row = Record<string, unknown>;
let db: Record<string, Row[]>;
let seq = 0;

function table(name: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "update" | "upsert" = "select";
  let patch: Row = {};
  const rows = () => (db[name] ??= []);
  const matching = () => rows().filter((r) => filters.every((f) => f(r)));
  const q = {
    select() { return q; },
    eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return q; },
    neq(c: string, v: unknown) { filters.push((r) => r[c] !== v); return q; },
    is(c: string, v: unknown) { filters.push((r) => (r[c] ?? null) === v); return q; },
    in(c: string, vs: unknown[]) { filters.push((r) => vs.includes(r[c])); return q; },
    gte(c: string, v: unknown) { filters.push((r) => String(r[c]) >= String(v)); return q; },
    lte(c: string, v: unknown) { filters.push((r) => String(r[c]) <= String(v)); return q; },
    update(p: Row) { op = "update"; patch = p; return q; },
    upsert(row: Row, opts: { onConflict: string }) {
      op = "upsert";
      const keys = opts.onConflict.split(",");
      const hit = rows().find((r) => keys.every((k) => r[k] === row[k]));
      if (hit) Object.assign(hit, row);
      else rows().push({ id: `row-${++seq}`, superseded_at: null, wrong_at: null, ...row });
      return Promise.resolve({ error: null });
    },
    maybeSingle() { return Promise.resolve({ data: matching()[0] ?? null, error: null }); },
    then(res: (v: { data: Row[] | null; error: null }) => unknown) {
      if (op === "update") {
        for (const r of matching()) Object.assign(r, patch);
        return Promise.resolve({ data: null, error: null }).then(res);
      }
      return Promise.resolve({ data: matching(), error: null }).then(res);
    },
  };
  return q;
}
const admin = { from: (n: string) => table(n) } as never;

const OWNER = "owner-1";
const bind = (lead_id: string, visitor_id: string, bound_via = "form", extra: Row = {}) =>
  db.contact_devices.push({ id: `b-${++seq}`, lead_id, owner_id: OWNER, visitor_id, bound_via, superseded_at: null, wrong_at: null, ...extra });
const lead = (id: string, extra: Row = {}) =>
  db.leads.push({ id, name: id, email: null, phone: null, card_owner: "dana-lee", created_at: "2026-09-01T00:00:00Z", status: null, tags: [], where_met: null, ...extra });

beforeEach(() => {
  db = {
    contact_devices: [],
    leads: [],
    profiles: [{ id: OWNER, email: "owner@example.com", phone: "+1 (917) 555-0100" }],
    cards: [{ user_id: OWNER, username: "dana-lee", email: "dana@acme.com", phone: "917-555-0199" }],
    card_events: [],
    card_views: [],
  };
});

describe("normalising the only identity keys we compare", () => {
  it("treats formatting differences in a phone as the same number", () => {
    expect(normalizePhone("+1 (917) 905-7335")).toBe(normalizePhone("9179057335"));
    expect(normalizePhone("12")).toBeNull();
  });
  it("lower-cases emails and refuses non-emails", () => {
    expect(normalizeEmail(" Priya@Example.COM ")).toBe("priya@example.com");
    expect(normalizeEmail("priya")).toBeNull();
  });
  it("recognises the owner's own details on the profile or any card", () => {
    const owner = { emails: new Set(["owner@example.com"]), phones: new Set(["9175550100"]) };
    expect(isOwnersOwnDetails({ phone: "917.555.0100" }, owner)).toBe(true);
    expect(isOwnersOwnDetails({ email: "OWNER@example.com" }, owner)).toBe(true);
    expect(isOwnersOwnDetails({ email: "priya@example.com" }, owner)).toBe(false);
  });
});

describe("resolving a browser to a contact", () => {
  it("is anonymous with no binding — today's behaviour", async () => {
    expect(await resolveKnownContact(admin, { ownerId: OWNER, visitorId: "v1" })).toEqual({ kind: "anonymous" });
  });

  it("names the one lead bound to the browser", async () => {
    lead("priya", { name: "Priya", where_met: "RE/MAX Summit" });
    bind("priya", "v1");
    const r = await resolveKnownContact(admin, { ownerId: OWNER, visitorId: "v1" });
    expect(r).toMatchObject({ kind: "known", leadId: "priya", name: "Priya", confidence: "form", whereMet: "RE/MAX Summit" });
  });

  it("is scoped to the owner: another owner's binding says nothing here", async () => {
    lead("priya");
    bind("priya", "v1", "form", { owner_id: "someone-else" });
    expect((await resolveKnownContact(admin, { ownerId: OWNER, visitorId: "v1" })).kind).toBe("anonymous");
  });

  it("two different people on one browser is AMBIGUOUS, never a guess", async () => {
    lead("priya", { email: "priya@example.com" });
    lead("sam", { email: "sam@example.com", created_at: "2026-09-02T00:00:00Z" });
    bind("priya", "ipad");
    bind("sam", "ipad");
    expect((await resolveKnownContact(admin, { ownerId: OWNER, visitorId: "ipad" })).kind).toBe("ambiguous");
  });

  it("the same person who submitted twice is one person — the newest lead", async () => {
    lead("priya-1", { phone: "917 555 1234" });
    lead("priya-2", { phone: "+19175551234", created_at: "2026-09-05T00:00:00Z" });
    bind("priya-1", "v1");
    bind("priya-2", "v1");
    expect(await resolveKnownContact(admin, { ownerId: OWNER, visitorId: "v1" })).toMatchObject({ kind: "known", leadId: "priya-2" });
  });

  it("ignores superseded and wrong-person bindings", async () => {
    lead("priya");
    bind("priya", "v1", "form", { superseded_at: "2026-09-03T00:00:00Z" });
    bind("priya", "v2", "form", { wrong_at: "2026-09-03T00:00:00Z" });
    expect((await resolveKnownContact(admin, { ownerId: OWNER, visitorId: "v1" })).kind).toBe("anonymous");
    expect((await resolveKnownContact(admin, { ownerId: OWNER, visitorId: "v2" })).kind).toBe("anonymous");
  });

  it("never names the owner as their own contact", async () => {
    lead("me", { email: "owner@example.com" });
    bind("me", "v1");
    expect((await resolveKnownContact(admin, { ownerId: OWNER, visitorId: "v1" })).kind).toBe("anonymous");
  });

  it("reports the strongest evidence it has for the lead", () => {
    const r = decideKnownContact(
      [{ lead_id: "p", bound_via: "link" }, { lead_id: "p", bound_via: "form" }],
      [{ id: "p", name: "P", email: null, phone: null, card_owner: "x", created_at: "t", status: null, tags: null, where_met: null }],
      { emails: new Set(), phones: new Set() },
    );
    expect(r).toMatchObject({ kind: "known", confidence: "form" });
  });

  it("degrades to anonymous when the tables don't exist yet", async () => {
    const broken = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ is: () => Promise.resolve({ data: null, error: { code: "PGRST205" } }) }) }) }) }) }) } as never;
    expect(await resolveKnownContact(broken, { ownerId: OWNER, visitorId: "v1" })).toEqual({ kind: "anonymous" });
  });
});

describe("binding the browser that submitted the form", () => {
  it("binds it as 'form'", async () => {
    lead("priya", { email: "priya@example.com" });
    expect(await bindFormDevice(admin, { leadId: "priya", ownerId: OWNER, visitorId: "v1", email: "priya@example.com", phone: null })).toBe("bound");
    expect(db.contact_devices).toHaveLength(1);
    expect(db.contact_devices[0]).toMatchObject({ lead_id: "priya", bound_via: "form", superseded_at: null });
  });

  it("refuses to bind the owner's own details", async () => {
    expect(await bindFormDevice(admin, { leadId: "me", ownerId: OWNER, visitorId: "v1", email: null, phone: "(917) 555-0199" })).toBe("owner");
    expect(db.contact_devices).toHaveLength(0);
  });

  it("a different person on the same browser supersedes the previous one", async () => {
    lead("priya", { email: "priya@example.com" });
    lead("sam", { email: "sam@example.com" });
    bind("priya", "ipad");
    await bindFormDevice(admin, { leadId: "sam", ownerId: OWNER, visitorId: "ipad", email: "sam@example.com", phone: null });
    const priya = db.contact_devices.find((b) => b.lead_id === "priya")!;
    expect(priya.superseded_at).not.toBeNull();
    expect(await resolveKnownContact(admin, { ownerId: OWNER, visitorId: "ipad" })).toMatchObject({ kind: "known", leadId: "sam" });
  });

  // 2026-10-23: the visit they shared in becomes THEIR data, not a window
  // recomputed at read time that a re-share or a second person could move.
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const event = (id: string, at: string, extra: Row = {}) =>
    db.card_events.push({ id, card_owner_username: "dana-lee", visitor_id: "ipad", event_type: "viewed_card", created_at: at, lead_id: null, ...extra });

  it("stamps the visit that led to the share with the new contact", async () => {
    lead("priya", { email: "priya@example.com" });
    event("before", ago(20));
    event("long-ago", ago(180));
    event("someone-else", ago(10), { visitor_id: "other-phone" });
    db.card_views.push({ id: "cv", username: "dana-lee__links", visitor_id: "ipad", viewed_at: ago(15), lead_id: null });
    await bindFormDevice(admin, { leadId: "priya", ownerId: OWNER, visitorId: "ipad", email: "priya@example.com", phone: null });
    const byId = Object.fromEntries(db.card_events.map((e) => [e.id, e]));
    expect(byId.before).toMatchObject({ lead_id: "priya", lead_confidence: "form" });
    expect(byId["long-ago"].lead_id).toBeNull();
    expect(byId["someone-else"].lead_id).toBeNull();
    expect(db.card_views[0].lead_id).toBe("priya");
  });

  it("a second person sharing on the same device takes the visit before THEIR share, never the first person's capture visit", async () => {
    lead("priya", { email: "priya@example.com" });
    lead("sam", { email: "sam@example.com" });
    // Priya shared 70 minutes ago; her capture view is hers.
    bind("priya", "ipad", "form", { bound_at: ago(70) });
    event("priya-capture", ago(72), { lead_id: "priya", lead_confidence: "form" });
    // Sam opened the card 5 minutes ago — the resolver called him Priya.
    event("sam-view", ago(5), { lead_id: "priya", lead_confidence: "form" });
    await bindFormDevice(admin, { leadId: "sam", ownerId: OWNER, visitorId: "ipad", email: "sam@example.com", phone: null });
    const byId = Object.fromEntries(db.card_events.map((e) => [e.id, e]));
    expect(byId["sam-view"].lead_id).toBe("sam");
    expect(byId["priya-capture"].lead_id).toBe("priya");
  });

  it("a one-tap re-share keeps the original binding time", async () => {
    lead("priya", { email: "priya@example.com" });
    bind("priya", "ipad", "form", { bound_at: "2026-10-01T15:00:00.000Z" });
    await bindFormDevice(admin, { leadId: "priya", ownerId: OWNER, visitorId: "ipad", email: "priya@example.com", phone: null });
    expect(db.contact_devices).toHaveLength(1);
    expect(db.contact_devices[0].bound_at).toBe("2026-10-01T15:00:00.000Z");
  });

  it("the same person re-submitting does not supersede themselves", async () => {
    lead("priya-1", { email: "priya@example.com" });
    lead("priya-2", { email: "priya@example.com" });
    bind("priya-1", "v1");
    await bindFormDevice(admin, { leadId: "priya-2", ownerId: OWNER, visitorId: "v1", email: "Priya@example.com", phone: null });
    expect(db.contact_devices.find((b) => b.lead_id === "priya-1")!.superseded_at).toBeNull();
  });
});

describe("the routes use it the way the rules assume", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const events = read("src/app/api/card-events/route.ts");
  const leads = read("src/app/api/leads/route.ts");
  const lib = read("src/lib/known-contact.ts");

  it("card-events stamps lead_id only from the server-side resolution", () => {
    expect(events).toMatch(/resolveKnownContact\(admin, \{ ownerId, visitorId: visitor_id \}\)/);
    expect(events).toMatch(/contact\.kind === "known" \? \{ lead_id: contact\.leadId, lead_confidence: contact\.confidence \}/);
    expect(events).toMatch(/leadId: knownLeadId,/);
  });

  it("the resolution runs AFTER the owner exclusion, so an owner is never a contact", () => {
    expect(events.indexOf("isOwnerActivity(")).toBeGreaterThan(-1);
    expect(events.indexOf("resolveKnownContact(")).toBeGreaterThan(events.indexOf("isOwnerActivity("));
  });

  it("the lead route binds the RESOLVED visitor id, after the response", () => {
    // …at the time the share really happened when the offline outbox replays it.
    expect(leads).toMatch(/bindFormDevice\(admin, \{ leadId, ownerId, visitorId: visitor_id, email, phone, at: replayAt \}\)/);
    expect(leads).toMatch(/after\(\s*\n\s*bindFormDevice/);
  });

  it("never trusts anything the visitor's browser volunteered", () => {
    expect(lib).not.toMatch(/visitor_name|visitor_email|visitor_phone|user-agent|clientIp/);
  });
});
