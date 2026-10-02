import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { freePeriodOf, showsTrialBubble, TRIAL_ENDS_KEY } from "@/lib/billing-state";

// Owner, 2026-10-02 (asked for more than once): the free-period bubble at the
// top of the dashboard is for the account's FIRST DAY only — whatever the
// plan, whatever gave the free time. After that the days left are in
// Settings → Profile, and the dashboard never shows the bubble again.

const NOW = Date.parse("2026-10-02T12:00:00Z");
const DAY = 86_400_000;
const inDays = (d: number) => new Date(NOW + d * DAY).toISOString();
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("freePeriodOf — one description of the free period", () => {
  it("a card trial (14-day, promo free time, a stretched trial)", () => {
    const f = freePeriodOf({ plan: "pro", planExpiresAt: null, hasSubscription: true, customization: { [TRIAL_ENDS_KEY]: inDays(12) } }, NOW)!;
    expect(f).toMatchObject({ kind: "trial", planName: "Pro", daysLeft: 12, isTrial: true, canceled: false, endsAt: inDays(12) });
  });

  it("a cancelled trial says so", () => {
    const f = freePeriodOf({ plan: "pro", planExpiresAt: null, hasSubscription: true, customization: { [TRIAL_ENDS_KEY]: inDays(5), _cancelAtPeriodEnd: true } }, NOW)!;
    expect(f.canceled).toBe(true);
  });

  it("free Pro with nothing billing it (a friend's month, a promo grant, the delete-flow gift)", () => {
    const f = freePeriodOf({ plan: "pro", planExpiresAt: inDays(20), hasSubscription: false, customization: {} }, NOW)!;
    expect(f).toMatchObject({ kind: "grant", planName: "Pro", daysLeft: 20, isTrial: false, canceled: false });
  });

  it("free Office is named Office", () => {
    const f = freePeriodOf({ plan: "enterprise", planExpiresAt: inDays(9), hasSubscription: false, customization: {} }, NOW)!;
    expect(f).toMatchObject({ kind: "grant", planName: "Office" });
  });

  it("nothing for Free, a paying subscriber, Apple, or a period that has ended", () => {
    expect(freePeriodOf({ plan: "free", planExpiresAt: inDays(5), hasSubscription: false, customization: {} }, NOW)).toBeNull();
    expect(freePeriodOf({ plan: "pro", planExpiresAt: null, hasSubscription: true, customization: {} }, NOW)).toBeNull();
    expect(freePeriodOf({ plan: "pro", planExpiresAt: null, hasSubscription: false, customization: { _planSource: "apple" } }, NOW)).toBeNull();
    expect(freePeriodOf({ plan: "pro", planExpiresAt: inDays(-1), hasSubscription: false, customization: {} }, NOW)).toBeNull();
    expect(freePeriodOf({ plan: "pro", planExpiresAt: null, hasSubscription: true, customization: { [TRIAL_ENDS_KEY]: inDays(-0.5) } }, NOW)).toBeNull();
  });
});

describe("showsTrialBubble — the account's first day only", () => {
  it("shows during the first 24 hours", () => {
    for (const hours of [0, 1, 12, 23.9]) {
      expect(showsTrialBubble(new Date(NOW - hours * 3_600_000).toISOString(), NOW), `${hours}h`).toBe(true);
    }
  });

  it("never after that", () => {
    for (const days of [1, 1.01, 3, 7, 13, 20, 400]) {
      expect(showsTrialBubble(new Date(NOW - days * DAY).toISOString(), NOW), `day ${days}`).toBe(false);
    }
  });

  it("an unknown creation time shows nothing", () => {
    expect(showsTrialBubble(null, NOW)).toBe(false);
    expect(showsTrialBubble("not a date", NOW)).toBe(false);
  });
});

describe("pinned at source", () => {
  const dash = read("src/app/dashboard/page.tsx");

  it("the dashboard renders the bubble exactly once, only on the first day", () => {
    expect(dash.match(/<TrialBanner\b/g)?.length).toBe(1);
    expect(dash).toMatch(/const trialBubble = !!freePeriod && showsTrialBubble\(user\.created_at\);/);
    expect(dash).toMatch(/\{trialBubble && freePeriod && \(\s*<TrialBanner/);
  });

  it("the dashboard and Settings describe the period with the same function", () => {
    expect(dash).toMatch(/freePeriodOf\(\{/);
    const settings = read("src/app/settings/flows/page.tsx");
    expect(settings).toMatch(/const freePeriod = freePeriodOf\(\{/);
    expect(settings).toMatch(/freePeriod=\{freePeriod\}/);
    expect(settings).toMatch(/plan_expires_at/);
  });

  it("Settings → Profile shows the days left, with no price and no link", () => {
    const general = read("src/components/GeneralSettings.tsx");
    const row = general.slice(general.indexOf("{freePeriod && ("), general.indexOf("{/* Named as it is on screen"));
    expect(row).toMatch(/"Free trial"/);
    expect(row).toMatch(/days left/);
    expect(row).not.toMatch(/\$\d|href=|<Link|Upgrade|Subscribe/);
  });
});
