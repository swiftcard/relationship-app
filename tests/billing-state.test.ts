import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const code = (p: string) =>
  readFileSync(join(root, p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const CRON = "src/app/api/reminders/route.ts";
const WEBHOOK = "src/app/api/stripe/webhook/route.ts";
const REFERRAL = "src/lib/referral-server.ts";

describe("the grace sweep can't cancel a paying customer", () => {
  it("re-reads the live subscription before cancelling", () => {
    // Nothing between the stamp and the cancel ever asked Stripe whether the
    // subscription had recovered — and cancelling cascades into Office member
    // downgrades and membership deletion.
    const c = code(CRON);
    expect(c).toMatch(/subscriptions\.retrieve\(u\.stripe_subscription_id as string\)/);
    const retrieveAt = c.indexOf("subscriptions.retrieve(u.stripe_subscription_id");
    const cancelAt = c.indexOf("subscriptions.cancel(u.stripe_subscription_id");
    expect(retrieveAt).toBeGreaterThan(0);
    expect(cancelAt).toBeGreaterThan(retrieveAt);
  });

  it("leaves a healthy subscription alone and clears the stale flag", () => {
    const c = code(CRON);
    expect(c).toMatch(/sub\.status === "active" \|\| sub\.status === "trialing"/);
    expect(c).toMatch(/delete healthy\._paymentFailedAt/);
  });

  it("only a failed RENEWAL arms the fuse", () => {
    // Any failed invoice used to stamp it — a one-off, a proration, a manual
    // invoice — putting a current customer 7 days from cancellation. Annual
    // customers were most exposed: the invoice that would clear it is months
    // away.
    const c = code(WEBHOOK);
    expect(c).toMatch(/isCycleInvoice = invoice\.billing_reason === "subscription_cycle"/);
    expect(c).toMatch(/if \(isCycleInvoice && !cust\._paymentFailedAt\)/);
  });
});

describe("a referral reward never costs the referrer something", () => {
  it("an app grant cannot write a plan DOWN", () => {
    // This wrote plan:"pro" unconditionally, so an Office owner claiming their
    // reward was demoted to Pro by the act of collecting it.
    const c = code(REFERRAL);
    expect(c).toMatch(/const plan = p\?\.plan === "enterprise" \? "enterprise" : "pro"/);
    expect(c, "still writes a bare pro").not.toMatch(/update\(\{ plan: "pro", plan_expires_at: expires \}\)/);
  });

  it("refuses rather than granting a paying subscriber something worthless", () => {
    const c = code(REFERRAL);
    expect(c).toMatch(/throw new Error\("referral_credit_failed"\)/);
    expect(c).toMatch(/throw new Error\("referral_credit_unavailable"\)/);
  });

  it("and releases the consumed rows when it refuses", () => {
    // The rows are marked claimed BEFORE the reward is applied, so a throw
    // that isn't caught would eat three referrals and deliver nothing.
    const c = code(REFERRAL);
    // The grant now reports WHICH reward it gave ("credit" | "grant") so the
    // screen can say what happened; still inside the same try.
    expect(c).toMatch(/try \{\s*kind = await grantReferrerReward/);
    expect(c).toMatch(/reward_granted: false, rewarded_at: null \}\)\s*\.in\("id", \(updated/);
    expect(c).toMatch(/nothing was used up/);
  });

  it("the failure is reported to the user, not swallowed", () => {
    expect(code(REFERRAL)).toMatch(/ok: false,[\s\S]{0,200}?couldn't apply your free month/);
  });
});
