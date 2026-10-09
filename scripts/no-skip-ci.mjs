#!/usr/bin/env node
// ── Refuse a push that would switch CI off ───────────────────────────────────
//
// GitHub skips every push workflow when a commit message carries a skip-CI tag
// ([skip ci], [ci skip], [no ci], [skip actions], [actions skip], or a
// "skip-checks: true" trailer). Vercel's Deployment Checks then wait for
// `verify` and `render` results that never come: the push is built but never
// goes live, and nothing anywhere turns red. On 2026-10-09 that happened to the
// very commit that documented the rule, because its message quoted the tag.
//
// Run by .githooks/pre-push, which hands it Git's pre-push lines on stdin:
//   <local ref> <local sha> <remote ref> <remote sha>
// Exits 1, naming the commit, if any commit being pushed carries a tag.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const SKIP_CI = /\[(skip ci|ci skip|no ci|skip actions|actions skip)\]|^skip-checks: *true$/im;
const ZERO = /^0+$/;

let input = "";
try { input = readFileSync(0, "utf8"); } catch { /* no stdin: nothing to check */ }

for (const line of input.split("\n")) {
  const [, localSha, , remoteSha] = line.trim().split(/\s+/);
  if (!localSha || ZERO.test(localSha)) continue; // deleting a branch
  // A new branch: every commit not already on a remote.
  const range = !remoteSha || ZERO.test(remoteSha) ? [localSha, "--not", "--remotes"] : [`${remoteSha}..${localSha}`];
  const log = execFileSync("git", ["log", "--format=%h %s%n%b%x00", ...range], { encoding: "utf8" });
  for (const entry of log.split("\0")) {
    if (!SKIP_CI.test(entry)) continue;
    const first = entry.trim().split("\n")[0];
    console.error(`pre-push: refused. This commit's message carries a skip-CI tag:\n  ${first}`);
    console.error("  GitHub would skip CI, and Vercel holds every deploy until CI passes,");
    console.error("  so this push would never go live. Reword the message (git commit --amend");
    console.error("  for the last commit) so it doesn't quote the tag, then push again.");
    process.exit(1);
  }
}
