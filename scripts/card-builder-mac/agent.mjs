#!/usr/bin/env node
// ── Card Builder's Mac agent (owner, 2026-11-16) ─────────────────────────────
// Runs on the owner's Mac, all the time (launchd: install.sh), and does the
// three things that have to happen on that Mac:
//
//   1. BATCHES. "New batch" in the admin makes a requested batch. This picks
//      it up (now, or at 11pm for "run overnight") and runs Claude Code's
//      /build-batch on it, ten prospects per run, until it is done. A run that
//      dies loses nothing: each draft is saved as it is finished.
//   2. SENDING. Openers the owner approved sit in prospect_outbox. This sends
//      them one at a time through Messages, from the owner's own number, on
//      iMessage only, inside the owner's hours and daily cap, with a random gap
//      of a few minutes between texts (src/lib/prospect-preview/send-window.ts).
//      A number that isn't on iMessage is skipped and marked; it never goes out
//      as a green SMS.
//   3. LISTENING. A reply of "stop" (or "remove me", "wrong number"…) puts the
//      number on the do-not-contact list at once.
//
// It also tells the server which networks are the owner's own (a hash, never
// the address), so the link preview Messages draws on this Mac, or the owner
// opening a link on the home Wi-Fi, never counts as the prospect looking.
//
// Talks to the database directly with the service key in .env.local, like
// scripts/card-builder.mjs. Never to swiftcard.me.
//
//   node scripts/card-builder-mac/agent.mjs            run forever
//   node scripts/card-builder-mac/agent.mjs --once     one pass, then exit
//   node scripts/card-builder-mac/agent.mjs --dry-run  decide, never send or build

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { knownNotIMessage, latestRowId, outcomeOf, repliesFrom, sendIMessage, STOP_RE } from "./imessage.mjs";
// Shared with the server: the very same rules (Node strips the types).
import { localClock, nextGapMs, readSenderSettings, sendDecision } from "../../src/lib/prospect-preview/send-window.ts";
import { networkKey } from "../../src/lib/prospect-preview/network-key.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ONCE = process.argv.includes("--once");
const DRY = process.argv.includes("--dry-run");
const TICK_MS = 60_000;
const CHUNK = 10;
const CHUNK_TIMEOUT_MS = 100 * 60_000;
const VERSION = "1";

const env = { ...process.env };
if (existsSync(join(ROOT, ".env.local"))) {
  for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("card-builder-mac: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed (.env.local).");
  process.exit(2);
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ── Settings rows (card_builder_settings) ───────────────────────────────────

async function getSetting(key) {
  const { data } = await db.from("card_builder_settings").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}
async function setSetting(key, value) {
  await db.from("card_builder_settings").upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

const state = { note: "starting", nextSendAt: null, child: null, lastNetworks: 0, chatRow: null, stalls: new Map() };

async function heartbeat() {
  await setSetting("mac_agent", { at: new Date().toISOString(), note: state.note, next_send_at: state.nextSendAt, version: VERSION });
}

// ── 0. The owner's own networks ─────────────────────────────────────────────

async function publicAddress(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return res.ok ? (await res.text()).trim() : null;
  } catch { return null; }
}

async function rememberNetworks() {
  if (Date.now() - state.lastNetworks < 10 * 60_000) return;
  state.lastNetworks = Date.now();
  const addrs = [await publicAddress("https://api.ipify.org"), await publicAddress("https://api6.ipify.org")].filter(Boolean);
  const keys = [...new Set(addrs.map(networkKey).filter(Boolean))];
  if (!keys.length) return;
  const now = new Date().toISOString();
  const list = Array.isArray(await getSetting("owner_networks")) ? await getSetting("owner_networks") : [];
  const fresh = list.filter((n) => n && typeof n.key === "string" && Date.now() - Date.parse(n.at) < 30 * 86_400_000 && !keys.includes(n.key));
  await setSetting("owner_networks", [...keys.map((key) => ({ key, at: now, from: "mac" })), ...fresh].slice(0, 24));
}

// ── 1. Batches ──────────────────────────────────────────────────────────────

const builtOf = (b) => (Array.isArray(b.items) ? b.items.filter((i) => i?.outcome === "built").length : 0);

async function nextBatch() {
  // Only batches made with "New batch" (they have run_after); a /build session in a terminal runs its own.
  const { data } = await db.from("prospect_batches").select("*").in("status", ["requested", "running"]).not("run_after", "is", null)
    .lte("run_after", new Date().toISOString()).order("created_at", { ascending: true }).limit(1);
  return data?.[0] ?? null;
}

function runClaude(prompt) {
  return new Promise((done) => {
    const claude = env.CLAUDE_BIN || "claude";
    const child = spawn(claude, [
      "-p", prompt,
      "--permission-mode", "default",
      // The research reads pages anyone can write, so a page could try to give
      // it orders. It can therefore only run the Card Builder tool (which makes
      // drafts and never sends), read, search, and write its JSON files in the
      // temp folder: never edit this repo (this file included), never run
      // anything else. Everything else is refused, not asked about.
      "--allowedTools", "Bash(node scripts/card-builder.mjs:*) Read(./.claude/**) Read(./src/lib/**) Read(./docs/**) Read(//tmp/**) Read(//private/tmp/**) Read(//private/var/folders/**) WebFetch WebSearch Write(//tmp/**) Write(//private/tmp/**) Write(//private/var/folders/**)",
      "--disallowedTools", "Edit NotebookEdit Read(./.env*) Write(./**) Bash(git:*) Bash(curl:*) Bash(rm:*)",
    ], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    state.child = child;
    // Keep the Mac awake while it works, and no longer.
    const awake = spawn("/usr/bin/caffeinate", ["-i", "-w", String(child.pid)], { stdio: "ignore" });
    awake.unref();
    let tail = "";
    const keep = (b) => { tail = (tail + b.toString()).slice(-4000); };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => child.kill("SIGTERM"), CHUNK_TIMEOUT_MS);
    child.on("close", (code) => { clearTimeout(timer); state.child = null; done({ code, tail }); });
    child.on("error", (e) => { clearTimeout(timer); state.child = null; done({ code: -1, tail: String(e) }); });
  });
}

async function finishBatch(id, error) {
  if (error) await db.from("prospect_batches").update({ error: error.slice(0, 300) }).eq("id", id);
  await new Promise((done) => spawn("node", ["scripts/card-builder.mjs", "batch-finish", id], { cwd: ROOT, env, stdio: "ignore" }).on("close", done));
}

async function batches() {
  if (state.child) return;
  const b = await nextBatch();
  if (!b) return;
  if (DRY) { log("would build a chunk of", b.label); return; }
  const before = builtOf(b);
  state.note = `building "${b.label}" (${before} of ${b.wanted} so far)`;
  await heartbeat();
  log("chunk start", b.id, b.label, before, "/", b.wanted);
  const { code, tail } = await runClaude(`/build-batch batch ${b.id} chunk ${CHUNK}`);
  const { data: after } = await db.from("prospect_batches").select("*").eq("id", b.id).maybeSingle();
  if (!after || after.status === "finished") { state.stalls.delete(b.id); state.note = "idle"; return; }
  const built = builtOf(after);
  if (built >= (after.wanted ?? 0)) { await finishBatch(b.id, null); state.stalls.delete(b.id); }
  else if (built === before && (after.items?.length ?? 0) === (b.items?.length ?? 0)) {
    // Two runs in a row that did nothing at all: stop rather than loop all night.
    const stalls = (state.stalls.get(b.id) ?? 0) + 1;
    state.stalls.set(b.id, stalls);
    if (stalls >= 2) { await finishBatch(b.id, `stopped: two runs built nothing${code ? ` (exit ${code})` : ""}`); log("batch stalled", b.id, tail.slice(-500)); }
  } else state.stalls.delete(b.id);
  state.note = "idle";
  log("chunk end", b.id, "built", built, "exit", code);
}

// ── 2. Sending ──────────────────────────────────────────────────────────────

async function sentToday(tz) {
  const { data } = await db.from("prospect_outbox").select("sent_at").eq("status", "sent").gte("sent_at", new Date(Date.now() - 36 * 3_600_000).toISOString());
  const today = localClock(new Date(), tz).date;
  return (data ?? []).filter((r) => r.sent_at && localClock(new Date(r.sent_at), tz).date === today).length;
}

async function finish(row, patch, previewPatch) {
  await db.from("prospect_outbox").update(patch).eq("id", row.id);
  if (previewPatch) await db.from("prospect_previews").update(previewPatch).eq("id", row.preview_id);
}

async function sendOne() {
  // A send that was interrupted (the Mac slept mid-send) is never retried: a double text is worse than a missed one.
  await db.from("prospect_outbox").update({ status: "failed", error: "interrupted while sending" }).eq("status", "sending").lt("claimed_at", new Date(Date.now() - 15 * 60_000).toISOString());

  const s = readSenderSettings(await getSetting("sender"));
  const notBefore = state.nextSendAt ? new Date(state.nextSendAt) : null;
  const count = await sentToday(s.tz);
  const d = sendDecision(s, { now: new Date(), sentToday: count, notBefore });
  const { count: waiting } = await db.from("prospect_outbox").select("id", { count: "exact", head: true }).eq("status", "queued");
  if (!d.ok) { if (!state.child) state.note = `${waiting ?? 0} queued · ${d.reason.replace(/_/g, " ")} · ${count}/${s.daily_cap} today`; return; }
  if (!waiting) { if (!state.child) state.note = `nothing queued · ${count}/${s.daily_cap} today`; return; }

  const { data: next } = await db.from("prospect_outbox").select("*").eq("status", "queued").order("created_at", { ascending: true }).limit(1);
  const row = next?.[0];
  if (!row) return;
  // Claim it: only one sender ever gets a row.
  const { data: claimed } = await db.from("prospect_outbox").update({ status: "sending", claimed_at: new Date().toISOString() }).eq("id", row.id).eq("status", "queued").select("id");
  if (!claimed?.length) return;

  const { data: p } = await db.from("prospect_previews").select("id, status, expires_at, sent_at, slug, not_imessage_at").eq("id", row.preview_id).maybeSingle();
  if (!p || p.status !== "live" || Date.parse(p.expires_at) <= Date.now()) return finish(row, { status: "canceled", error: "the card isn't live" });
  if (p.sent_at) return finish(row, { status: "canceled", error: "already sent another way" });
  const { data: dnc } = await db.from("crew_suppression").select("value").eq("value", `tel:${row.phone}`).limit(1);
  if (dnc?.length) return finish(row, { status: "canceled", error: "on the do-not-contact list" });
  if (p.not_imessage_at || (await knownNotIMessage(row.phone))) {
    return finish(row, { status: "not_imessage", error: "only ever an SMS conversation on this Mac" }, { not_imessage_at: new Date().toISOString() });
  }

  if (DRY) { log("would send", row.phone, JSON.stringify(row.body)); return finish(row, { status: "queued", claimed_at: null }); }
  const started = Date.now();
  try {
    await sendIMessage(row.phone, row.body);
  } catch (e) {
    const msg = String(e?.stderr || e?.message || e).slice(0, 200);
    log("send refused", row.phone, msg);
    return finish(row, { status: /buddy|participant|invalid|not.*registered/i.test(msg) ? "not_imessage" : "failed", error: msg }, /buddy|participant|registered/i.test(msg) ? { not_imessage_at: new Date().toISOString() } : null);
  }

  // Did it go on iMessage? Messages marks a failure within seconds; delivery can take longer.
  let outcome = "unknown";
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    outcome = await outcomeOf(row.phone, started);
    if (outcome === "failed" || outcome === "delivered") break;
  }
  const at = new Date().toISOString();
  if (outcome === "failed") {
    log("not on iMessage", row.phone);
    return finish(row, { status: "not_imessage", error: "Messages couldn't deliver it on iMessage" }, { not_imessage_at: at });
  }
  await finish(row, { status: "sent", sent_at: at, error: outcome === "unknown" ? "sent; delivery not confirmed (Full Disk Access?)" : null }, { sent_at: at, sent_channel: "text", updated_at: at });
  await db.from("prospect_message_events").insert({ preview_id: row.preview_id, kind: "sent", message: "opener", variant: row.hook, before: row.body, after: row.body });
  state.nextSendAt = new Date(Date.now() + nextGapMs(s)).toISOString();
  log("sent", row.phone, outcome, "next no sooner than", state.nextSendAt);
}

// ── 3. Listening for "stop" ─────────────────────────────────────────────────

async function listen() {
  if (state.chatRow === null) { state.chatRow = await latestRowId(); return; }
  const { data } = await db.from("prospect_outbox").select("phone").eq("status", "sent").gte("sent_at", new Date(Date.now() - 60 * 86_400_000).toISOString()).limit(2000);
  const phones = [...new Set((data ?? []).map((r) => r.phone))];
  const replies = await repliesFrom(phones, state.chatRow);
  for (const r of replies) {
    state.chatRow = Math.max(state.chatRow, Number(r.rowid));
    if (!STOP_RE.test(r.text ?? "")) continue;
    log("stop from", r.phone);
    if (DRY) continue;
    await db.from("crew_suppression").upsert({ value: `tel:${r.phone}`, reason: `replied "${String(r.text).slice(0, 60)}" to an opener`, source: "reply_handler" }, { onConflict: "value" });
    await db.from("prospect_outbox").update({ status: "canceled", error: "they asked not to be texted" }).eq("phone", r.phone).eq("status", "queued");
  }
}

// ── The loop ────────────────────────────────────────────────────────────────

async function pass() {
  const steps = [["networks", rememberNetworks], ["listen", listen], ["send", sendOne], ["heartbeat", heartbeat]];
  for (const [name, step] of steps) {
    try { await step(); } catch (e) { log(name, "failed:", e?.message ?? e); }
  }
  // A chunk runs for up to an hour and a half: never awaited by the loop, so sending and listening go on meanwhile.
  return state.child ? null : batches().catch((e) => { state.child = null; log("batch failed:", e?.message ?? e); });
}

log(`card-builder-mac ${VERSION}${DRY ? " (dry run)" : ""} in ${ROOT}`);
if (ONCE) {
  await (await pass());
  await heartbeat();
} else {
  for (;;) {
    await pass();
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
}
