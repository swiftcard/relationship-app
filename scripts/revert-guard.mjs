#!/usr/bin/env node
// ── Refuse a commit that quietly puts an older version of a file back ────────
//
// WHY THIS EXISTS: fixes keep coming undone, and the cause that can be seen in
// the history is not a fix being wrong; it is a later commit that was built on
// an out-of-date copy of a file and so reinstated the old one. On 2026-10-20
// 087c4cc3 ("No pop-up on the site can be covered any more...", 47 files) put
// six files back to what they were before 4c528009 and 812eb61d, undoing the
// push catch-up, reminders and VAPID fixes. Nothing failed: types, lint and the
// tests all still passed, because the older version was itself valid code.
// df500b20 restored them only because someone happened to notice.
//
// WHAT IT CATCHES: a commit whose version of a file is, byte for byte, a
// version that file had BEFORE its most recent change(s). That has two innocent
// explanations only: the commit is a deliberate revert (say so in the message),
// or its author's copy was stale (this is the accident). A genuine edit never
// reproduces an older version exactly.
//
// WHAT IT CANNOT CATCH: a stale copy that ALSO carries new edits of its own is a
// new version, not an old one. scripts/sync-main.mjs is the guard for that: it
// stops anyone building a commit while behind origin/main.
//
//   node scripts/revert-guard.mjs --staged [--message-file F]
//                                     commit-msg hook: the commit being made
//   node scripts/revert-guard.mjs --pushed
//                                     pre-push hook: the commits git is about to push
//                                     (reads git's ref lines on stdin)
//   node scripts/revert-guard.mjs --unpushed
//                                     by hand: every commit not on origin/main
//   node scripts/revert-guard.mjs --range A..B
//   node scripts/revert-guard.mjs --ci   CI: RANGE_FROM..RANGE_TO from the environment
//   node scripts/revert-guard.mjs --history 300
//                                     audit: list every such commit, exit 0
//
// Say it is deliberate with the word revert / restore / undo / roll back / back
// out / re-land in the message, or a line "Revert-ok: <why>". Exit 1 = refused.
// An internal failure (no git, odd history) PASSES with a warning: a safety net
// must never be the reason work stops.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DELIBERATE = /\b(?:revert(?:s|ed|ing)?|restor(?:e|es|ed|ing)|undo(?:es|ing)?|undid|roll(?:s|ed|ing)?[ -]?back|back(?:s|ed|ing)? out|re-?land(?:s|ed|ing)?)\b|^Revert-ok:/im;
const NULL_BLOB = /^0+$/;
const DEPTH = 8;        // how many of a file's latest changes one commit may be undoing
const LOOKBACK = 400;   // commits of history read per commit judged
// Files whose content legitimately returns to an earlier state, or is not code.
const SKIP = [/(^|\/)package-lock\.json$/, /\.lock$/, /(^|\/)audit-results\//];

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

let root;
try {
  root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
} catch {
  process.exit(0);
}
const git = (a) => execFileSync("git", ["-c", "core.quotepath=off", ...a], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 });
const tryGit = (a) => { try { return git(a); } catch { return null; } };

/** `git diff --raw -z` into [{ path, oldBlob, newBlob }], modifications only. */
function modified(out) {
  const t = out.split("\0").filter(Boolean);
  const rows = [];
  for (let i = 0; i < t.length; i += 2) {
    const m = /^:\d+ \d+ ([0-9a-f]+) ([0-9a-f]+) (\w)$/.exec(t[i]);
    if (!m || m[3] !== "M" || SKIP.some((re) => re.test(t[i + 1]))) continue;
    rows.push({ path: t[i + 1], oldBlob: m[1], newBlob: m[2] });
  }
  return rows;
}

/** For each path: its latest changes at `tip`, newest first, with the blob before and after each. */
function recentChanges(tip, paths) {
  const byPath = new Map();
  for (let i = 0; i < paths.length; i += 60) {
    const out = git(["log", "--no-merges", `-n${LOOKBACK}`, "--raw", "--no-abbrev", "--no-renames", "--format=%x01%H%x02%s", tip, "--", ...paths.slice(i, i + 60)]);
    let cur = null;
    for (const line of out.split("\n")) {
      if (line[0] === "\x01") { const [sha, subject] = line.slice(1).split("\x02"); cur = { sha, subject }; continue; }
      const m = /^:\d+ \d+ ([0-9a-f]+) ([0-9a-f]+) (\w)\t(.+)$/.exec(line);
      if (!m || !cur) continue;
      const list = byPath.get(m[4]) ?? [];
      if (list.length < DEPTH) list.push({ ...cur, oldBlob: m[1], newBlob: m[2] });
      byPath.set(m[4], list);
    }
  }
  return byPath;
}

/** The latest changes (newest first) a new version of a file puts back, or null. */
function undoneBy(chain, newBlob) {
  if (NULL_BLOB.test(newBlob)) return null;
  const k = chain.findIndex((e) => e.oldBlob === newBlob);
  return k >= 0 ? chain.slice(0, k + 1) : null;
}

/** Files whose new version equals one they had before their latest change(s). */
function reinstated(parent, changed) {
  const history = recentChanges(parent, changed.map((c) => c.path));
  const hits = [];
  for (const c of changed) {
    const undone = undoneBy(history.get(c.path) ?? [], c.newBlob);
    if (undone) hits.push({ path: c.path, undone });
  }
  return hits;
}

/** The same judgement for a whole stretch of history in ONE pass (audits; the per-commit path above is for hooks). */
function auditHistory(count) {
  const out = git(["log", "--reverse", "--no-merges", `-n${count}`, "--raw", "--no-abbrev", "--no-renames", "--format=%x01%H%x02%B%x03"]);
  const chains = new Map();
  const findings = [];
  for (const block of out.split("\x01").slice(1)) {
    const sha = block.slice(0, block.indexOf("\x02"));
    const message = block.slice(block.indexOf("\x02") + 1, block.indexOf("\x03"));
    const rows = [];
    for (const line of block.slice(block.indexOf("\x03")).split("\n")) {
      const m = /^:\d+ \d+ ([0-9a-f]+) ([0-9a-f]+) (\w)\t(.+)$/.exec(line);
      if (m) rows.push({ oldBlob: m[1], newBlob: m[2], status: m[3], path: m[4] });
    }
    const hits = [];
    for (const r of rows) {
      if (r.status !== "M" || SKIP.some((re) => re.test(r.path))) continue;
      const undone = undoneBy(chains.get(r.path) ?? [], r.newBlob);
      if (undone) hits.push({ path: r.path, undone });
    }
    if (hits.length) findings.push({ id: sha.slice(0, 8), subject: message.split("\n")[0], hits, excused: DELIBERATE.test(message) });
    const subject = message.split("\n")[0];
    for (const r of rows) {
      if (r.status === "D") { chains.delete(r.path); continue; }
      const chain = chains.get(r.path) ?? [];
      chain.unshift({ sha, subject, oldBlob: r.oldBlob, newBlob: r.newBlob });
      chains.set(r.path, chain.slice(0, DEPTH));
    }
  }
  return findings;
}

function judgeCommit(sha) {
  const parents = git(["rev-list", "--parents", "-n1", sha]).trim().split(" ").slice(1);
  if (parents.length !== 1) return null; // root or merge: nothing to compare against
  const changed = modified(git(["diff-tree", "-r", "--no-renames", "--raw", "--no-abbrev", "-z", parents[0], sha]));
  const hits = reinstated(parents[0], changed);
  if (!hits.length) return null;
  const message = git(["log", "-1", "--format=%B", sha]);
  return { id: sha.slice(0, 8), subject: message.split("\n")[0], hits, excused: DELIBERATE.test(message) };
}

function judgeStaged() {
  if (!tryGit(["rev-parse", "--verify", "-q", "HEAD"])) return null;
  if (existsSync(join(git(["rev-parse", "--absolute-git-dir"]).trim(), "MERGE_HEAD"))) return null; // a merge commit
  const changed = modified(git(["diff", "--cached", "--no-renames", "--raw", "--no-abbrev", "-z"]));
  const hits = reinstated("HEAD", changed);
  if (!hits.length) return null;
  const file = value("--message-file");
  const message = file && existsSync(file) ? readFileSync(file, "utf8").replace(/^#.*$/gm, "") : "";
  return { id: "this commit", subject: message.split("\n")[0].trim(), hits, excused: DELIBERATE.test(message) };
}

function report(findings) {
  for (const f of findings) {
    console.error(`  ${f.id}${f.subject ? `  "${f.subject.slice(0, 90)}"` : ""}${f.excused ? "  (says it is deliberate)" : ""}`);
    for (const h of f.hits.slice(0, 10)) {
      const what = h.undone.map((u) => `${u.sha.slice(0, 8)} "${u.subject.slice(0, 60)}"`).join(", ");
      console.error(`    ${h.path}  <- puts back the version from before ${what}`);
    }
    if (f.hits.length > 10) console.error(`    ... and ${f.hits.length - 10} more files`);
  }
}

function main() {
  let shas = [];
  let findings = [];
  if (flag("--history")) {
    findings = auditHistory(Number(value("--history")) || 300);
  } else if (flag("--staged")) {
    const f = judgeStaged();
    findings = f ? [f] : [];
  } else {
    if (flag("--pushed")) {
      // Git's pre-push lines: "<local ref> <local sha> <remote ref> <remote sha>".
      // These are the commits that really leave the machine, which is NOT always
      // origin/main..HEAD: a commit built with plumbing and pushed by sha
      // (`git push origin <sha>:main`) is not HEAD.
      let input = "";
      if (!process.stdin.isTTY) { try { input = readFileSync(0, "utf8"); } catch { /* no stdin */ } }
      const seen = new Set();
      for (const line of input.split("\n")) {
        const [, local, , remote] = line.trim().split(/\s+/);
        if (!local || NULL_BLOB.test(local)) continue; // deleting a branch pushes no commits
        const range = !remote || NULL_BLOB.test(remote) ? [local, "--not", "--remotes"] : [`${remote}..${local}`];
        const out = tryGit(["rev-list", "--reverse", ...range]);
        if (out === null) { console.error(`revert-guard: could not read ${range.join(" ")}; skipped.`); continue; }
        for (const sha of out.split("\n").filter(Boolean)) seen.add(sha);
      }
      shas = [...seen];
    } else if (flag("--unpushed")) {
      if (!tryGit(["rev-parse", "--verify", "-q", "origin/main"])) { console.error("revert-guard: no origin/main to compare with; skipped."); return 0; }
      shas = git(["rev-list", "--reverse", "origin/main..HEAD"]).split("\n").filter(Boolean);
    } else {
      const range = flag("--ci")
        ? (process.env.RANGE_FROM && !NULL_BLOB.test(process.env.RANGE_FROM) && process.env.RANGE_TO ? `${process.env.RANGE_FROM}..${process.env.RANGE_TO}` : "")
        : value("--range");
      if (!range) { console.error("revert-guard: no range to check (first push, or none given); skipped."); return 0; }
      const out = tryGit(["rev-list", "--reverse", range]);
      if (out === null) { console.error(`revert-guard: could not read ${range} (shallow clone or rewritten history); skipped.`); return 0; }
      shas = out.split("\n").filter(Boolean);
    }
    findings = shas.map(judgeCommit).filter(Boolean);
  }

  if (flag("--history")) {
    if (!findings.length) console.log("revert-guard: no commit in that history reinstates an older version of a file.");
    else { console.log(`revert-guard: ${findings.length} commit(s) reinstate older file versions:`); report(findings); }
    return 0;
  }

  const refused = findings.filter((f) => !f.excused);
  if (!refused.length) return 0;
  console.error("revert-guard: refused. This puts an OLDER version of a file back over a newer one:");
  report(refused);
  console.error([
    "",
    "  Almost always this means the copy you built the commit from was out of date, so",
    "  it silently undoes work that is already live (this is how 087c4cc3 undid the",
    "  push fixes on 2026-10-20). Nothing else would have caught it: the old code is valid.",
    "",
    "  Not deliberate:  node scripts/sync-main.mjs --apply   then re-apply only YOUR changes",
    "                   on top of the current files and commit again.",
    "  Deliberate:      say so in the message (the word revert, restore, undo, roll back or",
    "                   back out), or add a line   Revert-ok: <why>",
  ].join("\n"));
  return 1;
}

try {
  process.exit(main());
} catch (e) {
  console.error(`revert-guard: could not run (${String(e.message).split("\n")[0]}); not checked.`);
  process.exit(0);
}
