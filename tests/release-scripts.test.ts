import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// The App Store release scripts. There used to be one submit script PER
// release (asc-submit-104.mjs, asc-submit-105.mjs), each a copy of the last
// with the version, build and What's New typed in again — and the What's New
// kept in step with a second copy by a "must match" comment. Now one script
// reads the version and build from the Xcode project, and one module holds the
// text. These pin it that way.

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("one submit script for every release", () => {
  it("no per-release copies", () => {
    const copies = readdirSync(join(root, "scripts")).filter((f) => /^asc-submit-\d+\.mjs$/.test(f));
    expect(copies, "a per-release submit script is back — bump the Xcode project instead").toEqual([]);
    expect(existsSync(join(root, "scripts/asc-submit.mjs"))).toBe(true);
  });

  it("reads the version and build from the Xcode project, not a constant", () => {
    const s = read("scripts/asc-submit.mjs");
    expect(s).toMatch(/projectSetting\("MARKETING_VERSION"\)/);
    expect(s).toMatch(/projectSetting\("CURRENT_PROJECT_VERSION"\)/);
    expect(s, "a hardcoded version is back").not.toMatch(/WANT_VERSION = "\d/);
  });
});

describe("What's New has exactly one copy", () => {
  it("both scripts import it; neither types it", () => {
    for (const f of ["scripts/asc-submit.mjs", "scripts/asc-whats-new.mjs"]) {
      const s = read(f);
      expect(s, f).toMatch(/import \{ WHATS_NEW \} from "\.\/lib\/whats-new\.mjs"/);
      expect(s, f).not.toMatch(/const WHATS_NEW\s*=/);
    }
  });

  it("matches the newest entry in APP-STORE-METADATA.md ## Version", async () => {
    const { WHATS_NEW } = await import("../scripts/lib/whats-new.mjs");
    const meta = read("docs/ios-review/APP-STORE-METADATA.md");
    const section = meta.slice(meta.indexOf("## Version"));
    // The first entry's "What's New": `…` — backticked, possibly wrapped.
    const m = section.match(/"What's New": `([^`]+)`/);
    expect(m, "no What's New in the newest ## Version entry").not.toBeNull();
    const norm = (t: string) => t.replace(/\s+/g, " ").trim();
    expect(norm(m![1])).toBe(norm(WHATS_NEW));
  });
});
