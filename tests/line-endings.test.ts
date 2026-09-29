import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

// ── Line endings are a correctness issue in this repo ────────────────────────
//
// Hundreds of tests here read a source file as a string and assert on exact
// markup — `"{mode === \"signup\" && (\n          <PasswordField"` and the like.
// A working copy with CRLF fails those tests locally while CI (Linux, LF)
// passes, so a developer sees red that is not real and learns to ignore red.
// On 2026-09-28 the owner's PC had 1,219 of ~1,500 tracked text files CRLF in
// the working tree (core.autocrlf=true) and tests/signup-professional.test.ts
// failing for no product reason.
//
// .gitattributes pins `eol=lf` for every text file, which overrides
// core.autocrlf on every machine. These two tests make sure it stays pinned
// and that no CRLF file gets committed around it.

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

describe("line endings", () => {
  it(".gitattributes pins LF for every text file", () => {
    const attrs = readFileSync(".gitattributes", "utf8");
    expect(attrs).toMatch(/^\* text=auto eol=lf\s*$/m);
  });

  it("no tracked text file is committed with CRLF", () => {
    // `i/` is what is in the index (what gets pushed); `w/` is the working
    // tree, which is the developer's business and may legitimately be mid-edit.
    const rows = git("ls-files", "--eol", "-z").split("\0").filter(Boolean);
    const bad = rows
      .filter((r) => /^i\/(crlf|mixed)/.test(r))
      .map((r) => r.split("\t").pop());
    expect(bad, "files in the index with CRLF — run `git add --renormalize` on them").toEqual([]);
  }, 90_000); // git reads every tracked blob for --eol: ~12s idle on a Windows PC, more under load
});
