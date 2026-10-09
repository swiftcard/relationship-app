#!/usr/bin/env node
// ── Wait until production is actually serving a deploy ───────────────────────
//
// Vercel Deployment Checks hold every production build until CI's `verify` and
// `render` jobs pass, and only then put it on swiftcard.me (owner, 2026-10-09:
// "once we set it in place it's set. It doesn't move."). GitHub hears
// "deployment success" when the build is READY — before that hold — so a
// workflow that reacts to deployment_status and then tests https://swiftcard.me
// would be testing the build that is still live, not the one that deployed,
// and could close an issue over code nobody has seen yet.
//
// This waits for /api/health to report the deploy's commit, then tells the
// workflow whether to go on (GITHUB_OUTPUT `live`):
//
//   live=true   production serves DEPLOY_SHA — or there is no SHA to wait for
//               (a scheduled or manual run tests whatever is live)
//   live=false  superseded: a newer commit that already contains this one went
//               live first, and its own run tests it; or it was not live within
//               WAIT_MINUTES, i.e. a Deployment Check failed and held it
//
// A held or superseded deploy is the gate working, not a broken guard, so this
// never exits non-zero for one.
//
//   BASE=https://swiftcard.me DEPLOY_SHA=<sha> node scripts/wait-for-live.mjs

import { appendFileSync } from "node:fs";

const BASE = (process.env.BASE || process.env.HEALTH_BASE_URL || "https://swiftcard.me").replace(/\/$/, "");
const SHA = (process.env.DEPLOY_SHA || "").trim().toLowerCase();
const WAIT_MINUTES = Number(process.env.WAIT_MINUTES || 45);
const POLL_SECONDS = Number(process.env.POLL_SECONDS || 20);
const REPO = process.env.GITHUB_REPOSITORY || "";
const TOKEN = process.env.GITHUB_TOKEN || "";

function finish(live, reason) {
  console.log(`live=${live}: ${reason}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `live=${live}\n`);
  process.exit(0);
}

/** The commit production is serving, or null when it can't be read (a build
 *  from before /api/health reported one, or a blip). */
async function liveSha() {
  try {
    const res = await fetch(`${BASE}/api/health?t=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const body = await res.json();
    return typeof body?.sha === "string" && body.sha ? body.sha.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** True when `newer` already contains `older` and more (GitHub compare). */
async function supersedes(newer, older) {
  if (!REPO) return false;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/compare/${older}...${newer}`, {
      headers: { accept: "application/vnd.github+json", ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return false;
    return (await res.json())?.status === "ahead";
  } catch {
    return false;
  }
}

if (!SHA) finish(true, "no deploy commit to wait for; testing whatever is live");

const deadline = Date.now() + WAIT_MINUTES * 60_000;
let lastSeen;
let compared = "";
for (;;) {
  const live = await liveSha();
  if (live && live.startsWith(SHA)) finish(true, `${BASE} is serving ${SHA.slice(0, 7)}`);
  if (live && live !== compared) {
    compared = live;
    if (await supersedes(live, SHA)) {
      finish(false, `superseded: ${BASE} already serves ${live.slice(0, 7)}, which includes ${SHA.slice(0, 7)}`);
    }
  }
  if (live !== lastSeen) {
    console.log(`waiting: ${BASE} serves ${live ? live.slice(0, 7) : "(no commit reported)"}, not ${SHA.slice(0, 7)} yet`);
    lastSeen = live;
  }
  if (Date.now() > deadline) {
    finish(false, `${SHA.slice(0, 7)} not live after ${WAIT_MINUTES} min; a Deployment Check held it (see the CI run for this commit)`);
  }
  await new Promise((r) => setTimeout(r, POLL_SECONDS * 1000));
}
