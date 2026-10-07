import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Contacts never vanish when someone leaves a team (owner, 2026-10-07) ─────
//
// The office's Contacts tab is every contact on a CURRENT teammate's cards plus
// every contact stamped with the office tag. Only the admin's Remove button
// stamped, and only the first 1,000 — a seat reduction, the Office plan ending,
// a switch to Pro, or the teammate accepting another team's invite stamped
// nothing, and every one of their contacts silently left the company's list.

// ── A tiny in-memory Supabase: just the calls lib/office-departure makes ────
type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
let beforeFirstUpdate: (() => void) | null = null;

class Query {
  private filters: ((r: Row) => boolean)[] = [];
  private mode: "select" | "update" | "insert" = "select";
  private patch: Row = {};
  private orderBy: string | null = null;
  private max: number | null = null;
  constructor(private table: string) {}
  select() { return this; }
  update(p: Row) { this.mode = "update"; this.patch = p; return this; }
  insert(r: Row) { this.mode = "insert"; this.patch = r; return this; }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  gt(c: string, v: string) { this.filters.push((r) => String(r[c]) > v); return this; }
  is(c: string, v: unknown) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  contains(c: string, a: string[]) { this.filters.push((r) => Array.isArray(r[c]) && a.every((x) => (r[c] as string[]).includes(x))); return this; }
  containedBy(c: string, a: string[]) { this.filters.push((r) => Array.isArray(r[c]) && (r[c] as string[]).every((x) => a.includes(x))); return this; }
  order(c: string) { this.orderBy = c; return this; }
  limit(n: number) { this.max = n; return this; }
  maybeSingle() { return this.run().then(({ data }) => ({ data: (data as Row[])[0] ?? null, error: null })); }
  then<T>(ok: (v: { data: unknown; error: null }) => T, bad?: (e: unknown) => T) { return this.run().then(ok, bad); }
  private async run(): Promise<{ data: unknown; error: null }> {
    const rows = (db[this.table] ??= []);
    if (this.mode === "insert") { rows.push(this.patch); return { data: null, error: null }; }
    let hit = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.mode === "update") {
      if (beforeFirstUpdate) { const f = beforeFirstUpdate; beforeFirstUpdate = null; f(); hit = rows.filter((r) => this.filters.every((fn) => fn(r))); }
      for (const r of hit) Object.assign(r, structuredClone(this.patch));
      return { data: hit.map((r) => ({ id: r.id })), error: null };
    }
    if (this.orderBy) hit = [...hit].sort((a, b) => String(a[this.orderBy!]).localeCompare(String(b[this.orderBy!])));
    if (this.max != null) hit = hit.slice(0, this.max);
    return { data: hit.map((r) => ({ ...r })), error: null };
  }
}
vi.mock("@/lib/supabase-admin", () => ({ getAdminSupabase: () => ({ from: (t: string) => new Query(t) }) }));

const { keepContactsWithOffice, recordOfficeDeparture } = await import("@/lib/office-departure");
const { officeLeadTag } = await import("@/lib/office-leads");

const OFFICE = "office-1";
const TAG = officeLeadTag(OFFICE);
const pad = (n: number) => String(n).padStart(6, "0");

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  beforeFirstUpdate = null;
  db.profiles = [{ id: "u1", username: "jane" }];
  db.cards = [{ user_id: "u1", username: "jane" }, { user_id: "u1", username: "jane-realty" }];
});

describe("every contact stays — not the first 1,000", () => {
  it("stamps 2,600 contacts across both cards, keeping each one's own tags", async () => {
    db.leads = Array.from({ length: 2600 }, (_, i) => ({
      id: `id-${pad(i)}`,
      card_owner: i % 2 ? "jane" : "jane-realty",
      tags: i % 3 === 0 ? null : i % 3 === 1 ? ["unread"] : ["unread", "sc-locked"],
    }));
    // Someone else's contact must not be touched.
    db.leads.push({ id: "id-zzzzzz", card_owner: "bob", tags: null });

    const out = await keepContactsWithOffice(OFFICE, "u1");
    expect(out.slugs.sort()).toEqual(["jane", "jane-realty"]);
    expect(out.stamped).toBe(2600);
    expect(out.missed).toBe(0);
    const janes = db.leads.filter((l) => l.card_owner !== "bob");
    expect(janes.every((l) => (l.tags as string[]).includes(TAG))).toBe(true);
    expect(janes.filter((l) => (l.tags as string[]).includes("sc-locked")).length).toBe(866);
    expect(db.leads.find((l) => l.card_owner === "bob")!.tags).toBeNull();
  });

  it("never stamps twice", async () => {
    db.leads = [{ id: "a", card_owner: "jane", tags: ["unread", TAG] }, { id: "b", card_owner: "jane", tags: null }];
    const out = await keepContactsWithOffice(OFFICE, "u1");
    expect(out.stamped).toBe(1);
    expect(db.leads[0].tags).toEqual(["unread", TAG]);
    expect(db.leads[1].tags).toEqual([TAG]);
  });

  it("a contact edited mid-way is not overwritten, and is still stamped", async () => {
    db.leads = [{ id: "a", card_owner: "jane", tags: ["unread"] }];
    // Between the read and the write, the teammate pauses its follow-up.
    beforeFirstUpdate = () => { db.leads[0].tags = ["unread", "flow-paused"]; };
    const out = await keepContactsWithOffice(OFFICE, "u1");
    expect(out.missed).toBe(0);
    expect(db.leads[0].tags).toEqual(["unread", "flow-paused", TAG]);
  });

  it("records the departure so the contact drawer can date their history", async () => {
    db.leads = [{ id: "a", card_owner: "jane", tags: null }];
    await recordOfficeDeparture(OFFICE, "u1", "seats_reduced");
    expect(db.leads[0].tags).toEqual([TAG]);
    const audit = db.audit_logs?.[0] as Row;
    expect(audit.action).toBe("member.removed");
    expect(audit.org_id).toBe(OFFICE);
    expect(audit.target_id).toBe("u1");
    expect((audit.metadata as Row).reason).toBe("seats_reduced");
    expect(((audit.metadata as Row).slugs as string[]).sort()).toEqual(["jane", "jane-realty"]);
  });
});

// ── Every way off a team goes through it ────────────────────────────────────
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("no way of leaving skips it", () => {
  it("Remove from team: no 1,000 cap, the shared stamping", () => {
    const route = code("src/app/api/office/members/route.ts");
    expect(route).not.toMatch(/\.limit\(1000\)/);
    expect(route).toContain("await keepContactsWithOffice(office.id as string, member.user_id as string, removedSlugs)");
    // Stamped before the membership row is deleted.
    expect(route.indexOf("keepContactsWithOffice(")).toBeLessThan(route.indexOf('.from("office_members")\n    .delete()'));
  });

  it("seats reduced and the subscription ending (the webhook's release)", () => {
    const hook = code("src/app/api/stripe/webhook/route.ts");
    const release = hook.slice(hook.indexOf("async function releaseOfficeMember("), hook.indexOf("export async function POST("));
    expect(release).toContain("await recordOfficeDeparture(officeId, userId, reason);");
    expect(release.indexOf("recordOfficeDeparture(")).toBeLessThan(release.indexOf('status: "suspended"'));
    expect(hook).toContain('office.id as string, "seats_reduced");');
    expect(hook).toContain('office.id as string, "office_ended");');
  });

  it("Office → Pro, an expired free Office month, an owner deleting their account", () => {
    const sync = code("src/lib/office-billing-sync.ts");
    const teardown = sync.slice(sync.indexOf("export async function tearDownOfficeForOwner"));
    expect(teardown).toContain('await recordOfficeDeparture(office.id as string, uid, "office_ended");');
    expect(teardown.indexOf("recordOfficeDeparture(")).toBeLessThan(teardown.indexOf('update({ status: "suspended" })'));
  });

  it("accepting an invite to another team", () => {
    const join = code("src/app/api/join/route.ts");
    expect(join).toContain('await recordOfficeDeparture(r.office_id as string, user.id, "joined_another_team");');
    // Stamped before the old membership is deleted.
    expect(join.indexOf("recordOfficeDeparture(")).toBeLessThan(join.indexOf('.from("office_members")\n    .delete()'));
  });

  it("a stamping failure is reported, never silent, and never blocks the departure", () => {
    const lib = code("src/lib/office-departure.ts");
    expect(lib).toContain('reportError("office.departure-contacts-failed"');
    expect(lib).toContain('reportError("office.departure-contacts-missed"');
    const route = code("src/app/api/office/members/route.ts");
    expect(route).toContain('reportError("office.remove-contacts-failed"');
  });
});
