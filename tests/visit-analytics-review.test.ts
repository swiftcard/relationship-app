import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRecentVisits, visitStarts, type VisitEventRow } from "@/lib/recent-visits";

// ── The 2026-10-18 independent review of the four analytics commits ──────────
// No critical or high findings; these pin the small ones it raised, each
// fixed, so none can come back. (Its findings about the visitor-shared
// location went with that feature, removed on the owner's word the same day.)

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

describe("3. time on page can only be raised by the visitor's own cookie", () => {
  const dwell = read("src/app/api/card-events/dwell/route.ts").replace(/^\s*\/\/.*$/gm, "");
  it("no body visitor_id is read at all", () => {
    expect(dwell).not.toMatch(/body\?\.visitor_id/);
    expect(dwell).toContain("const visitorId = isVisitorId(cookieId) ? cookieId : null;");
    expect(read("src/components/CardEventTracker.tsx")).toContain("const json = JSON.stringify(payload);");
  });
});
