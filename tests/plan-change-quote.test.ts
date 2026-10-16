import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Pro → Office from Settings charged the card with one tap and no amount shown;
// the /checkout quote said $0.00 whenever the billing period changed; and a Pro
// trial moved to Office stayed trialing, so Office ran free and nobody was told.
const read = (p: string) => readFileSync(p, "utf8");
const modal = read("src/components/BillingManager.tsx");
const preview = read("src/app/api/stripe/subscription/preview/route.ts");
const change = read("src/app/api/stripe/subscription/change-plan/route.ts");
const page = read("src/app/checkout/CheckoutClient.tsx");

describe("a plan change that charges is reviewed and confirmed first", () => {
  it("Settings sends Pro → Office and any move to annual to the /checkout review", () => {
    expect(modal).toMatch(/const charges = \(plan === "office" && sub\.plan !== "office"\) \|\| \(interval === "annual"/);
    expect(modal).toContain("window.location.href = `/checkout?${qs.toString()}`;");
    // …before it could ever call change-plan directly.
    const body = modal.slice(modal.indexOf("async function choose("));
    expect(body.indexOf("if (charges)")).toBeLessThan(body.indexOf('"/api/stripe/subscription/change-plan"'));
  });
});

describe("the quote is what Stripe will charge", () => {
  it("a changed billing period or an ending trial quotes Stripe's whole invoice, not just prorations", () => {
    expect(preview).toContain("const intervalChanges = !!current && current.interval !== interval;");
    expect(preview).toMatch(/endsTrial \|\| intervalChanges\s*\?\s*Math\.max\(0, preview\.amount_due \?\? 0\)/);
  });

  it("a trial that carries on quotes nothing today and says until when", () => {
    expect(preview).toMatch(/dueTodayCents: trialing && !endsTrial\s*\?\s*0/);
    expect(preview).toContain("trialContinuesUntil:");
    expect(page).toContain("Your free trial carries on — nothing is charged today.");
  });

  it("the page no longer promises 'you keep your billing date' when it moves", () => {
    expect(page).toContain('preview.billingDateResets ? ", and your billing date moves to today."');
  });
});

describe("Office has no free trial", () => {
  it("preview and change-plan both end a Pro trial moved up to Office", () => {
    expect(preview).toMatch(/const endsTrial = trialing && targetPlan === "office" && current\?\.plan !== "office";/);
    expect(preview).toMatch(/\.\.\.\(endsTrial \? \{ trial_end: "now" as const \} : \{\}\)/);
    expect(change).toMatch(/endsTrial = sub\.status === "trialing" && targetPlan === "office" && !wasOffice;/);
    expect(change).toMatch(/\.\.\.\(endsTrial \? \{ trial_end: "now" as const \} : \{\}\)/);
  });

  it("and clears the trial markers, so no trial banner or day-7 notice follows", () => {
    // Removed key by key, alongside the cancel mirror (lib/customization-merge, audit B-03).
    expect(change).toMatch(/\.\.\.\(endsTrial \? \["_trialEndsAt", "_trialChargeCents", "_trialChargeInterval"\] : \[\]\)/);
  });
});

describe("the same change made again later is a new request to Stripe", () => {
  it("the idempotency key carries the moment, not just the transition", () => {
    expect(change).toMatch(/const idempotencyKey = `change:[^`]*:\$\{prorationDate \?\? Math\.floor\(nowSec \/ 60\)\}`;/);
  });
});

describe("'Cancel Pro, keep my account' keeps the time already paid for", () => {
  const route = readFileSync("src/app/api/account/downgrade/route.ts", "utf8");
  it("schedules the cancellation at period end instead of cancelling now", () => {
    expect(route).toContain("cancel_at_period_end: true");
    expect(route).not.toMatch(/subscriptions\.cancel\(/);
  });
  it("leaves stripe_subscription_id in place, so the deletion webhook still runs the Pro-ended step", () => {
    expect(route).not.toMatch(/stripe_subscription_id: null/);
    expect(route).toContain("_cancelAtPeriodEnd: true");
  });
  it("says so — no more 'Billing stops today'", () => {
    expect(readFileSync("src/lib/retention.ts", "utf8")).not.toContain("Billing stops today");
  });
});

describe("an App Store Pro subscriber is never billed twice by the website", () => {
  const route = readFileSync("src/app/api/stripe/checkout/route.ts", "utf8");
  it("buying Pro again on the web is refused", () => {
    expect(route).toMatch(/if \(appleBacked && isPro\) \{/);
    expect(route).toContain("You already have Pro through the App Store.");
  });
  it("Office is allowed only after the page has said to cancel the Apple subscription", () => {
    expect(route).toMatch(/if \(appleBacked && isOffice && body\.acknowledgeApple !== true\)/);
    expect(page).toContain("I understand — continue to Office");
    expect(page).toContain("acknowledgeApple: true");
  });
});

describe("no 50%-off offer where it can't honestly be made", () => {
  it("never inside the app (the delete-account flow)", () => {
    expect(readFileSync("src/lib/retention.ts", "utf8")).toMatch(/if \(!elig\.discount \|\| native\) return null;/);
  });
  it("never during a free trial (the Billing cancel flow)", () => {
    expect(modal).toMatch(/const canOfferDiscount = !sub\.retentionUsed && !sub\.trialEnd &&/);
  });
});

describe("deleting the account doesn't claim to cancel what Apple bills", () => {
  it("the final confirm tells an App Store subscriber to cancel in Apple settings", () => {
    const s = readFileSync("src/components/ManageAccount.tsx", "utf8");
    expect(s).toContain('source === "apple"');
    expect(s).toContain("Your App Store subscription is NOT cancelled by this");
  });
});
