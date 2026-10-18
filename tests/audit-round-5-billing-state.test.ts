import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";

// ── Audit round 5 (2026-10-16): billing state that holds ────────────────────
//
// B-03  Every writer of profiles.customization wrote the WHOLE object back
//       from its own copy; Stripe's three checkout events landing in the same
//       second erased each other's keys (_planSource, _planChosen, _everPaid).
// B-06  Only customer.subscription.deleted ended paid access: a subscription
//       Stripe marked unpaid, paused or expired kept Pro/Office forever, and
//       the 7-day grace clock was armed only by invoice.payment_failed, which
//       production has never once received.
// N-08  The per-IP notify cap skipped the bell row and the CRM event, not just
//       the buzz, and link taps (which never notify) used it up.

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
const notifications: Row[] = [];

function makeQuery(name: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: { kind: string; value?: Row } = { kind: "select" };
  const rows = () => (db[name] ??= []);
  const matches = () => rows().filter((r) => filters.every((f) => f(r)));
  const run = () => {
    if (op.kind === "update") { const hit = matches(); hit.forEach((r) => Object.assign(r, op.value)); return { data: hit, error: null }; }
    if (op.kind === "insert") { rows().push({ ...op.value }); return { data: null, error: null }; }
    const m = matches();
    return { data: m, error: null, count: m.length };
  };
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return chain; },
    not: (k: string, _o: string, v: unknown) => { filters.push((r) => (v === null ? r[k] != null : r[k] !== v)); return chain; },
    in: (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return chain; },
    order: () => chain, limit: () => chain,
    update: (v: Row) => { op = { kind: "update", value: v }; return chain; },
    insert: (v: Row) => { op = { kind: "insert", value: v }; return chain; },
    delete: () => { op = { kind: "delete" }; return chain; },
    maybeSingle: async () => ({ data: run().data?.[0] ?? null, error: null }),
    single: async () => ({ data: run().data?.[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return chain;
}

// merge_customization, as supabase/merge-customization.sql defines it.
const rpcCalls: Row[] = [];
async function rpc(fn: string, a: { p_user: string; p_set: Row; p_remove: string[]; p_require_sub?: string | null; p_require_plan?: string | null }) {
  if (fn !== "merge_customization") throw new Error("unexpected rpc " + fn);
  rpcCalls.push(a);
  const p = (db.profiles ?? []).find((r) => r.id === a.p_user
    && (a.p_require_sub == null || r.stripe_subscription_id === a.p_require_sub)
    && (a.p_require_plan == null || r.plan === a.p_require_plan));
  if (!p) return { data: null, error: null };
  const next = { ...((p.customization as Row) ?? {}) };
  for (const k of a.p_remove ?? []) delete next[k];
  p.customization = { ...next, ...(a.p_set ?? {}) };
  return { data: p.customization, error: null };
}

let live: Row = {};
vi.mock("@/lib/supabase-admin", () => ({ getAdminSupabase: () => ({ from: (t: string) => makeQuery(t), rpc }) }));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    subscriptions: { retrieve: async () => JSON.parse(JSON.stringify(live)) },
    webhooks: { constructEvent: (body: string) => JSON.parse(body) },
  }),
  subscriptionPeriodEnd: (sub: { items?: { data?: { current_period_end?: number }[] } }) => sub.items?.data?.[0]?.current_period_end,
  subscriptionPeriodEndIso: () => null,
}));
vi.mock("@/lib/subscription", async (orig) => ({
  ...(await orig<typeof import("@/lib/subscription")>()),
  planFromPriceId: (id: string | null | undefined) => (id === "price_pro" ? { plan: "pro", interval: "monthly" } : null),
}));
vi.mock("@/lib/office-roles", () => ({ getOfficeSubUserContext: async () => null }));
vi.mock("@/lib/audit", () => ({ writeAudit: async () => {} }));
vi.mock("@/lib/report-error", () => ({ reportError: async () => {} }));
vi.mock("@/lib/notify", () => ({ insertNotification: async (row: Row) => { notifications.push(row); return true; } }));
vi.mock("@/lib/push", () => ({ sendPushToUser: async () => {} }));
vi.mock("@/lib/office-departure", () => ({ recordOfficeDeparture: async () => {} }));
vi.mock("@/lib/card-page-data", () => ({ revalidateCardPage: () => {}, revalidateUserCards: async () => {} }));
vi.mock("@/lib/office-brand", () => ({ getOfficeBrand: async () => null, stripBrandFromUserCards: async () => {}, memberFallbackPlan: async () => "free" }));

import { customizationDiff, writeCustomizationChanges } from "@/lib/customization-merge";

const read = (p: string) => readFileSync(p, "utf8");
let eventN = 0;
async function webhook(type: string) {
  const { POST } = await import("@/app/api/stripe/webhook/route");
  const body = JSON.stringify({ id: `evt_${++eventN}`, type, data: { object: { id: "sub_1" } } });
  return (await POST(new NextRequest("https://swiftcard.me/api/stripe/webhook", { method: "POST", body, headers: { "stripe-signature": "t" } }))).status;
}
const sub = (status: string) => ({
  id: "sub_1", status, cancel_at_period_end: false, trial_end: null, ended_at: null,
  items: { data: [{ id: "si_1", quantity: 1, price: { id: "price_pro", unit_amount: 499, recurring: { interval: "month" } }, current_period_end: 2_000_000_000 }] },
});
const me = () => db.profiles[0];

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  notifications.length = 0;
  rpcCalls.length = 0;
  db.profiles = [{ id: "u1", plan: "pro", stripe_subscription_id: "sub_1", customization: { _planSource: "stripe", _planChosen: "pro", _push: { on: true } } }];
  db.cards = [{ username: "dana", user_id: "u1" }];
});

describe("B-03: a writer changes only the keys it changed", () => {
  it("the diff names what was added, changed and removed — nothing else", () => {
    expect(customizationDiff({ a: 1, b: { x: 1 }, c: 3 }, { a: 1, b: { x: 2 }, d: 4 })).toEqual({ set: { b: { x: 2 }, d: 4 }, remove: ["c"] });
    expect(customizationDiff({ a: { y: 1, x: 2 } }, { a: { x: 2, y: 1 } })).toEqual({ set: {}, remove: [] });
  });

  it("a key another writer set between our read and our write survives", async () => {
    const before = JSON.parse(JSON.stringify(me().customization)) as Row;
    // Meanwhile: invoice.payment_succeeded stamps _everPaid.
    (me().customization as Row)._everPaid = true;
    // Then this writer, from its stale copy, records the trial mirror.
    await writeCustomizationChanges("u1", before, { ...before, _trialEndsAt: "2026-11-01" });
    expect(me().customization).toMatchObject({ _everPaid: true, _trialEndsAt: "2026-11-01", _planSource: "stripe", _push: { on: true } });
  });

  it("no billing route or the webhook writes the whole object any more", () => {
    const files = [
      "src/app/api/stripe/webhook/route.ts",
      "src/app/api/stripe/subscription/cancel/route.ts",
      "src/app/api/stripe/subscription/keep/route.ts",
      "src/app/api/stripe/subscription/discount/route.ts",
      "src/app/api/stripe/subscription/extend-trial/route.ts",
      "src/app/api/stripe/subscription/change-plan/route.ts",
      "src/app/api/iap/revenuecat/route.ts",
      "src/app/api/iap/sync/route.ts",
      "src/lib/pro-ended.ts",
    ];
    for (const f of files) {
      const src = read(f).replace(/\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/\.update\(\{[^)]*\bcustomization\b/);
      expect(src, f).not.toMatch(/\.update\(appleGrantPatch\(/);
    }
    expect(read("src/lib/profile-customization.ts")).toMatch(/admin\.rpc\("merge_customization"/);
  });

  it("the database function is server-only and guarded the way callers rely on", () => {
    const sql = read("supabase/merge-customization.sql");
    expect(sql).toMatch(/\(coalesce\(customization, '\{\}'::jsonb\) - coalesce\(p_remove, '\{\}'::text\[\]\)\)\s*\|\| coalesce\(p_set, '\{\}'::jsonb\)/);
    expect(sql).toContain("and (p_require_sub is null or stripe_subscription_id = p_require_sub)");
    expect(sql).toContain("from anon, authenticated;");
    expect(sql).toContain("to service_role;");
  });
});

describe("B-06: a subscription Stripe stopped billing ends paid access", () => {
  it("unpaid: down to Free once, told once, and the subscription stays linked", async () => {
    live = sub("unpaid");
    expect(await webhook("customer.subscription.updated")).toBe(200);
    expect(me().plan).toBe("free");
    expect(me().stripe_subscription_id).toBe("sub_1");
    expect(me().customization).toMatchObject({ _proEndedChoicePending: true, _push: { on: true } });
    expect(notifications.filter((n) => n.type === "pro_ended")).toHaveLength(1);
    // Stripe sends more updates while it stays unpaid: nothing happens again.
    expect(await webhook("customer.subscription.updated")).toBe(200);
    expect(notifications.filter((n) => n.type === "pro_ended")).toHaveLength(1);
  });

  it("…and paying again brings the plan back and clears the prompt", async () => {
    live = sub("unpaid");
    await webhook("customer.subscription.updated");
    live = sub("active");
    expect(await webhook("customer.subscription.updated")).toBe(200);
    expect(me().plan).toBe("pro");
    expect(me().customization).not.toHaveProperty("_proEndedChoicePending");
  });

  it("paused and never-paid end it too", async () => {
    for (const status of ["paused", "incomplete_expired"]) {
      db.profiles = [{ id: "u1", plan: "pro", stripe_subscription_id: "sub_1", customization: { _planSource: "stripe" } }];
      live = sub(status);
      await webhook("customer.subscription.updated");
      expect(me().plan, status).toBe("free");
    }
  });

  it("deleted after it already ended by status: unlinked, and not announced a second time", async () => {
    live = sub("unpaid");
    await webhook("customer.subscription.updated");
    live = sub("canceled");
    expect(await webhook("customer.subscription.deleted")).toBe(200);
    expect(me().stripe_subscription_id).toBeNull();
    expect(notifications.filter((n) => n.type === "pro_ended")).toHaveLength(1);
  });

  it("past_due starts the 7-day grace clock, once", async () => {
    live = sub("past_due");
    await webhook("customer.subscription.updated");
    const first = (me().customization as Row)._paymentFailedAt;
    expect(typeof first).toBe("string");
    await webhook("customer.subscription.updated");
    expect((me().customization as Row)._paymentFailedAt).toBe(first);
    expect(me().plan).toBe("pro");
  });
});

describe("N-08: the per-IP cap stops the buzz, not the record", () => {
  const route = read("src/app/api/card-events/route.ts");

  it("only events that would notify are counted", () => {
    expect(route).toMatch(/const flooded = notice\s*\?\s*await isRateLimited\(`notify-ip:\$\{card_owner_username\}:\$\{notifyWho\}`, 6, 60 \* 60 \* 1000\)\s*:\s*false;/);
  });

  it("over the cap the row and the CRM event are still written, without the buzz", () => {
    expect(route).toContain("if (notice && !recordFlooded) {");
    expect(route).toContain("...(pushCategory && !flooded ? { pushCategory } : {}),");
  });

  it("a far wider ceiling still bounds the record against rotating visitor ids", () => {
    expect(route).toMatch(/isRateLimited\(`notify-ip-row:\$\{card_owner_username\}:\$\{ip\}`, 60, 60 \* 60 \* 1000\)/);
  });
});
