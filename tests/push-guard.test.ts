import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

// ── The push guard stays wired (do not switch it off) ────────────────────────
//
// .githooks/pre-push runs tsc + eslint before any push leaves the machine, and
// scripts/install-hooks.mjs (the npm "prepare" script) points Git at it on
// every `npm install`. CI was red for 26 consecutive pushes in September 2026
// over one lint error nobody saw; this is what stops that from being possible
// again. A future "speed up install" or "simplify package.json" must not
// quietly drop it.

const read = (p: string) => readFileSync(p, "utf8");

describe("pre-push guard", () => {
  it("package.json installs the hooks on every npm install", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts.prepare).toBe("node scripts/install-hooks.mjs");
  });

  it("the installer points core.hooksPath at the versioned .githooks directory", () => {
    const installer = read("scripts/install-hooks.mjs");
    expect(installer).toContain('"core.hooksPath", ".githooks"');
    // and can never break an install where there is no repo (Vercel, tarballs)
    expect(installer).toMatch(/existsSync\(join\(root, "\.git"\)\)/);
  });

  it("pre-push runs the typecheck and the linter, and fails on either", () => {
    const hook = read(".githooks/pre-push");
    expect(hook.startsWith("#!/bin/sh")).toBe(true);
    expect(hook).toMatch(/^set -e$/m);
    expect(hook).toMatch(/^npx tsc --noEmit$/m);
    expect(hook).toMatch(/^npx eslint$/m);
  });

  it("CI still runs the same two checks plus the tests, in that order", () => {
    const ci = read(".github/workflows/ci.yml");
    const typecheck = ci.indexOf("npx tsc --noEmit");
    const lint = ci.indexOf("npx eslint");
    const test = ci.indexOf("npx vitest run");
    expect(typecheck).toBeGreaterThan(-1);
    expect(lint).toBeGreaterThan(typecheck);
    expect(test).toBeGreaterThan(lint);
  });
});
