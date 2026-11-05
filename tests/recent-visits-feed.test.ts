import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRecentVisits, visitStarts, visitWhen, RECENT_VISITS_DAYS, type VisitEventRow } from "@/lib/recent-visits";

// ── Owner, 2026-11-05 ────────────────────────────────────────────────────────
// "Sometimes when people click on my card and touch stuff around my card, it
// shows under the analytics on my homepage. Sometimes it doesn't and sometimes
// it goes away." Three of the reasons, each pinned here:
//   1. the list followed the Today tab, which empties at midnight;
//   2. the card and its Swift Links page were two visits, so a tap on Swift
//      Links right after the card belonged to neither;
//   3. phone and email taps had no name of their own.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const T = (min: number) => new Date(Date.UTC(2026, 10, 5, 15, 0) + min * 60_000).toISOString();
const ev = (id: string, at: number, type: string, extra: Partial<VisitEventRow> = {}): VisitEventRow =>
  ({ id, created_at: T(at), event_type: type, surface: "card", visitor_id: "visitor-aaaa", ...extra });

describe("the list does not empty at midnight", () => {
  it("reads the last 30 days whichever tab is chosen", () => {
    const dash = read("src/app/dashboard/page.tsx");
    expect(RECENT_VISITS_DAYS).toBe(30);
    expect(dash).toContain("sinceIso: new Date(tzNow.getTime() - RECENT_VISITS_DAYS * 86_400_000).toISOString()");
    // Not the chart's window any more.
    expect(dash).not.toMatch(/loadRecentVisits\([^)]*sinceIso: viewsCutoff/);
    expect(read("src/components/dashboard/RecentVisits.tsx")).toContain("Recent visits · last 30 days");
  });

  it("every row says its day on the owner's clock", () => {
    const now = new Date("2026-11-05T20:00:00Z"); // 3:00 PM in New York
    const tz = "America/New_York";
    expect(visitWhen("2026-11-05T14:41:00Z", now, tz)).toBe("Today 9:41 AM");
    expect(visitWhen("2026-11-05T02:41:00Z", now, tz)).toBe("Yesterday 9:41 PM");
    expect(visitWhen("2026-11-03T14:41:00Z", now, tz)).toBe("Tue, Nov 3 9:41 AM");
  });

  it("the dashboard redraws when the owner comes back to it", () => {
    const live = read("src/components/dashboard/LiveRefresh.tsx");
    expect(live).toContain("router.refresh()");
    expect(live).toContain("const MIN_GAP_MS = 30_000;");
    expect(read("src/app/dashboard/page.tsx")).toContain("<LiveRefresh />");
  });

  it("Link taps names the window it counts", () => {
    expect(read("src/app/dashboard/page.tsx")).toContain('Link taps {viewsRange === "today" ? "today" : viewsRange === "week" ? "· last 7 days" : "· last 30 days"}');
  });
});

describe("one visit is one person on one card — the card AND its Swift Links", () => {
  it("card, then Swift Links, then a tap there: ONE row with all of it", () => {
    const events = [
      ev("tap", 6, "clicked_link", { surface: "links", target: "instagram.com", target_label: "Instagram" }),
      ev("links", 4, "viewed_card", { surface: "links" }),
      ev("card", 0, "viewed_card"),
    ];
    const rows = buildRecentVisits({ events, history: [], leads: [], paid: true, limit: 5 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "card", surface: "card", actions: ["Opened your Swift Links", "Tapped Instagram"] });
  });

  it("the other page well after the visit is a later visit", () => {
    const events = [ev("links", 45, "viewed_card", { surface: "links" }), ev("card", 0, "viewed_card")];
    expect(visitStarts(events).map((r) => r.id)).toEqual(["links", "card"]);
  });

  it("counts visits across both pages for the visit number", () => {
    const events = [ev("card2", 60, "viewed_card"), ev("links", 3, "viewed_card", { surface: "links" }), ev("card1", 0, "viewed_card")];
    const history = events.map((e) => ({ visitor_id: e.visitor_id, surface: e.surface, created_at: e.created_at, event_type: e.event_type }));
    const [second, first] = buildRecentVisits({ events, history, leads: [], paid: true, limit: 5 });
    expect(first).toMatchObject({ id: "card1", visitNumber: 1 });
    expect(second).toMatchObject({ id: "card2", visitNumber: 2 });
  });

  it("two people are never merged", () => {
    const events = [ev("b", 2, "viewed_card", { surface: "links", visitor_id: "visitor-bbbb" }), ev("a", 0, "viewed_card")];
    expect(buildRecentVisits({ events, history: [], leads: [], paid: true, limit: 5 })).toHaveLength(2);
  });
});

describe("a phone or email tap is named as what it was", () => {
  it("says 'Tapped your phone number', never 'Tapped phone'", () => {
    const events = [
      ev("email", 2, "clicked_link", { target: "email", target_label: "Email" }),
      ev("phone", 1, "clicked_link", { target: "phone", target_label: "Phone" }),
      ev("card", 0, "viewed_card"),
    ];
    const [row] = buildRecentVisits({ events, history: [], leads: [], paid: true, limit: 5 });
    expect(row.actions).toEqual(["Tapped your phone number", "Tapped your email"]);
  });

  it("Free still withholds what was tapped", () => {
    const events = [ev("phone", 1, "clicked_link", { target: "phone" }), ev("card", 0, "viewed_card")];
    const [row] = buildRecentVisits({ events, history: [], leads: [], paid: false, limit: 5 });
    expect(row).toMatchObject({ locked: true, actions: [] });
  });
});
