import { describe, it, expect, vi, beforeEach } from "vitest";

// ── The admin's numbers, pinned (owner, 2026-10-28: "make sure that all the
// analytics are actually real and that there's nothing fake") ──────────────
//
// Each rule here came from a real wrong number found in production that day:
// 28 of 41 accounts were QA's throwaways and counted as customers; every
// customer showed a phantom "(primary)" second card; the Users list said "—"
// for people who typed their name; revenue counted free trials as paying at
// full price; days were UTC; and reads stopped at 1,000 rows.

vi.mock("@/lib/admin", () => ({
  isAdminEmail: (e?: string | null) => (e ?? "").toLowerCase() === "hello@swiftcard.me",
  requireAdmin: async () => ({ id: "admin" }),
}));

const { accountKind, displayName, hasLegacyProfileCard, billingOf } = await import("@/lib/admin-data/accounts");
const { monthlyCents, summarize } = await import("@/lib/admin-data/billing");
const { nyDayKey, nyDayKeys, startOfNyDay } = await import("@/lib/admin-data/time");

describe("who counts as a customer", () => {
  it("QA's throwaway accounts are test accounts", () => {
    expect(accountKind("qa-and-pro-42782791-1@swiftcard-test.invalid")).toBe("test");
    expect(accountKind("someone@example.test")).toBe("test");
  });
  it("our own logins are internal: admin, demo, App Review, anything @swiftcard.me", () => {
    for (const e of ["hello@swiftcard.me", "demo@swiftcard.me", "demo-sales@swiftcard.me", "applereview@swiftcard.me", "iap-test@swiftcard.me", "menash@swiftcard.me"]) {
      expect(accountKind(e), e).toBe("internal");
    }
  });
  it("an account whose card is an internal test slug is a test account", () => {
    expect(accountKind("maya@gmail.com", ["qa-free-1234"])).toBe("test");
    expect(accountKind("maya@gmail.com", ["apple-review-pro"])).toBe("test");
  });
  it("a founder's own account is ours, whatever address it signed up with (2026-10-28)", () => {
    // Live on 10-28 the co-founder's own Office subscription was the "1 paying
    // customer, $7.98/mo", and the owner's own Pro was "moved by hand". Known
    // by their cards (lib/seeded-views), never by a name or email in code.
    expect(accountKind("someone@gmail.com", ["menashharooni-swiftcard"])).toBe("internal");
    expect(accountKind("someone@company.com", ["aaronlavi-malvecapital", "levleveducationalfund"])).toBe("internal");
    // A customer whose name merely starts the same is a customer.
    expect(accountKind("maya@gmail.com", ["menashe-cohen"])).toBe("customer");
    expect(accountKind("maya@gmail.com", ["aaronlavine-realty"])).toBe("customer");
  });
  it("everyone else is a customer", () => {
    expect(accountKind("Maya.Rep@Gmail.com", ["maya-rep"])).toBe("customer");
    expect(accountKind(null, [])).toBe("customer");
  });
});

describe("the name shown for an account", () => {
  it("uses the name they typed on their card when the profile has none (every normal signup)", () => {
    expect(displayName({ profileName: null, cardNames: ["Maya Rep"] })).toBe("Maya Rep");
    expect(displayName({ profileName: "  ", cardNames: ["", "Maya Rep"] })).toBe("Maya Rep");
  });
  it("prefers the profile name, then the card, then the sign-in provider's name", () => {
    expect(displayName({ profileName: "Maya R.", cardNames: ["Maya Rep"] })).toBe("Maya R.");
    expect(displayName({ profileName: null, cardNames: [], meta: { full_name: "Maya from Google" } })).toBe("Maya from Google");
    expect(displayName({ profileName: null, cardNames: [], meta: { name: "Maya Apple" } })).toBe("Maya Apple");
  });
  it("is null when nothing is known (the page then shows the email, never a dash)", () => {
    expect(displayName({ profileName: null, cardNames: [null], meta: {} })).toBeNull();
  });
});

describe("a legacy profile card exists only by the public page's own rule", () => {
  it("not migrated + has a name + no card at that slug", () => {
    expect(hasLegacyProfileCard({ username: "maya", profileName: "Maya", customization: {}, cardSlugs: [] })).toBe(true);
  });
  it("the phantom: a modern signup's profile has no name, so it is NOT a card", () => {
    expect(hasLegacyProfileCard({ username: "maya-3f9a", profileName: null, customization: {}, cardSlugs: ["maya-rep"] })).toBe(false);
  });
  it("a migrated profile, or one whose slug is already a card, is not a second card", () => {
    expect(hasLegacyProfileCard({ username: "maya", profileName: "Maya", customization: { _migrated: true }, cardSlugs: [] })).toBe(false);
    expect(hasLegacyProfileCard({ username: "maya", profileName: "Maya", customization: {}, cardSlugs: ["maya"] })).toBe(false);
  });
});

describe("how a plan is paid for", () => {
  const base = { planExpiresAt: null, stripeSubscriptionId: null, customization: {}, officeRole: null } as const;
  it("Free is not billed", () => {
    expect(billingOf({ ...base, plan: "free", effectivePlan: "free" }).source).toBe("none");
  });
  it("a Stripe trial is Stripe, with its end date, and not 'ever paid'", () => {
    const end = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const b = billingOf({ ...base, plan: "pro", effectivePlan: "pro", stripeSubscriptionId: "sub_1", customization: { _trialEndsAt: end } });
    expect(b).toMatchObject({ source: "stripe", trialEndsAt: end, everPaid: false });
  });
  it("an Office member is paid for by the team, not 'on a paid plan with nothing paying'", () => {
    expect(billingOf({ ...base, plan: "enterprise", effectivePlan: "enterprise", officeRole: "member" }).source).toBe("office_member");
  });
  it("Apple, a gift month, failed payment and cancelling are all read off the mirror", () => {
    expect(billingOf({ ...base, plan: "pro", effectivePlan: "pro", customization: { _planSource: "apple" } }).source).toBe("apple");
    expect(billingOf({ ...base, plan: "pro", effectivePlan: "pro", planExpiresAt: "2099-01-01T00:00:00Z" }).source).toBe("grant");
    const b = billingOf({ ...base, plan: "pro", effectivePlan: "pro", stripeSubscriptionId: "sub_1", customization: { _paymentFailedAt: "x", _cancelAtPeriodEnd: true, _everPaid: true } });
    expect(b).toMatchObject({ pastDue: true, cancelling: true, everPaid: true });
  });
});

type Sub = Parameters<typeof monthlyCents>[0];
const sub = (o: Partial<Sub> = {}): Sub => ({
  id: "sub", customerId: "cus", userId: null, status: "active", created: 1_700_000_000, canceledAt: null, endedAt: null,
  cancelAtPeriodEnd: false, trialEnd: null, periodEnd: null, livemode: true,
  items: [{ priceId: "price_pro", unitAmount: 499, quantity: 1, interval: "month", intervalCount: 1 }],
  discounts: [], ...o,
});

describe("what a subscription brings in per month", () => {
  it("monthly Pro is $4.99", () => expect(monthlyCents(sub())).toBe(499));
  it("annual is a twelfth of the year's price", () => {
    expect(monthlyCents(sub({ items: [{ priceId: "p", unitAmount: 5400, quantity: 1, interval: "year", intervalCount: 1 }] }))).toBe(450);
  });
  it("Office is the per-seat price × seats", () => {
    expect(monthlyCents(sub({ items: [{ priceId: "p", unitAmount: 399, quantity: 8, interval: "month", intervalCount: 1 }] }))).toBe(3192);
  });
  it("a recurring percent-off counts; a one-off coupon doesn't; an expired repeating one doesn't", () => {
    expect(monthlyCents(sub({ discounts: [{ percentOff: 50, amountOff: null, duration: "forever", end: null }] }))).toBe(250);
    expect(monthlyCents(sub({ discounts: [{ percentOff: 100, amountOff: null, duration: "once", end: null }] }))).toBe(499);
    expect(monthlyCents(sub({ discounts: [{ percentOff: 50, amountOff: null, duration: "repeating", end: 1 }] }), 100)).toBe(499);
  });
  it("an amount-off on an annual plan is spread over the year, never below zero", () => {
    expect(monthlyCents(sub({ items: [{ priceId: "p", unitAmount: 5400, quantity: 1, interval: "year", intervalCount: 1 }], discounts: [{ percentOff: null, amountOff: 1200, duration: "forever", end: null }] }))).toBe(350);
    expect(monthlyCents(sub({ discounts: [{ percentOff: null, amountOff: 99_999, duration: "forever", end: null }] }))).toBe(0);
  });
});

describe("the revenue picture", () => {
  const now = new Date("2026-10-28T16:00:00Z");
  const nowSec = Math.floor(now.getTime() / 1000);
  it("a free trial is NOT a paying customer and NOT revenue — it's a trial", () => {
    const r = summarize([sub({ status: "trialing", trialEnd: nowSec + 3 * 86_400, customerId: "a" })], { nonCustomerUserIds: new Set(), now });
    expect(r.mrrCents).toBe(0);
    expect(r.paying).toBe(0);
    expect(r.trials).toMatchObject({ active: 1, endingIn7Days: 1, convertsToCents: 499 });
  });
  it("the production case on 2026-10-28: two trials (one cancelling) and one unpaid = $0 and 0 paying", () => {
    const r = summarize([
      sub({ status: "trialing", trialEnd: nowSec + 86_400, customerId: "a" }),
      sub({ status: "trialing", trialEnd: nowSec + 86_400, cancelAtPeriodEnd: true, customerId: "b" }),
      sub({ status: "incomplete", customerId: "c" }),
    ], { nonCustomerUserIds: new Set(), now });
    expect(r.mrrCents).toBe(0);
    expect(r.paying).toBe(0);
    expect(r.trials).toMatchObject({ active: 2, cancelling: 1, convertsToCents: 499 });
  });
  it("past due still counts as revenue, flagged as at risk", () => {
    const r = summarize([sub({ status: "past_due", customerId: "a" })], { nonCustomerUserIds: new Set(), now });
    expect(r).toMatchObject({ mrrCents: 499, atRiskCents: 499, pastDue: 1, paying: 1 });
  });
  it("our own and QA's subscriptions are left out", () => {
    const r = summarize([sub({ userId: "ours" }), sub({ userId: "cust", customerId: "z" })], { nonCustomerUserIds: new Set(["ours"]), now });
    // An older subscription with no account tag is still ours by its Stripe customer.
    const untagged = summarize([sub({ userId: null, customerId: "cus_ours" }), sub({ userId: "cust", customerId: "z" })], { nonCustomerUserIds: new Set(), nonCustomerCustomerIds: new Set(["cus_ours"]), now });
    expect(untagged.excludedInternal).toBe(1);
    expect(untagged.paying).toBe(1);
    expect(r).toMatchObject({ mrrCents: 499, paying: 1, excludedInternal: 1 });
  });
  it("two subscriptions on one customer are one paying customer", () => {
    expect(summarize([sub({ id: "1" }), sub({ id: "2" })], { nonCustomerUserIds: new Set(), now }).paying).toBe(1);
  });
  it("lost revenue this month only counts customers who had paid", () => {
    const thisMonth = Math.floor(new Date("2026-10-10T12:00:00Z").getTime() / 1000);
    const r = summarize([
      sub({ status: "canceled", userId: "paid", canceledAt: thisMonth, endedAt: thisMonth }),
      sub({ status: "canceled", userId: "trialonly", canceledAt: thisMonth, endedAt: thisMonth, trialEnd: thisMonth }),
    ], { nonCustomerUserIds: new Set(), everPaidUserIds: new Set(["paid"]), now });
    expect(r.lostThisMonth).toEqual({ count: 1, cents: 499 });
  });
});

describe("New York days", () => {
  it("a 9pm New York signup is that day, not tomorrow (UTC put it on the next day)", () => {
    expect(nyDayKey("2026-10-28T01:30:00Z")).toBe("2026-10-27");
    expect(nyDayKey("2026-10-28T04:30:00Z")).toBe("2026-10-28");
  });
  it("today starts at New York midnight, across the DST change", () => {
    expect(startOfNyDay(0, new Date("2026-10-28T16:00:00Z")).toISOString()).toBe("2026-10-28T04:00:00.000Z");
    expect(startOfNyDay(0, new Date("2026-11-02T16:00:00Z")).toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });
  it("30 day keys end today and never repeat or skip a day across DST", () => {
    const keys = nyDayKeys(30, new Date("2026-11-10T16:00:00Z"));
    expect(keys).toHaveLength(30);
    expect(new Set(keys).size).toBe(30);
    expect(keys[29]).toBe("2026-11-10");
    expect(keys[0]).toBe("2026-10-12");
  });
});

describe("reading every account, not the first 1,000", () => {
  beforeEach(() => vi.resetModules());

  it("pages profiles and cards past PostgREST's 1,000-row answer", async () => {
    const N = 2_345;
    const profiles = Array.from({ length: N }, (_, i) => ({ id: `u${i}`, username: `u${i}`, name: null, email: null, plan: "free", plan_expires_at: null, created_at: "2026-10-01T00:00:00Z", company: null, title: null, customization: {}, signup_source: null, referral_code: null, stripe_subscription_id: null, stripe_customer_id: null }));
    const cards = profiles.map((p, i) => ({ id: `c${i}`, user_id: p.id, username: `card-${i}`, name: `Person ${i}`, label: null, created_at: "2026-10-01T00:00:00Z", is_offline: false, is_office_card: false }));
    const tables: Record<string, unknown[]> = { profiles, cards, offices: [], office_members: [] };
    const builder = (rows: unknown[]) => {
      const b = {
        select: () => b, order: () => b, eq: () => b,
        // PostgREST: never more than 1,000 rows, whatever the range asks.
        range: (from: number, to: number) => Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null }),
      };
      return b;
    };
    vi.doMock("@/lib/supabase-admin", () => ({
      getAdminSupabase: () => ({
        from: (t: string) => builder(tables[t] ?? []),
        auth: { admin: { listUsers: async ({ page }: { page: number }) => ({ data: { users: page === 1 ? profiles.slice(0, 1000).map((p) => ({ id: p.id, email: `${p.id}@gmail.com`, user_metadata: {} })) : [] }, error: null }) } },
      }),
    }));
    const { loadAccounts } = await import("@/lib/admin-data/accounts");
    const all = await loadAccounts();
    expect(all).toHaveLength(N);
    expect(all.every((a) => a.cards.length === 1)).toBe(true);
    // The name is the one on their card.
    expect(all[N - 1].name).toMatch(/^Person \d+$/);
  });
});
