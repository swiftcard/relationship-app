import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// ── A commit built on an out-of-date copy must not be able to undo a fix ─────
//
// 2026-10-20: 087c4cc3 (47 files) was built on a copy taken before 4c528009 and
// 812eb61d landed, so it put six files back to their old versions and removed
// the push-notification fixes. Types, lint and every test still passed, because
// the older code was itself valid. The same day c0a74f9f put back seven share
// files and 5623aa20 another; each was re-applied by hand minutes later. This
// is the guard (scripts/revert-guard.mjs) that makes the next one impossible to
// miss. These tests run it for real, in throwaway repos.

const script = resolve("scripts/revert-guard.mjs");
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "revert-guard-"));
  dirs.push(dir);
  const git = (...a: string[]) =>
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "core.autocrlf=false", ...a], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q", "-b", "main");
  git("config", "core.autocrlf", "false");
  const write = (files: Record<string, string>) => {
    for (const [p, c] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), c);
    }
  };
  const commit = (files: Record<string, string>, message: string) => {
    write(files);
    git("add", "-A");
    git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };
  const stage = (files: Record<string, string>) => { write(files); git("add", "-A"); };
  const guard = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, ...env } });
  return { dir, git, commit, stage, guard };
}

let n = 0;
function message(text: string) {
  const dir = mkdtempSync(join(tmpdir(), "revert-guard-msg-"));
  dirs.push(dir);
  const file = join(dir, `msg-${n++}`);
  writeFileSync(file, `${text}\n\n# Please enter the commit message\n`);
  return file;
}

describe("revert-guard, at commit time (the commit-msg hook)", () => {
  it("refuses a commit that puts an older version of a file back, and names the fix it undoes", () => {
    const r = repo();
    r.commit({ "src/push.ts": "v1\n", "src/other.ts": "same\n" }, "base");
    const fix = r.commit({ "src/push.ts": "v2\n" }, "Browser push with no VAPID keys is reported as a failure");
    // The stale copy: push.ts as it was before the fix, staged by a commit about something else.
    r.stage({ "src/push.ts": "v1\n", "src/popup.ts": "new work\n" });
    const out = r.guard(["--staged", "--message-file", message("No pop-up on the site can be covered any more")]);
    expect(out.status).toBe(1);
    expect(out.stderr).toContain("OLDER version");
    expect(out.stderr).toContain("src/push.ts");
    expect(out.stderr).not.toContain("src/popup.ts"); // only the reinstated file is blamed
    expect(out.stderr).toContain(fix.slice(0, 8));
    expect(out.stderr).toContain("sync-main.mjs");
  });

  it("sees through several undone changes, not just the latest", () => {
    const r = repo();
    r.commit({ "a.ts": "v1\n" }, "base");
    const c2 = r.commit({ "a.ts": "v2\n" }, "second change");
    const c3 = r.commit({ "a.ts": "v3\n" }, "third change");
    r.stage({ "a.ts": "v1\n" });
    const out = r.guard(["--staged", "--message-file", message("Something unrelated")]);
    expect(out.status).toBe(1);
    expect(out.stderr).toContain(c2.slice(0, 8));
    expect(out.stderr).toContain(c3.slice(0, 8));
  });

  it("lets a genuine edit through, even to a file that was just changed", () => {
    const r = repo();
    r.commit({ "a.ts": "v1\n" }, "base");
    r.commit({ "a.ts": "v2\n" }, "peer fix");
    r.stage({ "a.ts": "v2\nplus my own line\n" });
    expect(r.guard(["--staged", "--message-file", message("My change")]).status).toBe(0);
  });

  it("is satisfied when the message says the revert is deliberate", () => {
    for (const text of [
      "Restore the old behaviour",
      "Revert the share panel change",
      "Undo the pill",
      "Roll back the hero",
      "Back out the probe",
      "Dialogs no longer fade in\n\nRevert-ok: owner asked for the fade-in to go",
    ]) {
      const r = repo();
      r.commit({ "a.ts": "v1\n" }, "base");
      r.commit({ "a.ts": "v2\n" }, "feature");
      r.stage({ "a.ts": "v1\n" });
      expect(r.guard(["--staged", "--message-file", message(text)]).status, text).toBe(0);
    }
  });

  it("is NOT satisfied by a message that merely says remove, so an accident cannot hide behind one", () => {
    const r = repo();
    r.commit({ "a.ts": "v1\n" }, "base");
    r.commit({ "a.ts": "v2\n" }, "feature");
    r.stage({ "a.ts": "v1\n" });
    expect(r.guard(["--staged", "--message-file", message("Remove the pill from the hero")]).status).toBe(1);
  });

  it("ignores lockfiles, which legitimately return to an earlier state", () => {
    const r = repo();
    r.commit({ "package-lock.json": "{\"v\":1}\n" }, "base");
    r.commit({ "package-lock.json": "{\"v\":2}\n" }, "bump");
    r.stage({ "package-lock.json": "{\"v\":1}\n" });
    expect(r.guard(["--staged", "--message-file", message("Pin it back")]).status).toBe(0);
  });

  it("passes the very first commit, and a repo with nothing staged", () => {
    const r = repo();
    r.stage({ "a.ts": "v1\n" });
    expect(r.guard(["--staged", "--message-file", message("first")]).status).toBe(0);
    r.git("commit", "-q", "-m", "first");
    expect(r.guard(["--staged", "--message-file", message("nothing")]).status).toBe(0);
  });
});

describe("revert-guard, at push time and in CI", () => {
  function accident() {
    const r = repo();
    const c1 = r.commit({ "src/push.ts": "v1\n" }, "base");
    const c2 = r.commit({ "src/push.ts": "v2\n" }, "Browser push with no VAPID keys is reported as a failure");
    const c3 = r.commit({ "src/push.ts": "v1\n", "src/popup.ts": "x\n" }, "No pop-up on the site can be covered any more");
    return { r, c1, c2, c3 };
  }

  it("--range finds the commit by id and judges only that range", () => {
    const { r, c1, c2, c3 } = accident();
    const bad = r.guard(["--range", `${c2}..${c3}`]);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain(c3.slice(0, 8));
    // The range before the accident is clean: nothing in c1..c2 reinstates anything.
    expect(r.guard(["--range", `${c1}..${c2}`]).status).toBe(0);
  });

  it("--unpushed judges every commit not yet on origin/main", () => {
    const { r, c2, c3 } = accident();
    r.git("update-ref", "refs/remotes/origin/main", c2);
    expect(r.guard(["--unpushed"]).status).toBe(1);
    r.git("update-ref", "refs/remotes/origin/main", c3); // already pushed: nothing to judge
    expect(r.guard(["--unpushed"]).status).toBe(0);
  });

  it("--pushed judges what git is pushing, even a commit that is not HEAD (pushed by sha)", () => {
    const { r, c1, c2, c3 } = accident();
    const line = (local: string, remote: string) => `refs/heads/main ${local} refs/heads/main ${remote}\n`;
    const run = (input: string) => spawnSync(process.execPath, [script, "--pushed"], { cwd: r.dir, encoding: "utf8", input });
    expect(run(line(c3, c2)).status).toBe(1);               // the accident, as pushed
    expect(run(line(c3, c2)).stderr).toContain(c3.slice(0, 8));
    expect(run(line(c2, c1)).status).toBe(0);               // a clean push of an earlier commit
    r.git("checkout", "-q", "--detach", c2);                // HEAD is now NOT the commit being pushed
    expect(run(line(c3, c2)).status).toBe(1);
    expect(run(line("0".repeat(40), c2)).status).toBe(0);   // deleting a branch pushes nothing
    expect(run(line(c3, "0".repeat(40))).status).toBe(1);   // a new branch: every commit not on a remote
    expect(run("").status).toBe(0);                         // no refs at all
  });

  it("--unpushed with no origin/main passes with a note instead of blocking the push", () => {
    const { r } = accident();
    const out = r.guard(["--unpushed"]);
    expect(out.status).toBe(0);
    expect(out.stderr).toContain("skipped");
  });

  it("--ci reads RANGE_FROM..RANGE_TO and fails open when it cannot read them", () => {
    const { r, c2, c3 } = accident();
    expect(r.guard(["--ci"], { RANGE_FROM: c2, RANGE_TO: c3 }).status).toBe(1);
    const first = r.guard(["--ci"], { RANGE_FROM: "0".repeat(40), RANGE_TO: c3 });
    expect(first.status).toBe(0); // a brand-new branch has no "before"
    expect(first.stderr).toContain("skipped");
    const shallow = r.guard(["--ci"], { RANGE_FROM: "1".repeat(40), RANGE_TO: c3 });
    expect(shallow.status).toBe(0); // history not there (shallow clone, force push)
    expect(shallow.stderr).toContain("could not read");
  });

  it("a deliberate revert in the range passes", () => {
    const r = repo();
    r.commit({ "a.ts": "v1\n" }, "base");
    const c2 = r.commit({ "a.ts": "v2\n" }, "feature");
    const c3 = r.commit({ "a.ts": "v1\n" }, "Revert the feature");
    expect(r.guard(["--range", `${c2}..${c3}`]).status).toBe(0);
  });

  it("--history audits a stretch of history in one pass and never fails the run", () => {
    const { r, c3 } = accident();
    const out = r.guard(["--history", "50"]);
    expect(out.status).toBe(0);
    expect(out.stdout).toContain("reinstate older file versions");
    expect(out.stderr).toContain(c3.slice(0, 8));
  });

  it("outside a git repository it does nothing (an npm tarball, a Vercel build)", () => {
    const dir = mkdtempSync(join(tmpdir(), "revert-guard-nogit-"));
    dirs.push(dir);
    expect(spawnSync(process.execPath, [script, "--unpushed"], { cwd: dir, encoding: "utf8" }).status).toBe(0);
  });
});

describe("revert-guard stays wired in (do not switch it off)", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  const mode = (p: string) => execFileSync("git", ["ls-files", "-s", "--", p], { encoding: "utf8" }).split(" ")[0];

  it("commit-msg hands the staged commit and its message to the guard", () => {
    const hook = read(".githooks/commit-msg");
    expect(hook.startsWith("#!/bin/sh")).toBe(true);
    expect(hook).toMatch(/^set -e$/m);
    expect(hook).toMatch(/^node scripts\/revert-guard\.mjs --staged --message-file "\$1"$/m);
  });

  it("pre-push judges the refs git is pushing (not just HEAD), before the slow checks", () => {
    const hook = read(".githooks/pre-push");
    expect(hook).toMatch(/^node scripts\/revert-guard\.mjs --pushed$/m);
    expect(hook.indexOf("node scripts/revert-guard.mjs --pushed")).toBeLessThan(hook.indexOf("npx tsc --noEmit"));
    // git gives the refs on stdin once; each check must be re-fed them from a file
    expect(hook).toMatch(/^cat > "\$refs"$/m);
    expect((hook.match(/^exec < "\$refs"$/gm) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("both hooks are executable in git, or a Mac/Linux clone silently skips them", () => {
    expect(mode(".githooks/commit-msg")).toBe("100755");
    expect(mode(".githooks/pre-push")).toBe("100755");
  });

  it("CI runs it as a step of the verify job, after the tests, without renaming verify or render", () => {
    const ci = read(".github/workflows/ci.yml");
    const verify = ci.indexOf("\n  verify:");
    const render = ci.indexOf("\n  render:");
    const step = ci.indexOf("node scripts/revert-guard.mjs --ci");
    expect(verify).toBeGreaterThan(-1);
    expect(render).toBeGreaterThan(verify);
    expect(step).toBeGreaterThan(ci.indexOf("npx vitest run"));
    expect(step).toBeLessThan(render); // inside verify, not a new job Vercel's checks would not know
    expect(ci).toContain("RANGE_FROM: ${{ github.event.before || github.event.pull_request.base.sha }}");
  });

  it("the guard keeps its safety properties: fail open on trouble, strict about what excuses a revert", () => {
    const src = read("scripts/revert-guard.mjs");
    expect(src).toContain("not checked.");                  // an internal error passes with a warning
    expect(src).toMatch(/DELIBERATE = \/[^\n]*Revert-ok/);  // the explicit, auditable way out
    expect(src).not.toMatch(/DELIBERATE = [^\n]*\bremov/i); // "remove" must not excuse an accident
  });
});
