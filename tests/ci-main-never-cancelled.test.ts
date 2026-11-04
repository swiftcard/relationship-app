import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// The CI runs on main are the gate Vercel waits on before a commit goes live.
// With cancel-in-progress on main, frequent pushes cancelled every run before
// render (20-30 min) finished, and production sat on an old commit for hours
// (Nov 4 2026). A PR branch may still cancel its stale runs.
describe("CI on main finishes what it starts", () => {
  it("cancels in-progress runs on PR branches only, never on main", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(ci).toContain("group: ci-${{ github.ref }}");
    expect(ci).toContain("cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}");
    expect(ci).not.toMatch(/cancel-in-progress:\s*true/);
  });
});
