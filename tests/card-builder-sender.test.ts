import { describe, it, expect } from "vitest";
import { DEFAULT_SENDER, localClock, nextGapMs, readSenderSettings, sendDecision } from "@/lib/prospect-preview/send-window";
import { STOP_RE } from "../scripts/card-builder-mac/imessage.mjs";

// ── Card Builder: when the Mac may send an opener (owner, 2026-11-16) ───────
// "A randomized gap of a few minutes between sends, during daytime hours only,
// and a daily cap I set." The Mac agent imports this very file.

// Mon 2026-11-16, New York is UTC-5.
const at = (ny: string) => new Date(`${ny}-05:00`);
const s = { ...DEFAULT_SENDER, start: "10:00", end: "17:30", days: [1, 2, 3, 4, 5], daily_cap: 20 };

describe("the sending window", () => {
  it("sends on a weekday inside the hours", () => {
    expect(sendDecision(s, { now: at("2026-11-16T10:00:00"), sentToday: 0, notBefore: null })).toEqual({ ok: true });
    expect(sendDecision(s, { now: at("2026-11-16T17:29:00"), sentToday: 0, notBefore: null })).toEqual({ ok: true });
  });
  it("never before the start or at the end, in New York time whatever the Mac's clock says", () => {
    expect(sendDecision(s, { now: at("2026-11-16T09:59:00"), sentToday: 0, notBefore: null })).toEqual({ ok: false, reason: "outside_hours" });
    expect(sendDecision(s, { now: at("2026-11-16T17:30:00"), sentToday: 0, notBefore: null })).toEqual({ ok: false, reason: "outside_hours" });
    expect(sendDecision(s, { now: at("2026-11-16T23:00:00"), sentToday: 0, notBefore: null })).toEqual({ ok: false, reason: "outside_hours" });
  });
  it("never on a day off", () => {
    expect(sendDecision(s, { now: at("2026-11-15T12:00:00"), sentToday: 0, notBefore: null })).toEqual({ ok: false, reason: "day_off" });
  });
  it("stops at the daily cap", () => {
    expect(sendDecision(s, { now: at("2026-11-16T12:00:00"), sentToday: 20, notBefore: null })).toEqual({ ok: false, reason: "cap_reached" });
    expect(sendDecision({ ...s, daily_cap: 0 }, { now: at("2026-11-16T12:00:00"), sentToday: 0, notBefore: null })).toEqual({ ok: false, reason: "cap_reached" });
  });
  it("waits out the gap after the last send", () => {
    expect(sendDecision(s, { now: at("2026-11-16T12:00:00"), sentToday: 3, notBefore: at("2026-11-16T12:04:00") })).toEqual({ ok: false, reason: "gap" });
    expect(sendDecision(s, { now: at("2026-11-16T12:05:00"), sentToday: 3, notBefore: at("2026-11-16T12:04:00") })).toEqual({ ok: true });
  });
  it("paused means nothing goes", () => {
    expect(sendDecision({ ...s, paused: true }, { now: at("2026-11-16T12:00:00"), sentToday: 0, notBefore: null })).toEqual({ ok: false, reason: "paused" });
  });
  it("counts the day in New York: 11pm there is still the same day", () => {
    expect(localClock(new Date("2026-11-17T04:00:00Z"), "America/New_York")).toMatchObject({ date: "2026-11-16", day: 1, minute: 23 * 60 });
  });
});

describe("the gap is random, within the owner's bounds", () => {
  it("is never shorter than the least or longer than the most", () => {
    expect(nextGapMs({ gap_min: 3, gap_max: 9 }, () => 0)).toBe(3 * 60_000);
    expect(nextGapMs({ gap_min: 3, gap_max: 9 }, () => 1)).toBe(9 * 60_000);
    const seen = new Set(Array.from({ length: 50 }, () => nextGapMs({ gap_min: 3, gap_max: 9 })));
    expect(seen.size).toBeGreaterThan(10);
  });
});

describe("the owner's settings", () => {
  it("anything missing or nonsensical takes the default", () => {
    expect(readSenderSettings(null)).toEqual(DEFAULT_SENDER);
    const r = readSenderSettings({ daily_cap: "500", start: "18:00", end: "09:00", days: ["1", "9", "3"], gap_min: "10", gap_max: "2", paused: "1" });
    expect(r.daily_cap).toBe(100);
    expect(r.end).toBe(DEFAULT_SENDER.end);
    expect(r.days).toEqual([1, 3]);
    expect(r.gap_max).toBeGreaterThanOrEqual(r.gap_min);
    expect(r.paused).toBe(true);
  });
});

describe("a reply that means stop", () => {
  it.each(["Stop", "STOP", "Stop.", "Please stop texting me", "unsubscribe", "Remove me please", "Don't text me", "wrong number", "not interested, thanks"])("%s", (t) => expect(STOP_RE.test(t)).toBe(true));
  it.each(["Who is this?", "Thanks, looks great", "Can you call me tomorrow", "I'll stop by the office", "End of day works for me", "Cancel my 3pm, call at 4 instead"])("not: %s", (t) => expect(STOP_RE.test(t)).toBe(false));
});
