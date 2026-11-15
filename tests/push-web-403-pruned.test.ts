import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("src/lib/push.ts", "utf8");

describe("web push 403", () => {
  it("prunes a subscription the push service rejects with 403 instead of reporting it", () => {
    expect(src).toMatch(/r\.status === 404 \|\| r\.status === 410 \|\| r\.status === 403/);
  });
});
