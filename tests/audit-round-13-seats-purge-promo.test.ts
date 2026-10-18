import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// ── Audit round 13 (2026-10-18): one seat rule, a purge that finishes, a
//    promo use that is spent by a purchase ──────────────────────────────────
//
// B-16  The plan switcher lowered Office seats at once with a prorated credit,
//       around the Team seats rule (paid to the billing date; free only within
//       24 hours of adding).
// B-17  The purge treated supabase-js's resolved { error } as success, deleted
//       the profile and auth user anyway, and never reached several tables.
// B-18  A capped code's use was spent on every Apply, never given back.

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
const failTables = new Set<string>();
const reported: string[] = [];

function makeQuery(name: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: { kind: string; value?: Row } = { kind: "select" };
  let max = Infinity;
  const rows = () => (db[name] ??= []);
  const matches = () => rows().filter((r) => filters.every((f) => f(r)));
  const run = async () => {
    if (failTables.has(name) && op.kind !== "select") return { data: null, error: { code: "57014", message: "statement timeout" } };
    if (op.kind === "update") { const hit = matches(); hit.forEach((r) => Object.assign(r, op.value)); return { data: hit, error: null }; }
    if (op.kind === "delete") { const hit = matches(); const set = new Set(hit); db[name] = rows().filter((r) => !set.has(r)); return { data: hit, error: null }; }
    if (op.kind === "insert") { rows().push({ ...op.value }); return { data: [op.value], error: null }; }
    return { data: matches().slice(0, max), error: null };
  };
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return chain; },
    in: (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return chain; },
    is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return chain; },
    lt: (k: string, v: string) => { filters.push((r) => String(r[k] ?? "") < v); return chain; },
    not: () => chain, or: () => chain, order: () => chain,
    limit: (n: number) => { max = n; return chain; },
    update: (v: Row) => { op = { kind: "update", value: v }; return chain; },
    insert: (v: Row) => { op = { kind: "insert", value: v }; return chain; },
    delete: () => { op = { kind: "delete" }; return chain; },
    maybeSingle: async () => { const r = await run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; },
    single: async () => { const r = await run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run().then(res, rej),
  };
  return chain;
}
let authDeleted: string[] = [];
const fakeDb = {
  from: (t: string) => makeQuery(t),
  auth: { admin: { deleteUser: async (id: string) => { authDeleted.push(id); return { data: null, error: null }; } } },
  storage: { from: () => ({ list: async () => ({ data: [], error: null }), remove: async () => ({ data: null, error: null }) }) },
};

vi.mock("@/lib/supabase-admin", () => ({ getAdminSupabase: () => fakeDb }));
vi.mock("@/lib/report-error", () => ({ reportError: async (ctx: string) => { reported.push(ctx); } }));
vi.mock("@/lib/release-slug", () => ({ releaseSlugArtifacts: async () => {}, prevSlugsOf: () => [] }));
vi.mock("@/lib/office-brand", () => ({ memberFallbackPlan: async () => "free" }));

import { purgeUserData } from "@/lib/account-purge";
import { releaseAbandonedPromoClaims, ABANDONED_CLAIM_MS } from "@/lib/promo-claim";

const read = (p: string) => readFileSync(p, "utf8");
const U = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  failTables.clear();
  reported.length = 0;
  authDeleted = [];
});

describe("B-16: the plan switcher never lowers Office seats", () => {
  const route = read("src/app/api/stripe/subscription/change-plan/route.ts");

  it("asks for the Team seats control instead, before anything in Stripe is touched", () => {
    const refuse = route.indexOf('{ error: "use_seats_control"');
    expect(refuse).toBeGreaterThan(0);
    expect(refuse).toBeLessThan(route.indexOf("restorePendingSeatReduction(subjectId, sub)"));
    expect(refuse).toBeLessThan(route.indexOf("subscriptions.update("));
    expect(route).toMatch(/if \(wasOffice && seats < paidQty\) \{/);
  });

  it("counts the seats they've paid for, including during a scheduled reduction", () => {
    expect(route).toContain("const paidQty = officeRow?.scheduled_seats != null ? Math.max(stripeQty, (officeRow.seats as number | null) ?? 0) : stripeQty;");
  });

  it("the switcher shows the sentence, not the machine code", () => {
    expect(read("src/components/BillingManager.tsx")).toContain('if (!res.ok) { setErr(data.message || data.error || "Couldn\'t change plan."); return; }');
  });
});

describe("B-17: a purge either finishes or stops before the account", () => {
  beforeEach(() => {
    db.profiles = [{ id: U, username: "dana", stripe_subscription_id: null }];
    db.cards = [{ user_id: U, username: "dana", customization: {} }];
    db.leads = [{ id: "l1", card_owner: "dana" }];
    db.user_devices = [{ user_id: U, device_id: "d1" }];
    db.apple_refresh_tokens = [{ user_id: U }];
    db.push_log = [{ user_id: U }];
    db.unsubscribe_events = [{ user_id: U }];
    db.contact_links = [{ owner_id: U, lead_id: "l1" }];
    db.contact_devices = [{ owner_id: U, lead_id: "l1" }];
  });

  it("removes the tables it used to leave behind", async () => {
    expect(await purgeUserData(fakeDb as never, U)).toBe(true);
    for (const t of ["user_devices", "apple_refresh_tokens", "push_log", "unsubscribe_events", "contact_links", "contact_devices", "leads", "profiles", "cards"]) {
      expect(db[t], t).toHaveLength(0);
    }
    expect(authDeleted).toEqual([U]);
  });

  it("a delete that fails (resolved, not thrown) keeps the profile and auth user for tomorrow's run", async () => {
    failTables.add("leads");
    expect(await purgeUserData(fakeDb as never, U)).toBe(false);
    expect(db.profiles).toHaveLength(1);
    expect(db.cards).toHaveLength(1);
    expect(authDeleted).toEqual([]);
    expect(reported).toContain("account.purge-incomplete");
    // Tomorrow it works and finishes.
    failTables.clear();
    expect(await purgeUserData(fakeDb as never, U)).toBe(true);
    expect(db.leads).toHaveLength(0);
  });

  it("a table this environment doesn't have is nothing to delete, not a failure", () => {
    const src = read("src/lib/account-purge.ts");
    expect(src).toContain('const NOTHING_THERE = new Set(["42P01", "42703", "PGRST204", "PGRST205"]);');
    expect(src).not.toMatch(/await safeDelete\(\(\) => admin\.from\(/);
  });
});

describe("B-18: a promo use is spent by a purchase, not by pressing Apply", () => {
  const NOW = Date.UTC(2026, 9, 18, 12);
  const old = new Date(NOW - ABANDONED_CLAIM_MS - 60_000).toISOString();
  const fresh = new Date(NOW - 60 * 60 * 1000).toISOString();

  beforeEach(() => {
    db.promo_codes = [
      { id: "c_flyer", discount_type: "percent", uses_count: 3, max_uses: 3 },
      { id: "c_grant", discount_type: "grant", uses_count: 1, max_uses: 5 },
    ];
    db.promo_code_redemptions = [
      { id: "r_abandoned", code_id: "c_flyer", user_id: "a", redeemed_at: old, consumed_at: null },
      { id: "r_open", code_id: "c_flyer", user_id: "b", redeemed_at: fresh, consumed_at: null },
      { id: "r_bought", code_id: "c_flyer", user_id: "c", redeemed_at: old, consumed_at: old },
      { id: "r_grant", code_id: "c_grant", user_id: "d", redeemed_at: old, consumed_at: null },
    ];
  });

  it("an abandoned checkout's claim is released and its use given back — nothing else is", async () => {
    expect(await releaseAbandonedPromoClaims(fakeDb as never, NOW)).toBe(1);
    expect(db.promo_code_redemptions.map((r) => r.id).sort()).toEqual(["r_bought", "r_grant", "r_open"]);
    expect(db.promo_codes.find((c) => c.id === "c_flyer")?.uses_count).toBe(2);
    expect(db.promo_codes.find((c) => c.id === "c_grant")?.uses_count).toBe(1);
  });

  it("Apply on a money-off code only checks it; a grant is still recorded on the spot", () => {
    const route = read("src/app/api/promo/redeem/route.ts");
    const checkOnly = route.indexOf("if (!isGrantCode(promo)) {\n    return NextResponse.json({ success: true, promo: promoPayload(promo) });");
    expect(checkOnly).toBeGreaterThan(0);
    expect(checkOnly).toBeLessThan(route.indexOf('.from("promo_code_redemptions")\n    .insert('));
    expect(route).toContain("if (existing && (isGrantCode(promo) || existing.consumed_at)) {");
  });

  it("a checkout reusing its claim restarts the clock; the daily cron runs the release", () => {
    expect(read("src/app/api/stripe/checkout/route.ts")).toMatch(/\.update\(\{ redeemed_at: new Date\(\)\.toISOString\(\) \}\)\s*\.eq\("id", redemption\.id\)\s*\.is\("consumed_at", null\);/);
    expect(read("src/app/api/reminders/route.ts")).toContain("promoClaimsReleased = await releaseAbandonedPromoClaims(supabase);");
  });
});
