import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { noticeGivenToday, TEAM_NOTICE_GAP_MS } from "@/lib/weekly-recap";

// ── The Office console: a directory, not a leaderboard; one notice a day ────
//
// Owner, 2026-10-06: the console is there so an owner can see everything on
// their team's cards — "it is not a contest between teammates". 40be118a and
// 52357867 took the ranking out of Analytics, but the Team tab (the console's
// landing page) still opened highest-leads-first, and the CSV kept its own
// order. And once the team check became a 9am–midnight window (7f8669c3), the
// per-lead ledger let a lead crossing the 24h line at 3pm send a second
// "leads waiting" notice that repeated the morning's names.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r/g, "");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("A to Z everywhere the team is listed", () => {
  it("the Team tab's order comes from getOfficeAnalytics, sorted by name", () => {
    const all = code("src/lib/office-analytics.ts");
    // Only getOfficeAnalytics: a person's OWN cards are still ordered by views
    // further down (their most-viewed card) — that ranks cards, not people.
    const start = all.indexOf("export async function getOfficeAnalytics(");
    const a = all.slice(start, all.indexOf("\nexport ", start + 1));
    expect(start).toBeGreaterThan(-1);
    expect(a).toMatch(/const sorted = defaultEmployeeSort\(employees\);/);
    expect(a).toMatch(/return \{ totals, employees: sorted \};/);
    expect(a).not.toMatch(/\.sort\(\(a, b\) =>/);
    // office-team keeps that order — no re-ranking on top of it.
    const t = code("src/lib/office-team.ts");
    expect(t).not.toMatch(/people\.sort\(/);
    expect(t).not.toMatch(/b\.leads - a\.leads/);
  });

  it("the analytics CSV and the marketing replica's Team tab use the same rule", () => {
    expect(code("src/app/api/office/analytics/export/route.ts")).toMatch(/defaultEmployeeSort\(employees\)\.map\(/);
    expect(code("src/components/site/TeamsDashboard.tsx")).toMatch(/\{defaultEmployeeSort\(PEOPLE\)\.map\(\(p\) =>/);
  });
});

describe("leads waiting / no card yet: at most one notice a day", () => {
  const now = Date.parse("2026-10-06T19:00:00Z"); // 3pm New York

  it("a notice from this morning holds the afternoon's back", () => {
    const morning = { created_at: "2026-10-06T13:05:00Z" }; // 9:05am New York
    expect(noticeGivenToday([morning], now)).toBe(true);
  });

  it("yesterday's notice does not hold today's", () => {
    // Yesterday 9:30am, today's first run at 9:05am: 23h35m apart.
    const yesterday = { created_at: "2026-10-05T13:30:00Z" };
    expect(noticeGivenToday([yesterday], Date.parse("2026-10-06T13:05:00Z"))).toBe(false);
  });

  it("the gap outlasts the whole 9am–midnight window but not a day", () => {
    expect(TEAM_NOTICE_GAP_MS).toBeGreaterThan(15 * 3600 * 1000);
    expect(TEAM_NOTICE_GAP_MS).toBeLessThan(24 * 3600 * 1000);
  });

  it("no rows, or rows without a time, never block", () => {
    expect(noticeGivenToday(null, now)).toBe(false);
    expect(noticeGivenToday([], now)).toBe(false);
    expect(noticeGivenToday([{ created_at: null }], now)).toBe(false);
  });

  it("the team check applies it to both kinds, reading created_at with the ledger", () => {
    const r = code("src/app/api/push/recap/route.ts");
    expect(r).toMatch(/select\("meta, created_at"\)\s*\.eq\("office_id", team\.officeId\)\.eq\("type", "leads_waiting"\)/);
    expect(r).toMatch(/if \(!noticeGivenToday\(prior, now\) && stuck\.some\(/);
    expect(r).toMatch(/select\("meta, created_at"\)\s*\.eq\("office_id", team\.officeId\)\.eq\("type", "members_no_card"\)/);
    expect(r).toMatch(/if \(!noticeGivenToday\(priorNoCard, now\) && noCard\.some\(/);
  });
});

describe("the morning catch-up's once-a-day mark", () => {
  it("spans the 8am–8pm window plus a clocks-back hour, not 14h", () => {
    const c = code("src/app/api/push/catchup/route.ts");
    expect(c).toMatch(/new Date\(now - 13 \* 3600 \* 1000\)\.toISOString\(\)/);
    expect(c).not.toMatch(/now - 14 \* 3600 \* 1000/);
  });
});
