import { describe, it, expect } from "vitest";
import { MIN_TRIAL_END_LEAD_MS, giftBridgeTrialEnd, retentionGiftEndsAt } from "@/lib/billing-state";
import { discountRefusalFor } from "@/lib/retention-discount";

// ── The delete-flow promotions, where they meet Stripe ───────────────────────
//
// Owner, 2026-09-30: "it has to connect with Stripe perfectly … and it should
// only be one time." These are the pure rules behind that; the wiring is pinned
// in account-deletion-retention.test.ts.

const NOW = Date.parse("2026-09-30T12:00:00Z");
const DAY = 86_400_000;
const giftCust = { _retention: { grantedAt: "2026-09-25T12:00:00Z" } };

describe("the gift is recognised only when it is really running", () => {
  const base = { plan: "pro", planExpiresAt: new Date(NOW + 20 * DAY).toISOString(), hasSubscription: false, customization: giftCust };

  it("a running gift reports its end", () => {
    expect(retentionGiftEndsAt(base, NOW)).toBe(new Date(NOW + 20 * DAY).toISOString());
  });

  it("anything else is not the gift", () => {
    expect(retentionGiftEndsAt({ ...base, plan: "free" }, NOW)).toBeNull();
    expect(retentionGiftEndsAt({ ...base, hasSubscription: true }, NOW)).toBeNull();
    expect(retentionGiftEndsAt({ ...base, planExpiresAt: null }, NOW)).toBeNull();
    expect(retentionGiftEndsAt({ ...base, planExpiresAt: new Date(NOW - DAY).toISOString() }, NOW)).toBeNull();
    // A referral month (no retention record) keeps its own rules.
    expect(retentionGiftEndsAt({ ...base, customization: {} }, NOW)).toBeNull();
    // Apple bills Apple.
    expect(retentionGiftEndsAt({ ...base, customization: { ...giftCust, _planSource: "apple" } }, NOW)).toBeNull();
  });
});

describe("subscribing during the gift moves the first charge to the gift's end", () => {
  it("returns the gift's end in unix seconds", () => {
    const end = new Date(NOW + 20 * DAY).toISOString();
    expect(giftBridgeTrialEnd(end, NOW)).toBe(Math.floor((NOW + 20 * DAY) / 1000));
  });

  it("never asks Stripe for a trial_end it will refuse (under 48 hours)", () => {
    expect(MIN_TRIAL_END_LEAD_MS).toBeGreaterThanOrEqual(48 * 3600 * 1000);
    expect(giftBridgeTrialEnd(new Date(NOW + 47 * 3600 * 1000).toISOString(), NOW)).toBeNull();
    expect(giftBridgeTrialEnd(new Date(NOW + MIN_TRIAL_END_LEAD_MS - 1).toISOString(), NOW)).toBeNull();
    expect(giftBridgeTrialEnd(new Date(NOW + MIN_TRIAL_END_LEAD_MS + 1000).toISOString(), NOW)).not.toBeNull();
  });

  it("nothing, or nonsense, bridges nothing", () => {
    expect(giftBridgeTrialEnd(null, NOW)).toBeNull();
    expect(giftBridgeTrialEnd("not a date", NOW)).toBeNull();
    expect(giftBridgeTrialEnd(new Date(NOW - DAY).toISOString(), NOW)).toBeNull();
  });
});

describe("the 50% coupon goes only where it does what the offer says", () => {
  const map = (id: string | null | undefined) =>
    id === "price_pro_monthly" ? { plan: "pro" as const, interval: "monthly" as const }
      : id === "price_pro_annual" ? { plan: "pro" as const, interval: "annual" as const }
        : null;
  const sub = (over: Record<string, unknown> = {}) => ({
    status: "active",
    discounts: [],
    items: { data: [{ price: { id: "price_pro_monthly" } }] },
    ...over,
  });

  it("an active monthly subscription with no discount can take it", () => {
    expect(discountRefusalFor(sub(), map)).toBeNull();
  });

  it("a trial, a failed payment or a cancelled subscription cannot", () => {
    for (const status of ["trialing", "past_due", "canceled", "incomplete", "unpaid"]) {
      expect(discountRefusalFor(sub({ status }), map)).toBe("not_active");
    }
  });

  it("an annual plan cannot — a 3-month coupon would lapse before the renewal", () => {
    expect(discountRefusalFor(sub({ items: { data: [{ price: { id: "price_pro_annual" } }] } }), map)).toBe("annual");
  });

  it("an existing discount is never silently replaced", () => {
    expect(discountRefusalFor(sub({ discounts: ["di_123"] }), map)).toBe("already_discounted");
  });

  it("a price we don't recognise is refused rather than guessed", () => {
    expect(discountRefusalFor(sub({ items: { data: [{ price: { id: "price_other" } }] } }), map)).toBe("unknown_price");
  });
});
