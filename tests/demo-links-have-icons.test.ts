import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The product-cards demo feeds the real Swift Links renderer, which asks
// /api/link-icon for every link's host. A made-up host (coastlinehomes.com)
// has no icon, the route answers 404, and the nightly sweep reports it as a
// failed request. Demo links must point at sites that have a real icon.
describe("DashboardDemo links", () => {
  it("do not use the made-up persona site", () => {
    const src = readFileSync(join(process.cwd(), "src/components/site/DashboardDemo.tsx"), "utf8");
    const block = src.match(/const DEMO_LINKS = \[[\s\S]*?\];/)?.[0] ?? "";
    expect(block).not.toBe("");
    expect(block).not.toContain("coastlinehomes.com");
  });
});
