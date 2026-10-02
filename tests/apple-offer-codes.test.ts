import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appleOfferPlan } from "@/lib/apple-offer-codes";

// Owner, 2026-10-02: a new account in the iPhone app typed a "two months free"
// code (DEMISHA), the box said it applied, the Pro button opened Apple's plain
// subscription — and the code was gone. "Any time a promo code is added it
// has to work completely, even if it's billed through Apple."
//
// The remedy: each free-time Pro code is ALSO an Apple offer code with the
// same string, and the app's Pro card redeems it through Apple. A code Apple
// doesn't have is used on swiftcard.me — said on the Pro button itself.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const DEMISHA = {
  code: "DEMISHA", discount_type: "free_time", free_days: 60, applies_to: "pro",
  interval_target: "monthly", plan_target: "all", max_uses: 3, expires_at: null,
};

describe("which codes Apple can take (appleOfferPlan)", () => {
  it("the owner's two-months-free code is a two-month free trial on the monthly product", () => {
    expect(appleOfferPlan(DEMISHA)).toEqual({
      productId: "me.swiftcard.app.pro.monthly",
      duration: "TWO_MONTHS",
      customerEligibilities: ["NEW", "EXISTING", "EXPIRED"],
    });
  });

  it("an annual-only code is made on the annual product", () => {
    expect(appleOfferPlan({ ...DEMISHA, interval_target: "annual" })?.productId).toBe("me.swiftcard.app.pro.annual");
  });

  it("'new accounts only' means people not paying Apple: never or no longer subscribed", () => {
    expect(appleOfferPlan({ ...DEMISHA, plan_target: "free" })?.customerEligibilities).toEqual(["NEW", "EXPIRED"]);
    expect(appleOfferPlan({ ...DEMISHA, plan_target: "pro" })?.customerEligibilities).toEqual(["EXISTING"]);
  });

  it("maps every free period Apple has a step for, and nothing else", () => {
    const steps: Record<number, string> = { 14: "TWO_WEEKS", 30: "ONE_MONTH", 60: "TWO_MONTHS", 90: "THREE_MONTHS", 180: "SIX_MONTHS", 365: "ONE_YEAR" };
    for (const [days, dur] of Object.entries(steps)) expect(appleOfferPlan({ ...DEMISHA, free_days: Number(days) })?.duration).toBe(dur);
    expect(appleOfferPlan({ ...DEMISHA, free_days: 45 })).toBeNull();
  });

  it("never shortens the 14-day trial: Apple REPLACES it, so a one-week code stays off Apple", () => {
    expect(appleOfferPlan({ ...DEMISHA, free_days: 7 })).toBeNull();
    expect(read("src/lib/apple-offer-codes.ts")).toMatch(/offerEligibility: "REPLACE_INTRO_OFFERS"/);
  });

  it("leaves Office, money-off, tester, expired, inactive and non-alphanumeric codes to the website", () => {
    expect(appleOfferPlan({ ...DEMISHA, applies_to: "office" })).toBeNull();
    expect(appleOfferPlan({ ...DEMISHA, discount_type: "percent", free_days: null, discount_percent: 30 })).toBeNull();
    expect(appleOfferPlan({ ...DEMISHA, discount_type: "grant" })).toBeNull();
    expect(appleOfferPlan({ ...DEMISHA, expires_at: "2020-01-01T00:00:00Z" })).toBeNull();
    expect(appleOfferPlan({ ...DEMISHA, active: false })).toBeNull();
    expect(appleOfferPlan({ ...DEMISHA, code: "APPLE-PRO" })).toBeNull();
    expect(appleOfferPlan({ ...DEMISHA, applies_to: "any" })).not.toBeNull();
  });
});

describe("codes reach Apple on their own", () => {
  const lib = read("src/lib/apple-offer-codes.ts");

  it("a retry finds what an earlier run made instead of making it twice", () => {
    const mirror = lib.slice(lib.indexOf("export async function mirrorPromoToApple("), lib.indexOf("async function createOffer("));
    expect(mirror).toMatch(/offerCodes\?limit=200/);
    expect(mirror).toMatch(/found \? found\.id : await createOffer\(/);
    expect(mirror).toMatch(/customCodes\?limit=50/);
    expect(mirror.indexOf("customCodes?limit=50")).toBeLessThan(mirror.indexOf("await createCustomCode("));
  });

  it("a used-up code never reaches Apple", () => {
    expect(lib).toMatch(/if \(usedUp\) return \{ ok: false/);
  });

  it("deactivating a code turns Apple's copy off too", () => {
    expect(lib).toMatch(/attributes: \{ active: false \}/);
    const del = read("src/app/api/admin/promo-codes/route.ts");
    expect(del.slice(del.indexOf("export async function DELETE("))).toMatch(/await deactivateAppleOffer\(promo\.apple_offer_code_id/);
  });

  it("creating a code mirrors it, and the daily cron retries anything missing", () => {
    expect(read("src/app/api/admin/promo-codes/route.ts")).toMatch(/await mirrorPromoToApple\(data\)/);
    expect(read("src/app/api/reminders/route.ts")).toMatch(/await mirrorPendingPromosToApple\(\)/);
  });

  it("the check tells the app whether Apple can redeem the code", () => {
    const check = read("src/app/api/promo/check/route.ts");
    expect(check).toMatch(/appleRedeemable\(result\.promo\)/);
    expect(check).toMatch(/forPro, apple, annualOnly/);
  });

  it("the App Store Connect key comes from the environment, never the repo", () => {
    const lib = read("src/lib/apple-offer-codes.ts");
    expect(lib).toMatch(/process\.env\.ASC_PRIVATE_KEY/);
    expect(lib).not.toMatch(/BEGIN PRIVATE KEY/);
  });
});

describe("the app's Pro card acts on an applied code", () => {
  const src = read("src/components/PlanCards.tsx");
  const pro = src.slice(src.indexOf("function NativePro("), src.indexOf("function NativePromoCode("));

  it("the plan step holds the code where the Pro card can see it", () => {
    const chooser = src.slice(src.indexOf("function NativePlanChooser("), src.indexOf("export function NativeProUpgrade"));
    expect(chooser).toMatch(/const code = useNativePromo\(onLeftForWebsite\);/);
    expect(chooser).toMatch(/code=\{code\}/);
  });

  it("a code Apple has is redeemed through Apple, never the plain subscription sheet", () => {
    const appleBranch = pro.slice(pro.indexOf("if (promo && viaApple)"), pro.indexOf("if (promo && code)"));
    expect(appleBranch).toMatch(/<AppleOfferCodeButton/);
    expect(appleBranch).not.toMatch(/IapSubscribeButton/);
    expect(appleBranch).toMatch(/Try Pro free for \$\{freeFor\} →/);
    // Its price is still StoreKit's, never a typed number.
    expect(pro).toMatch(/<ProTrialPrice price=\{promoPrice\} period=\{promoPeriod\} freeFor=\{freeFor\} \/>/);
  });

  it("any other Pro code is used on swiftcard.me, and the button says so", () => {
    const webBranch = pro.slice(pro.indexOf("if (promo && code)"));
    expect(webBranch).toMatch(/`Use \$\{promo\.code\} on swiftcard\.me →`/);
    expect(webBranch).toMatch(/code\.website\.open\(promo\.code\)/);
  });

  it("Apple's code page opens with the code filled in, and coming back syncs the subscription", () => {
    const iap = read("src/lib/iap.ts");
    expect(iap).toMatch(/https:\/\/apps\.apple\.com\/redeem\?ctx=offercodes&id=\$\{APP_STORE_ID\}&code=\$\{encodeURIComponent\(code\)\}/);
    expect(iap).toMatch(/presentCodeRedemptionSheet\(\)/);
    // RevenueCat picks the redemption up itself; syncPurchases is observer-mode only.
    expect(iap).not.toMatch(/syncPurchases\(\)/);
    expect(iap).toMatch(/invalidateCustomerInfoCache\(\)/);
    expect(src).toMatch(/if \(await syncIapAfterRedeem\(\)\)/);
    // apps.apple.com is on the native plugin's host allow-list.
    expect(read("ios/App/App/ExternalPurchase.swift")).toMatch(/"apps\.apple\.com"/);
  });

  it("the box doesn't offer a second button for a code the Pro card already uses", () => {
    expect(read("src/components/PromoCodeBox.tsx")).toMatch(/website\.proCardAbove\s*\?/);
    expect(src).toMatch(/proCardAbove: !!code\.forPro/);
  });
});
