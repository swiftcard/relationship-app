import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("web push 403", () => {
  it("prunes a browser subscription the push service rejects with 403, like 404/410", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/push.ts"), "utf8");
    expect(src).toMatch(/r\.status === 403 \|\| r\.status === 404 \|\| r\.status === 410/);
  });
});
