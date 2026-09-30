import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Owner, 2026-09-30, after signing up in the iPhone app: the plan step "does
// not look like how it does in other places" — no Free / Pro / Office tabs (you
// had to scroll to reach Free and Office), no Monthly / Annual choice, and a Pro
// card of its own. "Anywhere else there's that same pricing plan, it should look
// the exact same … how it does on the website's pricing right now."
//
// So there is ONE set of plan cards (src/components/PlanTierCards.tsx, lifted
// from /pricing), and every plan chooser draws them. These pins fail the moment
// a surface starts drawing its own card again.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SURFACES = [
  "src/app/pricing/page.tsx", // the reference
  "src/components/PlanCards.tsx", // /welcome + the builder's plan step, web and app
  "src/app/upgrade/UpgradeClient.tsx", // Free → Pro / Office
];

describe("every plan chooser draws the shared cards", () => {
  for (const f of SURFACES) {
    const c = code(f);
    it(`${f} imports PlanTierCards and draws no card of its own`, () => {
      expect(c).toMatch(/from "@\/components\/PlanTierCards"/);
      expect(c).toMatch(/<ProPlanCard /);
      expect(c).toMatch(/<OfficePlanCard/);
      expect(c).toMatch(/<BillingToggle /);
      expect(c).toMatch(/<MobilePlanTabs /);
      // The markers of a hand-drawn card.
      expect(c, "a local tick icon — use PlanCheck").not.toMatch(/function Check\b/);
      expect(c, "a local Pro badge — use ProPlanCard").not.toMatch(/MOST POPULAR/);
      expect(c, "a local Free heading — use FreePlanCard").not.toMatch(/>Forever</);
      expect(c, "a local switch — use BillingToggle").not.toMatch(/aria-label="Toggle annual billing"/);
      expect(c, "a local Office badge — use OfficePlanCard").not.toMatch(/FOR TEAMS/);
      expect(c, "a hand-picked plan list — use PLAN_FEATURES via the cards").not.toMatch(/PLAN_FEATURES\./);
    });
  }

  it("Free is offered wherever all three plans are", () => {
    expect(code("src/app/pricing/page.tsx")).toMatch(/<FreePlanCard /);
    expect(code("src/components/PlanCards.tsx").match(/<FreePlanCard/g)?.length).toBe(2); // web + app
  });
});

describe("the iPhone app's plan step is the website's layout", () => {
  const src = code("src/components/PlanCards.tsx");
  const chooser = src.slice(src.indexOf("function NativePlanChooser("), src.indexOf("export function NativeProUpgrade"));

  it("native renders the chooser, not a stacked column", () => {
    const branch = src.slice(src.indexOf("if (native) {"), src.indexOf("return (\n    <div>"));
    expect(branch).toMatch(/<NativePlanChooser/);
    expect(chooser.length).toBeGreaterThan(200);
  });

  it("has the tabs and opens on the caller's tier (Pro by default)", () => {
    expect(chooser).toMatch(/<MobilePlanTabs active=\{tier\}/);
    expect(chooser).toMatch(/useState<PlanTier>\(initialTier\)/);
    expect(src).toMatch(/initialTier = "pro",/);
  });

  // Owner, 2026-09-30 (later): "why did you add a monthly and yearly toggle
  // there? It comes up anyways when a user taps on the plan" — Apple's sheet
  // offers both periods. So no switch in the app: the card shows the monthly
  // price and the sheet opens on monthly, annual one tap away inside it.
  it("has no Monthly / Annual switch; the card is monthly and so is the sheet it opens", () => {
    expect(chooser).not.toMatch(/<BillingToggle|annual/);
    expect(src.slice(src.indexOf("export function NativeProUpgrade"), src.indexOf("function NativePro("))).not.toMatch(/<BillingToggle/);
    const pro = src.slice(src.indexOf("function NativePro("));
    expect(pro).toMatch(/const price = offer\.monthly;/);
    expect(pro).toMatch(/period="monthly"/);
    expect(pro).toMatch(/appearance="card"/);
    const paywall = code("src/components/NativePaywall.tsx");
    expect(paywall).toMatch(/p\.period === \(period \?\? "annual"\)/);
  });

  it("the app's price comes from StoreKit, never a typed number", () => {
    const hook = code("src/lib/use-iap-price.ts");
    expect(hook).toMatch(/p\.period === "monthly"\)\?\.priceString/);
    expect(hook).not.toMatch(/PLAN_PRICES|\$\d/);
  });

  // Owner, 2026-09-30: "if they have a promo code they don't have anywhere to
  // put the promo code". The app sells Pro through Apple, which takes no Stripe
  // code and forbids unlocking a plan with the app's own (3.1.1) — so the code
  // is checked here and USED on swiftcard.me, through the Office link-out.
  it("has a promo box that checks the code in the app and uses it on swiftcard.me", () => {
    expect(chooser).toMatch(/\{canLinkOut && <NativePromoCode /);
    const box = src.slice(src.indexOf("function NativePromoCode("));
    expect(box).toMatch(/usePromoCode\(\{ plan: null, interval: null \}\)/);
    expect(box).toMatch(/openExternalPurchase\(`\/welcome\?promo=\$\{encodeURIComponent\(code\)\}`\)/);
    expect(box).toMatch(/if \(opened\) onLeft\?\.\(\);\s*else setFailed\(true\);/);
    const promoBox = code("src/components/PromoCodeBox.tsx");
    // Nothing is redeemed in the app: a free-time code goes to the website too.
    expect(promoBox).toMatch(/\{state\.grant && !website && \(/);
    expect(promoBox).toMatch(/label="Use it on swiftcard\.me →"/);
    expect(promoBox).toMatch(/label="Switch it on at swiftcard\.me →"/);
    // /welcome opens with the code already in its box.
    expect(code("src/components/WelcomePlan.tsx")).toMatch(/initialCode: paidIntent\?\.promo \?\? presetPromo,/);
    expect(code("src/app/welcome/page.tsx")).toMatch(/presetPromo=\{!presetIntent && typeof sp\.promo === "string"/);
  });

  it("coming back from paying on swiftcard.me finishes the first card as Pro", () => {
    const wizard = code("src/app/cards/new/NewCardWizard.tsx");
    expect(wizard).toMatch(/onLeftForWebsite=\{\(\) => \{ leftForWebsite\.current = true; \}\}/);
    expect(wizard).toMatch(/if \(!leftForWebsite\.current \|\| !isPaidPlan\(data\?\.plan\)\) return;\s*leftForWebsite\.current = false;\s*setShowPlan\(false\);\s*handleCreate\(undefined, undefined, false, true\);/);
  });

  it("no Office card means no Office tab — never a tab open on nothing", () => {
    expect(chooser).toMatch(/const tier: PlanTier = !canLinkOut && mobileTier === "office" \? "pro" : mobileTier;/);
    expect(chooser).toMatch(/tiers=\{canLinkOut \? undefined : \["free", "pro"\]\}/);
  });
});

describe("the app's purchase button", () => {
  const paywall = code("src/components/NativePaywall.tsx");

  it("does not pull the plan cards into every page that shows a Pro gate", () => {
    // NativePaywall is reached from PlanGate on every editor and the homepage
    // mini builders; the card's class comes in from PlanCards instead.
    expect(paywall).not.toMatch(/PlanTierCards/);
    expect(code("src/components/PlanCards.tsx")).toMatch(/appearance="card"\s+className=\{PRO_CTA_CLASS\}/);
  });

  it("holds its place while the sign-in check runs, instead of popping in", () => {
    expect(paywall).toMatch(/useState<IapStatus \| "pending">\("pending"\)/);
    expect(paywall).toMatch(/if \(status === "pending" && appearance === "card"\) \{\s*return <button type="button" disabled aria-busy="true"/);
  });

  it("reads StoreKit for the pill's trial line only where that line is drawn", () => {
    const button = paywall.slice(paywall.indexOf("export default function IapSubscribeButton"), paywall.indexOf("function TrialLine"));
    expect(button).not.toMatch(/useIapOffer\(/);
    expect(paywall.slice(paywall.indexOf("function TrialLine"))).toMatch(/useIapOffer\(\)/);
  });
});

describe("the shared cards", () => {
  const c = code("src/components/PlanTierCards.tsx");

  it("the Pro card keeps white ink in the app's light theme", () => {
    // Inside .sc-app's light theme .text-white is remapped to near-black;
    // sc-dark-sheet exempts the aurora card.
    expect(c).toMatch(/\$\{tierClass\(offTab\)\} sc-dark-sheet relative rounded-\[28px\]/);
  });

  it("scroll-reveal is opt-in: only /pricing mounts ScrollReveal", () => {
    // A data-reveal element on a page without ScrollReveal stays at opacity 0.
    expect(c).not.toMatch(/data-reveal(?!=\{reveal)/);
    for (const f of ["src/components/PlanCards.tsx", "src/app/upgrade/UpgradeClient.tsx"]) {
      expect(code(f), f).not.toMatch(/\breveal\b(?!\w)/);
    }
  });
});
