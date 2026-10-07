import { describe, it, expect } from "vitest";
import {
  REFERRAL,
  freeMonthDays,
  isSignupSource,
  sourceGrantsFreeMonth,
  nudgeCopy,
  NUDGE_COPY,
} from "@/lib/referral";

describe("referral free-month rules", () => {
  it("only a real referral link grants a free month", () => {
    expect(sourceGrantsFreeMonth("referral")).toBe(true);
    // Every other CTA is a plain 'create a free account' prompt — no free month.
    for (const src of ["save_contact", "share_info", "vcard", "badge", "follow_up", "direct", null, undefined]) {
      expect(sourceGrantsFreeMonth(src)).toBe(false);
    }
  });

  it("freeMonthDays scales months by the configured day length", () => {
    expect(freeMonthDays(1)).toBe(REFERRAL.DAYS_PER_FREE_MONTH);
    expect(freeMonthDays(3)).toBe(REFERRAL.DAYS_PER_FREE_MONTH * 3);
  });

  it("caps lifetime rewards at 3 months / 9 signups", () => {
    expect(REFERRAL.MAX_REFERRAL_REWARDS).toBe(3);
    expect(REFERRAL.SIGNUPS_PER_REWARD * REFERRAL.MAX_REFERRAL_REWARDS).toBe(9);
  });
});

describe("isSignupSource", () => {
  it("accepts known sources and rejects junk", () => {
    expect(isSignupSource("referral")).toBe(true);
    expect(isSignupSource("direct")).toBe(true);
    expect(isSignupSource("not-a-source")).toBe(false);
    expect(isSignupSource(null)).toBe(false);
    expect(isSignupSource(undefined)).toBe(false);
  });

  it("accepts the Alignable and ActiveRain campaign links without eating /compare/ alt_ sources", () => {
    expect(isSignupSource("al_offer")).toBe(true);
    expect(isSignupSource("ar_open_house")).toBe(true);
    expect(isSignupSource("alt_blinq")).toBe(true);
  });
});

describe("nudgeCopy", () => {
  it("returns the matching copy for a known source", () => {
    expect(nudgeCopy("save_contact")).toEqual(NUDGE_COPY.save_contact);
  });

  it("falls back to default copy for unknown/empty sources", () => {
    expect(nudgeCopy("nonsense")).toEqual(NUDGE_COPY.default);
    expect(nudgeCopy(null)).toEqual(NUDGE_COPY.default);
    expect(nudgeCopy(undefined)).toEqual(NUDGE_COPY.default);
  });

  it("every copy variant has a title, sub, and cta", () => {
    for (const key of Object.keys(NUDGE_COPY)) {
      const c = NUDGE_COPY[key];
      expect(c.title).toBeTruthy();
      expect(c.sub).toBeTruthy();
      expect(c.cta).toBeTruthy();
    }
  });
});
