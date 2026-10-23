import { describe, expect, it } from "vitest";
import { blockedBy, describeHours, doorState, nextBoundary, parseHoursForm, teamDoor, togglePatch, withinHours } from "@/lib/crew/doors";
import { DEFAULT_SETTINGS, defaultTeam } from "@/lib/crew/store";
import type { OfficeHours, TeamRow } from "@/lib/crew/types";
import { fakeAgent } from "./crew-helpers";

// The office doors: opening hours in New York time, a one-tap override that
// lasts until the next scheduled change, and "Lock the whole office" beating
// every door. 2026-10-21 is a Wednesday; New York is UTC-4 until Nov 1.

const WEEKDAYS: OfficeHours = { days: [1, 2, 3, 4, 5], open: 540, close: 1080 }; // Mon–Fri 9–6
const at = (iso: string) => new Date(iso);
const WED_2PM = at("2026-10-21T18:00:00Z");
const WED_8PM = at("2026-10-22T00:00:00Z");
const SAT_NOON = at("2026-10-24T16:00:00Z");
const row = (over: Partial<TeamRow> = {}): TeamRow => ({ ...defaultTeam("replies"), ...over });
const opts = (kill = false) => ({ team: "replies" as const, settings: { ...DEFAULT_SETTINGS, kill_all: kill }, hardDisabled: false });

describe("opening hours", () => {
  it("is open inside the hours and locked outside them, weekends included", () => {
    expect(withinHours(WEEKDAYS, WED_2PM)).toBe(true);
    expect(withinHours(WEEKDAYS, WED_8PM)).toBe(false);
    expect(withinHours(WEEKDAYS, SAT_NOON)).toBe(false);
    expect(withinHours(WEEKDAYS, at("2026-10-21T13:00:00Z"))).toBe(true); // 9:00am sharp opens
    expect(withinHours(WEEKDAYS, at("2026-10-21T22:00:00Z"))).toBe(false); // 6:00pm sharp locks
  });

  it("says when the door next opens or locks", () => {
    expect(teamDoor(row({ hours: WEEKDAYS }), WED_2PM).label).toBe("Open until 6:00pm");
    expect(teamDoor(row({ hours: WEEKDAYS }), WED_8PM).label).toBe("Locked · opens tomorrow 9:00am");
    expect(teamDoor(row({ hours: WEEKDAYS }), SAT_NOON).label).toBe("Locked · opens Mon 9:00am");
  });

  it("finds the next opening across the end of daylight saving", () => {
    // Fri Oct 30, 8pm EDT → Mon Nov 2, 9am EST (14:00 UTC, not 13:00).
    expect(nextBoundary(WEEKDAYS, at("2026-10-31T00:00:00Z"))!.toISOString()).toBe("2026-11-02T14:00:00.000Z");
  });

  it("describes and parses the hours form", () => {
    expect(describeHours(WEEKDAYS)).toBe("Mon–Fri 9:00am–6:00pm");
    expect(describeHours({ days: [0, 1, 2, 3, 4, 5, 6], open: 480, close: 1440 })).toBe("Every day 8:00am–midnight");
    const form = (o: Record<string, string>) => (k: string) => o[k] ?? "";
    expect(parseHoursForm(form({ day_1: "on", day_3: "on", open: "540", close: "1020" }))).toEqual({ days: [1, 3], open: 540, close: 1020 });
    expect(parseHoursForm(form({ open: "540", close: "1020" }))).toBe("Pick at least one day.");
    expect(parseHoursForm(form({ day_1: "on", open: "1020", close: "540" }))).toBe("Closing time has to be after opening time.");
    expect(parseHoursForm(form({ day_1: "on", open: "545", close: "1020" }))).toBe("Pick an opening and a closing time.");
  });
});

describe("one tap on the door", () => {
  it("without hours, just flips the door", () => {
    expect(togglePatch(row(), WED_2PM)).toEqual({ door_open: false, override_open: null, override_until: null });
    expect(togglePatch(row({ door_open: false }), WED_2PM)).toMatchObject({ door_open: true });
  });

  it("with hours, overrides only until the next scheduled change", () => {
    const r = row({ hours: WEEKDAYS });
    const locked = { ...r, ...togglePatch(r, WED_2PM) };
    expect(locked.override_open).toBe(false);
    expect(locked.override_until).toBe("2026-10-21T22:00:00.000Z");
    expect(teamDoor(locked, WED_2PM)).toMatchObject({ open: false, label: "Locked until 6:00pm" });
    // After 6pm the hours take over again (and they say locked anyway).
    expect(teamDoor(locked, at("2026-10-21T22:30:00Z"))).toMatchObject({ open: false, reason: "hours" });
    // Tapping again while the override is on goes back to the schedule.
    expect(togglePatch(locked, WED_2PM)).toEqual({ override_open: null, override_until: null });
    // Opening early on a weekend lasts until Monday's 9am opening.
    const early = { ...r, ...togglePatch(r, SAT_NOON) };
    expect(teamDoor(early, SAT_NOON)).toMatchObject({ open: true, label: "Open until Mon 9:00am" });
  });
});

describe("the whole office", () => {
  it("locking the office beats every door; the desk has no door of its own", () => {
    expect(doorState(row(), opts(true), WED_2PM)).toMatchObject({ open: false, reason: "office", label: "The whole office is locked" });
    expect(doorState(row({ door_open: false }), { ...opts(), team: "system" }, WED_2PM)).toMatchObject({ open: true, reason: "desk" });
    expect(doorState(undefined, opts(), WED_2PM)).toMatchObject({ open: true, reason: "manual" });
  });

  it("a locked door holds workers, not managers; a pause holds anyone", () => {
    const locked = doorState(row({ door_open: false }), opts(), WED_2PM);
    const st = { id: "x", enabled: true, model_override: null, daily_usd_cap: null, config: {}, last_run_at: null, next_run_at: null, lease_until: null, status_note: null };
    expect(blockedBy(fakeAgent(), st, locked, WED_2PM)).toBe("door locked");
    expect(blockedBy(fakeAgent({ role: "manager" }), st, locked, WED_2PM)).toBeNull();
    expect(blockedBy(fakeAgent({ role: "manager" }), st, doorState(row(), opts(true), WED_2PM), WED_2PM)).toBe("the whole office is locked");
    const open = doorState(row(), opts(), WED_2PM);
    expect(blockedBy(fakeAgent(), { ...st, paused_until: "2026-10-22T03:59:00Z" }, open, WED_2PM)).toBe("paused until 11:59pm");
    expect(blockedBy(fakeAgent(), { ...st, paused_until: "2026-10-21T17:00:00Z" }, open, WED_2PM)).toBeNull();
  });
});
