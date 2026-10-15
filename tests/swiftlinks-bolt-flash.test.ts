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

  it("stays subtle: a short impulse, then still", () => {
    // 2026-10-15: a little showier (owner: "make the impulse a little larger
    // … but still keep it a little subtle") — a 28% pop with a small rebound,
    // over the first 18% of the 3s cycle (~0.5s); still the rest of the time.
    expect(src).toMatch(/0%, 18%, 100% \{ transform: scale\(1\)/);
    expect(src).toMatch(/6% \{ transform: scale\(1\.28\)/);
    expect(src).toMatch(/12% \{ transform: scale\(0\.96\)/);
  });

  it("the bigger pop still fits inside the chip", () => {
    // 22px bolt × 1.28 = 28px, plus a 6px glow, inside the 40px chip.
    expect(src).toMatch(/w-10 h-10/);
    expect(src).toMatch(/className="sc-bolt-flash w-\[22px\] h-\[22px\]"/);
  });

  it("is off for visitors who ask for reduced motion", () => {
    expect(src).toMatch(/prefers-reduced-motion: reduce\) \{ \.sc-bolt-flash \{ animation: none; \}/);
  });
});
