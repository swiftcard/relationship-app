import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

  // 2026-10-09: a commit message that quoted a skip-CI tag switched CI off for
  // that push, so Vercel's Deployment Checks held it and it never went live.
  it("pre-push refuses a skip-CI tag before anything else", () => {
    const hook = read(".githooks/pre-push");
    expect(hook).toMatch(/^node scripts\/no-skip-ci\.mjs$/m);
    expect(hook.indexOf("node scripts/no-skip-ci.mjs")).toBeLessThan(hook.indexOf("npx tsc --noEmit"));
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

describe("scripts/no-skip-ci.mjs, run for real in a throwaway repo", () => {
  const script = resolve("scripts/no-skip-ci.mjs");
  const ZERO = "0".repeat(40);

  function repoWith(messages: string[]) {
    const dir = mkdtempSync(join(tmpdir(), "no-skip-ci-"));
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: dir, encoding: "utf8" }).trim();
    git("init", "-q");
    const shas = messages.map((m) => { git("commit", "-q", "--allow-empty", "-m", m); return git("rev-parse", "HEAD"); });
    return { dir, shas };
  }
  const push = (dir: string, local: string, remote: string) =>
    spawnSync(process.execPath, [script], { cwd: dir, input: `refs/heads/main ${local} refs/heads/main ${remote}\n`, encoding: "utf8" });

  it("refuses every form of the tag GitHub honours, in subject or body", () => {
    for (const tag of ["[skip ci]", "[ci skip]", "[no ci]", "[skip actions]", "[actions skip]", "[SKIP CI]"]) {
      const { dir, shas } = repoWith(["base", `Docs: mention ${tag} here`]);
      const r = push(dir, shas[1], shas[0]);
      expect(r.status, tag).toBe(1);
      expect(r.stderr, tag).toContain("skip-CI tag");
      rmSync(dir, { recursive: true, force: true });
    }
    const { dir, shas } = repoWith(["base", "Subject\n\nskip-checks: true"]);
    expect(push(dir, shas[1], shas[0]).status).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it("lets a clean push through, and only judges the commits being pushed", () => {
    const { dir, shas } = repoWith(["Old [skip ci] already on the remote", "A clean change"]);
    expect(push(dir, shas[1], shas[0]).status).toBe(0);
    // Deleting a branch pushes no commits.
    expect(push(dir, ZERO, shas[1]).status).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it("a new branch is judged on every commit not yet on a remote", () => {
    const { dir, shas } = repoWith(["first [no ci]", "second"]);
    expect(push(dir, shas[1], ZERO).status).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });
});
