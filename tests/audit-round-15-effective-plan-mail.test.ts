import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isPaidProfile } from "@/lib/effective-plan";

// ── Audit round 15 (2026-10-18): the plan someone actually has, and the mail
//    they are owed ───────────────────────────────────────────────────────────
//
// N-07  The 8am catch-up read "paid" from the plan column. A grant that ended
//       overnight still said pro, so a locked contact's real name went to the
//       lock screen — and a fresh Apple purchase was told to "open to unlock".
// N-15  The same column read decided whether a contact's reply was masked.
// N-10  Lifecycle mail ("your plan ends in 3 days", "your trial has ended")
//       was skipped for any account with no email_preferences row, which only
//       signup ever made — every older account, silently.

const read = (p: string) => readFileSync(p, "utf8");
const DAY = 86_400_000;

describe("N-07 / N-15: paid means paid right now", () => {
  it("an expired timed grant is Free even while the column still says pro; a subscription or Apple Pro is paid", () => {
    expect(isPaidProfile({ plan: "pro", plan_expires_at: new Date(Date.now() - DAY).toISOString(), stripe_subscription_id: null, customization: {} })).toBe(false);
    expect(isPaidProfile({ plan: "pro", plan_expires_at: new Date(Date.now() + DAY).toISOString(), stripe_subscription_id: null, customization: {} })).toBe(true);
    expect(isPaidProfile({ plan: "pro", plan_expires_at: new Date(Date.now() - DAY).toISOString(), stripe_subscription_id: "sub_1", customization: {} })).toBe(true);
    expect(isPaidProfile({ plan: "pro", plan_expires_at: new Date(Date.now() - DAY).toISOString(), stripe_subscription_id: null, customization: { _planSource: "apple" } })).toBe(true);
  });

  it("the morning catch-up reads the effective plan, with the columns it needs", () => {
    const catchup = read("src/app/api/push/catchup/route.ts");
    expect(catchup).toContain('.from("profiles").select(`id, ${PLAN_COLUMNS}`).in("id", userIds.slice(i, i + 200));');
    expect(catchup).toContain("const paid = !!profile && isPaidProfile(profile as PlanRow);");
    expect(catchup).not.toMatch(/isPaidPlan\(/);
  });

  it("a contact's reply is masked by the effective plan", () => {
    const inbound = read("src/app/api/twilio/inbound/route.ts");
    expect(inbound).toContain("const hidden = isLockedLead(target) && !isPaidProfile(owner as PlanRow);");
    expect(inbound.match(/select\(`id, \$\{PLAN_COLUMNS\}`\)/g)?.length).toBe(2);
    expect(inbound).not.toMatch(/isPaidPlan\(/);
  });
});

describe("N-10: lifecycle mail is never lost to a missing preferences row", () => {
  it("the cron provisions the row (and its unsubscribe link) before deciding", () => {
    const cron = read("src/app/api/reminders/route.ts");
    const fn = cron.slice(cron.indexOf("async function getEmailPrefs("));
    expect(fn.indexOf("await ensureEmailPreferences(userId, supabase);")).toBeGreaterThan(0);
    expect(fn.indexOf("await ensureEmailPreferences(userId, supabase);")).toBeLessThan(fn.indexOf('.from("email_preferences")'));
  });

  it("provisioning never re-subscribes someone who opted out", () => {
    expect(read("src/lib/email-prefs.ts")).toContain('upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true })');
  });
});
