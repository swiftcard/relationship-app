import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Promo codes at checkout (owner report 2026-09-23) ───────────────────────
// "When I create a promo code … and put it into Stripe, it doesn't work." The
// codes were free-time codes, which Stripe cannot express, so they never
// existed in Stripe. Every code is now entered in SwiftCard's own box on the
// order page, checked by one set of rules (lib/promo-check), and Stripe's own
// promo field is off.

type Row = Record<string, unknown>;
const db: { promo: Row | null; redemption: Row | null } = { promo: null, redemption: null };
const stripeCodes: Row[] = [];

vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: table === "promo_codes" ? db.promo : table === "promo_code_redemptions" ? db.redemption : null }),
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ promotionCodes: { list: async () => ({ data: stripeCodes }) } }),
}));

import { checkPromoForPurchase } from "@/lib/promo-check";

const base = { active: true, expires_at: null, max_uses: null, uses_count: 0, plan_target: "all", applies_to: "any", interval_target: "any", duration: "once" };
const pro = { plan: "pro" as const, interval: "monthly" as const };
const run = (over: Partial<Parameters<typeof checkPromoForPurchase>[0]> = {}) =>
  checkPromoForPurchase({ code: "MENASH100", userId: "u1", accountPlan: "free", purchase: pro, ...over });

beforeEach(() => { db.promo = null; db.redemption = null; stripeCodes.length = 0; });

describe("the owner's codes work", () => {
  it("a free-time code (MENASH100, 90 days) applies as free days — the case that failed on Stripe's page", async () => {
    db.promo = { ...base, id: "p1", code: "MENASH100", discount_type: "free_time", free_days: 90, stripe_coupon_id: null };
    const r = await run();
    expect(r.ok).toBe(true);
    if (r.ok && r.source === "swiftcard") { expect(r.freeDays).toBe(90); expect(r.couponId).toBeNull(); }
  });
  it("a money-off code applies its Stripe coupon", async () => {
    db.promo = { ...base, id: "p2", discount_type: "percent", discount_percent: 20, stripe_coupon_id: "co_1" };
    const r = await run();
    expect(r.ok && r.source === "swiftcard" && r.couponId).toBe("co_1");
  });
  it("a code made in the Stripe dashboard still works, as a Stripe promotion code", async () => {
    stripeCodes.push({ id: "promo_9", expires_at: null, max_redemptions: null, times_redeemed: 0, promotion: { coupon: { valid: true, percent_off: 15, duration: "once" } } });
    const r = await run({ code: "DASHBOARD15" });
    expect(r.ok && r.source === "stripe" && r.promotionCodeId).toBe("promo_9");
    expect(r.ok && r.label).toBe("15% off");
  });
});

describe("a code that can't apply says why — never a silent full price", () => {
  it("unknown code", async () => { expect((await run({ code: "NOPE" })).ok).toBe(false); });
  it("money off with no Stripe coupon behind it is reported broken", async () => {
    db.promo = { ...base, id: "p3", discount_type: "percent", discount_percent: 20, stripe_coupon_id: null };
    const r = await run();
    expect(!r.ok && r.reason).toMatch(/isn't set up for payments/);
  });
  it("with no plan picked yet (the /welcome chooser) a scoped code is accepted and says which plan it is for", async () => {
    db.promo = { ...base, id: "p4b", discount_type: "free_time", free_days: 30, applies_to: "office", interval_target: "annual" };
    const r = await run({ purchase: null });
    expect(r.ok).toBe(true);
    expect(r.ok && r.detail).toBe("This code is for the Office plan, billed annually. Choose that plan below.");
  });
  it("a code for Office doesn't apply to Pro", async () => {
    db.promo = { ...base, id: "p4", discount_type: "free_time", free_days: 30, applies_to: "office" };
    expect(!((await run()).ok)).toBe(true);
  });
  it("new-accounts-only refuses a subscriber", async () => {
    db.promo = { ...base, id: "p5", discount_type: "free_time", free_days: 30, plan_target: "free" };
    const r = await run({ accountPlan: "pro" });
    expect(!r.ok && r.reason).toMatch(/aren't subscribed yet/);
  });
  it("a spent code is refused; an unspent claim is still theirs even at the cap", async () => {
    db.promo = { ...base, id: "p6", discount_type: "free_time", free_days: 30, max_uses: 1, uses_count: 1 };
    db.redemption = { id: "r1", consumed_at: "2026-09-01T00:00:00Z" };
    expect((await run()).ok).toBe(false);
    db.redemption = { id: "r1", consumed_at: null };
    const r = await run();
    expect(r.ok && r.source === "swiftcard" && r.redemption?.id).toBe("r1");
  });
  it("a tester (grant) code is flagged so the page can switch it on instead", async () => {
    db.promo = { ...base, id: "p7", discount_type: "grant", free_days: 30, applies_to: "pro" };
    const r = await run();
    expect(!r.ok && r.grant).toBe(true);
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("Stripe's own promo field is off; checkout applies what the check resolved", () => {
    const s = read("src/app/api/stripe/checkout/route.ts");
    expect(s).not.toMatch(/allow_promotion_codes:\s*true/);
    expect(s).toContain("{ discounts: [{ promotion_code: promotionCodeId }] }");
    expect(s).toContain("const check = await checkPromoForPurchase({");
    expect(s).toMatch(/if \(!check\.ok\) \{\s*return NextResponse\.json\(\{ error: check\.reason, promoUnusable: true/);
  });
  it("the one box checks codes before payment and offers to continue without a refused one", () => {
    const s = read("src/components/PromoCodeBox.tsx");
    expect(s).toContain("Have a promo code?");
    expect(s).toContain('fetch("/api/promo/check"');
    expect(s).toContain("Continue without the code");
    expect(s).toMatch(/<form\s+method="post"/); // no input can ever reach a URL before hydration
  });
  it("every web checkout has the box: the order page and the new account's plan step (owner, 2026-09-24)", () => {
    // /checkout: the code rides the URL and is sent with the purchase.
    const checkout = read("src/app/checkout/CheckoutClient.tsx");
    expect(checkout).toContain("<PromoCodeBox");
    expect(checkout).toContain("usePromoCode({ plan, interval, initialCode: promoCode, onCodeChange: setPromoParam })");
    // /welcome: a new account paying here had nowhere to type a code. The
    // box is in BOTH places a purchase starts — the "Complete your Pro
    // subscription" panel and under the plan cards — and the applied code
    // is what the checkout request carries. The third is "Before you go
    // Free", whose "Keep my card exactly like this" is a Pro checkout too: a
    // code refused there must show why (2026-11-04, get-started-review).
    const welcome = read("src/components/WelcomePlan.tsx");
    expect(welcome.match(/<PromoCodeBox/g)?.length).toBe(3);
    expect(welcome).toContain("...(code ? { promoCode: code } : {})");
    expect(welcome).toContain("const code = opts?.withoutPromo ? undefined : promo.appliedCode;");
    // A refusal at checkout is shown, never a silent full price.
    expect(welcome).toContain("promo.refuseAtCheckout(code,");
    expect(welcome).toMatch(/if \(promo\.blocksPurchase && !opts\?\.withoutPromo\)/);
    // The chooser's box asks with no plan, and the check route allows that.
    const check = read("src/app/api/promo/check/route.ts");
    expect(check).toContain("purchase: plan ? { plan, interval } : null");
  });
  it("the admin funnel's 'Picked a plan' step is recorded — Free choice and first paid checkout", () => {
    const choose = read("src/app/api/account/choose-plan/route.ts");
    expect(choose).toContain('recordServerEvent("plan_selected", { plan: "free" }');
    const checkout = read("src/app/api/stripe/checkout/route.ts");
    expect(checkout).toContain('await recordServerEvent("plan_selected", { plan: planKey }');
    // Our own traffic is labelled internal, like the browser sink.
    expect(read("src/lib/server-events.ts")).toContain("isTestMailbox(email)");
  });
  it("the check route spends nothing", () => {
    const s = read("src/app/api/promo/check/route.ts");
    expect(s).not.toMatch(/\.insert\(|\.update\(/);
  });
});
