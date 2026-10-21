import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// QA accounts' card images filled Supabase storage past the free plan
// (2.8 GB of leftovers, 2026-10-20). The cleanup must stay narrow: it deletes
// only qa-*.png whose account is gone, and the nightly run keeps calling it.

const script = readFileSync("scripts/cleanup-qa-images.mjs", "utf8");

describe("QA image cleanup", () => {
  it("only ever targets qa- names, old enough, with no card or profile, and dry-runs by default", () => {
    expect(script).toContain("const QA_NAME = /^(qa-[a-z0-9-]+)\\.png$/i;");
    expect(script).toMatch(/inUse\.has\(m\[1\]\.toLowerCase\(\)\)/);
    expect(script).toContain("_prevSlugs");
    expect(script).toContain("MIN_AGE_MS = 6 * 3600_000");
    expect(script).toContain('const GO = process.argv.includes("--go");');
    expect(script).toMatch(/if \(!cards\.length\)[^\n]*process\.exit/);
  });

  it("runs after every nightly QA pass", () => {
    const wf = readFileSync(".github/workflows/nightly-qa.yml", "utf8");
    expect(wf).toContain("node scripts/cleanup-qa-images.mjs --go");
  });
});
