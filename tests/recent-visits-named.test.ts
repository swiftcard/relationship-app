import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRecentVisits, onePerson, type VisitEventRow } from "@/lib/recent-visits";
import { LOCKED_LEAD_TAG } from "@/lib/plan";

// ── Feature 3 (owner, 2026-10-18): anonymous visits become named ones ────────
// Every Save Contact already asks for the visitor's details (SaveContactButton
// → the share-back sheet, on every save path). What was missing: the visit in
// which they SHARED — and what they did before it — still read "Someone",
// because the name is stamped only on events after the binding exists. The
// contact's own timeline already credits those events to them; Recent visits
// now uses the same evidence, and never more.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const T = (min: number) => new Date(Date.UTC(2026, 9, 18, 15, 0) + min * 60_000).toISOString();
const view = (id: string, at: number, visitor = "visitor-aaaa", extra: Partial<VisitEventRow> = {}): VisitEventRow =>
  ({ id, created_at: T(at), event_type: "viewed_card", surface: "card", visitor_id: visitor, ...extra });

const priya = { id: "lead-p", name: "Priya Shah", tags: [], email: "priya@x.com", phone: "+1 (555) 010-2000", created_at: T(2) };

describe("the visit in which they shared is theirs", () => {
  // Viewed at 0, saved at 1, shared at 2 — the view carries no stamp.
  const events: VisitEventRow[] = [
    { id: "save", created_at: T(1), event_type: "downloaded_vcard", surface: "card", visitor_id: "visitor-aaaa" },
    view("v", 0),
  ];
  const bindings = [{ visitor_id: "visitor-aaaa", lead_id: "lead-p", from: T(2 - 120) }];
  const shares = [{ visitor_id: "visitor-aaaa", created_at: T(2), surface: "card" as const }];

  it("named, with 'Shared their details' first among what they did", () => {
    const [v] = buildRecentVisits({ events, history: [], leads: [priya], bindings, shares, paid: true, limit: 5 });
    expect(v.who).toBe("Priya Shah");
    expect(v.actions).toEqual(["Shared their details", "Saved your contact"]);
  });

  it("a visit from BEFORE the binding's lead-in stays anonymous", () => {
    const old = [view("old", -400)];
    expect(buildRecentVisits({ events: old, history: [], leads: [priya], bindings, paid: true, limit: 5 })[0].who).toBe("Someone");
  });

  it("a share on the Swift Links page belongs to the Swift Links visit, not the card's", () => {
    const [v] = buildRecentVisits({ events, history: [], leads: [priya], bindings, shares: [{ ...shares[0], surface: "links" }], paid: true, limit: 5 });
    expect(v.actions).not.toContain("Shared their details");
  });

  it("Free: an unlocked contact is named as everywhere else on Free; a locked one is not", () => {
    expect(buildRecentVisits({ events, history: [], leads: [priya], bindings, paid: false, limit: 5 })[0].who).toBe("Priya Shah");
    const locked = { ...priya, tags: [LOCKED_LEAD_TAG] };
    expect(buildRecentVisits({ events, history: [], leads: [locked], bindings, paid: false, limit: 5 })[0].who).toBe(null);
  });

  it("an event already stamped with a contact keeps that contact — a binding never overrides it", () => {
    const stamped = [view("s", 0, "visitor-aaaa", { lead_id: "lead-other", lead_confidence: "form" })];
    const other = { id: "lead-other", name: "Dana Lee", tags: [] };
    expect(buildRecentVisits({ events: stamped, history: [], leads: [priya, other], bindings, paid: true, limit: 5 })[0].who).toBe("Dana Lee");
  });
});

describe("one browser, two people: nobody is named", () => {
  const bindings = [
    { visitor_id: "visitor-ipad", lead_id: "lead-p", from: T(-100) },
    { visitor_id: "visitor-ipad", lead_id: "lead-d", from: T(-100) },
  ];
  const dana = { id: "lead-d", name: "Dana Lee", tags: [], email: "dana@y.com", phone: "5550109999", created_at: T(-50) };

  it("different people on a shared device → Someone", () => {
    const [v] = buildRecentVisits({ events: [view("v", 0, "visitor-ipad")], history: [], leads: [priya, dana], bindings, paid: true, limit: 5 });
    expect(v.who).toBe("Someone");
  });

  it("the same person who shared twice (same email or phone) → the newest", () => {
    const again = { ...priya, id: "lead-p2", name: "Priya S.", created_at: T(3) };
    expect(onePerson([priya, again])?.id).toBe("lead-p2");
    const samePhone = { ...dana, id: "lead-d2", email: null, phone: "555-010-2000", created_at: T(4) };
    expect(onePerson([priya, samePhone])?.id).toBe("lead-d2");
    expect(onePerson([priya, dana])).toBe(undefined);
    expect(onePerson([])).toBe(undefined);
  });
});

describe("the loader uses only evidence the owner earned", () => {
  const src = read("src/lib/recent-visits.ts");
  it("skips superseded, wrong-person and forwarded bindings; a link is evidence only from when it was opened", () => {
    expect(src).toContain("if (b.superseded_at || b.wrong_at || !b.bound_at) continue;");
    expect(src).toContain('if (b.bound_via === "link" && (b.link_device_index ?? 1) > 1) continue; // forwarded');
    expect(src).toContain('const lead = b.bound_via === "link" ? 0 : LEAD_IN_MS;');
  });
  it("bindings are the CARD OWNER's, and a browser with any binding never falls back to the share rule", () => {
    expect(src).toContain('.eq("owner_id", opts.ownerId)');
    expect(src).toContain("if (!sh.visitor_id || everBound.has(sh.visitor_id)) continue;");
    expect(read("src/app/dashboard/page.tsx")).toContain("paid: isPro, ownerId: user.id })");
  });
  it("the ask itself fires on every save path (feature 3's other half, already live)", () => {
    const save = read("src/components/SaveContactButton.tsx");
    expect((save.match(/setTimeout\(\(\) => setShowSheet\(true\), 900\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(save).toContain("window.addEventListener(SCAN_SAVED_EVENT, onScanSaved);");
  });
});
