import { describe, it, expect } from "vitest";
import { safeTimeZone, localDayKey, startOfLocalDayUtc } from "@/lib/tz-days";
import { getSourceLabel } from "@/lib/source-labels";
import { isLikelyBot } from "@/lib/bot-detection";

// ── Analytics accuracy suite ─────────────────────────────────────────────────
// Covers the parts of the analytics pipeline that must be provably correct:
// timezone-aware day bucketing (the source of near-midnight miscounts), source
// attribution honesty, and bot exclusion. The tz cases below are the ones that
// silently corrupted the dashboard before the audit — a view at 11pm Pacific
// landing on the wrong calendar day, and windows crossing a DST change.

describe("safeTimeZone — trust only Intl-valid zones", () => {
  it("passes through a valid IANA zone", () => {
    expect(safeTimeZone("America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(safeTimeZone("Asia/Tokyo")).toBe("Asia/Tokyo");
    expect(safeTimeZone("UTC")).toBe("UTC");
  });
  it("falls back to UTC for empty / spoofed / nonsense values", () => {
    expect(safeTimeZone(null)).toBe("UTC");
    expect(safeTimeZone(undefined)).toBe("UTC");
    expect(safeTimeZone("")).toBe("UTC");
    expect(safeTimeZone("Not/AZone")).toBe("UTC");
    expect(safeTimeZone("'; DROP TABLE card_views;--")).toBe("UTC");
  });
});

describe("localDayKey — bucket a UTC instant by the owner's local calendar", () => {
  it("keeps an 11pm-Pacific view on its LOCAL day, not the next UTC day", () => {
    // 2026-07-21T06:00Z === 2026-07-20 23:00 PDT.
    const instant = "2026-07-21T06:00:00Z";
    expect(localDayKey(instant, "America/Los_Angeles")).toBe("2026-07-20");
    // Proves the bug it fixes: the same instant is "Jul 21" in UTC.
    expect(localDayKey(instant, "UTC")).toBe("2026-07-21");
  });
  it("rolls a late-UTC view forward for an east-of-UTC zone", () => {
    // 2026-07-20T22:00Z === 2026-07-21 07:00 in Tokyo (+9).
    expect(localDayKey("2026-07-20T22:00:00Z", "Asia/Tokyo")).toBe("2026-07-21");
    expect(localDayKey("2026-07-21T00:30:00Z", "Asia/Tokyo")).toBe("2026-07-21");
  });
  it("accepts both Date and ISO-string inputs", () => {
    expect(localDayKey(new Date("2026-07-21T06:00:00Z"), "America/Los_Angeles")).toBe("2026-07-20");
  });
  it("emits YYYY-MM-DD, zero-padded", () => {
    expect(localDayKey("2026-01-05T12:00:00Z", "UTC")).toBe("2026-01-05");
    expect(/^\d{4}-\d{2}-\d{2}$/.test(localDayKey("2026-07-21T06:00:00Z", "Asia/Tokyo"))).toBe(true);
  });
});

describe("startOfLocalDayUtc — window edges anchored to local midnight", () => {
  const now = new Date("2026-07-21T10:00:00Z"); // 03:00 PDT on Jul 21

  it("start of TODAY (Pacific) is that day's local midnight in UTC", () => {
    const start = startOfLocalDayUtc(0, "America/Los_Angeles", now);
    expect(start.toISOString()).toBe("2026-07-21T07:00:00.000Z"); // PDT midnight = 07:00Z
    expect(localDayKey(start, "America/Los_Angeles")).toBe("2026-07-21");
  });
  it("7 local days ago lands on the right local date", () => {
    const start = startOfLocalDayUtc(7, "America/Los_Angeles", now);
    expect(localDayKey(start, "America/Los_Angeles")).toBe("2026-07-14");
  });
  it("30-day window start (29 days back) is 30 local days inclusive of today", () => {
    const start = startOfLocalDayUtc(29, "America/Los_Angeles", now);
    expect(localDayKey(start, "America/Los_Angeles")).toBe("2026-06-22");
  });
  it("stays on true local midnight across a spring-forward DST boundary", () => {
    // US DST began 2026-03-08. A window reaching back before it must still hit
    // local midnight (PST -8 that morning, not PDT -7).
    const dstNow = new Date("2026-03-10T12:00:00Z");
    const start = startOfLocalDayUtc(3, "America/Los_Angeles", dstNow); // Mar 7, pre-DST
    expect(localDayKey(start, "America/Los_Angeles")).toBe("2026-03-07");
    expect(start.toISOString()).toBe("2026-03-07T08:00:00.000Z"); // PST midnight = 08:00Z
  });
  it("UTC fallback behaves like plain UTC midnight", () => {
    const start = startOfLocalDayUtc(0, "UTC", new Date("2026-07-21T10:00:00Z"));
    expect(start.toISOString()).toBe("2026-07-21T00:00:00.000Z");
  });
  it("today's window never starts in the future", () => {
    const start = startOfLocalDayUtc(0, "America/Los_Angeles", now);
    expect(start.getTime()).toBeLessThanOrEqual(now.getTime());
  });
});

describe("getSourceLabel — attribute honestly, never invent a channel", () => {
  it("labels known first-party sources", () => {
    expect(getSourceLabel("qr_code")).toBe("QR code scan");
    expect(getSourceLabel("nfc_card")).toBe("NFC tap");
    expect(getSourceLabel("apple_wallet")).toBe("Apple Wallet");
    expect(getSourceLabel("google_wallet")).toBe("Google Wallet");
    expect(getSourceLabel("swift_links")).toBe("Swift Links");
    expect(getSourceLabel("direct_link")).toBe("Card link");
  });
  it("says 'Not tracked' for missing/unknown source — no fabricated origin", () => {
    expect(getSourceLabel(null)).toBe("Not tracked");
    expect(getSourceLabel(undefined)).toBe("Not tracked");
    expect(getSourceLabel("")).toBe("Not tracked");
  });
  it("de-slugs an unrecognized source instead of dropping it", () => {
    expect(getSourceLabel("some_new_partner")).toBe("some new partner");
  });
});

describe("isLikelyBot — exclude crawlers/monitors, keep real people", () => {
  it("flags common bots, crawlers, and synthetic monitors", () => {
    for (const ua of [
      "Googlebot/2.1 (+http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0)",
      "facebookexternalhit/1.1",
      "Slackbot-LinkExpanding 1.0",
      "Mozilla/5.0 (compatible; UptimeRobot/2.0)",
      "Playwright/1.0",
      "HeadlessChrome/120.0",
    ]) {
      expect(isLikelyBot(ua)).toBe(true);
    }
  });
  it("does NOT flag real mobile/desktop browsers", () => {
    for (const ua of [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Gecko/20100101 Firefox/121.0",
    ]) {
      expect(isLikelyBot(ua)).toBe(false);
    }
  });
  it("does not treat a missing UA as a bot (real clients omit it too)", () => {
    expect(isLikelyBot(null)).toBe(false);
    expect(isLikelyBot(undefined)).toBe(false);
    expect(isLikelyBot("")).toBe(false);
  });
});
