import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { trialEndedEmail, trialEndingSoonEmail } from "@/lib/email-templates";
import { PLAN_LIMITS, TRIAL_DAYS } from "@/lib/plan";
import { PLAN_FEATURES } from "@/lib/plan-content";

const root = process.cwd();
const code = (p: string) =>
  readFileSync(join(root, p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the downgrade email states the real Free limits", () => {
  const mail = () => trialEndedEmail({ firstName: "Sam", isTrial: true, unsubscribeUrl: "https://x/u?token=t" });

  it("quotes the actual monthly lead cap, not a remembered 25", () => {
    const html = mail().html;
    expect(html).toContain(`${PLAN_LIMITS.FREE_LEADS_PER_MONTH} a month`);
    expect(html, "still claims a 25-contact cap").not.toMatch(/cap back to 25/);
  });

  it("does not claim new captures pause — they are captured and locked", () => {
    expect(mail().html).not.toMatch(/new captures pause/i);
    expect(mail().html).toMatch(/still captured/i);
  });

  it("says extra cards stop loading, not that they go view-only", () => {
    const html = mail().html;
    expect(html, "'view-only' badly understates a 404'd public page").not.toMatch(/view-only/i);
    expect(html).toMatch(/stop loading for visitors/i);
    // The consequence people actually care about.
    expect(html).toMatch(/QR codes and NFC tags/i);
  });

  it("drops the Day 15 / 30 follow-ups no preset produces", () => {
    expect(mail().html).not.toMatch(/Day 15/);
    expect(mail().html).not.toMatch(/Day 15 \/ 30/);
  });

  it("the ending-soon email shares the same corrected card", () => {
    const html = trialEndingSoonEmail({ firstName: "Sam", daysLeft: 3, isTrial: true, unsubscribeUrl: "https://x/u?token=t" }).html;
    expect(html).toContain(`${PLAN_LIMITS.FREE_LEADS_PER_MONTH} a month`);
    expect(html).not.toMatch(/cap back to 25/);
  });
});

describe("the Free plan does not advertise a follow-up nothing sends", () => {
  it("the day-1 follow-up claim is gone", () => {
    const free = PLAN_FEATURES.free.join(" | ");
    expect(free, "the automated sender is hard-gated on isPaidPlan").not.toMatch(/day-1 follow-up/i);
  });

  it("Free does not advertise AI follow-up drafts (Pro-only)", () => {
    expect(PLAN_FEATURES.free.join(" | ")).not.toMatch(/AI follow-up/i);
  });

  it("Free still advertises the CRM it does have", () => {
    expect(PLAN_FEATURES.free.join(" | ")).toMatch(/Contacts CRM/);
  });
});

describe("the trial is not promised to customers who won't get one", () => {
  const PUBLIC_SURFACES = ["src/app/pricing/page.tsx", "src/components/PlanCards.tsx"];

  it.each(PUBLIC_SURFACES)("%s no longer hardcodes the day count", (f) => {
    const c = code(f);
    expect(c).toMatch(/TRIAL_DAYS/);
    expect(c, "still hardcodes 14 instead of TRIAL_DAYS").not.toMatch(/14-day free trial/);
    expect(c).not.toMatch(/^14 days free,/m);
  });

  it.each(PUBLIC_SURFACES)("%s qualifies the offer as new-customers-only", (f) => {
    // Checkout grants a trial only to customers with no prior Stripe
    // subscription, so an unqualified promise bills a returning customer in
    // full the moment they click.
    expect(code(f)).toMatch(/days free for new customers/);
  });

  it("TRIAL_DAYS is still the single source", () => {
    expect(TRIAL_DAYS).toBe(14);
  });
});

describe("promo blast describes the code it is actually sending", () => {
  it("branches on free_time first — the only kind the admin console creates", () => {
    const c = code("src/app/api/admin/promo-codes/send/route.ts");
    expect(c).toMatch(/promo\.discount_type === "free_time" && freeDays > 0/);
    // The percent branch could never be true, so every real code fell through
    // to "$0.00 off your upgrade" — the only place the recipient sees terms.
    const freeTimeAt = c.indexOf('=== "free_time"');
    const dollarAt = c.indexOf("off your upgrade");
    expect(freeTimeAt).toBeGreaterThan(0);
    expect(freeTimeAt).toBeLessThan(dollarAt);
  });

  it("pluralizes a single day correctly", () => {
    expect(code("src/app/api/admin/promo-codes/send/route.ts")).toMatch(/freeDays === 1 \? "day" : "days"/);
  });
});

describe("office branding copy matches what propagation actually does", () => {
  it("no longer claims the owner's own card is branded", () => {
    const c = code("src/app/office/admin/branding/page.tsx");
    expect(c, "three code paths deliberately exempt the owner").not.toMatch(/including yours/);
    expect(c).toMatch(/Your own cards stay yours/);
  });

  it("the team drawer no longer says the owner's card sets the team look", () => {
    const c = code("src/components/office/TeamList.tsx");
    expect(c).not.toMatch(/Your card sets the look/);
    expect(c).toMatch(/set on the Branding page/);
  });
});

describe("the admin referrals panel no longer makes a false security claim", () => {
  it("states both sides are unrewarded, now that that is true", () => {
    // The panel moved into Company Analytics as a tab (2026-10-27).
    const c = code("src/app/admin/analytics/ReferralsTab.tsx");
    expect(c, "the old claim was true of the referrer only").not.toMatch(/These never grant free months/);
    expect(c).toMatch(/Neither side is rewarded/);
  });
});
