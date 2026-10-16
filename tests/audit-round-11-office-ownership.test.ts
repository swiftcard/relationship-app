import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// ── Audit round 11 (2026-10-16): every team has one office and an owner ─────
//
// B-07  Two provisioning paths run at once for a new Office (checkout +
//       subscription.updated; in-app swap + webhook). Both saw no office and
//       both inserted; with two rows the owner lost the console and invites.
// B-08  An owner removed outside the app (Supabase dashboard, QA cleanup) left
//       the members on unpaid Office, refused account deletion and checkout as
//       "sub-users", with no admin left who could remove them.
// B-10  A referral reward credited unit_amount × months: for an annual
//       subscriber that is a YEAR for the month promised, and for an Office
//       team one seat of the team's month.

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
let tick = 0;
let failProfilesRead = false;

function makeQuery(name: string) {
  const filters: ((r: Row) => boolean)[] = [];
  const orders: string[] = [];
  let op: { kind: string; value?: Row } = { kind: "select" };
  let head = false;
  const rows = () => (db[name] ??= []);
  const matches = () => rows().filter((r) => filters.every((f) => f(r)));
  const run = async () => {
    await Promise.resolve(); // every query is a real await, so racers interleave
    if (op.kind === "update") { const hit = matches(); hit.forEach((r) => Object.assign(r, op.value)); return { data: hit, error: null }; }
    if (op.kind === "delete") { const hit = new Set(matches()); db[name] = rows().filter((r) => !hit.has(r)); return { data: null, error: null }; }
    if (op.kind === "insert") {
      const v = { id: `${name}_${++tick}`, created_at: new Date(Date.UTC(2026, 9, 16, 0, 0, tick)).toISOString(), ...op.value };
      rows().push(v);
      return { data: [v], error: null };
    }
    if (name === "profiles" && failProfilesRead) return { data: null, error: { message: "db down" }, count: null };
    let m = matches();
    for (const k of [...orders].reverse()) m = [...m].sort((a, b) => String(a[k]).localeCompare(String(b[k])));
    return { data: head ? null : m, error: null, count: m.length };
  };
  const chain: Record<string, unknown> = {
    select: (_c?: string, o?: { head?: boolean }) => { if (o?.head) head = true; return chain; },
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return chain; },
    in: (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return chain; },
    not: (k: string, _o: string, v: unknown) => { filters.push((r) => (v === null ? r[k] != null : r[k] !== v)); return chain; },
    order: (k: string) => { orders.push(k); return chain; },
    limit: () => chain,
    update: (v: Row) => { op = { kind: "update", value: v }; return chain; },
    insert: (v: Row) => { op = { kind: "insert", value: v }; return chain; },
    delete: () => { op = { kind: "delete" }; return chain; },
    maybeSingle: async () => {
      const r = await run();
      if (r.error) return { data: null, error: r.error };
      const d = (r.data ?? []) as Row[];
      // As PostgREST does: two rows is an error, not the first one.
      return d.length > 1 ? { data: null, error: { code: "PGRST116" } } : { data: d[0] ?? null, error: null };
    },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run().then(res, rej),
  };
  return chain;
}
const fakeDb = { from: (t: string) => makeQuery(t) };

vi.mock("@/lib/supabase-admin", () => ({ getAdminSupabase: () => fakeDb }));
vi.mock("@/lib/report-error", () => ({ reportError: async () => {} }));
vi.mock("@/lib/notify", () => ({ insertNotification: async () => true }));
vi.mock("@/lib/office-departure", () => ({ recordOfficeDeparture: async () => {} }));
vi.mock("@/lib/office-brand", () => ({
  getOfficeBrand: async () => null,
  stripBrandFromUserCards: async () => {},
  memberFallbackPlan: async () => "free",
  seedBrandFromOwnersFirstCard: async () => {},
  applyBrandToUserCards: async () => {},
}));

import { provisionOfficeForOwner, releaseOrphanedOffices } from "@/lib/office-billing-sync";
import { resolveOfficeContext } from "@/lib/office-roles";
import { referralCreditCents } from "@/lib/referral-server";
import { PLAN_PRICES } from "@/lib/plan";

const read = (p: string) => readFileSync(p, "utf8");

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  tick = 0;
  failProfilesRead = false;
});

describe("B-07: one office per owner, even when two provisioning paths race", () => {
  it("two simultaneous provisions leave exactly one office, with the seats asked for", async () => {
    db.profiles = [{ id: "own", name: "Dana", company: null }];
    db.cards = [{ user_id: "own", company: "Acme Realty", name: "Dana", created_at: "2026-01-01" }];
    await Promise.all([provisionOfficeForOwner(fakeDb as never, "own", 5), provisionOfficeForOwner(fakeDb as never, "own", 5)]);
    expect(db.offices).toHaveLength(1);
    expect(db.offices[0]).toMatchObject({ owner_id: "own", name: "Acme Realty", seats: 5 });
  });

  it("the oldest office is the one kept — a racer only ever deletes the row it made", async () => {
    db.profiles = [{ id: "own" }];
    db.offices = [{ id: "office_old", owner_id: "own", seats: 3, created_at: "2026-01-01T00:00:00.000Z" }];
    db.office_members = [{ id: "m1", office_id: "office_old", user_id: "u1", status: "active" }];
    // Simulate the race's losing side: it saw no office and inserted anyway.
    await Promise.all([provisionOfficeForOwner(fakeDb as never, "own", 4), provisionOfficeForOwner(fakeDb as never, "own", 4)]);
    expect(db.offices.map((o) => o.id)).toEqual(["office_old"]);
    expect(db.offices[0].seats).toBe(4);
  });

  it("the unique index ships with the repo", () => {
    expect(read("supabase/offices-one-per-owner.sql")).toContain("create unique index if not exists offices_owner_uidx on public.offices (owner_id);");
  });
});

describe("B-08: a team whose owner is gone lets its members go", () => {
  beforeEach(() => {
    db.offices = [
      { id: "o_orphan", owner_id: "gone", seats: 5 },
      { id: "o_live", owner_id: "here", seats: 5 },
    ];
    db.profiles = [
      { id: "here", plan: "enterprise", customization: {} },
      { id: "m_orphan", plan: "enterprise", office_id: "o_orphan", customization: { _planChosen: "enterprise" } },
      { id: "m_live", plan: "enterprise", office_id: "o_live", customization: {} },
    ];
    db.cards = [];
    db.office_members = [
      { id: "mm1", office_id: "o_orphan", user_id: "m_orphan", status: "active", role: "employee" },
      { id: "mm2", office_id: "o_live", user_id: "m_live", status: "active", role: "employee" },
    ];
  });

  it("a member of an ownerless team is nobody's sub-user; a real team's member still is", async () => {
    expect(await resolveOfficeContext("m_orphan")).toBeNull();
    expect(await resolveOfficeContext("m_live")).toMatchObject({ officeId: "o_live", ownerId: "here", isOwner: false });
  });

  it("the daily sweep releases them exactly as an ended subscription would — and only them", async () => {
    expect(await releaseOrphanedOffices(fakeDb as never)).toBe(1);
    const p = (id: string) => db.profiles.find((r) => r.id === id)!;
    expect(p("m_orphan")).toMatchObject({ plan: "free", office_id: null });
    expect(db.office_members.find((m) => m.id === "mm1")?.status).toBe("suspended");
    expect(p("m_live")).toMatchObject({ plan: "enterprise", office_id: "o_live" });
    expect(db.office_members.find((m) => m.id === "mm2")?.status).toBe("active");
    // Nothing left to release the next day.
    expect(await releaseOrphanedOffices(fakeDb as never)).toBe(0);
  });

  it("a failed read of the owners never looks like every owner is gone", async () => {
    failProfilesRead = true;
    await expect(releaseOrphanedOffices(fakeDb as never)).rejects.toBeTruthy();
    expect(db.office_members.every((m) => m.status === "active")).toBe(true);
  });

  it("the daily cron runs the sweep and reports it", () => {
    const cron = read("src/app/api/reminders/route.ts");
    expect(cron).toContain("orphanMembersReleased = await releaseOrphanedOffices(supabase);");
    expect(cron).toMatch(/seatReductionsApplied, orphanMembersReleased,/);
  });
});

describe("B-10: a referral reward is one month of what they pay", () => {
  const monthly = (unit: number) => ({ unit_amount: unit, recurring: { interval: "month", interval_count: 1 } });
  const annual = (unit: number) => ({ unit_amount: unit, recurring: { interval: "year", interval_count: 1 } });

  it("monthly Pro: the monthly price", () => {
    expect(referralCreditCents(monthly(PLAN_PRICES.PRO_MONTHLY_CENTS), 1, 1)).toBe(PLAN_PRICES.PRO_MONTHLY_CENTS);
  });

  it("annual Pro: a twelfth of the year, never the whole year", () => {
    expect(referralCreditCents(annual(PLAN_PRICES.PRO_ANNUAL_CENTS), 1, 1)).toBe(Math.round(PLAN_PRICES.PRO_ANNUAL_CENTS / 12));
  });

  it("Office: every seat, monthly or annual", () => {
    expect(referralCreditCents(monthly(PLAN_PRICES.OFFICE_MONTHLY_PER_SEAT_CENTS), 5, 1)).toBe(PLAN_PRICES.OFFICE_MONTHLY_PER_SEAT_CENTS * 5);
    expect(referralCreditCents(annual(PLAN_PRICES.OFFICE_ANNUAL_PER_SEAT_CENTS), 5, 1)).toBe(Math.round(PLAN_PRICES.OFFICE_ANNUAL_PER_SEAT_CENTS / 12) * 5);
  });

  it("the claim credits through it", () => {
    expect(read("src/lib/referral-server.ts")).toContain("const amount = referralCreditCents(price, item?.quantity, months);");
  });
});
