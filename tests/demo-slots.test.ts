import { describe, it, expect } from "vitest";
import { openDemoSlots, isOpenDemoSlot } from "@/lib/demo/slots";
import { planReminders, withinTextHours } from "@/lib/demo/reminders";
import { zonedWallTimeToUtc, zonedParts } from "@/lib/tz-days";
import { fmtRange, fmtWhen, fmtWithNewYork, dayKey } from "@/lib/demo/format";
import { teamSizeFor } from "@/lib/demo/config";

// Owner, 2026-11-03: demos Monday to Friday, 10 AM to 5 PM New York time, 30
// minutes each; reminders halfway, the night before and the day of, in the
// prospect's own time zone. These pin both.

const NY = "America/New_York";
const ny = (y: number, m: number, d: number, h: number, min = 0) => zonedWallTimeToUtc(y, m, d, h, min, NY);
const HOUR = 3_600_000;

describe("open demo times", () => {
  // Monday 2026-11-09, 8:00 AM New York.
  const now = ny(2026, 11, 9, 8);

  it("are on the half hour, 10:00 to 4:30 New York time, weekdays only", () => {
    const slots = openDemoSlots(now);
    for (const s of slots) {
      const p = zonedParts(s, NY);
      expect([1, 2, 3, 4, 5]).toContain(p.dow);
      expect(p.min % 30).toBe(0);
      expect(p.h * 60 + p.min).toBeGreaterThanOrEqual(10 * 60);
      expect(p.h * 60 + p.min).toBeLessThanOrEqual(16 * 60 + 30);
    }
    // A full weekday has 14 starts: 10:00 … 16:30.
    const tuesday = slots.filter((s) => dayKey(s, NY) === "2026-11-10");
    expect(tuesday.map((s) => zonedParts(s, NY).h * 100 + zonedParts(s, NY).min)).toEqual([
      1000, 1030, 1100, 1130, 1200, 1230, 1300, 1330, 1400, 1430, 1500, 1530, 1600, 1630,
    ]);
    expect(slots.some((s) => dayKey(s, NY) === "2026-11-14")).toBe(false); // Saturday
    expect(slots.some((s) => dayKey(s, NY) === "2026-11-15")).toBe(false); // Sunday
  });

  it("start at least 4 hours from now", () => {
    const slots = openDemoSlots(now);
    expect(slots[0].getTime()).toBe(ny(2026, 11, 9, 12).getTime());
    for (const s of slots) expect(s.getTime() - now.getTime()).toBeGreaterThanOrEqual(4 * HOUR);
  });

  it("stop 30 days out", () => {
    const slots = openDemoSlots(now);
    const last = slots[slots.length - 1];
    expect(last.getTime() - now.getTime()).toBeLessThanOrEqual(30 * 24 * HOUR);
  });

  it("leave out anything busy: a booked demo or a busy block on the owner's calendar", () => {
    const booked = ny(2026, 11, 11, 15);
    const meeting = { start: ny(2026, 11, 12, 10, 15).getTime(), end: ny(2026, 11, 12, 11, 5).getTime() };
    const slots = openDemoSlots(now, [{ start: booked.getTime(), end: booked.getTime() + 30 * 60_000 }, meeting]);
    const keys = slots.map((s) => s.getTime());
    expect(keys).not.toContain(booked.getTime());
    expect(keys).toContain(ny(2026, 11, 11, 14, 30).getTime());
    expect(keys).toContain(ny(2026, 11, 11, 15, 30).getTime());
    // 10:15–11:05 blocks 10:00, 10:30 and 11:00, not 11:30.
    expect(keys).not.toContain(ny(2026, 11, 12, 10).getTime());
    expect(keys).not.toContain(ny(2026, 11, 12, 10, 30).getTime());
    expect(keys).not.toContain(ny(2026, 11, 12, 11).getTime());
    expect(keys).toContain(ny(2026, 11, 12, 11, 30).getTime());
  });

  it("isOpenDemoSlot refuses a time off the grid, in the past, or outside the hours", () => {
    expect(isOpenDemoSlot(ny(2026, 11, 10, 15), now)).toBe(true);
    expect(isOpenDemoSlot(ny(2026, 11, 10, 15, 15), now)).toBe(false);
    expect(isOpenDemoSlot(ny(2026, 11, 10, 9, 30), now)).toBe(false);
    expect(isOpenDemoSlot(ny(2026, 11, 10, 17), now)).toBe(false);
    expect(isOpenDemoSlot(ny(2026, 11, 9, 10), now)).toBe(false);
    expect(isOpenDemoSlot(new Date("nonsense"), now)).toBe(false);
  });

  it("stay on New York wall-clock time across the March 2027 clock change", () => {
    const before = ny(2027, 3, 12, 9); // Friday, EST
    const slots = openDemoSlots(before);
    const fri = slots.find((s) => dayKey(s, NY) === "2027-03-12");
    const mon = slots.find((s) => dayKey(s, NY) === "2027-03-15");
    expect(fri?.toISOString()).toBe("2027-03-12T18:00:00.000Z"); // 1:00 PM EST = 18:00Z (first after 4h notice)
    expect(mon?.toISOString()).toBe("2027-03-15T14:00:00.000Z"); // 10:00 AM EDT = 14:00Z
  });
});

describe("reminder times", () => {
  const at = (iso: string) => new Date(iso);
  const kinds = (r: ReturnType<typeof planReminders>) => r.map((x) => x.kind);

  it("a week out: halfway, the night before at 7 PM, the morning of at 8 AM", () => {
    const booked = ny(2026, 11, 9, 11);
    const start = ny(2026, 11, 16, 15);
    const r = planReminders(booked, start, NY);
    expect(kinds(r)).toEqual(["halfway", "night_before", "day_of"]);
    // Halfway is Fri 1:00 AM, overnight, so it moves to Fri 9:00 AM.
    expect(r[0].sendAt.getTime()).toBe(ny(2026, 11, 13, 9).getTime());
    expect(r[1].sendAt.getTime()).toBe(ny(2026, 11, 15, 19).getTime());
    expect(r[2].sendAt.getTime()).toBe(ny(2026, 11, 16, 8).getTime());
  });

  it("halfway in the daytime stays where it falls", () => {
    const booked = ny(2026, 11, 9, 10);
    const start = ny(2026, 11, 13, 14);
    const r = planReminders(booked, start, NY);
    const halfway = r.find((x) => x.kind === "halfway")!;
    expect(halfway.sendAt.getTime()).toBe(ny(2026, 11, 11, 12).getTime());
  });

  it("booked Tuesday 9 PM for Wednesday 3 PM: only the morning-of reminder", () => {
    const booked = ny(2026, 11, 10, 21);
    const start = ny(2026, 11, 11, 15);
    const r = planReminders(booked, start, NY);
    expect(kinds(r)).toEqual(["day_of"]);
    expect(r[0].sendAt.getTime()).toBe(ny(2026, 11, 11, 8).getTime());
  });

  it("booked the same morning: one reminder, an hour before (the halfway one would be noise)", () => {
    const booked = ny(2026, 11, 10, 9);
    const start = ny(2026, 11, 10, 14);
    const r = planReminders(booked, start, NY);
    expect(kinds(r)).toEqual(["day_of"]);
    expect(r[0].sendAt.getTime()).toBe(ny(2026, 11, 10, 13).getTime());
  });

  it("booked with the minimum notice: nothing more than the confirmation", () => {
    const booked = ny(2026, 11, 10, 11, 30);
    const start = ny(2026, 11, 10, 15, 30);
    // An hour before is 2:30, 3 hours after booking: that one still goes.
    expect(kinds(planReminders(booked, start, NY))).toEqual(["day_of"]);
    // An hour before is 3:30, under 2 hours after a 1:45 booking: nothing.
    const tight = planReminders(ny(2026, 11, 10, 13, 45), ny(2026, 11, 10, 16, 30), NY);
    expect(tight).toEqual([]);
  });

  it("uses the prospect's own clock: Los Angeles gets 7 PM and 8 AM Pacific", () => {
    const LA = "America/Los_Angeles";
    const booked = ny(2026, 11, 9, 11);
    const start = ny(2026, 11, 16, 15); // 12:00 PM Pacific
    const r = planReminders(booked, start, LA);
    const night = r.find((x) => x.kind === "night_before")!;
    const morning = r.find((x) => x.kind === "day_of")!;
    expect(zonedParts(night.sendAt, LA)).toMatchObject({ d: 15, h: 19, min: 0 });
    expect(zonedParts(morning.sendAt, LA)).toMatchObject({ d: 16, h: 8, min: 0 });
  });

  it("an early start in their zone moves the morning-of to an hour before", () => {
    const LA = "America/Los_Angeles";
    const booked = ny(2026, 11, 9, 11);
    const start = ny(2026, 11, 16, 10); // 7:00 AM Pacific
    const morning = planReminders(booked, start, LA).find((x) => x.kind === "day_of")!;
    expect(morning.sendAt.getTime()).toBe(start.getTime() - HOUR);
  });

  it("never sends after the start, and never two within 3 hours", () => {
    for (const [b, s] of [[ny(2026, 11, 9, 11), ny(2026, 11, 10, 10)], [ny(2026, 11, 9, 16), ny(2026, 11, 11, 16, 30)], [ny(2026, 11, 2, 10), ny(2026, 12, 1, 10)]]) {
      const r = planReminders(b, s, NY);
      for (const x of r) {
        expect(x.sendAt.getTime()).toBeLessThan(s.getTime());
        expect(x.sendAt.getTime()).toBeGreaterThan(b.getTime());
      }
      for (let i = 1; i < r.length; i++) expect(r[i].sendAt.getTime() - r[i - 1].sendAt.getTime()).toBeGreaterThanOrEqual(3 * HOUR);
    }
  });

  it("a bad time zone falls back safely instead of throwing", () => {
    expect(() => planReminders(at("2026-11-09T15:00:00Z"), at("2026-11-12T20:00:00Z"), "Not/AZone")).not.toThrow();
  });

  it("texts only go out 8 AM to 9 PM their time", () => {
    expect(withinTextHours(ny(2026, 11, 10, 8), NY)).toBe(true);
    expect(withinTextHours(ny(2026, 11, 10, 7, 59), NY)).toBe(false);
    expect(withinTextHours(ny(2026, 11, 10, 21), NY)).toBe(false);
    expect(withinTextHours(ny(2026, 11, 10, 10), "America/Los_Angeles")).toBe(false); // 7 AM Pacific
  });
});

describe("how a demo time reads", () => {
  const start = ny(2026, 11, 11, 15);
  const end = new Date(start.getTime() + 30 * 60_000);
  it("in New York", () => {
    expect(fmtWhen(start, NY)).toBe("Wednesday, November 11 at 3:00 PM EST");
    expect(fmtRange(start, end, NY)).toBe("3:00–3:30 PM EST");
    expect(fmtWithNewYork(start, NY)).toBe("3:00 PM EST");
  });
  it("elsewhere, with New York time alongside", () => {
    expect(fmtWithNewYork(start, "America/Los_Angeles")).toBe("12:00 PM PST (3:00 PM New York time)");
    expect(fmtRange(ny(2026, 11, 11, 11, 30), ny(2026, 11, 11, 12), NY)).toBe("11:30 AM–12:00 PM EST");
  });
  it("team size chips from the seat picker", () => {
    expect(teamSizeFor(2)).toBe("2–5");
    expect(teamSizeFor(10)).toBe("6–15");
    expect(teamSizeFor(25)).toBe("16–50");
    expect(teamSizeFor(51)).toBe("51+");
  });
});
