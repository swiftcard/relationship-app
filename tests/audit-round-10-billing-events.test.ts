import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";

// ── Audit round 10 (2026-10-16): no billing event or notice is lost ─────────
//
// B-04  A new subscriber's first invoice.payment_succeeded arrives before
//       checkout.session.completed has stored stripe_customer_id. The lookup
//       by customer found nobody and answered 200, so the first payment never
//       marked anyone as paying (0 accounts flagged after 15 paid invoices).
// B-05  The dedup row was written on ARRIVAL. A run the platform killed part-
//       way never reached the catch that removes it, and every Stripe retry
//       was answered "duplicate": paid but never provisioned.
// B-22  The trial "you'll be charged on…" notice was stamped as sent BEFORE
//       sending. A failed send, or an account with no email yet, was never
//       retried, and the card networks require that notice.

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
const reported: string[] = [];
let stateColumnMissing = false;

function makeQuery(name: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: { kind: string; value?: Row } = { kind: "select" };
  const rows = () => (db[name] ??= []);
  const matches = () => rows().filter((r) => filters.every((f) => f(r)));
  const run = () => {
    if (op.kind === "update") {
      if (name === "stripe_events" && stateColumnMissing && op.value && "state" in op.value) return { data: null, error: { code: "PGRST204" } };
      const hit = matches(); hit.forEach((r) => Object.assign(r, op.value)); return { data: hit, error: null };
    }
    if (op.kind === "delete") { const hit = new Set(matches()); db[name] = rows().filter((r) => !hit.has(r)); return { data: null, error: null }; }
    if (op.kind === "insert") {
      const v = { ...op.value };
      if (name === "stripe_events") {
        if (stateColumnMissing && "state" in v) return { data: null, error: { code: "PGRST204" } };
        if (rows().some((r) => r.event_id === v.event_id)) return { data: null, error: { code: "23505" } };
        v.state ??= "done";
        v.created_at ??= new Date().toISOString();
      }
      rows().push(v);
      return { data: null, error: null };
    }
    const m = matches();
    return { data: m, error: null, count: m.length };
  };
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return chain; },
    not: (k: string, _o: string, v: unknown) => {
      const path = k.split("->>");
      const get = (r: Row) => (path.length === 2 ? (r[path[0]] as Row | null)?.[path[1]] : r[k]);
      filters.push((r) => (v === null ? get(r) != null : get(r) !== v));
      return chain;
    },
    in: (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return chain; },
    order: () => chain, limit: () => chain,
    update: (v: Row) => { op = { kind: "update", value: v }; return chain; },
    insert: (v: Row) => { op = { kind: "insert", value: v }; return chain; },
    delete: () => { op = { kind: "delete" }; return chain; },
    maybeSingle: async () => ({ data: run().data?.[0] ?? null, error: null }),
    single: async () => { const d = run().data?.[0] ?? null; return { data: d, error: d ? null : { code: "PGRST116" } }; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return chain;
}

// merge_customization, as supabase/merge-customization.sql defines it.
async function rpc(fn: string, a: { p_user: string; p_set: Row; p_remove: string[] }) {
  if (fn !== "merge_customization") throw new Error("unexpected rpc " + fn);
  const p = (db.profiles ?? []).find((r) => r.id === a.p_user);
  if (!p) return { data: null, error: null };
  const next = { ...((p.customization as Row) ?? {}) };
  for (const k of a.p_remove ?? []) delete next[k];
  p.customization = { ...next, ...(a.p_set ?? {}) };
  return { data: p.customization, error: null };
}
const fakeDb = { from: (t: string) => makeQuery(t), rpc };

const liveSubs: Record<string, Row> = {};
vi.mock("@/lib/supabase-admin", () => ({ getAdminSupabase: () => fakeDb }));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    subscriptions: { retrieve: async (id: string) => { if (!liveSubs[id]) throw new Error("no such subscription"); return liveSubs[id]; } },
    webhooks: { constructEvent: (body: string) => JSON.parse(body) },
  }),
  subscriptionPeriodEnd: () => undefined,
  subscriptionPeriodEndIso: () => null,
}));
vi.mock("@/lib/subscription", async (orig) => ({
  ...(await orig<typeof import("@/lib/subscription")>()),
  planFromPriceId: (id: string | null | undefined) => (id === "price_pro" ? { plan: "pro", interval: "monthly" } : null),
}));
vi.mock("@/lib/office-roles", () => ({ getOfficeSubUserContext: async () => null }));
vi.mock("@/lib/audit", () => ({ writeAudit: async () => {} }));
vi.mock("@/lib/report-error", () => ({ reportError: async (ctx: string) => { reported.push(ctx); } }));
vi.mock("@/lib/notify", () => ({ insertNotification: async () => true }));
vi.mock("@/lib/push", () => ({ sendPushToUser: async () => {} }));
vi.mock("@/lib/office-departure", () => ({ recordOfficeDeparture: async () => {} }));
vi.mock("@/lib/card-page-data", () => ({ revalidateCardPage: () => {}, revalidateUserCards: async () => {} }));
vi.mock("@/lib/office-brand", () => ({ getOfficeBrand: async () => null, stripBrandFromUserCards: async () => {}, memberFallbackPlan: async () => "free" }));
vi.mock("@/lib/account-email", () => ({ getAccountEmail: async (_id: string, fallback: string | null) => fallback }));
vi.mock("@/lib/greeting-name", () => ({ greetingFirstName: async () => "Sam" }));

import { claimStripeEvent, finishStripeEvent, clearStripeEvent, STRIPE_EVENT_STALE_MS } from "@/lib/stripe-idempotency";
import { sendTrialChargeNotices, trialNoticeIdempotencyKey } from "@/lib/trial-notice";

const read = (p: string) => readFileSync(p, "utf8");
const U1 = "6f1c9a52-8d3e-4b7a-9c21-0e5d4f3a2b10";
const ev = () => db.stripe_events?.find((r) => r.event_id === "evt_1");

async function post(event: Row) {
  const { POST } = await import("@/app/api/stripe/webhook/route");
  const req = new NextRequest("https://swiftcard.me/api/stripe/webhook", { method: "POST", body: JSON.stringify(event), headers: { "stripe-signature": "t" } });
  const res = await POST(req);
  return { status: res.status, body: await res.json() as Row };
}
const firstInvoice = (over: Row = {}) => ({
  id: "evt_1",
  type: "invoice.payment_succeeded",
  data: { object: {
    id: "in_1", customer: "cus_new", amount_paid: 499, billing_reason: "subscription_create",
    created: Math.floor(Date.now() / 1000),
    parent: { subscription_details: { subscription: "sub_1", metadata: { user_id: U1 } } },
    lines: { data: [] },
    ...over,
  } },
});

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  for (const k of Object.keys(liveSubs)) delete liveSubs[k];
  reported.length = 0;
  stateColumnMissing = false;
});

describe("B-05: an event counts as handled when it finishes, not when it arrives", () => {
  it("claimed as processing, done only once finished; then a redelivery is a duplicate", async () => {
    expect(await claimStripeEvent("evt_1", "x")).toBe("process");
    expect(ev()?.state).toBe("processing");
    expect(await claimStripeEvent("evt_1", "x")).toBe("in_progress");
    await finishStripeEvent("evt_1");
    expect(ev()?.state).toBe("done");
    expect(await claimStripeEvent("evt_1", "x")).toBe("duplicate");
  });

  it("a run that died without releasing its claim is taken over by the retry — once", async () => {
    const t0 = Date.now();
    expect(await claimStripeEvent("evt_1", "x", t0)).toBe("process");
    // …the platform kills that run: no finish, no clear.
    const later = t0 + STRIPE_EVENT_STALE_MS + 1000;
    expect(await claimStripeEvent("evt_1", "x", t0 + 1000)).toBe("in_progress");
    expect(await claimStripeEvent("evt_1", "x", later)).toBe("process");
    expect(reported).toContain("stripe.idempotency.reclaimed");
    // The takeover re-stamped the claim, so a second retry right behind it waits.
    expect(await claimStripeEvent("evt_1", "x", later + 1000)).toBe("in_progress");
  });

  it("a failed handler releases the claim, so the retry processes it", async () => {
    await claimStripeEvent("evt_1", "x");
    await clearStripeEvent("evt_1");
    expect(await claimStripeEvent("evt_1", "x")).toBe("process");
  });

  it("before the state column exists it behaves exactly as it did", async () => {
    stateColumnMissing = true;
    expect(await claimStripeEvent("evt_1", "x")).toBe("process");
    expect(ev()?.state).toBe("done"); // the column default: "handled"
    await finishStripeEvent("evt_1");
    expect(reported).not.toContain("stripe.idempotency.finish_failed");
    expect(await claimStripeEvent("evt_1", "x")).toBe("duplicate");
  });

  it("the webhook answers a claim in progress with a retryable 409, never a 200", async () => {
    db.stripe_events = [{ event_id: "evt_1", type: "x", state: "processing", created_at: new Date().toISOString() }];
    const r = await post({ id: "evt_1", type: "customer.created", data: { object: {} } });
    expect(r.status).toBe(409);
  });

  it("every 2xx after the claim marks the event done — including the early ones", async () => {
    const r = await post({ id: "evt_1", type: "customer.created", data: { object: {} } });
    expect(r.status).toBe(200);
    expect(ev()?.state).toBe("done");
    const route = read("src/app/api/stripe/webhook/route.ts");
    const afterClaim = route.slice(route.indexOf("const handled = async"));
    // The only bare 2xx left is the duplicate answer, which comes before it.
    expect(afterClaim).not.toMatch(/return NextResponse\.json\(\{ received: true/);
    expect(route.match(/return handled\(NextResponse\.json\(/g)?.length).toBe(3);
    expect(route).toContain("export const maxDuration = 60;");
  });
});

describe("B-04: the first payment marks its account as paying", () => {
  it("checkout tags the subscription with the account", () => {
    const checkout = read("src/app/api/stripe/checkout/route.ts");
    expect(checkout).toMatch(/subscription_data: \{\s*metadata: \{ user_id: user\.id \},/);
  });

  it("an invoice that beats checkout's write finds its owner through that tag", async () => {
    db.profiles = [{ id: U1, plan: "pro", stripe_customer_id: null, customization: { _planSource: "stripe" } }];
    const r = await post(firstInvoice());
    expect(r.status).toBe(200);
    expect(db.profiles[0].customization).toMatchObject({ _everPaid: true, _planSource: "stripe" });
    expect(ev()?.state).toBe("done");
  });

  it("never credits an account tied to a different Stripe customer", async () => {
    db.profiles = [{ id: U1, plan: "pro", stripe_customer_id: "cus_other", customization: {} }];
    // An hour-old invoice: no retry, just nobody to credit.
    const r = await post(firstInvoice({ created: Math.floor(Date.now() / 1000) - 2 * 3600 }));
    expect(r.status).toBe(200);
    expect(db.profiles[0].customization).toEqual({});
  });

  it("an untagged first payment with no account yet is retried, not dropped", async () => {
    db.profiles = [];
    const r = await post(firstInvoice({ parent: { subscription_details: { subscription: "sub_1", metadata: {} } } }));
    expect(r.status).toBe(500);
    expect(ev()).toBeUndefined(); // released, so Stripe's retry is processed
  });

  it("…but not forever: after the first hour it stops asking", async () => {
    db.profiles = [];
    const r = await post(firstInvoice({ created: Math.floor(Date.now() / 1000) - 2 * 3600, parent: null }));
    expect(r.status).toBe(200);
  });
});

describe("B-22: the trial charge notice is recorded only once it has gone", () => {
  const DAY = 86_400_000;
  const NOW = Date.UTC(2026, 9, 16, 12);
  const endsAt = new Date(NOW + 7 * DAY - 60_000).toISOString();
  const sends: { to: string; key?: string }[] = [];
  let failNext = 0;
  const resend = {
    emails: {
      send: async (p: { to: string }, o?: { idempotencyKey?: string }) => {
        sends.push({ to: p.to, key: o?.idempotencyKey });
        if (failNext > 0) { failNext--; return { data: null, error: new Error("resend down") }; }
        return { data: { id: `em_${sends.length}` }, error: null };
      },
    },
  };
  const trialist = (over: Row = {}) => ({
    id: U1, email: "sam@example.com", name: null, plan: "pro", stripe_subscription_id: "sub_t",
    customization: { _trialEndsAt: endsAt, _trialChargeCents: 499 },
    ...over,
  });
  const run = () => sendTrialChargeNotices(fakeDb as never, resend as never, NOW);
  const warned = () => (db.profiles[0].customization as Row)._trialChargeWarnedFor;

  beforeEach(() => { sends.length = 0; failNext = 0; });

  it("a failed send stays unstamped and the next run sends it", async () => {
    db.profiles = [trialist()];
    failNext = 1;
    expect((await run()).sent).toBe(0);
    expect(warned()).toBeUndefined();
    expect(reported).toContain("trial-notice.email");
    expect((await run()).sent).toBe(1);
    expect(warned()).toBe(endsAt);
    // Once stamped, nothing more.
    await run();
    expect(sends.length).toBe(2);
  });

  it("every attempt for one charge date carries the same idempotency key, so overlapping runs send one email", async () => {
    db.profiles = [trialist()];
    failNext = 1;
    await run(); await run();
    expect(new Set(sends.map((s) => s.key))).toEqual(new Set([trialNoticeIdempotencyKey(U1, endsAt)]));
  });

  it("no account email yet: not stamped, so it goes out once there is one", async () => {
    db.profiles = [trialist({ email: null })];
    await run();
    expect(sends.length).toBe(0);
    expect(warned()).toBeUndefined();
    db.profiles[0].email = "sam@example.com";
    await run();
    expect(sends.length).toBe(1);
  });

  it("a cancel flag Stripe no longer agrees with still gets the notice", async () => {
    db.profiles = [trialist({ customization: { _trialEndsAt: endsAt, _cancelAtPeriodEnd: true } })];
    liveSubs.sub_t = { id: "sub_t", status: "trialing", cancel_at_period_end: false, cancel_at: null };
    await run();
    expect(sends.length).toBe(1);
  });

  it("a real cancellation is still skipped, and so is one Stripe can't confirm either way", async () => {
    db.profiles = [trialist({ customization: { _trialEndsAt: endsAt, _cancelAtPeriodEnd: true } })];
    liveSubs.sub_t = { id: "sub_t", status: "trialing", cancel_at_period_end: true, cancel_at: null };
    await run();
    delete liveSubs.sub_t; // retrieve throws
    await run();
    expect(sends.length).toBe(0);
  });

  it("the stamp is merged in, never the run's stale copy of the whole object", async () => {
    db.profiles = [trialist()];
    const src = read("src/lib/trial-notice.ts");
    expect(src).not.toMatch(/\.update\(\{ customization:/);
    // A key written by someone else during the run survives the stamp.
    const send = resend.emails.send;
    resend.emails.send = async (p, o) => { (db.profiles[0].customization as Row)._everPaid = true; return send(p, o); };
    try { await run(); } finally { resend.emails.send = send; }
    expect(db.profiles[0].customization).toMatchObject({ _everPaid: true, _trialChargeWarnedFor: endsAt });
  });
});
