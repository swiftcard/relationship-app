#!/usr/bin/env node
// ── Keep this folder level with what is live ─────────────────────────────────
//
// WHY THIS EXISTS: on 2026-10-20 a commit (087c4cc3) was built on a copy of the
// code taken before two other fixes landed, so it quietly put six files back to
// their old versions and undid the push-notification fixes. The same morning
// this folder was 20 commits behind origin/main, and 38 of its 41 "modified"
// files plus 13 "new" files were byte-for-byte what origin already had: stale
// copies of work that had shipped from somewhere else. A commit made from that
// state undoes live fixes without anyone noticing.
//
//   node scripts/sync-main.mjs            report: how far behind, what is stale
//   node scripts/sync-main.mjs --apply    drop stale copies, then fast-forward
//   node scripts/sync-main.mjs --brief    one short paragraph (session start)
//   node scripts/sync-main.mjs --gate     refuse a `git commit` while behind
//                                         (Claude Code PreToolUse hook; reads
//                                         the tool call as JSON on stdin)
//
// --apply is lossless by construction: it only removes files whose content is
// IDENTICAL (line endings aside) to origin/main's version, so the fast-forward
// brings back exactly what was removed. Anything else — your real in-progress
// work, or a file that differs from origin — is never touched, only listed.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

const mode = process.argv.includes("--apply") ? "apply"
  : process.argv.includes("--gate") ? "gate"
  : process.argv.includes("--brief") ? "brief"
  : "report";

// A tool call that is not a commit is none of the gate's business. `commit-tree`
// is deliberately NOT one: building a commit on top of origin/main with plumbing
// is the sanctioned way out when the folder cannot be levelled, and
// revert-guard judges that commit at push time and in CI instead.
const COMMIT = /\bgit\s+(?:-[cC]\s+\S+\s+|--\S+\s+)*commit(?![\w-])/;

let root;
try {
  root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
} catch {
  process.exit(0); // not a git checkout (a tarball build): nothing to keep level
}

const run = (args, opts = {}) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"], timeout: 60_000, ...opts });
const tryRun = (args, opts) => { try { return run(args, opts); } catch { return null; } };

if (mode === "gate") {
  let call = "";
  try {
    const input = JSON.parse(readFileSync(0, "utf8") || "{}");
    call = String(input?.tool_input?.command ?? "");
  } catch { /* no JSON on stdin: nothing to judge */ }
  if (!COMMIT.test(call)) process.exit(0);
  if (process.env.SWIFTCARD_SYNC_GATE === "off") process.exit(0);
}

// ── Where are we against origin/main? ────────────────────────────────────────
const branch = (tryRun(["rev-parse", "--abbrev-ref", "HEAD"]) ?? "").trim();
if (branch !== "main") {
  if (mode !== "gate" && mode !== "brief") console.log(`sync-main: on "${branch || "a detached HEAD"}", not main. Nothing to level.`);
  process.exit(0);
}
if (tryRun(["fetch", "--quiet", "--no-tags", "origin", "main"], { timeout: 20_000 }) === null) {
  // Offline, or origin unreachable. A guard must never be the reason work stops.
  if (mode !== "gate" && mode !== "brief") console.log("sync-main: could not reach origin; not comparing.");
  process.exit(mode === "report" || mode === "apply" ? 2 : 0);
}
const count = (range) => Number((tryRun(["rev-list", "--count", range]) ?? "0").trim());
const behind = count("HEAD..origin/main");
const ahead = count("origin/main..HEAD");
const head = (tryRun(["rev-parse", "--short", "HEAD"]) ?? "").trim();

if (mode === "gate") {
  if (behind === 0) process.exit(0);
  console.error([
    `BLOCKED: this folder is ${behind} commit${behind === 1 ? "" : "s"} behind origin/main.`,
    "A commit made now is built on an old copy of the code and can silently put back",
    "older versions of files that are already live. (That is exactly how 087c4cc3 undid",
    "the push-notification fixes on 2026-10-20.)",
    "",
    "Run:  node scripts/sync-main.mjs --apply",
    "Then look at `git status`, re-apply only your own changes if the sync touched",
    "them, and commit again.",
    "",
    "If the sync cannot finish (files that differ from origin's), build the commit on",
    "top of origin/main with `git commit-tree` instead (that is not gated); the push",
    "hook and CI still check it for an older file version put back.",
  ].join("\n"));
  process.exit(2);
}

// ── What is dirty, and is it stale? ──────────────────────────────────────────
const normalize = (buf) => buf.toString("latin1").replace(/\r\n/g, "\n");
const onOrigin = (path) => tryRun(["cat-file", "-e", `origin/main:${path}`]) !== null;
const originBlob = (path) => {
  try { return execFileSync("git", ["cat-file", "blob", `origin/main:${path}`], { cwd: root, maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; }
};
const sameAsOrigin = (path) => {
  const theirs = originBlob(path);
  if (!theirs || !existsSync(join(root, path))) return false;
  const mine = readFileSync(join(root, path));
  return mine.equals(theirs) || normalize(mine) === normalize(theirs);
};
const originChanged = (path) => tryRun(["diff", "--quiet", "HEAD", "origin/main", "--", path]) === null;

const tokens = (run(["status", "--porcelain=v1", "-z", "--untracked-files=all"]) ?? "").split("\0").filter(Boolean);
const stale = [];     // identical to origin/main: safe to drop
const conflict = [];  // differs from origin/main AND origin changed it: needs a human
const yours = [];     // real work on a current base: left alone
for (let i = 0; i < tokens.length; i++) {
  const x = tokens[i][0], y = tokens[i][1], path = tokens[i].slice(3);
  if (x === "R" || x === "C") i++; // a rename carries its old name as the next token
  if (x === "?" ) {
    if (!onOrigin(path)) yours.push(path);
    else if (sameAsOrigin(path)) stale.push({ path, kind: "new" });
    else conflict.push(path);
  } else if (x !== " ") {
    yours.push(path); // staged: somebody is mid-commit; leave it
  } else if (y === "M") {
    if (sameAsOrigin(path)) stale.push({ path, kind: "modified" });
    else if (originChanged(path)) conflict.push(path);
    else yours.push(path);
  } else if (y === "D") {
    if (!onOrigin(path)) stale.push({ path, kind: "deleted" }); // origin deleted it too
    else yours.push(path);
  } else {
    yours.push(path);
  }
}

if (mode === "brief") {
  if (behind === 0 && stale.length === 0 && conflict.length === 0) {
    console.log(`SwiftCard sync: this folder is level with origin/main (${head}).`);
  } else {
    const lines = [`SwiftCard sync: this folder is ${behind} commit${behind === 1 ? "" : "s"} BEHIND origin/main (${ahead} ahead).`];
    if (stale.length) lines.push(`  ${stale.length} changed file${stale.length === 1 ? "" : "s"} here are already identical to origin/main: stale copies of work that has shipped.`);
    if (conflict.length) lines.push(`  ${conflict.length} file${conflict.length === 1 ? "" : "s"} differ from origin/main, which also changed ${conflict.length === 1 ? "it" : "them"}: ${conflict.slice(0, 4).join(", ")}${conflict.length > 4 ? ", ..." : ""}`);
    lines.push("  Run `node scripts/sync-main.mjs --apply` before editing or committing. A commit built on this old base undoes live fixes without any error.");
    console.log(lines.join("\n"));
  }
  process.exit(0);
}

console.log(`sync-main: HEAD ${head} is ${behind} commit${behind === 1 ? "" : "s"} behind and ${ahead} ahead of origin/main.`);
const show = (title, list) => {
  if (!list.length) return;
  console.log(`  ${title} (${list.length}):`);
  for (const p of list.slice(0, 12)) console.log(`    ${typeof p === "string" ? p : p.path}`);
  if (list.length > 12) console.log(`    ... and ${list.length - 12} more`);
};

if (mode === "report") {
  show("identical to origin/main (stale copies, safe to drop)", stale);
  show("differ from origin/main, which changed them too (needs a look)", conflict);
  show("your own work on a current base (left alone)", yours);
  if (behind || stale.length || conflict.length) console.log("Run `node scripts/sync-main.mjs --apply` to drop the stale copies and fast-forward.");
  process.exit(behind || conflict.length ? 1 : 0);
}

// ── --apply ──────────────────────────────────────────────────────────────────
let dropped = 0;
const pruneEmptyDirs = (path) => {
  for (let dir = dirname(join(root, path)); dir.length > root.length; dir = dirname(dir)) {
    try { if (readdirSync(dir).length) return; rmdirSync(dir); } catch { return; }
  }
};
for (const { path, kind } of stale) {
  // Look again immediately before acting: a second session may have edited it
  // since the status above. Identical-to-origin is the only thing that makes
  // dropping safe, so it is re-proved per file, not assumed.
  if (kind === "deleted") {
    if (onOrigin(path)) continue;
    run(["restore", "--", path]); dropped++;
  } else if (!sameAsOrigin(path)) {
    continue;
  } else if (kind === "new") {
    unlinkSync(join(root, path)); pruneEmptyDirs(path); dropped++;
  } else {
    run(["restore", "--", path]); dropped++;
  }
}
console.log(`  dropped ${dropped} stale cop${dropped === 1 ? "y" : "ies"} (each identical to origin/main, so nothing is lost).`);
show("left alone: differs from origin/main, which changed it too", conflict);
show("left alone: your own work", yours);

if (behind === 0) { console.log("sync-main: already level with origin/main."); process.exit(conflict.length ? 1 : 0); }
if (conflict.length) {
  console.log("sync-main: not fast-forwarding, because those files would be overwritten.");
  console.log("  Look at each:  git diff origin/main -- <file>");
  console.log("  If it is an older version of what origin has, `git restore -- <file>` (or delete it if new), then run this again.");
  process.exit(1);
}
try {
  const out = run(["merge", "--ff-only", "origin/main"]);
  console.log(out.trim().split("\n").slice(-3).join("\n"));
  console.log(`sync-main: level with origin/main (${(tryRun(["rev-parse", "--short", "HEAD"]) ?? "").trim()}).`);
} catch (e) {
  console.log(`sync-main: fast-forward refused:\n${String(e.stderr || e.message).trim()}`);
  process.exit(1);
}
