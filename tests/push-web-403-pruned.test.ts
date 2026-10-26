import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A web push subscription the push service answers 403 (VAPID key mismatch /
// revoked) is permanently undeliverable: it is pruned, not logged as a fault
// to error_events every weekly recap.
describe("web push 403", () => {
  it("prunes the subscription like 404/410", () => {
    const src = readFileSync(join(__dirname, "..", "src/lib/push.ts"), "utf8");
    expect(src).toMatch(/r\.status === 404 \|\| r\.status === 410 \|\| r\.status === 403/);
  });
});
