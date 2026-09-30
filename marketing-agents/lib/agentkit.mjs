// ── Shared runtime for every marketing/monitoring agent ──────────────────────
//
// Plain Node (24+), zero dependencies — runs in GitHub Actions with nothing but
// `node`. Talks to Supabase over REST with the service-role key.
//
// THE SAFETY CONTRACT every agent inherits by using this file:
//   • Its ONLY write surface is the agent_* tables. There is no helper here for
//     touching product tables, and no platform (Reddit/IG/X/LinkedIn) API of
//     any kind — draft-only agents are structurally unable to post.
//   • Fail safe: safeMain() wraps the run; any throw marks the run failed with
//     the error and exits nonzero. Queue writes are single INSERTs — there is
//     no multi-step write that can be left half-done.
//   • Pause: checkpoint() re-reads the pause flags between steps. A pause
//     takes effect at the next checkpoint — finished items stay, the run is
//     marked 'paused' with a summary of what it got through.
//   • Caps: assertRunnable() refuses to start when the agent is disabled or
//     paused, and when this month's total spend has hit the system cap — in
//     which case it emails the owner instead of silently burning capacity.

import { readFileSync } from "node:fs";

const SB_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY || "";

// ── The org chart (marketing-agents/org.json) ────────────────────────────────
// Maps a runnable agent_id → its persona (party id) and its lead, so every
// run can report to the right person in the Comms feed.
const ORG = JSON.parse(readFileSync(new URL("../org.json", import.meta.url), "utf8")).parties;
const PARTY_BY_AGENT = Object.fromEntries(Object.entries(ORG).filter(([, p]) => p.agent_id).map(([pid, p]) => [p.agent_id, pid]));
export function partyOf(agentId) { return PARTY_BY_AGENT[agentId] ?? agentId; }
export function leadOf(agentId) { return ORG[partyOf(agentId)]?.reports_to ?? "atlas"; }
function nameOf(partyId) { const p = ORG[partyId]; return p ? `${p.name}` : partyId; }

/** Append one row to the company chat log. NEVER throws — a comms hiccup must
 *  not fail a run — and never writes anywhere but agent_messages. */
export async function say(from_id, to_id, body, { kind = "a2a", run_id = null } = {}) {
  try { await sb("POST", "agent_messages", { body: { from_id, to_id, kind, body: String(body).slice(0, 1000), run_id } }); }
  catch (e) { console.error(`comms write failed: ${String(e).slice(0, 120)}`); }
}

function need(name, v) { if (!v) throw new Error(`${name} is not set`); return v; }

export async function sb(method, path, { params = "", body, prefer } = {}) {
  const url = `${need("SUPABASE_URL", SB_URL)}/rest/v1/${path}${params ? `?${params}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: {
      apikey: need("SUPABASE_SERVICE_ROLE_KEY", SB_KEY),
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`supabase ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

export async function getSettings(agentId) {
  const rows = await sb("GET", "agent_settings", { params: `agent_id=eq.${agentId}&limit=1` });
  if (rows?.length) return rows[0];
  const seeded = await seedSettings(agentId);
  if (seeded) return seeded;
  throw new Error(`no agent_settings row for '${agentId}' — has supabase/agent-flow.sql been run?`);
}

/** Settings for a CHAT turn. A lead (Maya, Sasha, Nina, Rex) has no settings
 *  row — leads are org parties, not scheduled agents — but the owner can still
 *  @-mention one, so a lead answers with a fixed, modest allowance. */
export async function getChatSettings(agentId) {
  const rows = await sb("GET", "agent_settings", { params: `agent_id=eq.${agentId}&limit=1` });
  if (rows?.length) return rows[0];
  if (ORG[agentId]?.kind === "lead") return { agent_id: agentId, enabled: true, paused: false, output_cap: 6, usage_cap_tokens: DEFAULT_RUN_CAP_TOKENS };
  const seeded = await seedSettings(agentId);
  if (seeded) return seeded;
  throw new Error(`no agent_settings row for '${agentId}' — has supabase/agent-flow.sql been run?`);
}

const CONFIG_AGENTS = JSON.parse(readFileSync(new URL("../config.json", import.meta.url), "utf8")).agents;

/** An agent added to config.json after the seed in agent-flow.sql ran has no
 *  settings row. Create it (rested, like every worker after Start) instead of
 *  failing every run with "has agent-flow.sql been run?" — the same self-heal
 *  the board route does, so the tab and the runner agree on who exists. */
async function seedSettings(agentId) {
  const c = CONFIG_AGENTS[agentId];
  if (!c) return null;
  try {
    const [row] = await sb("POST", "agent_settings", {
      body: { agent_id: agentId, enabled: true, paused: true, output_cap: c.output_cap ?? 6, schedule: c.default_schedule ?? null },
      prefer: "resolution=ignore-duplicates,return=representation",
    }) ?? [];
    return row ?? null;
  } catch { return null; }
}

export async function getSystem() {
  const rows = await sb("GET", "agent_system", { params: "limit=1" });
  if (!rows?.length) throw new Error("agent_system row missing — run supabase/agent-flow.sql");
  return rows[0];
}

function autoStopped(system) {
  return !!system.auto_pause_at && new Date(system.auto_pause_at).getTime() <= Date.now();
}

async function monthTokensUsed() {
  const monthStart = new Date();
  monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const rows = await sb("GET", "agent_runs", {
    params: `select=usage_tokens&started_at=gte.${monthStart.toISOString()}`,
  });
  return (rows ?? []).reduce((s, r) => s + Number(r.usage_tokens || 0), 0);
}

// Caps are TOKENS (owner order 2026-09-02) — the system runs on the Claude
// plan, so usage is measured in tokens, never dollars. Fallbacks below apply
// until supabase/agent-flow-tokens.sql has been run.
export const DEFAULT_RUN_CAP_TOKENS = 500_000;
export const DEFAULT_MONTHLY_CAP_TOKENS = 6_000_000;
export const fmtTok = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);

export async function email(subject, html) {
  // No direct Resend key in Actions? Relay through the app: /api/agent-email
  // holds the key server-side and always mails the configured digest address.
  if (!RESEND_KEY && process.env.AGENT_RELAY_SECRET) {
    const res = await fetch("https://swiftcard.me/api/agent-email", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.AGENT_RELAY_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ subject, html }),
    }).catch(() => null);
    if (!res?.ok) console.error(`email relay failed (${res ? res.status : "network"})`);
    return !!res?.ok;
  }
  if (!RESEND_KEY) { console.log(`[email skipped — no RESEND_API_KEY] ${subject}`); return false; }
  const sys = await getSystem();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    // From support@, never hello@ — these land ON hello@, and mail from your
    // own address to your own address is a spoofing pattern that trains the
    // owner's mailbox against the domain their user-facing mail sends from.
    // Kept in sync with src/lib/email-senders.ts (this file cannot import TS).
    // A plain-text part on EVERY send — HTML-only mail is a spam signal, and
    // this path shares a domain reputation with the card shares users send.
    // Crude tag-strip rather than the app's htmlToText: this file is plain
    // .mjs run from GitHub Actions and cannot import the TypeScript helper.
    body: JSON.stringify({
      from: "SwiftCard Agents <support@swiftcard.me>",
      to: [sys.digest_email],
      subject,
      html,
      text: String(html)
        .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/\n{3,}/g, "\n\n").trim(),
    }),
  });
  if (!res.ok) console.error(`resend → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.ok;
}

/** A run handle. Create with startRun(); everything else hangs off it. */
export class Run {
  constructor(agentId, row, settings, trigger = "manual") { this.agentId = agentId; this.id = row.id; this.settings = settings; this.trigger = trigger; this.direct = trigger === "chat"; this.outputCount = 0; this.usageUsd = 0; this.usageTokens = 0; this.notes = []; this.finished = false; }

  /** Refuse-to-start gates. Returns null (and records why) instead of a Run when blocked.
   *  A CHAT turn (trigger "chat") is the owner talking to this agent directly:
   *  it answers even when benched or when the office is closed — he asked
   *  THIS agent — and leads answer on default settings. The monthly token cap
   *  still holds: nothing outranks the budget line. */
  static async start(agentId, trigger = "manual") {
    const direct = trigger === "chat";
    const [settings, system] = await Promise.all([direct ? getChatSettings(agentId) : getSettings(agentId), getSystem()]);
    const blocked = direct ? null :
      !settings.enabled ? "skipped_disabled" :
      (settings.paused || system.paused || autoStopped(system)) ? "paused" : null;
    if (!blocked) {
      const spent = await monthTokensUsed();
      const monthlyCap = Number(system.monthly_usage_cap_tokens ?? DEFAULT_MONTHLY_CAP_TOKENS);
      if (spent >= monthlyCap) {
        const [row] = await sb("POST", "agent_runs", { body: { agent_id: agentId, trigger, status: "skipped_cap", finished_at: new Date().toISOString(), summary: `Monthly token cap hit (${fmtTok(spent)} of ${fmtTok(monthlyCap)} tokens). Agent did not run.` }, prefer: "return=representation" });
        // No email (owner policy 2026-09-02: reports + 🔴 criticals only) —
        // the comms line below and Atlas's digest carry the cap state.
        await say("atlas", "owner", `Budget line held: ${nameOf(partyOf(agentId))} refused to start — ${fmtTok(spent)} of the ${fmtTok(monthlyCap)}-token monthly cap is used. Raise the cap in Settings if you want more this month.`, { kind: "owner_out", run_id: row?.id ?? null });
        console.log(`::warning::${agentId}: monthly usage cap hit — not running`);
        return null;
      }
      const [row] = await sb("POST", "agent_runs", { body: { agent_id: agentId, trigger, gh_run_id: process.env.GITHUB_RUN_ID ?? null }, prefer: "return=representation" });
      // Comms: the dispatch and the acknowledgment, at the moment they happen.
      const worker = partyOf(agentId), lead = leadOf(agentId);
      const why = trigger === "start_all" ? "the owner opened the company" : trigger === "schedule" ? "your scheduled window" : trigger === "radar" ? "the Radar found live conversations for you" : "a manual run order";
      if (direct) await say(worker, "owner", `Saw your message in Chat — reading it now.`, { kind: "owner_out", run_id: row.id });
      else if (lead === "owner") await say(worker, "owner", `On it — compiling your report now.`, { kind: "owner_out", run_id: row.id });
      else { await say(lead, worker, `GO — start your run now (${why}).`, { run_id: row.id }); await say(worker, lead, `On it — starting now.`, { run_id: row.id }); }
      return new Run(agentId, row, settings, trigger);
    }
    await sb("POST", "agent_runs", { body: { agent_id: agentId, trigger, status: blocked, finished_at: new Date().toISOString(), summary: blocked === "paused" ? "Agent (or the whole system) is paused — did not start." : "Agent is disabled — did not start." } });
    console.log(`${agentId}: ${blocked} — not running`);
    return null;
  }

  /** Progress note, visible live in the Agent Flow status board. */
  async note(text) {
    this.notes.push(text);
    console.log(`[${this.agentId}] ${text}`);
    await sb("PATCH", "agent_runs", { params: `id=eq.${this.id}`, body: { summary: text } }).catch(() => {});
  }

  /** Pause gate — call between steps. Exits cleanly if paused (no partial writes: items already inserted stay, nothing is half-written). */
  async checkpoint() {
    const [settings, system] = await Promise.all([this.direct ? getChatSettings(this.agentId) : getSettings(this.agentId), getSystem()]);
    // A chat turn answers the owner even while paused (see start()); the two
    // token caps below apply to it like any other run.
    if (!this.direct && (settings.paused || system.paused || autoStopped(system))) {
      const why = autoStopped(system) ? "Auto-stop time reached" : "Paused";
      await this.finish("paused", `${why} mid-run after: ${this.notes.at(-1) ?? "startup"}. ${this.outputCount} item(s) were completed and kept.`);
      process.exit(0);
    }
    const runCap = Number(this.settings.usage_cap_tokens ?? DEFAULT_RUN_CAP_TOKENS);
    if (this.usageTokens >= runCap) {
      await this.finish("success", `Stopped at the per-run token cap (${fmtTok(runCap)}). ${this.outputCount} item(s) produced.`);
      process.exit(0);
    }
    // The monthly cap can be crossed MID-RUN (by this agent or one running in
    // parallel) — the pre-start gate alone can't catch that. Stop safely and
    // say so, instead of silently burning past the ceiling.
    const spent = await monthTokensUsed();
    const monthlyCap = Number(system.monthly_usage_cap_tokens ?? DEFAULT_MONTHLY_CAP_TOKENS);
    if (spent >= monthlyCap) {
      await this.finish("paused", `Monthly token cap (${fmtTok(monthlyCap)}) crossed mid-run — stopped safely. ${this.outputCount} item(s) were completed and kept.`);
      // No email (owner policy 2026-09-02: reports + 🔴 criticals only) — the
      // run row above and Atlas's digest carry it.
      process.exit(0);
    }
  }

  addUsage(usd, tokens = 0) { this.usageUsd += Number(usd || 0); this.usageTokens += Number(tokens || 0); }

  /** Queue an item. Respects the output cap; dedupes on (agent, dedupe_key).
   *  `status` lets a CLEAN report file itself as already-read ("acknowledged")
   *  so all-quiet days cost the owner zero clicks. Returns
   *  { result: 'added'|'duplicate'|'cap', id?: string }. */
  async addItem({ item_type, title, content = null, context = null, platform = null, target = null, target_url = null, payload = null, dedupe_key = null, status = "pending" }) {
    if (this.outputCount >= this.settings.output_cap) return { result: "cap" };
    try {
      const [row] = await sb("POST", "agent_queue_items", { body: { agent_id: this.agentId, run_id: this.id, item_type, title, content, context, platform, target, target_url, payload, dedupe_key, status }, prefer: "return=representation" });
      this.outputCount++;
      return { result: "added", id: row?.id };
    } catch (e) {
      if (String(e).includes("23505") || String(e).includes("duplicate")) return { result: "duplicate" };
      throw e;
    }
  }

  async finish(status, summary) {
    if (this.finished) return; this.finished = true;
    await sb("PATCH", "agent_runs", { params: `id=eq.${this.id}`, body: { status, summary, finished_at: new Date().toISOString(), output_count: this.outputCount, usage_usd: this.usageUsd.toFixed(4), usage_tokens: this.usageTokens } });
    // Comms: report back up the chain. A failure escalates lead → Atlas so the
    // chief (and the feed) always knows; the chief reports straight to the owner.
    if (status === "skipped_usage") return; // standDownIfUsageExhausted already said its piece
    const worker = partyOf(this.agentId), lead = leadOf(this.agentId);
    const cost = this.usageTokens > 0 ? `, ${this.usageTokens >= 1e6 ? (this.usageTokens / 1e6).toFixed(2) + "M" : Math.round(this.usageTokens / 100) / 10 + "k"} tokens` : "";
    const report =
      status === "success" ? `Done — ${this.outputCount} item(s) queued${cost}. ${String(summary ?? "").slice(0, 200)}` :
      status === "paused" ? `Stopped at a checkpoint — ${String(summary ?? "").slice(0, 200)}` :
      `⚠ FAILED — ${String(summary ?? "").slice(0, 200)}`;
    // A chat turn reports straight to the owner: its reply is in the Chat tab.
    if (this.direct) await say(worker, "owner", status === "success" ? `Replied to you in Chat${cost}.` : report, { kind: "owner_out", run_id: this.id });
    else if (lead === "owner") await say(worker, "owner", status === "success" ? `Your report is ready — it's in the queue and your inbox.` : report, { kind: "owner_out", run_id: this.id });
    else {
      await say(worker, lead, report, { run_id: this.id });
      if (status === "failed") await say(lead, "atlas", `Escalating: ${nameOf(worker)} (${ORG[worker]?.role ?? this.agentId}) failed their run — ${String(summary ?? "").slice(0, 160)}`, { run_id: this.id });
    }
  }
}

/** Snapshot the owner's Claude-plan usage into agent_system so the tab can
 *  show it even with no token in Vercel. Best-effort — never fails a run. */
export async function snapshotClaudeUsage() {
  const tok = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!tok) return;
  try {
    const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: { Authorization: `Bearer ${tok}`, "anthropic-beta": "oauth-2025-04-20" },
    });
    if (!res.ok) return;
    const u = await res.json();
    const pick = (w) => (w ? { utilization: w.utilization, resets_at: w.resets_at } : null);
    await sb("PATCH", "agent_system", {
      params: "id=eq.true",
      body: { claude_usage: { five_hour: pick(u.five_hour), seven_day: pick(u.seven_day), captured_at: new Date().toISOString() } },
    });
  } catch (e) { console.error(`usage snapshot failed: ${String(e).slice(0, 120)}`); }
}

/** LLM agents call this BEFORE burning a Claude call: when the owner's plan
 *  window is exhausted, stand down gracefully (status 'skipped_usage', a calm
 *  comms note with the reset time) instead of failing red. No-LLM watchers
 *  never call it — they are immune to usage limits. Best-effort: any error
 *  checking usage lets the run proceed. */
export async function standDownIfUsageExhausted(run) {
  const tok = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!tok) return; // API-key billing (or no token) — nothing to check
  let u = null;
  try {
    const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: { Authorization: `Bearer ${tok}`, "anthropic-beta": "oauth-2025-04-20" },
    });
    if (res.ok) u = await res.json();
  } catch { /* fail open */ }
  // Either exhausted window blocks the CLI — the 7-day cap can be hit while
  // the 5-hour one reads low, so check both and report whichever is binding.
  const exhausted = [["5-hour", u?.five_hour], ["7-day", u?.seven_day]].find(([, w]) => w && Number(w.utilization) >= 99);
  if (!exhausted) return;
  const [windowName, w] = exhausted;
  const resets = w.resets_at ? new Date(w.resets_at).toLocaleString("en-US", { timeZone: "America/New_York", weekday: windowName === "7-day" ? "short" : undefined, hour: "numeric", minute: "2-digit" }) + " ET" : "the next window";
  const worker = partyOf(run.agentId), lead = leadOf(run.agentId);
  await say(worker, lead === "owner" ? "owner" : lead, `Standing down — the Claude plan's ${windowName} window is used up. I'll be back after ${resets}; the schedule retries me automatically.`, { kind: lead === "owner" ? "owner_out" : "a2a", run_id: run.id });
  await run.finish("skipped_usage", `Claude plan ${windowName} usage window exhausted (${Math.round(w.utilization)}%). Skipped without spending; resumes after ${resets}.`);
  process.exit(0);
}

/**
 * Stand down because the Claude plan's window is used up, using the CLI's OWN
 * message as the reason. The pre-flight check above cannot catch a window that
 * closes mid-run, and without this the throw became a red "failed" run — which
 * hid a routine wait behind the same badge a real breakage gets.
 *
 * Recorded as `skipped_usage`, exactly like the pre-flight path, so the board
 * and the digest can tell "waiting for capacity" from "broken".
 */
export async function standDownForUsage(run, message) {
  const worker = partyOf(run.agentId), lead = leadOf(run.agentId);
  await say(worker, lead === "owner" ? "owner" : lead,
    `Standing down — ${message}. Nothing is wrong with me; I'll pick this up on my next turn once the plan's window resets.`,
    { kind: lead === "owner" ? "owner_out" : "a2a", run_id: run.id });
  await run.finish("skipped_usage", `Stood down without spending: ${message}.`);
  process.exit(0);
}

/** Wrap an agent's main. Guarantees the run row never stays 'running' forever. */
export async function safeMain(agentId, fn) {
  const trigger = process.env.AGENT_TRIGGER || "manual";
  const run = await Run.start(agentId, trigger);
  if (!run) return;
  try {
    await fn(run);
    if (!run.finished) await run.finish("success", `${run.outputCount} item(s) produced. ${run.notes.at(-1) ?? ""}`.trim());
  } catch (e) {
    console.error(e);
    await run.finish("failed", `Failed: ${String(e).slice(0, 400)}`).catch(() => {});
    process.exitCode = 1;
  }
  await snapshotClaudeUsage();
}

/** Parse `claude -p --output-format json` output: returns {text, costUsd, tokens}. */
export function parseClaudeJson(stdout) {
  const j = JSON.parse(stdout);
  const text = j.result ?? "";
  const costUsd = j.total_cost_usd ?? j.cost_usd ?? 0;
  const usage = j.usage ?? {};
  const tokens = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
  return { text, costUsd, tokens };
}

/** Pull the first JSON array/object out of an LLM reply (tolerates prose around it). */
export function extractJson(text) {
  const m = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  if (!m) throw new Error("no JSON found in model output");
  return JSON.parse(m[1]);
}
