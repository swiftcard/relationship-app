import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// ── A folder that is behind origin/main must say so, and must be fixable ─────
//
// 2026-10-20: this folder sat 20 commits behind origin/main while 38 of its 41
// "modified" files and 13 "new" ones were byte-for-byte what origin already had:
// stale copies of work that had shipped from elsewhere. A commit from that state
// undoes live fixes with no error (087c4cc3). scripts/sync-main.mjs reports it,
// drops only the copies that are IDENTICAL to origin's (so nothing is lost),
// fast-forwards, and refuses a `git commit` while behind. Run for real here.

const script = resolve("scripts/sync-main.mjs");
const roots: string[] = [];
afterAll(() => { for (const d of roots) rmSync(d, { recursive: true, force: true }); });

function world() {
  const root = mkdtempSync(join(tmpdir(), "sync-main-"));
  roots.push(root);
  const git = (cwd: string, ...a: string[]) =>
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "core.autocrlf=false", ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const origin = join(root, "origin.git");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  const clone = (name: string) => {
    git(root, "clone", "-q", origin, name);
    const dir = join(root, name);
    git(dir, "checkout", "-q", "-B", "main");
    // The checkout git does (the script's own) must not depend on the machine's global autocrlf.
    git(dir, "config", "core.autocrlf", "false");
    return dir;
  };
  const write = (dir: string, files: Record<string, string>) => {
    for (const [p, c] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), c);
    }
  };
  const push = (dir: string, files: Record<string, string>, message: string) => {
    write(dir, files);
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", message);
    git(dir, "push", "-q", "origin", "main");
  };
  const sync = (dir: string, args: string[], input = "", env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8", input, env: { ...process.env, ...env } });

  // A peer publishes the first commit; "here" is the folder under test.
  const peer = clone("peer");
  push(peer, { "x.txt": "x1\n", "z.txt": "z1\n", "keep.txt": "k\n" }, "base");
  const here = clone("here");
  return { root, git, write, push, sync, peer, here, head: (d: string) => git(d, "rev-parse", "HEAD") };
}

const commit = (command: string) => JSON.stringify({ tool_name: "Bash", tool_input: { command } });

describe("sync-main", () => {
  it("says so when the folder is level, and lets a commit through", () => {
    const w = world();
    expect(w.sync(w.here, ["--brief"]).stdout).toContain("level with origin/main");
    expect(w.sync(w.here, ["--gate"], commit("git commit -m x")).status).toBe(0);
    expect(w.sync(w.here, []).status).toBe(0);
  });

  it("drops stale copies of shipped work (even with CRLF line endings), then fast-forwards, losing nothing", () => {
    const w = world();
    w.push(w.peer, { "x.txt": "x2\n", "y.txt": "y1\n" }, "ship x2 and y");
    // Here, the same work exists as uncommitted changes from before it shipped elsewhere.
    w.write(w.here, { "x.txt": "x2\r\n", "y.txt": "y1\n" });

    const report = w.sync(w.here, []);
    expect(report.status).toBe(1); // behind
    expect(report.stdout).toContain("1 commit behind");
    expect(report.stdout).toContain("(2)"); // two stale copies

    const applied = w.sync(w.here, ["--apply"]);
    expect(applied.status).toBe(0);
    expect(applied.stdout).toContain("dropped 2 stale copies");
    expect(w.git(w.here, "status", "--porcelain")).toBe("");
    expect(w.head(w.here)).toBe(w.head(w.peer));
    expect(readFileSync(join(w.here, "x.txt"), "utf8")).toBe("x2\n");
    expect(readFileSync(join(w.here, "y.txt"), "utf8")).toBe("y1\n");
  });

  it("never touches a file that differs from origin's, and does not fast-forward over it", () => {
    const w = world();
    w.push(w.peer, { "x.txt": "x2 from the peer\n" }, "peer changes x");
    w.write(w.here, { "x.txt": "my unfinished edit\n" });
    const before = w.head(w.here);

    const applied = w.sync(w.here, ["--apply"]);
    expect(applied.status).toBe(1);
    expect(applied.stdout).toContain("x.txt");
    expect(applied.stdout).toContain("not fast-forwarding");
    expect(w.head(w.here)).toBe(before);
    expect(readFileSync(join(w.here, "x.txt"), "utf8")).toBe("my unfinished edit\n");
  });

  it("leaves real in-progress work on files origin did not change, and still fast-forwards", () => {
    const w = world();
    w.push(w.peer, { "y.txt": "y1\n" }, "peer adds y");
    w.write(w.here, { "z.txt": "z1 plus my edit\n", "mine.txt": "brand new, mine\n" });

    const applied = w.sync(w.here, ["--apply"]);
    expect(applied.status).toBe(0);
    expect(w.head(w.here)).toBe(w.head(w.peer));
    expect(readFileSync(join(w.here, "z.txt"), "utf8")).toBe("z1 plus my edit\n");
    expect(existsSync(join(w.here, "mine.txt"))).toBe(true);
    expect(w.git(w.here, "status", "--porcelain")).toContain("mine.txt");
  });

  it("removes the empty folders a dropped new file leaves behind", () => {
    const w = world();
    w.push(w.peer, { "deep/er/new.txt": "n\n" }, "peer adds a nested file");
    w.write(w.here, { "deep/er/new.txt": "n\n" });
    expect(w.sync(w.here, ["--apply"]).status).toBe(0);
    expect(w.git(w.here, "status", "--porcelain")).toBe("");
  });
});

describe("sync-main --gate (the Claude Code PreToolUse hook)", () => {
  it("blocks a git commit while behind, in every spelling of it, and says how to fix it", () => {
    const w = world();
    w.push(w.peer, { "y.txt": "y1\n" }, "peer adds y");
    for (const cmd of ["git commit -m \"x\"", "git -c user.email=a@b.c commit -m x", "git add a && git commit -am y"]) {
      const out = w.sync(w.here, ["--gate"], commit(cmd));
      expect(out.status, cmd).toBe(2);
      expect(out.stderr, cmd).toContain("BLOCKED");
      expect(out.stderr, cmd).toContain("node scripts/sync-main.mjs --apply");
    }
  });

  it("does not gate plumbing: building on origin/main with commit-tree is the sanctioned way out", () => {
    const w = world();
    w.push(w.peer, { "y.txt": "y1\n" }, "peer adds y");
    const out = w.sync(w.here, ["--gate"], commit("git commit-tree -p origin/main -m x HEAD^{tree}"));
    expect(out.status).toBe(0);
    expect(out.stderr).toBe("");
  });

  it("is silent about everything that is not a commit, and when switched off", () => {
    const w = world();
    w.push(w.peer, { "y.txt": "y1\n" }, "peer adds y");
    for (const cmd of ["git status", "git log --oneline", "git push origin main", "npm test"]) {
      const out = w.sync(w.here, ["--gate"], commit(cmd));
      expect(out.status, cmd).toBe(0);
      expect(out.stderr, cmd).toBe("");
    }
    expect(w.sync(w.here, ["--gate"], commit("git commit -m x"), { SWIFTCARD_SYNC_GATE: "off" }).status).toBe(0);
  });

  it("fails open: bad input, no network, or a clean sync lets the commit through", () => {
    const w = world();
    expect(w.sync(w.here, ["--gate"], "not json at all").status).toBe(0);
    w.push(w.peer, { "y.txt": "y1\n" }, "peer adds y");
    w.git(w.here, "remote", "set-url", "origin", join(w.root, "does-not-exist.git"));
    expect(w.sync(w.here, ["--gate"], commit("git commit -m x")).status).toBe(0);
    w.git(w.here, "remote", "set-url", "origin", join(w.root, "origin.git"));
    expect(w.sync(w.here, ["--apply"]).status).toBe(0);
    expect(w.sync(w.here, ["--gate"], commit("git commit -m x")).status).toBe(0);
  });

  it("--brief tells a new session when the folder is behind", () => {
    const w = world();
    w.push(w.peer, { "y.txt": "y1\n" }, "peer adds y");
    const out = w.sync(w.here, ["--brief"]);
    expect(out.status).toBe(0); // advisory: it must never stop a session starting
    expect(out.stdout).toContain("BEHIND origin/main");
    expect(out.stdout).toContain("node scripts/sync-main.mjs --apply");
  });
});

describe("sync-main stays wired in (do not switch it off)", () => {
  const settings = JSON.parse(readFileSync(".claude/settings.json", "utf8")) as {
    hooks: Record<string, { matcher?: string; hooks: { type: string; command: string }[] }[]>;
  };

  it("every session starts with the folder's state, from the project's own settings", () => {
    const cmds = settings.hooks.SessionStart.flatMap((g) => g.hooks.map((h) => h.command));
    expect(cmds.some((c) => c.includes("scripts/sync-main.mjs") && c.includes("--brief"))).toBe(true);
  });

  it("a commit is gated on both shells Claude Code can use", () => {
    const group = settings.hooks.PreToolUse.find((g) => g.hooks.some((h) => h.command.includes("sync-main.mjs") && h.command.includes("--gate")));
    expect(group, "the commit gate is gone from .claude/settings.json").toBeDefined();
    expect(group?.matcher).toBe("Bash|PowerShell");
  });

  it("the project's instructions tell every session to level the folder before it commits", () => {
    expect(readFileSync("CLAUDE.md", "utf8")).toContain("node scripts/sync-main.mjs --apply");
  });
});
