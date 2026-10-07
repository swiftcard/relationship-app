import { describe, it, expect } from "vitest";
import { buildEmployeeAnalyticsCsv, type EmployeeCsvRow } from "@/lib/office-analytics-csv";

const baseRow: EmployeeCsvRow = {
  name: "Jane Doe",
  cardName: "Jane's card",
  views: 42,
  uniqueVisitors: 30,
  scans: 5,
  leads: 3,
  contactsSaved: 2,
  swiftlinkViews: 7,
  lastActivityAt: "2026-03-01T12:00:00.000Z",
};

describe("buildEmployeeAnalyticsCsv", () => {
  it("emits a header row followed by one line per employee", () => {
    const csv = buildEmployeeAnalyticsCsv([baseRow]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      "Employee,Card,Card views,Swift Link views,Contacts captured,Contact downloads,Unique visitors,QR & NFC scans,Most recent activity"
    );
    expect(lines).toHaveLength(2);
  });

  it("quote-escapes names/card names containing commas or quotes", () => {
    const row: EmployeeCsvRow = { ...baseRow, name: 'Jane "JD" Doe, Jr.', cardName: "Acme, Inc." };
    const csv = buildEmployeeAnalyticsCsv([row]);
    const dataLine = csv.split("\n")[1];
    expect(dataLine).toContain('"Jane ""JD"" Doe, Jr."');
    expect(dataLine).toContain('"Acme, Inc."');
  });

  it("has no conversion-rate column — a saved contact is not a lead that failed to convert", () => {
    const csv = buildEmployeeAnalyticsCsv([baseRow]);
    expect(csv.toLowerCase()).not.toContain("conversion");
    expect(csv.split("\n")[1]).not.toContain("%");
  });

  it("handles an empty employee list — header only, no crash", () => {
    const csv = buildEmployeeAnalyticsCsv([]);
    expect(csv.split("\n")).toHaveLength(1);
  });

  it("renders a missing lastActivityAt as blank", () => {
    const row: EmployeeCsvRow = { ...baseRow, lastActivityAt: null };
    const csv = buildEmployeeAnalyticsCsv([row]);
    const cols = csv.split("\n")[1].split(",");
    expect(cols[8]).toBe('""');
  });

  it("neutralizes a leading formula character so Excel/Sheets can't execute it (CSV/formula injection)", () => {
    for (const malicious of ["=1+1", "+1+1", "-2+3", "@SUM(1,1)", "\t=1+1"]) {
      const row: EmployeeCsvRow = { ...baseRow, name: malicious };
      const csv = buildEmployeeAnalyticsCsv([row]);
      const dataLine = csv.split("\n")[1];
      // A leading single quote neutralizes the formula trigger while keeping
      // the value legible — the cell must start with a quoted apostrophe,
      // never the raw =/+/-/@/tab character Excel/Sheets would treat as a formula.
      expect(dataLine.startsWith(`"'${malicious}`)).toBe(true);
    }
  });

  it("still escapes embedded quotes on a value that also needs formula-neutralizing", () => {
    const row: EmployeeCsvRow = { ...baseRow, name: '=cmd|"/c calc"!A1' };
    const csv = buildEmployeeAnalyticsCsv([row]);
    const dataLine = csv.split("\n")[1];
    expect(dataLine).toContain(`"'=cmd|""/c calc""!A1"`);
  });
});
