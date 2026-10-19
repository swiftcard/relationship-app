import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Owner, 2026-09-16: "the sign-up for the office plan is not working … if i
// press get started i make a card then i choose office plan, it glitches".
// Reproduced on production: payment worked, but Stripe returns the buyer the
// moment they pay — BEFORE its webhook sets the plan — and /office/admin sent
// anyone not yet on Office to /pricing (in the app: → /dashboard → /welcome,
// the plan chooser again).

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("after paying, nobody is bounced before the plan lands", () => {
  it("every checkout returns through /checkout/success with the session id", () => {
    const src = read("src/app/api/stripe/checkout/route.ts");
    expect(src).toMatch(/success_url: `\$\{APP_URL\}\/checkout\/success\?plan=\$\{planKey\}/);
    expect(src).toContain("session_id={CHECKOUT_SESSION_ID}");
    // The caller's destination survives as `next`.
    expect(src).toMatch(/&next=\$\{encodeURIComponent\(successPath\)\}/);
  });

  it("the success page waits for the plan, but only for a real, paid session of this account", () => {
    const src = read("src/app/checkout/success/page.tsx");
    expect(src).toMatch(/const settled = \(isOffice \? isOfficePlan\(profile\?\.plan\) : isPaidPlan\(profile\?\.plan\)\) && officeReady;/);
    // Office also waits for the office row the webhook creates after the plan.
    expect(src).toMatch(/from\("offices"\)\.select\("id"\)\.eq\("owner_id", user!\.id\)/);
    expect(src).toMatch(/session\.client_reference_id === user!\.id && session\.status === "complete"/);
    expect(src).toMatch(/if \(!paid\) redirect\("\/welcome"\)/);
    expect(src).toMatch(/<AwaitingPlan /);
    // `next` is validated before it is followed.
    expect(src).toMatch(/!next\.startsWith\("\/\/"\) && SAFE_PATH\.test\(next\)/);
  });

  it("the waiting screen re-checks on its own", () => {
    const src = read("src/app/checkout/success/AwaitingPlan.tsx");
    // Every 2 s at first, then backing off and stopping (audit P-08).
    expect(src).toMatch(/tick = setTimeout\(\(\) => \{ router\.refresh\(\); next\(\); \}, STEPS\[i\+\+\]\);/);
  });
});

describe("a plan picked on /pricing is not asked for again", () => {
  it("the claim hands /pricing's plan to /welcome", () => {
    const src = read("src/components/GuestDraftClaim.tsx");
    expect(src).toMatch(/picked === "pro" \|\| picked === "office"/);
    expect(src).toMatch(/for \(const k of \["interval", "seats", "promo"\]\)/);
  });

  it("/welcome turns it into the Complete-your-subscription step (web only)", () => {
    expect(read("src/app/welcome/page.tsx")).toMatch(/presetIntent=\{presetIntent\}/);
    expect(read("src/components/WelcomePlan.tsx")).toContain("setIntent(detectNativeApp() ? null : presetIntent);");
  });
});

describe("Office has no free trial", () => {
  it("the trial is only ever computed for Pro", () => {
    const src = read("src/app/api/stripe/checkout/route.ts");
    expect(src).toMatch(/isPro &&\s*trialAllowed &&/);
  });

  it("the Office subscription step promises no trial", () => {
    expect(read("src/components/WelcomePlan.tsx")).toContain('paidIntent.plan === "pro" && trialEligible ?');
  });
});
