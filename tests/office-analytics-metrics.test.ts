import { describe, it, expect } from "vitest";
import { pctChange, fillDateRange, defaultEmployeeSort } from "@/lib/office-analytics-metrics";

describe("pctChange — period-over-period delta", () => {
  it("computes a normal percentage change", () => {
    expect(pctChange(150, 100)).toBeCloseTo(0.5);
    expect(pctChange(50, 100)).toBeCloseTo(-0.5);
  });

  it("returns 0 when both periods are zero (no change, not 'new')", () => {
    expect(pctChange(0, 0)).toBe(0);
  });

  it("returns null (not +Infinity) when there's no prior-period baseline but current > 0", () => {
    expect(pctChange(10, 0)).toBeNull();
  });
});

describe("fillDateRange — zero-fills missing UTC days for the chart", () => {
  it("fills every day in range when the RPC only returned rows with data", () => {
    const rows = [{ date: "2026-01-02", views: 5 }];
    const filled = fillDateRange(rows, "2026-01-01T00:00:00.000Z", "2026-01-04T00:00:00.000Z");
    expect(filled).toEqual([
      { date: "2026-01-01", views: 0 },
      { date: "2026-01-02", views: 5 },
      { date: "2026-01-03", views: 0 },
    ]);
  });

  it("preserves existing counts exactly, doesn't just zero everything", () => {
    const rows = [
      { date: "2026-01-01", views: 3 },
      { date: "2026-01-02", views: 7 },
    ];
    const filled = fillDateRange(rows, "2026-01-01T00:00:00.000Z", "2026-01-03T00:00:00.000Z");
    expect(filled).toEqual([
      { date: "2026-01-01", views: 3 },
      { date: "2026-01-02", views: 7 },
    ]);
  });

  it("handles a single-day range", () => {
    const filled = fillDateRange([], "2026-03-05T00:00:00.000Z", "2026-03-06T00:00:00.000Z");
    expect(filled).toEqual([{ date: "2026-03-05", views: 0 }]);
  });

  it("stays UTC-pure — a row dated across a DST-adjacent boundary still lands on the right UTC day", () => {
    const rows = [{ date: "2026-03-08", views: 2 }];
    const filled = fillDateRange(rows, "2026-03-07T00:00:00.000Z", "2026-03-09T00:00:00.000Z");
    expect(filled.map((f) => f.date)).toEqual(["2026-03-07", "2026-03-08"]);
    expect(filled[1].views).toBe(2);
  });
});

describe("defaultEmployeeSort — A→Z like a directory, never a ranking", () => {
  // The console shows an admin everything on their team's cards; it is not a
  // race between teammates (owner, 2026-10-06).
  it("orders by name ascending", () => {
    const rows = [{ name: "Zed" }, { name: "Anna" }, { name: "Mia" }];
    expect(defaultEmployeeSort(rows).map((r) => r.name)).toEqual(["Anna", "Mia", "Zed"]);
  });

  it("ignores views, contact downloads and leads entirely", () => {
    const rows = [
      { name: "Busy", views: 900, contactsSaved: 80, leads: 50 },
      { name: "Alex", views: 0, contactsSaved: 0, leads: 0 },
    ];
    expect(defaultEmployeeSort(rows).map((r) => r.name)).toEqual(["Alex", "Busy"]);
  });

  it("does not mutate the input array", () => {
    const rows = [{ name: "B" }, { name: "A" }];
    const copy = [...rows];
    defaultEmployeeSort(rows);
    expect(rows).toEqual(copy);
  });
});
