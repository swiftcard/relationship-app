import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The Swift Links corner badge's bolt glints every 3 seconds (owner,
// 2026-10-06: "a very clean subtle flash just to grab the attention").

const src = readFileSync(join(process.cwd(), "src/components/SwiftLinksPromoBadge.tsx"), "utf8");

describe("Swift Links badge bolt flash", () => {
  it("runs every 3 seconds, on the bolt only", () => {
    expect(src).toMatch(/animation: sc-bolt-flash 3s ease-in-out 1s infinite;/);
    expect(src).toMatch(/<svg viewBox="0 0 24 24" className="sc-bolt-flash /);
    // The chip (the button) is not animated.
    expect(src).not.toMatch(/<button[^>]*sc-bolt-flash/);
  });

  it("stays subtle: a short glint, a small pop, then still", () => {
    expect(src).toMatch(/0%, 14%, 100% \{ transform: scale\(1\)/);
    expect(src).toMatch(/5% \{ transform: scale\(1\.1\)/);
  });

  it("is off for visitors who ask for reduced motion", () => {
    expect(src).toMatch(/prefers-reduced-motion: reduce\) \{ \.sc-bolt-flash \{ animation: none; \}/);
  });
});
