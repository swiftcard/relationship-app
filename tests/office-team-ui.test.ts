import { describe, it, expect } from "vitest";
import { relativeTime, shortDate } from "@/lib/relative-time";
import { leadStatusView } from "@/lib/office-leads";
import { computeSetupProgress } from "@/lib/office-team";

const now = 1_700_000_000_000;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("relativeTime — plain-English distances, never raw timestamps", () => {
  it("covers the ladder", () => {
    expect(relativeTime(new Date(now - 10 * 1000).toISOString(), now)).toBe("Just now");
    expect(relativeTime(new Date(now - 5 * MIN).toISOString(), now)).toBe("5 minutes ago");
    expect(relativeTime(new Date(now - 1 * MIN).toISOString(), now)).toBe("1 minute ago");
    expect(relativeTime(new Date(now - 3 * HOUR).toISOString(), now)).toBe("3 hours ago");
    expect(relativeTime(new Date(now - 30 * HOUR).toISOString(), now)).toBe("Yesterday");
    expect(relativeTime(new Date(now - 5 * DAY).toISOString(), now)).toBe("5 days ago");
    expect(relativeTime(new Date(now - 45 * DAY).toISOString(), now)).toBe("1 month ago");
    expect(relativeTime(new Date(now - 400 * DAY).toISOString(), now)).toBe("1 year ago");
  });

  it("future timestamps (clock skew) read as Just now, never negative", () => {
    expect(relativeTime(new Date(now + HOUR).toISOString(), now)).toBe("Just now");
  });

  it("garbage in → em dash out", () => {
    expect(relativeTime(null, now)).toBe("—");
    expect(relativeTime("not-a-date", now)).toBe("—");
    expect(shortDate(null)).toBe("—");
  });
});

describe("leadStatusView — real app statuses map to owner words", () => {
  it("maps the actual vocabulary (new_contact/touch/dissolved)", () => {
    expect(leadStatusView("new_contact")).toEqual({ label: "New", worked: false });
    expect(leadStatusView("touch")).toEqual({ label: "Contacted", worked: true });
    expect(leadStatusView("dissolved")).toEqual({ label: "Closed", worked: true });
  });

  it("null/unknown/legacy junk reads as New — never a raw enum", () => {
    expect(leadStatusView(null).label).toBe("New");
    expect(leadStatusView(undefined).label).toBe("New");
    // the old office page colour-coded these; they can't occur, but if a row
    // somehow carries one it must still render a clean label
    expect(leadStatusView("hot").label).toBe("New");
    expect(leadStatusView("warm").label).toBe("New");
  });
});

describe("computeSetupProgress — checklist derives from durable facts", () => {
  it("fresh office: nothing done", () => {
    const p = computeSetupProgress({ hasBrand: false, memberRowCount: 0, liveEmployeeCards: 0 });
    expect(p).toMatchObject({
      brandingDone: false, invitedDone: false, cardLiveDone: false, allDone: false,
    });
  });

  it("each fact checks its own step", () => {
    expect(computeSetupProgress({ hasBrand: true, memberRowCount: 0, liveEmployeeCards: 0 }).brandingDone).toBe(true);
    expect(computeSetupProgress({ hasBrand: false, memberRowCount: 2, liveEmployeeCards: 0 }).invitedDone).toBe(true);
    expect(computeSetupProgress({ hasBrand: false, memberRowCount: 0, liveEmployeeCards: 1 }).cardLiveDone).toBe(true);
  });

  it("all three facts → allDone (checklist gone for good)", () => {
    const p = computeSetupProgress({ hasBrand: true, memberRowCount: 1, liveEmployeeCards: 1 });
    expect(p.allDone).toBe(true);
  });
});
