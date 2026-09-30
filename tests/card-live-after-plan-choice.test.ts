import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { awaitingPlanChoice } from "@/lib/card-active";
import { PLAN_STEP_REQUIRED_SINCE } from "@/lib/billing-state";
import { PLAN_CHOSEN_KEY } from "@/lib/welcome-email";

// Owner, 2026-09-16: "They press Save and Create Your Account and they should
// create their account. Once they create an account their card isn't live yet
// and they still didn't get the 'Your Card Is Created' email. They have to
// choose a plan." A new account's card goes live when — and only when — a plan
// is chosen: Free, Stripe or Apple. Existing accounts are never taken down.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const NEW = "2026-09-17T12:00:00Z";
const OLD = "2026-09-01T12:00:00Z";

describe("the rule", () => {
  it("a new Free account with no plan chosen is not live", () => {
    expect(NEW >= PLAN_STEP_REQUIRED_SINCE).toBe(true);
    expect(awaitingPlanChoice({ plan: "free", customization: {}, created_at: NEW })).toBe(true);
    expect(awaitingPlanChoice({ plan: null, customization: null, created_at: NEW })).toBe(true);
  });

  it("choosing a plan — Free, Stripe or Apple — puts it live", () => {
    expect(awaitingPlanChoice({ plan: "free", customization: { [PLAN_CHOSEN_KEY]: "free" }, created_at: NEW })).toBe(false);
    expect(awaitingPlanChoice({ plan: "pro", customization: {}, created_at: NEW })).toBe(false);
  });

  it("uses the same marker the plan step writes", () => {
    // card-active reads the key by name so the OG image route does not pull in
    // the email module; this is what keeps the two spellings identical.
    expect(PLAN_CHOSEN_KEY).toBe("_planChosen");
    expect(read("src/lib/card-active.ts")).toContain("_planChosen");
  });

  it("never takes down an existing account, an office member, or a row without a date", () => {
    expect(awaitingPlanChoice({ plan: "free", customization: {}, created_at: OLD })).toBe(false);
    expect(awaitingPlanChoice({ plan: "free", customization: {}, created_at: NEW, office_id: "o1" })).toBe(false);
    expect(awaitingPlanChoice({ plan: "free", customization: {}, created_at: null })).toBe(false);
    expect(awaitingPlanChoice(null)).toBe(false);
  });

  it("is the same cut-off the dashboard uses to send people to /welcome", () => {
    const dash = read("src/app/dashboard/page.tsx");
    expect(dash).toMatch(/profile\.created_at >= PLAN_STEP_REQUIRED_SINCE/);
    expect(read("src/lib/card-active.ts")).toMatch(/owner\.created_at >= PLAN_STEP_REQUIRED_SINCE/);
  });
});

describe("every public surface honours it", () => {
  it("the shared kill-switch (vCard, wallet, OG image, lead capture, analytics)", () => {
    const src = read("src/lib/card-active.ts");
    expect(src).toMatch(/select\("plan, customization, created_at, office_id"\)/);
    expect(src).toMatch(/if \(awaitingPlanChoice\(owner\)\) return false;/);
  });

  it("the cached page data carries it", () => {
    const src = read("src/lib/card-page-data.ts");
    expect(src).toMatch(/select\("plan, photo_url, customization, created_at, office_id"\)/);
    expect(src).toMatch(/awaitingPlan = awaitingPlanChoice\(cardOwner\)/);
  });

  it("the card page and the Swift Links page 404 for everyone but the owner", () => {
    expect(read("src/app/[username]/page.tsx")).toMatch(/if \(cardRow && awaitingPlan && !isOwnerView\) notFound\(\);/);
    expect(read("src/app/links/[username]/page.tsx")).toMatch(/if \(awaitingPlan && !isOwnerView\) notFound\(\);/);
  });

  it("share images, unfurls and wallet passes resolve to nothing", () => {
    expect(read("src/lib/resolve-card.ts")).toMatch(/if \(cardRow && awaitingPlan\) return null;/);
    expect(read("src/app/links/[username]/page.tsx")).toMatch(/if \(!cardOrLegacy \|\| awaitingPlan\) return/);
  });
});

describe("choosing a plan opens the cards immediately and sends the email", () => {
  for (const [file, label] of [
    ["src/app/api/account/choose-plan/route.ts", "Free on /welcome"],
    ["src/app/api/stripe/webhook/route.ts", "Stripe checkout"],
    ["src/app/api/iap/sync/route.ts", "Apple purchase (app sync)"],
    ["src/app/api/iap/revenuecat/route.ts", "Apple purchase (RevenueCat)"],
  ] as const) {
    it(label, () => {
      const src = read(file);
      expect(src, `${label} does not drop the cached card pages`).toMatch(/revalidateUserCards\(/);
      expect(src, `${label} never sends the welcome email`).toMatch(/sendWelcomeWhenCardLive\(/);
    });
  }

  it("/welcome says 'live' only AFTER a plan is chosen", () => {
    const src = read("src/components/WelcomePlan.tsx");
    // Before the plan: "Your account is ready … your card goes live".
    expect(src).toMatch(/>Your account is ready</);
    expect(src).toMatch(/your card goes live/);
    // "Your card is live!" exists only inside the post-plan setup step (and
    // only when there is a card: a plan bought from the app's builder before
    // its card was saved reads "You're all set!").
    expect(src).toMatch(/\{cardSlug \? "Your card is live!" : "You're all set!"\}/);
    const live = src.indexOf('{cardSlug ? "Your card is live!"');
    const setupStart = src.indexOf("{setupNext !== null ? (");
    const planStep = src.indexOf(">Your account is ready<");
    expect(live).toBeGreaterThan(setupStart);
    expect(live).toBeLessThan(planStep);
  });
});
