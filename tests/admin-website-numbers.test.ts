import { describe, it, expect } from "vitest";
import { summarizeWebsite, type PageviewRow } from "@/lib/admin-data/website";

// ── The Website page's counting, pinned (owner, 2026-10-28) ─────────────────
// "website analytics is fake — make it accurate", and "make sure 'include my
// team's visits' really works". Each block is one of the ways it was wrong.

// Noon, 28 Oct 2026 in New York (EDT, UTC-4).
const NOW = new Date("2026-10-28T16:00:00Z");

function row(over: Partial<PageviewRow> & { at: string }): PageviewRow {
  const { at, ...rest } = over;
  return {
    visitor_id: "v1", session_id: "s1", path: "/", referrer: null, country: "US",
    duration_ms: null, created_at: at, is_internal: false, landing: false, device: null,
    ...rest,
  };
}

describe("the team switch changes the totals by exactly the team's rows", () => {
  const rows = [
    row({ at: "2026-10-28T13:00:00Z", visitor_id: "a", session_id: "a1" }),
    row({ at: "2026-10-28T13:01:00Z", visitor_id: "a", session_id: "a1", path: "/pricing" }),
    row({ at: "2026-10-28T14:00:00Z", visitor_id: "us", session_id: "u1", is_internal: true }),
    row({ at: "2026-10-28T14:02:00Z", visitor_id: "us", session_id: "u1", path: "/pricing", is_internal: true }),
    row({ at: "2026-10-28T14:03:00Z", visitor_id: "us", session_id: "u1", path: "/faq", is_internal: true }),
  ];
  const out = summarizeWebsite(rows, { includeInternal: false, now: NOW });
  const inc = summarizeWebsite(rows, { includeInternal: true, now: NOW });

  it("left out: only the customer's visit", () => {
    expect(out.kpis.pageviews.d30).toBe(2);
    expect(out.kpis.visitors.d30).toBe(1);
    expect(out.kpis.visits.d30).toBe(1);
  });

  it("included: plus exactly the team's rows, and the page says how many", () => {
    expect(inc.kpis.pageviews.d30 - out.kpis.pageviews.d30).toBe(out.team.pageviews);
    expect(inc.kpis.visits.d30 - out.kpis.visits.d30).toBe(out.team.visits);
    expect(inc.kpis.visitors.d30 - out.kpis.visitors.d30).toBe(out.team.visitors);
    expect(out.team).toEqual({ pageviews: 3, visits: 1, visitors: 1 });
    expect(inc.team).toEqual(out.team);
  });
});

describe("a source counts once per visit, from the page it started on", () => {
  // One visit from Google that read three pages. Old data repeated the
  // referrer on every client-side page change.
  const rows = [
    row({ at: "2026-10-27T13:00:00Z", referrer: "www.google.com" }),
    row({ at: "2026-10-27T13:01:00Z", referrer: "www.google.com", path: "/pricing" }),
    row({ at: "2026-10-27T13:02:00Z", referrer: "www.google.com", path: "/faq" }),
    row({ at: "2026-10-27T15:00:00Z", visitor_id: "v2", session_id: "s2", referrer: "com.google.android.googlequicksearchbox" }),
    row({ at: "2026-10-27T16:00:00Z", visitor_id: "v3", session_id: "s3", referrer: "l.instagram.com" }),
    row({ at: "2026-10-27T17:00:00Z", visitor_id: "v4", session_id: "s4" }),
  ];
  const s = summarizeWebsite(rows, { includeInternal: false, now: NOW });

  it("Google is two visits (the website and the Android app), grouped by name", () => {
    expect(s.topReferrers[0]).toEqual({ label: "Google", count: 2, detail: "com.google.android.googlequicksearchbox, www.google.com" });
    expect(s.topReferrers[1]).toMatchObject({ label: "Instagram", count: 1 });
  });

  it("a visit with no referrer is counted apart, not dropped", () => {
    expect(s.directVisits).toBe(1);
  });
});

describe("a visit is one person's session", () => {
  it("two storage-blocked browsers that both said 'nostore' are two visits", () => {
    const s = summarizeWebsite([
      row({ at: "2026-10-27T13:00:00Z", visitor_id: "x", session_id: "nostore" }),
      row({ at: "2026-10-27T13:05:00Z", visitor_id: "y", session_id: "nostore" }),
    ], { includeInternal: false, now: NOW });
    expect(s.kpis.visits.d30).toBe(2);
    expect(s.kpis.visitors.d30).toBe(2);
  });

  it("going on to the card builder or sign-in is not leaving after one page", () => {
    const s = summarizeWebsite([
      row({ at: "2026-10-27T13:00:00Z", visitor_id: "a", session_id: "a" }),
      row({ at: "2026-10-27T13:00:30Z", visitor_id: "a", session_id: "a", path: "/cards/new" }),
      row({ at: "2026-10-27T14:00:00Z", visitor_id: "b", session_id: "b", path: "/login" }),
      row({ at: "2026-10-27T15:00:00Z", visitor_id: "c", session_id: "c", path: "/pricing" }),
    ], { includeInternal: false, now: NOW });
    expect(s.kpis.bounceRatePct).toBe(33); // only c, of three visits
    expect(s.builderBySource).toEqual([{ label: "No referrer", count: 1 }]);
    expect(s.exitPages.map((p) => p.label).sort()).toEqual(["/cards/new", "/login", "/pricing"]);
  });

  it("someone with two visits came back", () => {
    const s = summarizeWebsite([
      row({ at: "2026-10-20T13:00:00Z", session_id: "first" }),
      row({ at: "2026-10-27T13:00:00Z", session_id: "second" }),
      row({ at: "2026-10-27T13:00:00Z", visitor_id: "once", session_id: "once" }),
    ], { includeInternal: false, now: NOW });
    expect(s.kpis.cameBack).toBe(1);
    expect(s.kpis.visitors.d30).toBe(2);
  });
});

describe("New York days", () => {
  // 11pm in New York on the 27th is 03:00 UTC on the 28th.
  const late = row({ at: "2026-10-28T03:00:00Z", visitor_id: "late", session_id: "late" });
  // 1am in New York on the 28th.
  const early = row({ at: "2026-10-28T05:00:00Z", visitor_id: "early", session_id: "early" });
  const s = summarizeWebsite([late, early], { includeInternal: false, now: NOW });

  it("a visit at 11pm is yesterday, not today", () => {
    expect(s.kpis.visitors.d1).toBe(1);
    expect(s.daily.find((d) => d.date === "2026-10-27")?.views).toBe(1);
    expect(s.daily.find((d) => d.date === "2026-10-28")?.views).toBe(1);
  });

  it("thirty calendar days, today last", () => {
    expect(s.daily).toHaveLength(30);
    expect(s.daily.at(-1)?.date).toBe("2026-10-28");
  });

  it("rows from before the 30 days never count", () => {
    const old = summarizeWebsite([row({ at: "2026-09-01T12:00:00Z" })], { includeInternal: false, now: NOW });
    expect(old.kpis.pageviews.d30).toBe(0);
  });
});

describe("people, not pageviews, for countries and devices", () => {
  const s = summarizeWebsite([
    row({ at: "2026-10-27T13:00:00Z", country: "US", device: "phone" }),
    row({ at: "2026-10-27T13:01:00Z", country: "US", device: "phone", path: "/pricing" }),
    row({ at: "2026-10-27T13:02:00Z", country: "US", device: "phone", path: "/faq" }),
    row({ at: "2026-10-27T14:00:00Z", visitor_id: "gb", session_id: "gb", country: "GB", device: "computer" }),
  ], { includeInternal: false, now: NOW });

  it("one count per person", () => {
    expect(s.topCountries).toEqual([{ label: "GB", count: 1 }, { label: "US", count: 1 }]);
    expect(s.devices).toEqual([{ label: "computer", count: 1 }, { label: "phone", count: 1 }]);
  });

  it("says when devices started being recorded", () => {
    expect(s.detailSince).toBe("2026-10-27T13:00:00Z");
  });
});

describe("campaigns and time on page", () => {
  const s = summarizeWebsite([
    row({ at: "2026-10-27T13:00:00Z", landing: true, src: "badge", duration_ms: 4000 }),
    row({ at: "2026-10-27T13:01:00Z", path: "/pricing", duration_ms: 1000 }),
    row({ at: "2026-10-27T14:00:00Z", visitor_id: "b", session_id: "b", landing: true, utm_source: "flyer", utm_campaign: "nyc", duration_ms: 6000 }),
    row({ at: "2026-10-27T15:00:00Z", visitor_id: "c", session_id: "c", duration_ms: 2000 }),
  ], { includeInternal: false, now: NOW });

  it("a campaign is counted once per visit", () => {
    expect(s.campaigns).toEqual([{ label: "flyer · nyc", count: 1 }, { label: "src=badge", count: 1 }]);
  });

  it("time per page needs three timed views before it's shown", () => {
    expect(s.topPages.find((p) => p.label === "/")?.avgSec).toBe(4);
    expect(s.topPages.find((p) => p.label === "/pricing")?.avgSec).toBeNull();
    expect(s.kpis.avgDurationSec).toBe(3); // (4+1+6+2)/4 = 3.25 s
  });
});
