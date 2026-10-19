import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRecentVisits, visitStarts, type VisitEventRow } from "@/lib/recent-visits";

// ── The 2026-10-18 independent review of the four analytics commits ──────────
// No critical or high findings; these pin the seven small ones it raised, each
// fixed, so none can come back.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const T = (min: number) => new Date(Date.UTC(2026, 9, 18, 15, 0) + min * 60_000).toISOString();
const ev = (id: string, at: number, type: string, extra: Partial<VisitEventRow> = {}): VisitEventRow =>
  ({ id, created_at: T(at), event_type: type, surface: "card", visitor_id: "visitor-aaaa", ...extra });

describe("1. a visit that was only a contact download is counted", () => {
  // Desktop QR ?save=1 at 0 (no view), the card opened an hour later.
  const events = [ev("view", 60, "viewed_card"), ev("save", 0, "downloaded_vcard")];
  const history = events.map((e) => ({ visitor_id: e.visitor_id, surface: e.surface, created_at: e.created_at, event_type: e.event_type }));

  it("the later view is the 2nd visit, not another 1st", () => {
    const [later, saveOnly] = buildRecentVisits({ events, history, leads: [], paid: true, limit: 5 });
    expect(saveOnly).toMatchObject({ id: "save", visitNumber: 1, actions: ["Saved your contact"] });
    expect(later).toMatchObject({ id: "view", visitNumber: 2, actions: [] });
  });

  it("a save inside a view's visit is that visit's, never a row of its own — and never dropped", () => {
    expect(visitStarts([ev("v", 0, "viewed_card"), ev("s", 5, "downloaded_vcard")]).map((r) => r.id)).toEqual(["v"]);
    // The human gate can record the view a moment AFTER the save.
    expect(visitStarts([ev("v", 0.5, "viewed_card"), ev("s", 0, "downloaded_vcard")]).map((r) => r.id)).toEqual(["v"]);
    // A view well after the save is a later visit; the save keeps its own row.
    expect(visitStarts([ev("v", 45, "viewed_card"), ev("s", 0, "downloaded_vcard")]).map((r) => r.id)).toEqual(["v", "s"]);
  });
});

describe("2. every event belongs to exactly one visit", () => {
  it("a tap in the last minute before the next visit is the NEXT visit's only", () => {
    // Visits at 0 and 30.5 (just past the window); a tap at 30.
    const events = [ev("v2", 30.5, "viewed_card"), ev("tap", 30, "clicked_link", { target_label: "Book" }), ev("v1", 0, "viewed_card")];
    const [second, first] = buildRecentVisits({ events, history: [], leads: [], paid: true, limit: 5 });
    expect(second.actions).toEqual(["Tapped Book"]);
    expect(first.actions).toEqual([]);
  });
  it("a tap long into one sitting (no new view) still belongs to it", () => {
    const events = [ev("tap", 45, "clicked_link", { target_label: "Listings" }), ev("v1", 0, "viewed_card")];
    expect(buildRecentVisits({ events, history: [], leads: [], paid: true, limit: 5 })[0].actions).toEqual(["Tapped Listings"]);
  });
});

describe("3. a later share cannot erase that the first visit shared a location", () => {
  const src = read("src/lib/recent-visits.ts");
  it("the first location's time is kept apart and set only at capture", () => {
    expect(src).toContain("const first = sh.shared_location_first_at");
    expect(read("src/app/api/leads/route.ts")).toContain("shared_location_first_at: sharedCols.shared_location_at");
    expect(read("src/app/api/leads/route.ts")).not.toMatch(/update\([^)]*shared_location_first_at/);
  });
  it("first share with location at 2, a repeat share with a new point at 120 → both visits say so", () => {
    const events = [ev("vB", 119, "viewed_card"), ev("vA", 0, "viewed_card")];
    const shares = [
      { visitor_id: "visitor-aaaa", created_at: T(2), surface: "card" as const, location: true },
      { visitor_id: "visitor-aaaa", created_at: T(120), surface: "card" as const, location: true },
    ];
    const [b, a] = buildRecentVisits({ events, history: [], leads: [], shares, paid: true, limit: 5 });
    expect(a.actions).toEqual(["Shared their details and location"]);
    expect(b.actions).toEqual(["Shared their details and location"]);
  });
});

describe("4. time on page can only be raised by the visitor's own cookie", () => {
  const dwell = read("src/app/api/card-events/dwell/route.ts").replace(/^\s*\/\/.*$/gm, "");
  it("no body visitor_id is read at all", () => {
    expect(dwell).not.toMatch(/body\?\.visitor_id/);
    expect(dwell).toContain("const visitorId = isVisitorId(cookieId) ? cookieId : null;");
    expect(read("src/components/CardEventTracker.tsx")).toContain("const json = JSON.stringify(payload);");
  });
});

describe("5 & 6. the new-contact notice only claims a location that was saved, at its real time", () => {
  const route = read("src/app/api/leads/route.ts");
  it("locationSaved, not 'a point was sent'", () => {
    expect(route).toContain("let locationSaved = !!sharedCols && !error;");
    expect(route).toContain('shared their info${locationSaved ? " and their exact location" : ""}');
  });
});

describe("7. the location switch is one control to a screen reader", () => {
  const t = read("src/components/ShareLocationToggle.tsx");
  it("a fixed visible name, the state in aria-checked, the rest as its description", () => {
    expect(t).toContain('<span className="block text-gray-900 text-sm font-medium">Add my current location</span>');
    expect(t).toContain("aria-describedby={`${ids}-hint ${ids}-status`}");
  });
  it("the live region is always mounted, so its message is announced", () => {
    expect(t).toContain('role="status" className="text-gray-500 text-xs mt-1.5 px-1 empty:hidden"');
    expect(t).not.toMatch(/\(state === "denied" \|\| state === "failed"\) && \(/);
  });
});
