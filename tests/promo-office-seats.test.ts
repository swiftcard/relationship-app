import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// ── Office promo codes that come with seats (owner, 2026-10-06) ─────────────
// "When I bring on a team — one admin and 14 sub-users — I give the whole team
// a month free. Only the admin puts in the promo to get those 14 seats. I still
// get his card; he can cancel any time; when the promo ends it starts billing."
//
// So an Office-only code carries a seat count, and the order it is used on is
// FIXED at that count: the order pages lock their seat picker to it, and the
// checkout route refuses any other count before the code is claimed — never a
// re-sized total nobody was shown. A free-Office grant opens that many seats.

type Row = Record<string, unknown>;
const db: { promo: Row | null; redemption: Row | null } = { promo: null, redemption: null };

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
  getStripe: () => ({ promotionCodes: { list: async () => ({ data: [] }) } }),
}));

import { checkPromoForPurchase } from "@/lib/promo-check";
import {
  MAX_PROMO_SEATS, describePromo, isPromoSeats, promoSeats, promoSeatsMessage, seatsLabel,
} from "@/lib/promo";
import { PLAN_LIMITS } from "@/lib/plan";

const read = (p: string) => readFileSync(p, "utf8");

beforeEach(() => { db.promo = null; db.redemption = null; });

describe("the vocabulary (lib/promo)", () => {
  it("only an Office-only code fixes a seat count", () => {
    expect(promoSeats({ applies_to: "office", seats: 15 })).toBe(15);
    expect(promoSeats({ applies_to: "pro", seats: 15 })).toBeNull();
    expect(promoSeats({ applies_to: "any", seats: 15 })).toBeNull();
    expect(promoSeats({ applies_to: "office", seats: null })).toBeNull();
  });

  it("a seat count outside what Office can sell is ignored, not honoured", () => {
    expect(isPromoSeats(PLAN_LIMITS.OFFICE_MIN_SEATS)).toBe(true);
    expect(isPromoSeats(PLAN_LIMITS.OFFICE_MIN_SEATS - 1)).toBe(false);
    expect(isPromoSeats(MAX_PROMO_SEATS + 1)).toBe(false);
    expect(isPromoSeats(2.5)).toBe(false);
    expect(promoSeats({ applies_to: "office", seats: 1 })).toBeNull();
  });

  it("says the seats include the person buying", () => {
    expect(seatsLabel(15)).toBe("15 seats — you + 14 teammates");
    expect(seatsLabel(2)).toBe("2 seats — you + 1 teammate");
    expect(promoSeatsMessage(15)).toBe("This code is for exactly 15 seats — you + 14 teammates.");
  });

  it("the admin list describes the seats", () => {
    expect(describePromo({ discount_type: "free_time", free_days: 30, applies_to: "office", seats: 15 })).toContain("· 15 seats");
    expect(describePromo({ discount_type: "free_time", free_days: 30, applies_to: "pro", seats: 15 })).not.toContain("seats");
  });
});

describe("the code check hands the seats to the order pages", () => {
  const base = { active: true, expires_at: null, max_uses: null, uses_count: 0, plan_target: "all", interval_target: "any", duration: "once" };

  it("the owner's deal: one month free on Office for 15 seats", async () => {
    db.promo = { ...base, id: "s1", code: "TEAM15", discount_type: "free_time", free_days: 30, applies_to: "office", seats: 15 };
    const r = await checkPromoForPurchase({ code: "TEAM15", userId: "u1", accountPlan: "free", purchase: { plan: "office", interval: "monthly" } });
    expect(r.ok).toBe(true);
    if (r.ok && r.source === "swiftcard") { expect(r.seats).toBe(15); expect(r.freeDays).toBe(30); }
  });

  it("a code without seats leaves the choice to the buyer", async () => {
    db.promo = { ...base, id: "s2", code: "OFFICE30", discount_type: "free_time", free_days: 30, applies_to: "office", seats: null };
    const r = await checkPromoForPurchase({ code: "OFFICE30", userId: "u1", accountPlan: "free", purchase: { plan: "office", interval: "monthly" } });
    expect(r.ok && r.source === "swiftcard" && r.seats).toBeNull();
  });

  it("the check route and the redeem preview return the seats", () => {
    expect(read("src/app/api/promo/check/route.ts")).toMatch(/seats\s*}\);/);
    expect(read("src/app/api/promo/redeem/route.ts")).toContain("seats: promoSeats(promo)");
  });
});

describe("the server holds the order to the code's seats", () => {
  const checkout = read("src/app/api/stripe/checkout/route.ts");

  it("refuses any other seat count, with the reason, as promoUnusable", () => {
    expect(checkout).toContain("quantity !== check.seats");
    expect(checkout).toMatch(/promoSeatsMessage\(check\.seats\), promoUnusable: true/);
  });

  it("refuses BEFORE the code is claimed, so a refused order doesn't spend it", () => {
    const refuse = checkout.indexOf("quantity !== check.seats");
    const claim = checkout.indexOf('.from("promo_code_redemptions")');
    expect(refuse).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(refuse);
  });

  it("a free-Office grant opens the code's seats (five when it names none)", () => {
    expect(read("src/app/api/promo/redeem/route.ts")).toContain("provisionOfficeForOwner(admin, user.id, promoSeats(promo) ?? 5)");
  });
});

describe("the admin can make one", () => {
  const route = read("src/app/api/admin/promo-codes/route.ts");
  const form = read("src/app/admin/marketing/MarketingClient.tsx");

  it("seats are accepted on Office-only codes and nothing else", () => {
    expect(route).toContain('if (hasSeats && applies_to !== "office")');
    expect(route).toContain("isPromoSeats(Number(seats))");
  });

  it("a code with seats is never saved without them", () => {
    expect(route).toMatch(/seatCount && \/seats\/i\.test\(error\.message\)/);
  });

  it("a free plan (no card) can be created from the form, for one named plan", () => {
    expect(form).toContain('<option value="grant"');
    expect(route).toContain('if (isGrant && applies_to === "any")');
  });

  it("the form only offers Seats on an Office-only code", () => {
    expect(form).toContain('promoForm.applies_to === "office" && (');
    expect(form).toContain('seats: promoForm.applies_to === "office" && promoForm.seats ? Number(promoForm.seats) : null');
  });

  it("the database allows exactly the range the app honours", () => {
    const sql = read("supabase/promo-seats.sql");
    expect(sql).toContain(`seats between ${PLAN_LIMITS.OFFICE_MIN_SEATS} and ${MAX_PROMO_SEATS}`);
  });
});

describe("every web page an Office purchase passes through locks to the code's seats", () => {
  it("/pricing", () => {
    const s = read("src/app/pricing/page.tsx");
    expect(s).toContain("const seats = promoSeatLock ?? pickedSeats");
    expect(s).toContain("lockedSeats={promoSeatLock}");
  });

  it("/welcome (the plan cards and the paid panel)", () => {
    const w = read("src/components/WelcomePlan.tsx");
    expect(w).toContain("lockedSeats={promo.appliedSeats}");
    expect(w).toContain("promo.appliedSeats ? promo.appliedSeats : pickedSeats");
    const cards = read("src/components/PlanCards.tsx");
    expect(cards).toContain("const seats = lockedSeats ?? pickedSeats");
    expect(cards).toContain("lockedSeats={lockedSeats}");
  });

  it("/checkout rewrites the link's seat count to the code's", () => {
    const c = read("src/app/checkout/CheckoutClient.tsx");
    expect(c).toContain('q.set("seats", String(codeSeats))');
  });

  it("the locked picker says why it can't be changed", () => {
    expect(read("src/components/PlanTierCards.tsx")).toContain("set by your promo code");
  });
});
