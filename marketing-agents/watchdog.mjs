// ── The watchdog loop: Finn, Bo, Vera and Dash, always on ───────────────────
//
// OWNER ORDER (2026-09-03): these four have NO schedules. They watch
// continuously while the office is open and their Active box is ticked. Menash
// decides when they stop; nothing in this file may decide it for him. There is
// no cadence here, no "next check-in", and nothing to configure — the Active
// toggle is the whole control surface.
//
// The loop this replaces was a half-hourly GitHub cron that woke agents inside
// a ±30-minute due window. GitHub's scheduler is best-effort and was actually
// firing every 2.5–5 hours, so narrow windows were missed outright: Vera did
// not run at all on 2026-09-03. Worse, the UI still said "on duty", so it
// looked like something was watching when nothing was.
//
// HOW IT STAYS FREE: each tick runs lib/detectors.mjs — plain HTTP probes, no
// model, no tokens. The expensive LLM agent is dispatched only when a detector
// reports a problem that isn't already open. Quiet weeks cost nothing.
//
// HOW IT STAYS ALIVE: a GitHub Actions job caps at 6 hours, so this runs for
// TICK_BUDGET_MIN and then exits 0; agent-watchdog.yml re-dispatches itself
// immediately, so coverage is continuous across job boundaries. Exiting is not
// stopping — only the owner's switches stop it, and then the loop exits on
// purpose and the workflow does NOT re-arm.

import { readFileSync } from "node:fs";
import { sb, say } from "./lib/agentkit.mjs";
import { DETECTORS, blindnessFindings } from "./lib/detectors.mjs";
import { SERVICING_INTERVAL_MIN, FIXER_ELIGIBLE, FINDING_ITEM_TYPE } from "./lib/detectors-servicing.mjs";
import { isDue } from "./lib/schedule.mjs";
import { pollMediaPool } from "./lib/media-pool.mjs";
import { radarTick } from "./lib/radar.mjs";

const config = JSON.parse(readFileSync(new URL("./config.json", import.meta.url), "utf8"));
const TICK_SEC = Number(process.env.WATCHDOG_TICK_SEC || 60);
const BUDGET_MIN = Number(process.env.WATCHDOG_BUDGET_MIN || 330); // 5h30m; job cap is 6h
const REPO = process.env.GITHUB_REPOSITORY ?? "swiftcard/relationship-app";
const WATCHDOGS = Object.keys(DETECTORS).filter((id) => config.agents[id]?.continuous);

// The original four probe on every tick (a down site must be caught within a
// minute). The servicing bench watches populations — every card, every link,
// a dependency audit — so each runs at its own interval, always on the first
// tick after the loop wakes. Not a schedule: the owner's Active toggle is
// still the only control, and a paused watchdog is skipped regardless.
const INTERVAL_MS = Object.fromEntries(Object.entries(SERVICING_INTERVAL_MIN).map(([id, m]) => [id, m * 60 * 1000]));
const lastProbeAt = new Map();
const probeDue = (id) => Date.now() - (lastProbeAt.get(id) ?? 0) >= (INTERVAL_MS[id] ?? 0);

// Watchdogs with a heavier once-a-day pass in a real browser (their own
// workflow, agent-<id>.yml). The loop dispatches it when the last such run is
// older than DEEP_PASS_MS — persistent in agent_runs, so a loop restart cannot
// double-fire it.
const DEEP_PASS_MS = { layout: 24 * 60 * 60 * 1000 };


const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19);

/** Wake an agent's LLM workflow to investigate a finding it just detected
 *  (trigger "watchdog"), or to answer conversations the Radar found ("radar"). */
async function dispatchAgent(agentId, reason, trigger = "watchdog") {
  const wf = config.agents[agentId]?.workflow;
  if (!wf) return false;
  if (!process.env.GH_TOKEN) { console.log(`  ! GH_TOKEN missing — cannot wake ${agentId}`); return false; }
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${wf}/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json" },
    body: JSON.stringify({ ref: "main", inputs: { trigger } }),
  });
  console.log(`  → woke ${agentId} (${wf}) status ${res.status}: ${reason}`);
  return res.status === 204;
}

/**
 * Findings currently open for this agent, keyed by dedupe_key.
 * The queue IS the state store — no new table, so this needs no SQL from the
 * owner before it works.
 */
async function openFindings(agentId) {
  const rows = await sb("GET", "agent_queue_items", {
    params: `agent_id=eq.${agentId}&status=eq.pending&select=id,dedupe_key,title&limit=200`,
  });
  return new Map((rows ?? []).filter((r) => r.dedupe_key?.startsWith("watchdog:")).map((r) => [r.dedupe_key, r]));
}

async function recordFinding(agentId, f) {
  const itemType = FINDING_ITEM_TYPE[agentId] ?? "generic";
  const [row] = await sb("POST", "agent_queue_items", {
    body: [{
      agent_id: agentId,
      item_type: itemType,
      platform: "site",
      target: f.key,
      title: `${f.severity === "critical" ? "🔴" : "🟠"} ${f.title}`,
      content: f.detail,
      context: "Detected by the continuous watchdog loop (code-only probe, no tokens spent detecting it).",
      dedupe_key: `watchdog:${f.key}`,
      status: "pending",
    }],
    prefer: "return=representation",
  }) ?? [];
  return row?.id ?? null;
}

/**
 * A code-fixable finding (a dead page, a broken card route, a vulnerable
 * dependency) goes straight to Fixer, who opens a DRAFT pull request — never
 * a merge. Everything else (a chargeback, an expiring secret) is the owner's.
 */
async function handToFixer(agentId, itemId, f) {
  if (!FIXER_ELIGIBLE.has(agentId) || !itemId || !process.env.GH_TOKEN) return;
  if (f.key.startsWith("blind:")) return; // a missing credential is not a code bug
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/agent-fixer.yml/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json" },
    body: JSON.stringify({ ref: "main", inputs: { item_id: String(itemId) } }),
  }).catch(() => null);
  console.log(`  → Fixer asked to draft a PR for item ${itemId} (status ${res?.status ?? "n/a"})`);
}

async function resolveFinding(item) {
  await sb("PATCH", "agent_queue_items", {
    params: `id=eq.${item.id}`,
    body: { status: "acknowledged" },
  });
}

async function tick() {
  // The owner's switches, read fresh every tick — so Pause All or unticking
  // Active takes effect within one tick, not at some next scheduled boundary.
  const sys = (await sb("GET", "agent_system", { params: "limit=1" }))[0];
  if (!sys) { console.log("agent_system row missing — standing down."); return "stop"; }
  // Housekeeping runs even with the office closed: the chat answers while
  // paused (a direct run skips the gates), so a stuck turn still needs its
  // retry, and a dead run still needs closing. The hourly backstop is enough.
  await sweepChatOrders().catch((e) => console.log(`${stamp()} chat sweep error: ${String(e?.message ?? e).slice(0, 160)}`));
  await sweepStaleRuns().catch((e) => console.log(`${stamp()} stale-run sweep error: ${String(e?.message ?? e).slice(0, 160)}`));
  if (sys.paused) { console.log(`${stamp()} office closed (Pause All) — watchdogs standing down.`); return "stop"; }
  if (sys.auto_pause_at && new Date(sys.auto_pause_at).getTime() <= Date.now()) {
    console.log(`${stamp()} auto-stop reached — watchdogs standing down.`); return "stop";
  }

  const rows = await sb("GET", "agent_settings", {
    params: `agent_id=in.(${WATCHDOGS.join(",")})&select=agent_id,enabled,paused`,
  });
  const onDuty = (rows ?? []).filter((r) => r.enabled && !r.paused).map((r) => r.agent_id);
  if (!onDuty.length) { console.log(`${stamp()} no watchdog is Active — standing down.`); return "stop"; }

  for (const agentId of onDuty) {
    if (!probeDue(agentId)) continue;
    lastProbeAt.set(agentId, Date.now());
    // Open findings go in first so a population detector re-checks what it
    // already reported, and only closes it when the thing is actually fixed.
    const open = await openFindings(agentId);
    let findings;
    try {
      // Blindness first: a watchdog missing the credential its eyes need must
      // report THAT, rather than an all-clear it cannot actually vouch for.
      findings = [...(await blindnessFindings(agentId)), ...(await DETECTORS[agentId]({ openKeys: [...open.keys()] }))];
    } catch (e) {
      console.log(`${stamp()} ${agentId} probe threw: ${String(e?.message ?? e).slice(0, 200)}`);
      continue;
    }
    const seen = new Set();
    const newFindings = [];

    for (const f of findings) {
      const key = `watchdog:${f.key}`;
      seen.add(key);
      if (open.has(key)) continue; // already reported and still open — say nothing
      console.log(`${stamp()} ${agentId} NEW ${f.severity}: ${f.title}`);
      const itemId = await recordFinding(agentId, f);
      // Tell the owner's comms log immediately.
      await say(agentId, "owner", `${f.severity === "critical" ? "🔴" : "🟠"} ${f.title} — ${f.detail.slice(0, 300)}`, { kind: "owner_out" }).catch(() => {});
      newFindings.push(f);
      await handToFixer(agentId, itemId, f);
    }

    // ONE wake per cycle, not one per finding.
    //
    // This used to sit inside the loop above, so a probe that turned up N new
    // problems dispatched the agent's workflow N times — and because that
    // workflow does a FULL pass and files a written report every time, the
    // owner got N identical "Card health: N problem(s)" items seconds apart.
    // Cara found 2 problems on 2026-09-09 and filed the same report twice;
    // Lyn did the same thing earlier that day. The findings themselves were
    // never duplicated (they carry dedupe keys) — only the report was.
    if (newFindings.length) {
      await dispatchAgent(agentId, newFindings.length === 1 ? newFindings[0].title : `${newFindings.length} new findings`);
    }

    // Anything previously open that no longer trips is fixed. Close it so the
    // queue stays an accurate picture of what is wrong RIGHT NOW.
    for (const [key, item] of open) {
      if (seen.has(key)) continue;
      console.log(`${stamp()} ${agentId} recovered: ${item.title}`);
      await resolveFinding(item);
      await say(agentId, "owner", `✅ Recovered — ${item.title.replace(/^[🔴🟠]\s*/, "")} is back to normal.`, { kind: "owner_out" }).catch(() => {});
    }
  }

  await dispatchScheduled();
  await dispatchDeepPasses(onDuty);

  // Resolve submitted creative jobs into the shared pool. Nothing else in the
  // system has a reliable clock, and a generation job that is never polled is
  // an asset that never exists — that is why Milo's videos went nowhere.
  const media = await pollMediaPool().catch(() => null);
  if (media && (media.ready || media.failed)) {
    console.log(`${stamp()} media pool: ${media.ready} ready, ${media.failed} failed, ${media.stillPending} pending`);
  }

  // The Radar (owner order 2026-09-30): scan Reddit, Telegram, Hacker News,
  // the news feeds and the rest for conversations about us, our topic and
  // our competitors — code only, on its own interval inside this loop — and
  // wake the agent whose thread it is. Like the detectors: nothing is spent
  // listening; the model runs only when there is something real to answer.
  await radarTick({ dispatch: dispatchAgent }).catch((e) => console.log(`${stamp()} radar error: ${String(e?.message ?? e).slice(0, 200)}`));
  return "continue";
}

/** Once-a-day browser pass for watchdogs that have one (Pix renders every page). */
async function dispatchDeepPasses(onDuty) {
  for (const [agentId, everyMs] of Object.entries(DEEP_PASS_MS)) {
    if (!onDuty.includes(agentId)) continue;
    const runs = await sb("GET", "agent_runs", {
      params: `agent_id=eq.${agentId}&select=started_at&order=started_at.desc&limit=1`,
    }).catch(() => null);
    const last = runs?.[0]?.started_at ? new Date(runs[0].started_at).getTime() : 0;
    if (Date.now() - last < everyMs) continue;
    await dispatchAgent(agentId, "deep pass in a real browser");
  }
}

/**
 * The reliable clock for everyone who ISN'T a watchdog.
 *
 * agent-scheduler.yml is a GitHub cron set to every 30 minutes that actually
 * fires every 2.5–5 hours, and its ±30-minute due windows meant a late tick
 * skipped the run entirely rather than running it late. That is how Vera lost a
 * whole day, and it would have eaten Atlas's reports too.
 *
 * This loop is already awake every 60 seconds, so it is a far better clock. It
 * asks "is it past due and has this agent not run since?", which turns a late
 * dispatcher into a late run instead of a missing one. The old cron stays as a
 * backstop and shares this same logic, so the two can never double-fire.
 */
async function dispatchScheduled() {
  const rows = await sb("GET", "agent_settings", {
    params: "enabled=is.true&paused=is.false&select=agent_id,schedule",
  });
  for (const r of rows ?? []) {
    if (config.agents[r.agent_id]?.continuous) continue; // watchdogs have no clock
    const schedule = r.schedule || config.agents[r.agent_id]?.default_schedule;
    if (!schedule) continue;

    // A chat turn is not a shift — it must not push the next scheduled run out.
    const runs = await sb("GET", "agent_runs", {
      params: `agent_id=eq.${r.agent_id}&trigger=neq.chat&select=started_at&order=started_at.desc&limit=1`,
    });
    const lastRunAt = runs?.[0]?.started_at ?? null;
    if (!isDue(schedule, lastRunAt, new Date())) continue;

    console.log(`${stamp()} ${r.agent_id} is due (${schedule}, last run ${lastRunAt ?? "never"})`);
    await dispatchAgent(r.agent_id, `scheduled: ${schedule}`);
  }
}

/**
 * The company chat's safety net. The chat API wakes each @-mentioned agent
 * the moment the owner sends; if that dispatch failed (GitHub hiccup, token
 * missing at the time) the order sits 'waiting'. Every tick, anything waiting
 * more than 3 minutes is re-dispatched, and a turn stuck 'working' for 25
 * minutes (a dead run) is retried the same way. After an hour it is marked
 * failed and the room is told, so a silence is never mistaken for an answer.
 */
/**
 * A run row is written "running" at start and "success/failed" by the runner
 * at the end. A worker that GitHub cancels or times out never writes the end,
 * so the row stays "running" forever — the tab shows the agent as working,
 * the scheduler thinks it ran, and the next due shift is skipped. Every run
 * has a hard 25-minute CLI timeout, so anything still "running" after 45
 * minutes is dead: close it as failed and say why. (Zoe's 2026-09-02 shift sat
 * "running" for six days.)
 */
async function sweepStaleRuns() {
  const cutoff = new Date(Date.now() - 45 * 60_000).toISOString();
  const rows = await sb("GET", "agent_runs", { params: `status=eq.running&started_at=lt.${cutoff}&select=id,agent_id,started_at&limit=40` });
  for (const r of rows ?? []) {
    await sb("PATCH", "agent_runs", { params: `id=eq.${r.id}&status=eq.running`, body: {
      status: "failed", finished_at: new Date().toISOString(),
      error: "The run never finished — the worker was cancelled or timed out before it could report back. Closed by the watchdog.",
    } });
    console.log(`${stamp()} closed stale run ${r.id} (${r.agent_id}, started ${r.started_at})`);
  }
}

const CHAT_WORKFLOW = "agent-chat.yml";
async function sweepChatOrders() {
  const now = Date.now();
  const rows = await sb("GET", "agent_chat_orders", {
    params: `status=in.(waiting,working)&select=id,message_id,responder,status,created_at,updated_at&order=created_at.asc&limit=40`,
  }).catch(() => null);
  if (!rows?.length) return;
  const retryAfterMs = { waiting: 3 * 60_000, working: 25 * 60_000 };
  const byResponder = new Map();
  for (const o of rows) {
    const ageMs = now - new Date(o.created_at).getTime();
    const idleMs = now - new Date(o.updated_at ?? o.created_at).getTime();
    if (ageMs > 60 * 60_000) {
      await sb("PATCH", "agent_chat_orders", { params: `id=eq.${o.id}`, body: { status: "failed", error: "no turn started within an hour", updated_at: new Date().toISOString() } }).catch(() => {});
      await sb("POST", "agent_chat", { body: { from_id: "atlas", kind: "system", body: `⚠ ${o.responder} never answered — the turn could not be started within an hour. Send the message again or check GITHUB_AGENTS_TOKEN.`, reply_to: o.message_id } }).catch(() => {});
      continue;
    }
    if (idleMs < retryAfterMs[o.status]) continue;
    if (!byResponder.has(o.responder)) byResponder.set(o.responder, []);
    byResponder.get(o.responder).push(o.id);
  }
  for (const [responder, ids] of byResponder) {
    if (!process.env.GH_TOKEN) { console.log(`  ! GH_TOKEN missing — cannot re-wake ${responder}'s chat turn`); return; }
    const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${CHAT_WORKFLOW}/dispatches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json" },
      body: JSON.stringify({ ref: "main", inputs: { agent: responder, trigger: "chat" } }),
    }).catch(() => null);
    console.log(`${stamp()} chat: re-woke ${responder} for ${ids.length} order(s) → ${res?.status ?? "network"}`);
    // Stamp the attempt so the next tick does not fire again immediately.
    await sb("PATCH", "agent_chat_orders", { params: `id=in.(${ids.join(",")})`, body: { updated_at: new Date().toISOString() } }).catch(() => {});
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
if (!WATCHDOGS.length) { console.log("No continuous watchdogs configured."); process.exit(0); }
console.log(`Watchdog loop up: ${WATCHDOGS.join(", ")} — probing every ${TICK_SEC}s for up to ${BUDGET_MIN}m.`);

const until = Date.now() + BUDGET_MIN * 60 * 1000;
let ticks = 0;
let verdict = "continue";
while (Date.now() < until) {
  try {
    verdict = await tick();
  } catch (e) {
    // A Supabase hiccup must not kill the watch. Log, wait, keep going.
    console.log(`${stamp()} tick error: ${String(e?.message ?? e).slice(0, 200)}`);
  }
  if (verdict === "stop") break;
  ticks++;
  await sleep(TICK_SEC * 1000);
}
console.log(`Loop ending after ${ticks} tick(s): ${verdict === "stop" ? "owner stood the watch down — NOT re-arming." : "time budget reached — re-arming."}`);
// The workflow reads this to decide whether to re-dispatch itself.
console.log(`WATCHDOG_REARM=${verdict === "stop" ? "no" : "yes"}`);
process.exit(0);
