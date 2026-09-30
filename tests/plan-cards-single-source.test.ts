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

  it("has the Monthly / Annual switch, the tabs, and opens on the caller's tier (Pro by default)", () => {
    expect(chooser).toMatch(/<BillingToggle/);
    expect(chooser).toMatch(/<MobilePlanTabs active=\{tier\}/);
    expect(chooser).toMatch(/useState<PlanTier>\(initialTier\)/);
    expect(src).toMatch(/initialTier = "pro",/);
  });

  it("the switch drives the price AND the product the Apple sheet opens on", () => {
    expect(chooser).toMatch(/annual=\{annual\}/);
    const pro = src.slice(src.indexOf("function NativePro("));
    expect(pro).toMatch(/const price = annual \? offer\.annual : offer\.monthly;/);
    expect(pro).toMatch(/period=\{annual \? "annual" : "monthly"\}/);
    expect(pro).toMatch(/appearance="card"/);
    const paywall = code("src/components/NativePaywall.tsx");
    expect(paywall).toMatch(/p\.period === \(period \?\? "annual"\)/);
  });

  it("the app's SAVE badge and per-month line come from StoreKit, never a typed number", () => {
    expect(chooser).toMatch(/\{\.\.\.appSaveBadge\(offer\)\}/);
    expect(src).toMatch(/saveBadge: offer\.annualSavePct \? `SAVE \$\{offer\.annualSavePct\}%` : null, badgePending: offer\.status === "loading"/);
    const hook = code("src/lib/use-iap-price.ts");
    expect(hook).toMatch(/annual\.price \/ \(monthly\.price \* 12\)/);
    expect(hook).toMatch(/currency: annual\.currencyCode/);
    expect(hook).not.toMatch(/PLAN_PRICES|\$\d/);
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
