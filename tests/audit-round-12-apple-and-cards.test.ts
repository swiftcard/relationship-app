import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// ── Audit round 12 (2026-10-16): who is paying, asked of the right place ────
//
// B-11  A grant (tester) code refused Stripe subscribers but not Apple ones;
//       on an Apple Pro it made Office that neither the expiry job nor Apple's
//       own EXPIRATION ever ended. The refusal also came after the code was
//       spent.
// B-12  RevenueCat revokes didn't re-check RevenueCat (grants did), so a late
//       EXPIRATION dropped a re-subscribed customer to Free; failed writes
//       were answered 200 and never retried.
// B-13  The card fingerprint was read only from sub.default_payment_method,
//       null for every trial in production: the one-trial-per-card rule, the
//       referral same-card check and the retention rule were all off.

type Obj = Record<string, unknown>;
const stripe = {
  customers: { retrieve: vi.fn() },
  setupIntents: { retrieve: vi.fn() },
  paymentMethods: { list: vi.fn() },
};
vi.mock("@/lib/stripe", () => ({ getStripe: () => stripe }));

import { cardFingerprintFor } from "@/lib/stripe-card-fingerprint";

const read = (p: string) => readFileSync(p, "utf8");
const card = (fingerprint: string) => ({ id: "pm_1", card: { fingerprint } });
const sub = (over: Obj = {}) => ({ id: "sub_1", customer: "cus_1", default_payment_method: null, pending_setup_intent: null, ...over }) as never;

beforeEach(() => {
  stripe.customers.retrieve.mockReset().mockResolvedValue({ id: "cus_1", invoice_settings: { default_payment_method: null } });
  stripe.setupIntents.retrieve.mockReset().mockResolvedValue({ payment_method: null });
  stripe.paymentMethods.list.mockReset().mockResolvedValue({ data: [] });
});

describe("B-13: every trial's card is fingerprinted, wherever Checkout left it", () => {
  it("on the subscription", async () => {
    expect(await cardFingerprintFor(sub({ default_payment_method: card("fp_sub") }))).toBe("fp_sub");
    expect(stripe.customers.retrieve).not.toHaveBeenCalled();
  });

  it("on the customer's invoice settings", async () => {
    stripe.customers.retrieve.mockResolvedValue({ id: "cus_1", invoice_settings: { default_payment_method: card("fp_cust") } });
    expect(await cardFingerprintFor(sub())).toBe("fp_cust");
  });

  it("on the subscription's setup intent", async () => {
    stripe.setupIntents.retrieve.mockResolvedValue({ payment_method: card("fp_setup") });
    expect(await cardFingerprintFor(sub({ pending_setup_intent: "seti_1" }))).toBe("fp_setup");
  });

  it("only attached to the customer", async () => {
    stripe.paymentMethods.list.mockResolvedValue({ data: [card("fp_attached")] });
    expect(await cardFingerprintFor(sub())).toBe("fp_attached");
  });

  it("a lookup that fails moves on to the next place, and nothing found is null — never a thrown event", async () => {
    stripe.customers.retrieve.mockRejectedValue(new Error("stripe down"));
    stripe.paymentMethods.list.mockResolvedValue({ data: [card("fp_attached")] });
    expect(await cardFingerprintFor(sub())).toBe("fp_attached");
    stripe.paymentMethods.list.mockRejectedValue(new Error("stripe down"));
    expect(await cardFingerprintFor(sub())).toBeNull();
  });

  it("the checkout handler uses it, and says so when a trial still has no card", () => {
    const hook = read("src/app/api/stripe/webhook/route.ts");
    expect(hook).toContain("paymentFingerprint = await cardFingerprintFor(sub);");
    expect(hook).toContain('"stripe.webhook.trial_without_card_fingerprint"');
    expect(hook).not.toMatch(/paymentFingerprint = pm\?\.card\?\.fingerprint/);
  });
});

describe("B-11: a grant code never lands on a paying subscriber — Stripe or Apple", () => {
  const route = read("src/app/api/promo/redeem/route.ts");

  it("asks about Apple as well as Stripe", () => {
    expect(route).toContain("return !!p?.stripe_subscription_id || (isPaidPlan(p?.plan as string | null) && isApplePaid(p?.customization));");
    expect(route).toContain("if (prof?.stripe_subscription_id || (isPaidPlan(prof?.plan as string | null) && isApplePaid(prof?.customization))) {");
  });

  it("asks before the code is recorded or counted, so a refused code is still unused", () => {
    const refuse = route.indexOf("if (isGrantCode(promo) && await paysForOwnPlan(admin, user.id))");
    expect(refuse).toBeGreaterThan(0);
    expect(refuse).toBeLessThan(route.indexOf('.from("promo_code_redemptions")\n    .insert('));
    expect(refuse).toBeLessThan(route.indexOf("await claimPromoUse(admin"));
  });
});

describe("B-12: a late Apple EXPIRATION can't drop someone who is paying", () => {
  const route = read("src/app/api/iap/revenuecat/route.ts");

  it("a revoke asks RevenueCat first, as a grant does; only a definite 'still active' stops it", () => {
    const revoke = route.slice(route.indexOf('if (decision.action === "revoke")'));
    expect(revoke.indexOf('if ((await rcProActive(profile.id as string)) === true) return "stale_revoke";'))
      .toBeLessThan(revoke.indexOf('.update({ plan: "free" })'));
    expect(revoke.indexOf("return \"stale_revoke\"")).toBeGreaterThan(-1);
  });

  it("a failed plan write is thrown (RevenueCat retries a 500), not acknowledged", () => {
    expect(route).toContain("if (grantError) throw grantError;");
    expect(route).toContain("if (revokeError) throw revokeError;");
    expect(route).toContain('return NextResponse.json({ error: "lookup_failed" }, { status: 500 });');
  });

  it("asking RevenueCat can't hang the webhook", () => {
    expect(read("src/lib/revenuecat-rest.ts")).toContain("signal: AbortSignal.timeout(8_000),");
  });
});
