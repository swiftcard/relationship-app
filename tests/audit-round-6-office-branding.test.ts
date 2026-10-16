import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// ── Audit round 6 (2026-10-16): Office Branding saves what it says ──────────
//
// C02-A01  A failed brand save fell into retries meant only for a missing
//          column, kept just logo/company/website/template, and answered ok:
//          "Applied ✓" for a change that mostly didn't happen.
// C02-A02  The second propagation pass branded every active membership row,
//          without the profiles.office_id check the route's own pass uses, so
//          a departed member with a stale row got the office written over
//          their own card.
// C02-A39  (render test: tests/render/unsaved-leave-guard.interactive.test.ts)

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
const cardUpdates: { id: unknown; patch: Row }[] = [];

function makeQuery(name: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: { kind: string; value?: Row } = { kind: "select" };
  const rows = () => (db[name] ??= []);
  const matches = () => rows().filter((r) => filters.every((f) => f(r)));
  const run = () => {
    if (op.kind === "update") {
      const hit = matches();
      if (name === "cards") hit.forEach((r) => cardUpdates.push({ id: r.id, patch: op.value! }));
      hit.forEach((r) => Object.assign(r, op.value));
      return { data: hit, error: null };
    }
    return { data: matches(), error: null };
  };
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return chain; },
    in: (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return chain; },
    is: () => chain, not: () => chain, order: () => chain, limit: () => chain,
    update: (v: Row) => { op = { kind: "update", value: v }; return chain; },
    delete: () => { op = { kind: "delete" }; return chain; },
    maybeSingle: async () => ({ data: run().data?.[0] ?? null, error: null }),
    single: async () => ({ data: run().data?.[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return chain;
}

vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => ({
    from: (t: string) => makeQuery(t),
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
  }),
}));
vi.mock("@/lib/card-page-data", () => ({ revalidateCardPage: () => {}, revalidateUserCards: async () => {} }));

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  cardUpdates.length = 0;
  db.offices = [{ id: "off1", owner_id: "owner", brand_company: "Harbor Realty", brand_logo_url: "https://x/logo.png", brand_website: null, brand_template: null, brand_locks: {} }];
  db.office_members = [
    { office_id: "off1", user_id: "member", status: "active" },
    { office_id: "off1", user_id: "departed", status: "active" }, // stale row
  ];
  db.profiles = [
    { id: "owner", office_id: "off1" },
    { id: "member", office_id: "off1" },
    { id: "departed", office_id: null }, // left; the membership row was never cleaned up
  ];
  db.cards = [
    { id: "c-owner", user_id: "owner", is_office_card: true, customization: {}, company: "Mine" },
    { id: "c-member", user_id: "member", is_office_card: true, customization: {}, company: "Old" },
    { id: "c-departed", user_id: "departed", is_office_card: true, customization: {}, company: "Their own company" },
  ];
});

describe("C02-A02: propagation brands only members still in the office", () => {
  it("the member gets the brand; the departed member and the owner keep their own cards", async () => {
    const { propagateBrandToOfficeCards } = await import("@/lib/office-brand");
    await propagateBrandToOfficeCards("off1");
    const touched = new Set(cardUpdates.map((u) => u.id));
    expect(touched.has("c-member")).toBe(true);
    expect(touched.has("c-departed")).toBe(false);
    expect(touched.has("c-owner")).toBe(false);
    expect(db.cards.find((c) => c.id === "c-departed")!.company).toBe("Their own company");
  });
});

describe("C02-A01: a brand save that fails says so", () => {
  const route = readFileSync("src/app/api/office/brand/route.ts", "utf8");

  it("the fewer-columns retries run ONLY for a missing column", () => {
    expect(route).toContain('const missingColumn = (e: { code?: string } | null) => e?.code === "42703" || e?.code === "PGRST204";');
    expect(route).toMatch(/if \(error && missingColumn\(error\) && Object\.keys\(linkFields\)\.length\) \{/);
    expect(route).toMatch(/if \(error && missingColumn\(error\)\) \{\s*\(\{ error \} = await admin\.from\("offices"\)\.update\(\{\s*brand_logo_url:/);
    // Never an unconditional retry into a partial save.
    expect(route).not.toMatch(/\n\s*if \(error\) \{\s*\(\{ error \} = await admin\.from\("offices"\)\.update\(/);
  });

  it("any other failure is an error the admin sees, not a raw database message", () => {
    expect(route).toContain('return NextResponse.json({ error: "Couldn\'t save the branding. Nothing was changed — try again." }, { status: 500 });');
    expect(route).not.toMatch(/return NextResponse\.json\(\{ error: error\.message \}, \{ status: 500 \}\)/);
  });
});
