import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateKeyPairSync } from "node:crypto";

// The App Store Connect half of lib/apple-offer-codes, against a fake App
// Store Connect: the exact calls made, in order, with the bodies Apple's API
// documents — and what is written back to promo_codes. Apple itself can't be
// reached from CI; this pins everything up to the wire.

const updates: { values: Record<string, unknown>; id: unknown }[] = [];
vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => ({
    from: () => ({
      update: (values: Record<string, unknown>) => ({
        eq: async (_c: string, id: unknown) => { updates.push({ values, id }); return { error: null }; },
      }),
    }),
  }),
}));

import { mirrorPromoToApple, deactivateAppleOffer } from "@/lib/apple-offer-codes";

type Call = { method: string; path: string; body: unknown; auth: string };
let calls: Call[];
let existingOffers: { id: string; attributes: { name: string } }[];
let existingCustomCodes: { id: string; attributes: { customCode: string } }[];
let failOn: string | null;

const DEMISHA = {
  id: "row-1", code: "DEMISHA", discount_type: "free_time", free_days: 60, applies_to: "pro",
  interval_target: "monthly", plan_target: "all", max_uses: 3, uses_count: 1, expires_at: null, active: true,
};

beforeEach(() => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  process.env.ASC_KEY_ID = "KEY123";
  process.env.ASC_ISSUER_ID = "issuer-1";
  // As pasted into an env var: newlines arrive as literal "\n".
  process.env.ASC_PRIVATE_KEY = (privateKey.export({ type: "pkcs8", format: "pem" }) as string).replace(/\n/g, "\\n");
  calls = []; updates.length = 0; existingOffers = []; existingCustomCodes = []; failOn = null;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: { method: string; body?: string; headers: Record<string, string> }) => {
    const path = url.replace("https://api.appstoreconnect.apple.com/v1", "");
    calls.push({ method: init.method, path, body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers.Authorization });
    const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
    if (failOn && path.startsWith(failOn)) return new Response(JSON.stringify({ errors: [{ title: "Invalid", detail: "Apple says no" }] }), { status: 409 });
    if (path.startsWith("/apps/")) return ok([{ id: "grp-1" }]);
    if (path.startsWith("/subscriptionGroups/")) return ok([{ id: "sub-annual", attributes: { productId: "me.swiftcard.app.pro.annual" } }, { id: "sub-monthly", attributes: { productId: "me.swiftcard.app.pro.monthly" } }]);
    if (path.startsWith("/subscriptions/sub-monthly/offerCodes")) return ok(existingOffers);
    if (path === "/subscriptions/sub-monthly/subscriptionAvailability") return ok({ id: "avail-1" });
    if (path.startsWith("/subscriptionAvailabilities/avail-1/availableTerritories")) return ok([{ id: "USA" }]);
    if (path === "/subscriptionOfferCodes" && init.method === "POST") return ok({ id: "offer-new" });
    if (/^\/subscriptionOfferCodes\/[^/]+\/customCodes/.test(path)) return ok(existingCustomCodes);
    if (path === "/subscriptionOfferCodeCustomCodes") return ok({ id: "cc-1" });
    if (path.startsWith("/subscriptionOfferCodes/") && init.method === "PATCH") return ok({ id: "offer-new" });
    return new Response("{}", { status: 404 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

const posts = () => calls.filter((c) => c.method === "POST");

describe("mirrorPromoToApple against App Store Connect", () => {
  it("makes a two-month free trial on the monthly product, then the DEMISHA code on it", async () => {
    expect(await mirrorPromoToApple(DEMISHA)).toEqual({ ok: true });
    const [offer, custom] = posts();
    expect(offer.path).toBe("/subscriptionOfferCodes");
    expect(offer.body).toMatchObject({
      data: {
        type: "subscriptionOfferCodes",
        attributes: {
          name: "SwiftCard DEMISHA", offerMode: "FREE_TRIAL", duration: "TWO_MONTHS", numberOfPeriods: 1,
          customerEligibilities: ["NEW", "EXISTING", "EXPIRED"], offerEligibility: "REPLACE_INTRO_OFFERS",
        },
        relationships: { subscription: { data: { type: "subscriptions", id: "sub-monthly" } } },
      },
      included: [{ type: "subscriptionOfferCodePrices", relationships: { territory: { data: { type: "territories", id: "USA" } } } }],
    });
    expect(custom.path).toBe("/subscriptionOfferCodeCustomCodes");
    // 2 uses left on the website; Apple can't hold a cap under 500 (live
    // probe 2026-10-08: "The given number of codes 2 is invalid"), so it gets
    // Apple's minimum and the cap is enforced by the webhook ledger instead.
    expect(custom.body).toMatchObject({
      data: { attributes: { customCode: "DEMISHA", numberOfCodes: 500 }, relationships: { offerCode: { data: { id: "offer-new" } } } },
    });
    expect(updates).toEqual([{ values: { apple_offer_code_id: "offer-new", apple_offer_error: null }, id: "row-1" }]);
  });

  it("inline price rows use Apple's ${local-id} form — a plain id is refused live (409, 2026-10-08)", async () => {
    await mirrorPromoToApple(DEMISHA);
    const offer = posts()[0].body as { data: { relationships: { prices: { data: { id: string }[] } } }; included: { id: string }[] };
    expect(offer.data.relationships.prices.data.map((p) => p.id)).toEqual(["${price-USA}"]);
    expect(offer.included.map((p) => p.id)).toEqual(["${price-USA}"]);
  });

  it("the redemption count stays inside Apple's 500–25,000: uncapped → 10,000, a huge cap → 25,000", async () => {
    await mirrorPromoToApple({ ...DEMISHA, max_uses: null, uses_count: 0 });
    await mirrorPromoToApple({ ...DEMISHA, max_uses: 100000, uses_count: 0 });
    const counts = posts().filter((c) => c.path === "/subscriptionOfferCodeCustomCodes").map((c) => (c.body as { data: { attributes: { numberOfCodes: number } } }).data.attributes.numberOfCodes);
    expect(counts).toEqual([10000, 25000]);
  });

  it("the code's expiry goes on Apple's custom code as a date", async () => {
    await mirrorPromoToApple({ ...DEMISHA, expires_at: "2027-04-30T00:00:00+00:00" });
    const custom = posts().find((c) => c.path === "/subscriptionOfferCodeCustomCodes")!.body as { data: { attributes: { expirationDate?: string } } };
    expect(custom.data.attributes.expirationDate).toBe("2027-04-30");
  });

  it("an offer found switched off on Apple is switched back on for an active code", async () => {
    existingOffers = [{ id: "offer-old", attributes: { name: "SwiftCard DEMISHA", active: false } as { name: string } }];
    existingCustomCodes = [{ id: "cc-old", attributes: { customCode: "DEMISHA" } }];
    expect(await mirrorPromoToApple(DEMISHA)).toEqual({ ok: true });
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.path).toBe("/subscriptionOfferCodes/offer-old");
    expect(patch?.body).toMatchObject({ data: { attributes: { active: true } } });
  });

  it("signs every request with an ES256 App Store Connect token", async () => {
    await mirrorPromoToApple(DEMISHA);
    const [h, p] = calls[0].auth.replace("Bearer ", "").split(".").slice(0, 2).map((s) => JSON.parse(Buffer.from(s, "base64url").toString()));
    expect(h).toEqual({ alg: "ES256", kid: "KEY123", typ: "JWT" });
    expect(p).toMatchObject({ iss: "issuer-1", aud: "appstoreconnect-v1" });
    expect(p.exp - p.iat).toBeLessThanOrEqual(1200);
  });

  it("a retry after a half-finished run reuses the offer and only adds the code", async () => {
    existingOffers = [{ id: "offer-old", attributes: { name: "SwiftCard DEMISHA" } }];
    expect(await mirrorPromoToApple(DEMISHA)).toEqual({ ok: true });
    expect(posts().map((c) => c.path)).toEqual(["/subscriptionOfferCodeCustomCodes"]);
    expect(updates[0].values.apple_offer_code_id).toBe("offer-old");
  });

  it("when both already exist it creates nothing and just records the id", async () => {
    existingOffers = [{ id: "offer-old", attributes: { name: "SwiftCard DEMISHA" } }];
    existingCustomCodes = [{ id: "cc-old", attributes: { customCode: "DEMISHA" } }];
    expect(await mirrorPromoToApple(DEMISHA)).toEqual({ ok: true });
    expect(posts()).toEqual([]);
    expect(updates[0].values).toEqual({ apple_offer_code_id: "offer-old", apple_offer_error: null });
  });

  it("an annual-only code goes on the annual product", async () => {
    await mirrorPromoToApple({ ...DEMISHA, interval_target: "annual" });
    expect(calls.some((c) => c.path.startsWith("/subscriptions/sub-annual/"))).toBe(true);
  });

  it("Apple's refusal is recorded on the row, word for word, and nothing claims success", async () => {
    failOn = "/subscriptionOfferCodeCustomCodes";
    const r = await mirrorPromoToApple(DEMISHA);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Apple says no");
    expect(updates).toHaveLength(1);
    expect(updates[0].values).toEqual({ apple_offer_error: expect.stringContaining("Apple says no") });
  });

  it("a used-up code, an Office code and a money-off code never call Apple", async () => {
    expect((await mirrorPromoToApple({ ...DEMISHA, uses_count: 3 })).ok).toBe(false);
    expect((await mirrorPromoToApple({ ...DEMISHA, applies_to: "office" })).ok).toBe(false);
    expect((await mirrorPromoToApple({ ...DEMISHA, discount_type: "percent" })).ok).toBe(false);
    expect(calls).toEqual([]);
    expect(updates).toEqual([]);
  });

  it("without the App Store Connect key it does nothing and says why", async () => {
    delete process.env.ASC_PRIVATE_KEY;
    const r = await mirrorPromoToApple(DEMISHA);
    expect(r).toEqual({ ok: false, error: expect.stringContaining("ASC_") });
    expect(calls).toEqual([]);
  });
});

describe("deactivateAppleOffer", () => {
  it("turns the Apple offer off", async () => {
    expect(await deactivateAppleOffer("offer-new")).toBeNull();
    expect(calls).toEqual([{
      method: "PATCH", path: "/subscriptionOfferCodes/offer-new", auth: expect.any(String),
      body: { data: { type: "subscriptionOfferCodes", id: "offer-new", attributes: { active: false } } },
    }]);
  });

  it("a code that was never on Apple needs nothing", async () => {
    expect(await deactivateAppleOffer(null)).toBeNull();
    expect(calls).toEqual([]);
  });

  it("reports Apple's refusal instead of claiming the code is off", async () => {
    failOn = "/subscriptionOfferCodes/";
    expect(await deactivateAppleOffer("offer-new")).toContain("Apple says no");
  });
});
