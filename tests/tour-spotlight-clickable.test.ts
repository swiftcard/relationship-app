import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// The guided tour's full-screen dim layer (used for centred steps) sat over
// the whole page at opacity 0 during every spotlight step — still catching
// taps. So an "interactive" step ("Your SwiftCard — try it", which invites a
// tap on Scan to connect) or a clickToAdvance step could never be clicked:
// the hole in the spotlight was painted but not open. Found driving the real
// tour on swiftcard.me at 390px (2026-09-22).
const src = readFileSync("src/components/GuidedTour.tsx", "utf8");

describe("the tour's spotlight hole can actually be clicked", () => {
  it("the full-screen layer stops catching taps when it is hidden", () => {
    expect(src).toMatch(/full\.current\.style\.opacity = "0"; full\.current\.style\.pointerEvents = "none";/);
  });

  it("and catches them again on a centred step, where it is the dim", () => {
    expect(src).toMatch(/full\.current\.style\.opacity = "1"; full\.current\.style\.pointerEvents = "auto";/);
  });

  it("a step that invites a tap still has its hole cover lifted", () => {
    expect(src).toMatch(/holeCover\.current\.style\.pointerEvents = clickable \? "none" : "auto"/);
  });
});

describe("the full-screen card opened from the tour sits above the tour", () => {
  it("is layered over the tour's masks and tooltip", () => {
    const full = readFileSync("src/components/CardFullscreen.tsx", "utf8");
    expect(full).toMatch(/fixed inset-0 z-\[10001\]/);
  });
});
