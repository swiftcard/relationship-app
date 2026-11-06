import { describe, it, expect } from "vitest";
import { dropIndex, moveAmongUnlocked, nextUnlocked, shiftFor, withHttps } from "@/lib/link-list";

// ── Moving links and section headers (owner, 2026-11-06) ────────────────────
// "They can hold on to a section header and put it above a link or they can
// move one link under another link just by dragging it around." These are the
// moves themselves; tests/render/link-list-editor.interactive.test.ts drives
// the grip in a real browser.

type R = { label: string; office?: boolean };
const r = (label: string, office = false): R => ({ label, office });
const labels = (rows: R[]) => rows.map((x) => x.label);
const isOffice = (x: R) => !!x.office;

describe("moveAmongUnlocked", () => {
  const rows = [r("Book"), r("WATCH"), r("YouTube"), r("Shop")];

  it("puts a section header above a link", () => {
    expect(labels(moveAmongUnlocked(rows, 1, 0))).toEqual(["WATCH", "Book", "YouTube", "Shop"]);
  });

  it("moves one link under another", () => {
    expect(labels(moveAmongUnlocked(rows, 0, 2))).toEqual(["WATCH", "YouTube", "Book", "Shop"]);
    expect(labels(moveAmongUnlocked(rows, 3, 1))).toEqual(["Book", "Shop", "WATCH", "YouTube"]);
  });

  it("never mutates the list it was given, and a no-op or out-of-range move is an unchanged copy", () => {
    const before = labels(rows);
    const same = moveAmongUnlocked(rows, 2, 2);
    expect(same).not.toBe(rows);
    expect(labels(same)).toEqual(before);
    expect(labels(moveAmongUnlocked(rows, -1, 2))).toEqual(before);
    expect(labels(moveAmongUnlocked(rows, 0, 9))).toEqual(before);
    expect(labels(rows)).toEqual(before);
  });

  it("company rows lead and never move; nothing lands above them", () => {
    const team = [r("Company booking", true), r("Company WATCH", true), r("Mine A"), r("Mine B")];
    // The member's own rows trade places…
    expect(labels(moveAmongUnlocked(team, 3, 2, isOffice))).toEqual(["Company booking", "Company WATCH", "Mine B", "Mine A"]);
    // …a company row cannot be moved, and nothing can take its slot.
    expect(labels(moveAmongUnlocked(team, 0, 3, isOffice))).toEqual(labels(team));
    expect(labels(moveAmongUnlocked(team, 3, 0, isOffice))).toEqual(labels(team));
  });

  it("a locked row in the middle keeps its exact index while the others pass it", () => {
    const mixed = [r("A"), r("LOCK", true), r("B"), r("C")];
    expect(labels(moveAmongUnlocked(mixed, 0, 3, isOffice))).toEqual(["B", "LOCK", "C", "A"]);
    expect(labels(moveAmongUnlocked(mixed, 3, 0, isOffice))).toEqual(["C", "LOCK", "A", "B"]);
  });

  it("keeps every other field on the rows it moves (size, photo, kind)", () => {
    const rich = [{ label: "A", url: "https://a.com", size: "featured" }, { label: "S", url: "", kind: "header" }];
    const out = moveAmongUnlocked(rich, 1, 0);
    expect(out[0]).toBe(rich[1]);
    expect(out[1]).toBe(rich[0]);
  });
});

describe("nextUnlocked", () => {
  it("skips locked rows and stops at the ends", () => {
    const locked = [true, false, true, false];
    expect(nextUnlocked(locked, 3, -1)).toBe(1);
    expect(nextUnlocked(locked, 1, -1)).toBe(1);
    expect(nextUnlocked(locked, 1, 1)).toBe(3);
    expect(nextUnlocked(locked, 3, 1)).toBe(3);
  });
});

describe("dropIndex: a row takes a slot once its centre passes that slot's midpoint", () => {
  // Four 40px rows, 8px apart.
  const rects = [0, 48, 96, 144].map((top) => ({ top, height: 40 }));
  const open = [false, false, false, false];

  it("stays put until the midpoint is crossed", () => {
    expect(dropIndex(rects, 0, 0, open)).toBe(0);
    expect(dropIndex(rects, 0, 47, open)).toBe(0);
    expect(dropIndex(rects, 0, 49, open)).toBe(1);
  });

  it("travels down and up past several rows", () => {
    expect(dropIndex(rects, 0, 150, open)).toBe(3);
    expect(dropIndex(rects, 3, -100, open)).toBe(1);
    expect(dropIndex(rects, 3, -500, open)).toBe(0);
  });

  it("can never land on a locked slot, and a locked row cannot be dragged", () => {
    const lead = [true, false, false, false];
    expect(dropIndex(rects, 3, -500, lead)).toBe(1);
    expect(dropIndex(rects, 0, 150, lead)).toBe(0);
  });
});

describe("shiftFor: the rows step aside to open the gap", () => {
  const open = [false, false, false, false];
  it("dragging down: the rows passed step up; dragging up: they step down", () => {
    expect([0, 1, 2, 3].map((i) => shiftFor(i, 0, 2, open))).toEqual([0, -1, -1, 0]);
    expect([0, 1, 2, 3].map((i) => shiftFor(i, 3, 1, open))).toEqual([0, 1, 1, 0]);
  });
  it("a locked row never steps", () => {
    expect(shiftFor(1, 3, 0, [false, true, false, false])).toBe(0);
  });
});

describe("withHttps: the one address rule every link form uses", () => {
  it("adds https:// to a bare address and leaves a full one alone", () => {
    expect(withHttps("calendly.com/alex")).toBe("https://calendly.com/alex");
    expect(withHttps("  g.page/r/alex  ")).toBe("https://g.page/r/alex");
    expect(withHttps("http://example.com")).toBe("http://example.com");
    expect(withHttps("HTTPS://Example.com")).toBe("HTTPS://Example.com");
    expect(withHttps("   ")).toBe("");
  });
});
