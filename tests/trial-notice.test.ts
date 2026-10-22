import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { trialNoticeDue } from "../src/lib/trial-notice";
import { trialChargeSoonEmail } from "../src/lib/email-templates";

const DAY = 86_400_000;
const HOUR = 3_600_000;

// ── Why this file exists ────────────────────────────────────────────────────
//
// A card trial ends by charging the card, and both networks require a notice
// first: Visa at least 7 days before the charge WITH the amount, Mastercard
// between 3 and 7 days before the trial ends. The old reminder fired at "3 days
// or less" off a daily cron, so it landed 2-3 days out with no amount — short
// of Visa always and of Mastercard some days. These tests pin the fix, because
// the failure is invisible: nothing breaks, the notice just quietly goes out
// too late (or too bare) and the next disputed charge is one we lose.
describe("trial charge notice — timing", () => {
  it("fires at the 7-day mark, which is the only point both networks accept", () => {
    expect(trialNoticeDue(7 * DAY)).toBe(true);
    // An hour of slack for a schedule that fires a few minutes late.
    expect(trialNoticeDue(7 * DAY + HOUR)).toBe(true);
  });

  it("does NOT fire earlier than 7 days — Mastercard's window closes there", () => {
    expect(trialNoticeDue(8 * DAY)).toBe(false);
    expect(trialNoticeDue(7 * DAY + 2 * HOUR)).toBe(false);
  });

  it("still fires if a run was missed, rather than skipping the notice", () => {
    expect(trialNoticeDue(5 * DAY)).toBe(true);
    expect(trialNoticeDue(2 * DAY)).toBe(true);
    expect(trialNoticeDue(HOUR)).toBe(true);
  });

  it("does not fire once the charge has already happened", () => {
    expect(trialNoticeDue(0)).toBe(false);
    expect(trialNoticeDue(-DAY)).toBe(false);
  });
});

describe("trial charge notice — what the email must say", () => {
  const base = {
    firstName: "Sam",
    planName: "Pro",
    chargeDate: "September 28, 2026",
    manageUrl: "https://swiftcard.me/settings/flows?billing=1",
  };

  it("states the amount and the date — Visa requires both", () => {
    const { html, subject } = trialChargeSoonEmail({ ...base, amountCents: 499, intervalWord: "monthly" });
    expect(html).toContain("$4.99");
    expect(html).toContain("monthly");
    expect(html).toContain("September 28, 2026");
    expect(subject).toContain("September 28, 2026");
  });

  it("tells them how to avoid the charge", () => {
    const { html } = trialChargeSoonEmail({ ...base, amountCents: 499, intervalWord: "monthly" });
    expect(html.toLowerCase()).toContain("cancel");
    expect(html).toContain("https://swiftcard.me/settings/flows?billing=1");
  });

  it("still sends a usable notice when a legacy trial row has no stored amount", () => {
    const { html } = trialChargeSoonEmail({ ...base, amountCents: null });
    expect(html).toContain("September 28, 2026");
    expect(html).not.toContain("$NaN");
    expect(html).not.toContain("undefined");
  });

  it("never calls the Office plan by its internal name", () => {
    const { html, subject } = trialChargeSoonEmail({ ...base, planName: "Office", amountCents: 1998 });
    expect(`${html} ${subject}`.toLowerCase()).not.toContain("enterprise");
  });
});

describe("trial charge notice — the schedule that makes it land on time", () => {
  it("runs hourly on GitHub, not as a Vercel cron (Hobby allows two daily jobs)", () => {
    const wf = readFileSync(".github/workflows/trial-notice.yml", "utf8");
    // Any hourly cron expression is fine; a daily one is not — it cannot hit
    // the 7-day mark, which is the whole point of the job.
    expect(wf).toMatch(/cron:\s*"\d+ \* \* \* \*"/);
    expect(wf).toContain("/api/billing/trial-notice");

    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons?: { path: string }[] };
    // An hourly entry here does not warn — it makes every later deployment fail
    // validation with cron_jobs_limits_reached.
    expect((vercel.crons ?? []).length).toBeLessThanOrEqual(2);
    expect((vercel.crons ?? []).some((c) => c.path.includes("trial-notice"))).toBe(false);
  });

  it("keeps the daily backstop wired, so a stalled schedule delays rather than drops it", () => {
    const reminders = readFileSync("src/app/api/reminders/route.ts", "utf8");
    expect(reminders).toContain("sendTrialChargeNotices");
  });
});
