import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import {
  SEAT_ADDS_KEY, SEAT_REFUND_WINDOW_MS, freshSeatAdds, paidSeats, parseSeatAdds, planSeatChange,
  seatRefundCents, seatSyncDecision, serializeSeatAdds, type SeatAdd,
} from "@/lib/office-seat-plan";
import { isDuplicatePurchase, survivingSubscription } from "@/lib/stripe-supersede";

// ── Audit round 2 (2026-10-15): Office seats and duplicate subscriptions ─────
//
// B-01  A seat reduction was applied to Stripe only AFTER the period ended, so
//       the renewal had already billed a full extra cycle at the old count.
// B-02  customer.subscription.updated trusted the event's snapshot; a stale or
//       out-of-order delivery lowered seats and suspended paid members.
// B-15  Two checkouts could both be paid; the webhook cancelled one outright
//       with no refund, and a retried old event cancelled the NEWER plan.
//
// And the owner's seat rule (2026-10-15): an added seat is charged now; a
// seat removed later stays, paid, to the end of the month; a seat removed
// within 24 hours of being added costs nothing.
//
// The seat routes and the webhook run for real below, against a fake database
// and a Stripe simulator that keeps quantities, invoices, credit notes and
// idempotency keys the way Stripe does.

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};

function makeQuery(name: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: { kind: string; value?: Row } = { kind: "select" };
  const rows = () => (db[name] ??= []);
  const matches = () => rows().filter((r) => filters.every((f) => f(r)));
  const run = () => {
    if (op.kind === "update") {
      const hit = matches();
      hit.forEach((r) => Object.assign(r, op.value));
      return { data: hit, error: null, count: hit.length };
    }
    if (op.kind === "insert") {
      rows().push({ ...op.value });
      return { data: null, error: null };
    }
    const m = matches();
    return { data: m, error: null, count: m.length };
  };
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return chain; },
    not: (k: string, _op: string, v: unknown) => { filters.push((r) => (v === null ? r[k] != null : r[k] !== v)); return chain; },
    in: (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return chain; },
    order: () => chain,
    limit: () => chain,
    update: (v: Row) => { op = { kind: "update", value: v }; return chain; },
    insert: (v: Row) => { op = { kind: "insert", value: v }; return chain; },
    delete: () => { op = { kind: "delete" }; return chain; },
    maybeSingle: async () => ({ data: run().data?.[0] ?? null, error: null }),
    single: async () => ({ data: run().data?.[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return chain;
}

// ── The Stripe simulator ─────────────────────────────────────────────────────
type Inv = { id: string; status: string; amount_paid: number; post_payment_credit_notes_amount: number; subscription: string; quantity: number; reason: string };
type Sub = {
  id: string; status: string; created: number; customer: string; metadata: Record<string, string>; latest_invoice: string | null;
  items: { data: { id: string; quantity: number; price: { id: string; unit_amount: number }; current_period_end: number }[] };
};
const UNIT = 400; // cents per seat per month
const s = {
  subs: new Map<string, Sub>(),
  invoices: new Map<string, Inv>(),
  creditNotes: [] as { invoice: string; amount: number; refund_amount?: number; reason?: string }[],
  updates: [] as { id: string; params: Record<string, unknown> }[],
  cancels: [] as { id: string; params: Record<string, unknown> }[],
  idem: new Map<string, unknown>(),
  failCreditNotes: false,
  n: 0,
};
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const once = <T,>(key: string | undefined, fn: () => T): T => {
  if (key && s.idem.has(key)) return clone(s.idem.get(key) as T);
  const r = fn();
  if (key) s.idem.set(key, clone(r));
  return r;
};
function invoice(sub: string, amount: number, quantity: number, reason: string): Inv {
  const inv = { id: `in_${++s.n}`, status: "paid", amount_paid: amount, post_payment_credit_notes_amount: 0, subscription: sub, quantity, reason };
  s.invoices.set(inv.id, inv);
  return inv;
}
/** The period ends: Stripe bills the next one at whatever quantity it holds. */
function renew(subId: string): Inv {
  const sub = s.subs.get(subId)!;
  const it = sub.items.data[0];
  const inv = invoice(subId, UNIT * it.quantity, it.quantity, "subscription_cycle");
  sub.latest_invoice = inv.id;
  it.current_period_end += 30 * 86400;
  return inv;
}
const stripeApi = {
  subscriptions: {
    retrieve: async (id: string) => clone(s.subs.get(id)!),
    update: async (id: string, params: Record<string, unknown>, opts?: { idempotencyKey?: string }) =>
      once(opts?.idempotencyKey, () => {
        const sub = s.subs.get(id)!;
        s.updates.push({ id, params: clone(params) });
        const items = params.items as { quantity: number }[] | undefined;
        if (items) {
          const it = sub.items.data[0];
          const old = it.quantity;
          it.quantity = items[0].quantity;
          // Half the period left: an added seat costs half a month now.
          if (params.proration_behavior === "always_invoice" && it.quantity > old) {
            sub.latest_invoice = invoice(id, (UNIT / 2) * (it.quantity - old), it.quantity - old, "subscription_update").id;
          }
        }
        for (const [k, v] of Object.entries((params.metadata as Record<string, string>) ?? {})) {
          if (v === "") delete sub.metadata[k]; else sub.metadata[k] = v;
        }
        return clone(sub);
      }),
    cancel: async (id: string, params: Record<string, unknown> = {}) => {
      s.cancels.push({ id, params });
      s.subs.get(id)!.status = "canceled";
      return clone(s.subs.get(id)!);
    },
  },
  invoices: {
    retrieve: async (id: string) => clone(s.invoices.get(id)!),
    createPreview: async () => ({ lines: { data: [] } }),
    list: (p: { subscription: string; status: string }) =>
      [...s.invoices.values()].filter((i) => i.subscription === p.subscription && i.status === p.status).map(clone),
  },
  creditNotes: {
    create: async (p: { invoice: string; amount: number; refund_amount?: number; reason?: string }, opts?: { idempotencyKey?: string }) =>
      once(opts?.idempotencyKey, () => {
        if (s.failCreditNotes) throw new Error("Stripe refused the credit note");
        const inv = s.invoices.get(p.invoice)!;
        if (p.amount > inv.amount_paid - inv.post_payment_credit_notes_amount) throw new Error("credit note exceeds what is left");
        inv.post_payment_credit_notes_amount += p.amount;
        s.creditNotes.push(p);
        return { id: `cn_${++s.n}` };
      }),
  },
  webhooks: { constructEvent: (body: string) => JSON.parse(body) },
};

let user: { id: string } | null = { id: "owner" };
vi.mock("@/lib/supabase-admin", () => ({ getAdminSupabase: () => ({ from: (t: string) => makeQuery(t) }) }));
vi.mock("@/lib/supabase-server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }) }));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => stripeApi,
  subscriptionPeriodEnd: (sub: Sub) => sub.items?.data?.[0]?.current_period_end,
  subscriptionPeriodEndIso: (sub: Sub) => {
    const u = sub.items?.data?.[0]?.current_period_end;
    return u ? new Date(u * 1000).toISOString() : null;
  },
}));
vi.mock("@/lib/subscription", async (orig) => ({
  ...(await orig<typeof import("@/lib/subscription")>()),
  planFromPriceId: (id: string | null | undefined) =>
    id === "price_office" ? { plan: "office", interval: "monthly" } : id === "price_pro" ? { plan: "pro", interval: "monthly" } : null,
}));
vi.mock("@/lib/office-roles", () => ({
  requireOfficeCapability: async () => ({ ownerId: "owner", officeId: "off1" }),
  getOfficeSubUserContext: async () => null,
  officeSubUserBlockMessage: () => null,
  resolveBillingSubjectId: async (id: string) => id,
}));
vi.mock("@/lib/audit", () => ({ writeAudit: async () => {} }));
const reported: string[] = [];
vi.mock("@/lib/report-error", () => ({ reportError: async (ctx: string) => { reported.push(ctx); } }));
vi.mock("@/lib/office-brand", () => ({
  getOfficeBrand: async () => null,
  stripBrandFromUserCards: async () => {},
  memberFallbackPlan: async () => "free",
}));
vi.mock("@/lib/notify", () => ({ insertNotification: async () => {} }));
vi.mock("@/lib/push", () => ({ sendPushToUser: async () => {} }));
vi.mock("@/lib/office-departure", () => ({ recordOfficeDeparture: async () => {} }));
vi.mock("@/lib/card-page-data", () => ({ revalidateCardPage: () => {}, revalidateUserCards: async () => {} }));

const T0 = Date.parse("2026-10-15T12:00:00Z");
const PERIOD_END = Math.floor(Date.parse("2026-10-30T12:00:00Z") / 1000);

function seed(seats: number, activeMembers: number) {
  for (const k of Object.keys(db)) delete db[k];
  db.profiles = [{ id: "owner", plan: "enterprise", stripe_subscription_id: "sub_1", customization: {} }];
  db.offices = [{ id: "off1", owner_id: "owner", seats, scheduled_seats: null, scheduled_seats_at: null }];
  db.office_members = Array.from({ length: activeMembers }, (_, i) => ({
    id: `m${i}`, office_id: "off1", user_id: `u${i}`, status: "active", joined_at: `2026-0${(i % 9) + 1}-01`,
  }));
  s.subs.clear(); s.invoices.clear(); s.creditNotes = []; s.updates = []; s.cancels = []; s.idem.clear(); s.failCreditNotes = false;
  s.subs.set("sub_1", {
    id: "sub_1", status: "active", created: Math.floor(T0 / 1000) - 90 * 86400, customer: "cus_1", metadata: {}, latest_invoice: null,
    items: { data: [{ id: "si_1", quantity: seats, price: { id: "price_office", unit_amount: UNIT }, current_period_end: PERIOD_END }] },
  });
}
const office = () => db.offices[0];
const stripeQty = () => s.subs.get("sub_1")!.items.data[0].quantity;
const seatsReq = (seats: number) =>
  new NextRequest("https://swiftcard.me/api/stripe/subscription/seats", {
    method: "POST", body: JSON.stringify({ seats }), headers: { "content-type": "application/json" },
  });
const postSeats = async (seats: number) => {
  const { POST } = await import("@/app/api/stripe/subscription/seats/route");
  const r = await POST(seatsReq(seats));
  return { status: r.status, body: await r.json() };
};
const webhook = async (type: string, object: Row) => {
  const { POST } = await import("@/app/api/stripe/webhook/route");
  const body = JSON.stringify({ id: `evt_${++s.n}`, type, data: { object } });
  const r = await POST(new NextRequest("https://swiftcard.me/api/stripe/webhook", { method: "POST", body, headers: { "stripe-signature": "t" } }));
  return r.status;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  user = { id: "owner" };
  reported.length = 0;
});
afterEach(() => vi.useRealTimers());

describe("the owner's seat rule, through the real seats route", () => {
  it("removing a seat later keeps it to the end of the month, and the RENEWAL bills the lower count (B-01)", async () => {
    seed(5, 2);
    const r = await postSeats(4);
    expect(r.body.mode).toBe("scheduled");
    expect(r.body.effectiveAt).toBe(new Date(PERIOD_END * 1000).toISOString());
    // The team keeps the 5 seats it paid for…
    expect(office().seats).toBe(5);
    expect(office().scheduled_seats).toBe(4);
    // …while Stripe already holds 4, with no proration either way…
    expect(stripeQty()).toBe(4);
    expect(s.updates.at(-1)!.params.proration_behavior).toBe("none");
    expect(s.creditNotes).toEqual([]);
    // …so the renewal bills 4, not 5: no extra cycle at the old count.
    expect(renew("sub_1").quantity).toBe(4);
  });

  it("the renewal's webhook applies the reduction, and nobody is removed", async () => {
    seed(5, 2);
    await postSeats(4);
    renew("sub_1");
    vi.setSystemTime(PERIOD_END * 1000 + 60_000);
    expect(await webhook("customer.subscription.updated", { id: "sub_1" })).toBe(200);
    expect(office().seats).toBe(4);
    expect(office().scheduled_seats).toBeNull();
    expect(db.office_members.every((m) => m.status === "active")).toBe(true);
  });

  it("adding a seat charges for it now", async () => {
    seed(3, 1);
    const r = await postSeats(4);
    expect(r.body.mode).toBe("increased");
    expect(office().seats).toBe(4);
    const inv = s.invoices.get(s.subs.get("sub_1")!.latest_invoice!)!;
    expect(inv.amount_paid).toBe(UNIT / 2);
    // …and the purchase is remembered for the 24-hour rule.
    expect(parseSeatAdds(s.subs.get("sub_1")!.metadata[SEAT_ADDS_KEY])).toEqual([
      { at: Math.floor(T0 / 1000) * 1000, n: 1, left: 1, inv: inv.id },
    ]);
  });

  it("removing it within 24 hours: off now, and the charge refunded to the card", async () => {
    seed(3, 1);
    await postSeats(4);
    const inv = s.subs.get("sub_1")!.latest_invoice!;
    vi.setSystemTime(T0 + 23 * 3600_000);
    const r = await postSeats(3);
    expect(r.body).toMatchObject({ ok: true, mode: "reduced_now", seats: 3, refundedSeats: 1, refundedCents: UNIT / 2 });
    expect(s.creditNotes).toEqual([expect.objectContaining({ invoice: inv, amount: UNIT / 2, refund_amount: UNIT / 2 })]);
    expect(office()).toMatchObject({ seats: 3, scheduled_seats: null });
    expect(stripeQty()).toBe(3);
    expect(renew("sub_1").quantity).toBe(3);
  });

  it("removing it after 24 hours: kept and paid to the end of the month, nothing refunded", async () => {
    seed(3, 1);
    await postSeats(4);
    vi.setSystemTime(T0 + 25 * 3600_000);
    const r = await postSeats(3);
    expect(r.body.mode).toBe("scheduled");
    expect(s.creditNotes).toEqual([]);
    expect(office()).toMatchObject({ seats: 4, scheduled_seats: 3 });
  });

  it("removing more than was just added: the new seats are refunded now, the rest wait for the date", async () => {
    seed(4, 0);
    await postSeats(6);
    vi.setSystemTime(T0 + 3600_000);
    const r = await postSeats(3);
    expect(r.body).toMatchObject({ mode: "reduced_now_and_scheduled", seats: 4, scheduledSeats: 3, refundedSeats: 2, refundedCents: UNIT });
    expect(office()).toMatchObject({ seats: 4, scheduled_seats: 3 });
    expect(stripeQty()).toBe(3);
  });

  it("two quick adds, one quick removal: the newest purchase is the one refunded", async () => {
    seed(2, 0);
    await postSeats(3);
    const first = s.subs.get("sub_1")!.latest_invoice!;
    vi.setSystemTime(T0 + 60_000);
    await postSeats(4);
    const second = s.subs.get("sub_1")!.latest_invoice!;
    vi.setSystemTime(T0 + 120_000);
    await postSeats(3);
    expect(s.creditNotes.map((c) => c.invoice)).toEqual([second]);
    expect(s.invoices.get(first)!.post_payment_credit_notes_amount).toBe(0);
  });

  it("a refund Stripe refuses leaves the seat as an ordinary removal (kept and paid), and is reported", async () => {
    seed(3, 1);
    await postSeats(4);
    s.failCreditNotes = true;
    const r = await postSeats(3);
    expect(r.body).toMatchObject({ mode: "scheduled", seats: 4, scheduledSeats: 3, refundedSeats: 0 });
    expect(office()).toMatchObject({ seats: 4, scheduled_seats: 3 });
    expect(reported).toContain("office.seats.refund_failed");
  });

  it("a seat already refunded by hand is not refunded twice, and still comes off now", async () => {
    seed(3, 1);
    await postSeats(4);
    const inv = s.invoices.get(s.subs.get("sub_1")!.latest_invoice!)!;
    inv.post_payment_credit_notes_amount = inv.amount_paid;
    const r = await postSeats(3);
    expect(r.body.mode).toBe("reduced_now");
    expect(s.creditNotes).toEqual([]);
  });

  it("cancelling a pending reduction puts Stripe back without charging for seats already paid", async () => {
    seed(5, 1);
    await postSeats(3);
    const invoicesBefore = s.invoices.size;
    const r = await postSeats(5);
    expect(r.body.mode).toBe("unchanged");
    expect(stripeQty()).toBe(5);
    expect(s.updates.at(-1)!.params.proration_behavior).toBe("none");
    expect(s.invoices.size).toBe(invoicesBefore);
    expect(office()).toMatchObject({ seats: 5, scheduled_seats: null });
  });

  it("adding a seat while a reduction is pending charges for that one seat only", async () => {
    seed(5, 1);
    await postSeats(3);
    const r = await postSeats(6);
    expect(r.body.mode).toBe("increased");
    expect(stripeQty()).toBe(6);
    const inv = s.invoices.get(s.subs.get("sub_1")!.latest_invoice!)!;
    expect(inv.quantity).toBe(1);
    expect(office()).toMatchObject({ seats: 6, scheduled_seats: null });
  });

  it("a double-click buys one seat, not two", async () => {
    seed(3, 1);
    await Promise.all([postSeats(4), postSeats(4)]);
    expect([...s.invoices.values()].filter((i) => i.reason === "subscription_update")).toHaveLength(1);
    expect(stripeQty()).toBe(4);
  });

  it("the same add made again after a refunded removal is charged again (keys follow the state)", async () => {
    seed(3, 1);
    await postSeats(4);
    vi.setSystemTime(T0 + 60_000);
    await postSeats(3);
    vi.setSystemTime(T0 + 120_000);
    await postSeats(4);
    expect([...s.invoices.values()].filter((i) => i.reason === "subscription_update")).toHaveLength(2);
    expect(stripeQty()).toBe(4);
  });

  it("still refuses to strand anyone", async () => {
    seed(5, 3);
    const r = await postSeats(3);
    expect(r.status).toBe(409);
    expect(stripeQty()).toBe(5);
  });

  it("the seats screen shows the seats held, with the pending count beside them", async () => {
    seed(5, 1);
    await postSeats(3);
    const { GET } = await import("@/app/api/stripe/subscription/seats/route");
    const d = await (await GET()).json();
    expect(d.seats).toBe(5);
    expect(d.scheduledSeats).toBe(3);
  });
});

describe("the webhook reads Stripe, not the event (B-02)", () => {
  it("a stale event showing 5 seats cannot cut an office Stripe bills for 8", async () => {
    seed(8, 7);
    const stale = clone(s.subs.get("sub_1")!);
    stale.items.data[0].quantity = 5;
    expect(await webhook("customer.subscription.updated", stale as unknown as Row)).toBe(200);
    expect(office().seats).toBe(8);
    expect(db.office_members.filter((m) => m.status === "active")).toHaveLength(7);
  });

  it("a real reduction made in the Stripe portal is still followed, and trims the newest", async () => {
    seed(8, 7);
    s.subs.get("sub_1")!.items.data[0].quantity = 5;
    expect(await webhook("customer.subscription.updated", { id: "sub_1" })).toBe(200);
    expect(office().seats).toBe(5);
    expect(db.office_members.filter((m) => m.status === "active")).toHaveLength(4);
  });

  it("while a reduction is pending, the change it made is not mistaken for a cut", async () => {
    seed(5, 1);
    await postSeats(3);
    expect(await webhook("customer.subscription.updated", { id: "sub_1" })).toBe(200);
    expect(office()).toMatchObject({ seats: 5, scheduled_seats: 3 });
  });
});

describe("the daily backstop", () => {
  it("a reduction scheduled the old way (Stripe still on the old count) is moved onto Stripe before renewal", async () => {
    seed(5, 1);
    Object.assign(office(), { scheduled_seats: 3, scheduled_seats_at: new Date(PERIOD_END * 1000).toISOString() });
    const { applyDueSeatReductions } = await import("@/lib/office-scheduled-seats");
    await applyDueSeatReductions();
    expect(stripeQty()).toBe(3);
    expect(office()).toMatchObject({ seats: 5, scheduled_seats: 3 });
  });

  it("if the team grew past the reduction before its date, nobody is cut and Stripe bills what's in use", async () => {
    seed(5, 1);
    await postSeats(3);
    db.office_members.push(
      { id: "x1", office_id: "off1", user_id: "x1", status: "active", joined_at: "2026-10-20" },
      { id: "x2", office_id: "off1", user_id: "x2", status: "active", joined_at: "2026-10-21" },
    );
    renew("sub_1");
    vi.setSystemTime(PERIOD_END * 1000 + 60_000);
    const { applyDueSeatReductions } = await import("@/lib/office-scheduled-seats");
    expect(await applyDueSeatReductions()).toBe(1);
    expect(office()).toMatchObject({ seats: 4, scheduled_seats: null });
    expect(stripeQty()).toBe(4);
    expect(s.updates.at(-1)!.params.proration_behavior).toBe("create_prorations");
  });
});

describe("the seat rules, as pure decisions", () => {
  const now = T0;
  const add = (hoursAgo: number, n: number, left = n, inv: string | null = `in_${hoursAgo}`): SeatAdd => ({ at: now - hoursAgo * 3600_000, n, left, inv });

  it("paid seats: Stripe's count, or the office's while a reduction is pending", () => {
    expect(paidSeats(4, 4, null)).toBe(4);
    expect(paidSeats(3, 5, 3)).toBe(5);
    expect(paidSeats(6, 5, null)).toBe(6);
  });

  it("only purchases inside 24 hours with seats left are refundable", () => {
    expect(freshSeatAdds([add(1, 2), add(25, 1), add(2, 1, 0)], now)).toEqual([add(1, 2)]);
    expect(SEAT_REFUND_WINDOW_MS).toBe(86_400_000);
  });

  it("a purchase with no invoice is never refunded against nothing", () => {
    const p = planSeatChange({ paid: 4, stripeQty: 4, requested: 3, adds: [add(1, 1, 1, null)], now });
    expect(p.kind === "decrease" && p.refunds).toEqual([]);
  });

  it("refund shares never strand or exceed a cent", () => {
    expect(seatRefundCents({ amountPaid: 1000, alreadyCredited: 0, seats: 1, of: 3, last: false })).toBe(333);
    expect(seatRefundCents({ amountPaid: 1000, alreadyCredited: 666, seats: 1, of: 3, last: true })).toBe(334);
    expect(seatRefundCents({ amountPaid: 1000, alreadyCredited: 1000, seats: 1, of: 3, last: true })).toBe(0);
  });

  it("the record fits Stripe's metadata limit and drops what has aged out", () => {
    const many = Array.from({ length: 20 }, (_, i) => add(i * 0.5, 3, 3, `in_${"x".repeat(24)}${i}`));
    const v = serializeSeatAdds(many, now);
    expect(v.length).toBeLessThanOrEqual(500);
    expect(serializeSeatAdds([add(30, 1)], now)).toBe("");
    expect(parseSeatAdds("not json")).toEqual([]);
  });

  it("the webhook's seat decision", () => {
    const pendingAt = new Date(now + 86400_000).toISOString();
    expect(seatSyncDecision({ liveQty: 5, dbSeats: 5, scheduledSeats: null, scheduledAt: null, now })).toBe("noop");
    expect(seatSyncDecision({ liveQty: 3, dbSeats: 5, scheduledSeats: 3, scheduledAt: pendingAt, now })).toBe("keep");
    expect(seatSyncDecision({ liveQty: 3, dbSeats: 5, scheduledSeats: 3, scheduledAt: new Date(now - 1).toISOString(), now })).toBe("apply_due");
    expect(seatSyncDecision({ liveQty: 4, dbSeats: 5, scheduledSeats: 3, scheduledAt: pendingAt, now })).toBe("sync");
    // An old-style schedule (Stripe still on the paid count) is left alone.
    expect(seatSyncDecision({ liveQty: 5, dbSeats: 5, scheduledSeats: 3, scheduledAt: pendingAt, now })).toBe("noop");
  });
});

describe("two subscriptions for one account (B-15)", () => {
  it("the newer one survives, whichever event arrives first", () => {
    expect(survivingSubscription({ created: 100 }, { created: 200 })).toBe("incoming");
    expect(survivingSubscription({ created: 200 }, { created: 100 })).toBe("prior");
  });

  it("bought within a day of each other is a duplicate", () => {
    expect(isDuplicatePurchase({ created: 0 }, { created: 3600 })).toBe(true);
    expect(isDuplicatePurchase({ created: 0 }, { created: 2 * 86400 })).toBe(false);
  });

  it("a duplicate is refunded in full; an older paid plan is credited; an unpaid one just ends", async () => {
    const { cancelReplacedSubscription } = await import("@/lib/stripe-supersede");
    seed(2, 0);
    const now = Math.floor(T0 / 1000);
    const mk = (id: string, created: number, paid: boolean) => {
      const sub = clone(s.subs.get("sub_1")!);
      Object.assign(sub, { id, created, status: "active" });
      s.subs.set(id, sub);
      const inv = invoice(id, 5400, 1, "subscription_create");
      if (!paid) inv.status = "open";
      sub.latest_invoice = inv.id;
      return sub;
    };
    const survivor = mk("sub_new", now, true);
    const dup = mk("sub_dup", now - 600, true);
    expect(await cancelReplacedSubscription(clone(dup), clone(survivor))).toEqual({ refundedCents: 5400, mode: "refunded" });
    expect(s.creditNotes.at(-1)).toMatchObject({ amount: 5400, refund_amount: 5400, reason: "duplicate" });

    const old = mk("sub_old", now - 40 * 86400, true);
    expect((await cancelReplacedSubscription(clone(old), clone(survivor))).mode).toBe("credited");
    expect(s.cancels.at(-1)).toMatchObject({ id: "sub_old", params: { prorate: true, invoice_now: true } });

    const unpaid = mk("sub_unpaid", now - 40 * 86400, false);
    expect((await cancelReplacedSubscription(clone(unpaid), clone(survivor))).mode).toBe("cancelled");
    expect(s.cancels.at(-1)).toMatchObject({ id: "sub_unpaid", params: {} });
  });

  const webhookSrc = readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");
  const checkoutSrc = readFileSync("src/app/api/stripe/checkout/route.ts", "utf8");

  it("a stale checkout is cancelled BEFORE the trial record, the promo and the plan write", () => {
    const stale = webhookSrc.indexOf('survivingSubscription(held, sub) === "prior"');
    expect(stale).toBeGreaterThan(-1);
    for (const later of ['ledgerAdd("card"', "promo_code_redemptions", "plan write failed"]) {
      expect(webhookSrc.indexOf(later), later).toBeGreaterThan(stale);
    }
  });

  it("the old subscription is never cancelled outright any more", () => {
    expect(webhookSrc).not.toMatch(/subscriptions\.cancel\(priorSubId\)/);
    expect(webhookSrc).toContain("cancelReplacedSubscription(prior as Stripe.Subscription, incoming as Stripe.Subscription)");
  });

  it("checkout closes other open pages for the account before opening one, and reuses the same order", () => {
    const close = checkoutSrc.indexOf("stripe.checkout.sessions.expire(open.id)");
    const create = checkoutSrc.indexOf("stripe.checkout.sessions.create(");
    expect(close).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(close);
    expect(checkoutSrc).toContain("open.metadata?.order === orderFingerprint");
    expect(checkoutSrc).toMatch(/metadata: \{\s*\/\/[^\n]*\n\s*order: orderFingerprint,/);
  });
});
