import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// A promo code redeemed on Apple's page must end in Pro, a saved card and the
// "Your card is live!" step — never back on "Choose your plan".
//
// Owner, 2026-11-04: a brand-new account in the iPhone app applied SWIFTNYC
// (one month free), tapped "Try Pro free for one month →", redeemed it on
// Apple's App Store page and came back to the SAME "Choose your plan" screen.
// The account stayed Free, with NO card, and no RevenueCat webhook ever came:
//
//   • the app never called syncPurchases on return, which RevenueCat's guide
//     for exactly this flow says to do ("It is important to call syncPurchases
//     when the user returns back to your app to retrieve their purchase… If
//     not, the user may need to trigger a restore") — so RevenueCat never
//     learnt of the redemption, and three cache reads over four seconds found
//     nothing;
//   • the code button had no Restore, the one other way to post the receipt;
//   • the "waiting" state was in memory only — a reload forgot it;
//   • the builder's plan gate saved the card only AFTER a plan completed, so
//     the card existed nowhere but on the phone.
//
// Behaviour is driven in tests/render/apple-offer-code-redeem.interactive.test.ts
// (a RevenueCat stub that, like the real one, knows a redemption only once it
// is told). These pin the shape so it can't quietly come back.
// ─────────────────────────────────────────────────────────────────────────────

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const iap = read("src/lib/iap.ts");
const cards = read("src/components/PlanCards.tsx");
const wizard = read("src/app/cards/new/NewCardWizard.tsx");
const fn = (src: string, start: string, end?: string) =>
  src.slice(src.indexOf(start), end ? src.indexOf(end, src.indexOf(start) + start.length) : undefined);

describe("coming back from Apple's code page", () => {
  const sync = fn(iap, "export async function syncIapAfterRedeem", "export async function manageIapSubscription");

  it("hands the purchase to RevenueCat (syncPurchases) before asking it anything", () => {
    expect(sync.indexOf("await sync();")).toBeGreaterThan(-1);
    expect(sync.indexOf("await sync();")).toBeLessThan(sync.indexOf("getCustomerInfo()"));
    expect(sync).toMatch(/w\.P\.syncPurchases\(\)/);
  });

  it("keeps asking for ~30 s, hears RevenueCat's own update, and always lets go of it", () => {
    const pauses = iap.match(/REDEEM_CHECK_PAUSES_MS = \[([^\]]+)\]/)?.[1].split(",").map((n) => Number(n.trim())) ?? [];
    expect(pauses.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(25_000);
    expect(sync).toMatch(/addCustomerInfoUpdateListener\(/);
    expect(sync).toMatch(/finally \{\s*if \(listener\) w\.P\.removeCustomerInfoUpdateListener/);
  });

  it("ends in the server having Pro, like a purchase does", () => {
    expect(sync).toMatch(/await waitForServerGrant\(\);\s*forgetAppleRedeem\(\);\s*return true;/);
    expect(fn(iap, "export async function purchaseIap", "export async function restoreIap")).toMatch(/await waitForServerGrant\(\);/);
  });
});

describe("the redemption is written down before Apple opens", () => {
  const redeem = fn(iap, "export async function redeemAppleOfferCode", "const REDEEM_CHECK_PAUSES_MS");

  it("per account, before the page opens, and dropped if nothing opened", () => {
    expect(redeem.indexOf("rememberAppleRedeem(uid, code);")).toBeGreaterThan(-1);
    expect(redeem.indexOf("rememberAppleRedeem(uid, code);")).toBeLessThan(redeem.indexOf("ext.open({ url })"));
    expect(redeem).toMatch(/if \(!w\) \{ forgetAppleRedeem\(\); return false; \}/);
    expect(iap).toMatch(/return p\.uid === uid \? \(p as PendingAppleRedeem\) : null;/);
  });

  it("the plan step finishes a redemption it did not start, only once the app is in front", () => {
    const hook = fn(cards, "function useAppleRedeem(", "type AppleRedeem =");
    expect(hook).toMatch(/pendingAppleRedeemForSession\(\)\.then/);
    expect(hook).toMatch(/if \(document\.visibilityState === "visible"\) void confirm\(\);\s*else setPhase\("waiting"\);/);
    // Back from Apple: visibility, or a page restored from the bfcache.
    expect(hook).toMatch(/addEventListener\("visibilitychange", onReturn\)/);
    expect(hook).toMatch(/addEventListener\("pageshow", onShow\)/);
    // One controller per plan step, owned by the chooser.
    expect(fn(cards, "function NativePlanChooser(", "export function NativeProUpgrade")).toMatch(/const redeem = useAppleRedeem\(onIapPurchased\);/);
  });
});

describe("never a dead end", () => {
  it("not confirmed yet → Check again and Restore Purchases, in the Pro card", () => {
    const status = fn(cards, "function AppleRedeemStatus(", "function AppleRedeemBanner(");
    expect(status).toMatch(/Apple hasn&apos;t confirmed it yet\.|Apple hasn't confirmed it yet\./);
    expect(status).toMatch(/onClick=\{redeem\.checkAgain\}[^>]*>Check again</);
    expect(status).toMatch(/redeem\.restore\(redeem\.origin\)/);
  });

  it("Restore Purchases is on the iPhone plan step (never Android's), and a restore carries on", () => {
    const chooser = fn(cards, "function NativePlanChooser(", "export function NativeProUpgrade");
    expect(chooser).toMatch(/<NativeRestore redeem=\{redeem\} \/>/);
    // Android returns its Free-only card before the chooser is ever reached.
    const native = fn(cards, "if (native) {", "<NativePlanChooser");
    expect(native).toMatch(/detectNativePlatform\(\) === "android"/);
    expect(fn(cards, "function NativeRestore(")).toMatch(/redeem\.restore\("restore"\)/);
    const hook = fn(cards, "function useAppleRedeem(", "type AppleRedeem =");
    expect(hook).toMatch(/if \(await restoreIap\(\)\) \{ succeed\(\); return; \}/);
    // The sheet's own Restore continues mid-flow too, instead of reloading
    // into the builder with the plan step still to do.
    expect(read("src/components/NativePaywall.tsx")).toMatch(/if \(restored\) \{[\s\S]*?if \(onPurchased\) onPurchased\(\);\s*else window\.location\.reload\(\);/);
  });
});

describe("the builder's plan gate saves the card before Apple opens", () => {
  it("saves as designed (chosenPlan pro), then /welcome carries the plan step on", () => {
    const save = fn(wizard, "const saveCardBeforeApple: BeforeAppleRedeem", "// handleGuestFree");
    // iapPurchased = true → chosenPlan "pro": the design is kept, like a Stripe Pro pick.
    expect(save).toMatch(/handleCreate\(undefined, undefined, false, true, \(slug\) => \{/);
    expect(save).toMatch(/new URLSearchParams\(\{ card: slug, promo: code \}\)/);
    expect(save).toMatch(/router\.replace\(`\/welcome\?\$\{qs\.toString\(\)\}`\)/);
    expect(save).toMatch(/\.finally\(\(\) => \{ if \(!saved\) resolve\(null\); \}\)/);
    expect(wizard).toMatch(/onBeforeAppleRedeem=\{saveCardBeforeApple\}/);
  });

  it("a save-only create stops before routing and can't create the card twice", () => {
    const create = fn(wizard, "async function handleCreate(", "// One definition, three render sites");
    const onSaved = create.indexOf("if (onSaved) { onSaved(savedUsername); return; }");
    expect(onSaved).toBeGreaterThan(-1);
    // After the card exists, before any of the routing.
    expect(onSaved).toBeGreaterThan(create.indexOf("setCreatedUsername(savedUsername);"));
    expect(onSaved).toBeLessThan(create.indexOf("router.push(`/checkout?"));
    expect(onSaved).toBeLessThan(create.indexOf("setStep(5);"));
    // creatingRef is only released on failure paths, never after a save.
    expect(create.slice(onSaved)).not.toMatch(/creatingRef\.current = false/);
  });

  it("the hand-off page is the one that checks — the builder never also does", () => {
    const hook = fn(cards, "function useAppleRedeem(", "type AppleRedeem =");
    expect(hook).toMatch(/if \(handoff\) \{[\s\S]*?setPhase\("handedoff"\);\s*handoff\(opened\);\s*return;\s*\}/);
    // /welcome opens with the code in the box, so its Pro card can open Apple again.
    expect(read("src/components/WelcomePlan.tsx")).toMatch(/initialPromo=\{presetPromo\}/);
  });
});
