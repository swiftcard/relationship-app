import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A browser subscription answered 403 (made under another VAPID key, or
// revoked) can never be delivered to. It must be pruned like 404/410 instead
// of raising a push.delivery error on every notification.
describe("web push 403", () => {
  it("is pruned with the other dead-subscription statuses", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/push.ts"), "utf8");
    expect(src).toMatch(/r\.status === 404 \|\| r\.status === 410 \|\| r\.status === 403\)\s*\{(\s*\/\/[^\n]*)+\s*await admin\.from\("push_subscriptions"\)\.delete\(\)/);
  });
});
