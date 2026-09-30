// ── The brain: how every agent thinks before it works ───────────────────────
//
// Owner order (2026-09-08): "All my agents should have a brain like that."
//
//   1. PLAYBOOK — the agent researches ITS OWN JOB first: how this role is done
//      well right now, how often to work (once a day? three times a week?),
//      what works, what gets ignored, what gets you banned. Refreshed about
//      weekly. The cadence it lands on becomes the agent's rhythm — unless the
//      owner set one by hand, which always wins.
//   2. TODAY — on every shift the agent researches exactly what to make today
//      (what's being asked, what's trending, what competitors just did, what it
//      already made recently so it never repeats itself).
//   3. TWO OPTIONS — it writes TWO complete, different, finished options, both
//      of which sway people towards SwiftCard. Never one, never three.
//   4. THE OWNER PICKS — a "choice" item in the queue shows both; his pick
//      becomes the real item and posts through the same owner-gated path as
//      before (connector, publish, or copy). Nothing posts on its own.
//
// Same structural guarantees as run-agent.mjs: the model gets research tools
// only; this file's writes go to agent_* tables and nothing else.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { sb, say, parseClaudeJson, extractJson, standDownForUsage, partyOf, leadOf } from "./agentkit.mjs";
import { isValidSchedule } from "./schedule.mjs";

const PLAYBOOK_MAX_AGE_DAYS = 7;
const RECENT_WORK_DAYS = 14;

/** One headless Claude call with research tools only. Returns null when the
 *  plan window is used up (the run has already been stood down). */
export async function askClaude(run, prompt, { maxTurns = 40, timeoutMin = 25 } = {}) {
  let stdout;
  try {
    stdout = execFileSync("claude", [
      "-p", prompt,
      "--output-format", "json",
      "--allowedTools", "WebSearch,WebFetch",
      "--max-turns", String(maxTurns),
    ], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: timeoutMin * 60 * 1000 });
  } catch (e) {
    const out = String(e?.stdout ?? "");
    const limit = out.match(/(You've hit your (?:session|usage) limit[^"\\]*)/i)?.[1]
      ?? (/(session|usage) limit|rate.?limit|429/i.test(out) ? "the Claude plan's session window is used up" : null);
    if (!limit) throw e;
    await standDownForUsage(run, limit);
    return null;
  }
  const { text, costUsd, tokens } = parseClaudeJson(stdout);
  run.addUsage(costUsd, tokens);
  return text;
}

// ── 1. Playbook ──────────────────────────────────────────────────────────────

export async function loadPlaybook(agentId) {
  try {
    const rows = await sb("GET", "agent_playbooks", { params: `agent_id=eq.${agentId}&limit=1` });
    return rows?.[0] ?? null;
  } catch { return null; }
}

/** True while supabase/agent-brain.sql has not been run: the playbook table
 *  does not exist (PostgREST 404 / 42P01). Researching a playbook that has
 *  nowhere to land would spend tokens every shift and then fail the run at
 *  the write — so the runner skips the research and says why instead. */
async function playbookTableMissing() {
  try {
    await sb("GET", "agent_playbooks", { params: "select=agent_id&limit=1" });
    return false;
  } catch (e) {
    return /→ 404|42P01|does not exist|PGRST205/.test(String(e));
  }
}

function playbookStale(pb) {
  if (!pb?.researched_at) return true;
  return Date.now() - new Date(pb.researched_at).getTime() > PLAYBOOK_MAX_AGE_DAYS * 86400e3;
}

/**
 * Make sure the agent knows its job. Researches (one LLM call) when there is
 * no playbook or it is over a week old; otherwise returns the stored one.
 * `brief` is the agent's own instructions file — the research is about doing
 * THAT job well, not marketing in general.
 */
export async function ensurePlaybook(run, brief, { role, defaultCadence }) {
  const agentId = run.agentId;
  const existing = await loadPlaybook(agentId);
  if (existing && !playbookStale(existing)) return existing;
  if (!existing && (await playbookTableMissing())) {
    await run.note("No playbook yet — supabase/agent-brain.sql has not been run, so I can't research my role until it is. Working from my brief for now.");
    console.log("agent_playbooks table missing — skipping role research (run supabase/agent-brain.sql)");
    return null;
  }

  await run.note(existing ? "Refreshing my playbook — re-checking how this job is best done now…" : "First shift: researching how to do this job well…");
  const prompt = `You are about to take a job at SwiftCard (swiftcard.me — the digital business card that shares everything; iOS app + web; Free and Pro plans). Your role: ${role}.

Before working, RESEARCH THE ROLE ITSELF. Use web search widely (current-year guides, platform policies, practitioner write-ups, case studies, what the best small-company teams do). Answer, concretely and for THIS role:
- How often should this work happen for best results without burning out an audience or getting flagged? Pick ONE rhythm.
- What does great look like right now — formats, lengths, tone, timing, hooks that actually get responses?
- What gets ignored, flagged, banned, or quietly punished on the platforms involved (self-promotion rules, DM limits, link rules, disclosure norms)?
- Where exactly does this work reach people (the channels / surfaces that matter for a digital-business-card app aimed at realtors, contractors, sales people, consultants and small businesses)?

Your instructions for the job are below, so the research is about doing THIS job:
---
${brief.slice(0, 6000)}
---

Return ONLY a JSON object (no prose around it):
{
 "cadence": "<one of: daily@HH:MM | weekly@mon,wed,fri@HH:MM | every@Nh — times in US Eastern, between 07:00 and 20:00; at most twice a day>",
 "cadence_reason": "<one sentence>",
 "summary": "<3-5 plain sentences: how this role is done well right now>",
 "best_practices": ["<8-15 specific, actionable rules>"],
 "pitfalls": ["<6-12 things that fail or get you banned>"],
 "channels": ["<where the work lands / who it reaches>"],
 "sources": [{"title": "...", "url": "..."}]
}`;
  const text = await askClaude(run, prompt, { maxTurns: 30 });
  if (text === null) return existing; // stood down; work with what we had
  let pb;
  try { pb = extractJson(text); } catch { pb = null; }
  if (!pb || typeof pb !== "object" || Array.isArray(pb)) {
    console.log("playbook research returned no JSON — keeping the old playbook");
    return existing;
  }
  const cadence = isValidSchedule(pb.cadence) && cadenceIsSane(pb.cadence) ? String(pb.cadence).trim() : (existing?.cadence ?? defaultCadence ?? null);
  const row = {
    agent_id: agentId,
    cadence,
    summary: String(pb.summary ?? "").slice(0, 2000),
    best_practices: Array.isArray(pb.best_practices) ? pb.best_practices.slice(0, 20).map(String) : [],
    pitfalls: Array.isArray(pb.pitfalls) ? pb.pitfalls.slice(0, 15).map(String) : [],
    channels: Array.isArray(pb.channels) ? pb.channels.slice(0, 15).map(String) : [],
    sources: Array.isArray(pb.sources) ? pb.sources.slice(0, 15) : [],
    researched_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  // A failed save must not throw away the shift: the research still shapes
  // today's work, it just won't be remembered until the table exists.
  try { await sb("POST", "agent_playbooks", { body: row, prefer: "resolution=merge-duplicates" }); }
  catch (e) { console.error(`playbook not saved: ${String(e).slice(0, 160)}`); return row; }
  await applyCadence(agentId, cadence);
  const lead = leadOf(agentId);
  await say(partyOf(agentId), lead === "owner" ? "owner" : lead,
    `Playbook ${existing ? "refreshed" : "written"}: I'll work ${describeCadence(cadence)}. ${String(pb.cadence_reason ?? "").slice(0, 160)}`,
    { kind: lead === "owner" ? "owner_out" : "a2a", run_id: run.id });
  return row;
}

/** No more than twice a day, and only during the owner's waking hours. */
function cadenceIsSane(cadence) {
  const s = String(cadence);
  const every = s.match(/^every@(\d{1,2})h$/);
  if (every) return Number(every[1]) >= 6;
  const times = (s.split("@").pop() ?? "").split(",");
  if (times.length > 2) return false;
  return times.every((t) => { const h = Number(t.split(":")[0]); return h >= 7 && h <= 20; });
}

/**
 * The playbook's cadence becomes the agent's schedule — unless the owner set
 * one from the tab (schedule_source = 'owner'), which the playbook never
 * touches. Both clocks read agent_settings.schedule, so nothing else changes.
 */
export async function applyCadence(agentId, cadence) {
  if (!cadence) return;
  try {
    const rows = await sb("GET", "agent_settings", { params: `agent_id=eq.${agentId}&select=schedule,schedule_source&limit=1` });
    const s = rows?.[0];
    if (!s || s.schedule_source === "owner") return;
    if (s.schedule === cadence && s.schedule_source === "playbook") return;
    await sb("PATCH", "agent_settings", { params: `agent_id=eq.${agentId}`, body: { schedule: cadence, schedule_source: "playbook", updated_at: new Date().toISOString() } });
  } catch (e) { console.error(`cadence not applied: ${String(e).slice(0, 120)}`); }
}

export function describeCadence(c) {
  if (!c) return "on my default rhythm";
  const s = String(c);
  const every = s.match(/^every@(\d{1,2})h$/); if (every) return `every ${every[1]} hours`;
  const weekly = s.match(/^weekly@([a-z,]+)@(.+)$/i);
  if (weekly) return `${weekly[1].split(",").map((d) => d[0].toUpperCase() + d.slice(1, 3)).join("/")} at ${weekly[2]} ET`;
  const daily = s.match(/^daily@(.+)$/); if (daily) return `daily at ${daily[1]} ET`;
  return s;
}

export function playbookBlock(pb) {
  if (!pb) return "";
  const list = (a) => (Array.isArray(a) && a.length ? a.map((x) => `- ${x}`).join("\n") : "- (none recorded)");
  return `\n---\nMY PLAYBOOK (what I learned about doing this job well — researched ${pb.researched_at ? new Date(pb.researched_at).toISOString().slice(0, 10) : "recently"}; I work ${describeCadence(pb.cadence)}):
${pb.summary ?? ""}
Best practices:
${list(pb.best_practices)}
Pitfalls to avoid:
${list(pb.pitfalls)}
Channels: ${(pb.channels ?? []).join("; ")}`;
}

// ── 2. Today's context ───────────────────────────────────────────────────────

/** What this agent already made recently — so today is never a repeat. */
export async function recentWorkBlock(agentId) {
  try {
    const since = new Date(Date.now() - RECENT_WORK_DAYS * 86400e3).toISOString();
    const rows = await sb("GET", "agent_queue_items", {
      params: `agent_id=eq.${agentId}&created_at=gte.${since}&select=title,status,item_type,created_at&order=created_at.desc&limit=60`,
    });
    if (!rows?.length) return "\n---\nMY RECENT WORK (last 14 days): nothing yet — this is a fresh start.";
    const lines = rows.map((r) => `- ${r.created_at.slice(0, 10)} [${r.status}] ${r.title}`);
    return `\n---\nMY RECENT WORK (last 14 days — do NOT repeat these topics, angles, people or threads; "rejected" means the owner said no to that idea):\n${lines.join("\n")}`;
  } catch { return ""; }
}

/** What Cleo (competitor watch) found lately — every agent gets to use it. */
export async function intelBlock() {
  try {
    const since = new Date(Date.now() - 21 * 86400e3).toISOString();
    const rows = await sb("GET", "agent_queue_items", {
      params: `agent_id=eq.competitors&created_at=gte.${since}&status=neq.rejected&select=title,content,created_at&order=created_at.desc&limit=12`,
    });
    if (!rows?.length) return "";
    const lines = rows.map((r) => `- ${r.created_at.slice(0, 10)} ${r.title}: ${String(r.content ?? "").replace(/\s+/g, " ").slice(0, 240)}`);
    return `\n---\nCOMPETITOR INTEL (from Cleo, last 3 weeks — use it where it sharpens an angle, never name-call):\n${lines.join("\n")}`;
  } catch { return ""; }
}

/** Open requests other agents filed for THIS agent. Answered first. */
export async function openRequests(agentId) {
  try {
    return (await sb("GET", "agent_requests", {
      params: `to_agent=eq.${agentId}&status=eq.open&select=id,from_agent,kind,brief,for_item,created_at&order=created_at.asc&limit=10`,
    })) ?? [];
  } catch { return []; }
}

export function openRequestsBlock(reqs) {
  if (!reqs.length) return "";
  const lines = reqs.map((r) => `- request_id ${r.id} · from ${r.from_agent} · ${r.kind}: ${r.brief}`);
  return `\n---\nREQUESTS WAITING ON ME (answer these FIRST, one item each, and put the request_id in that item's payload.request_id):\n${lines.join("\n")}`;
}

/** Who may file a request to whom (e.g. social → video). A closed map — an
 *  agent cannot invent a colleague to lean on. Shared by the daily runner and
 *  the chat turn. */
export const CAN_REQUEST = { social: ["video"], ads: ["video"], blog: ["video"], email: ["video"], partners: ["video"], listings: ["video"], cro: ["video"], support: ["cro"], geo: ["cro"], launch: ["social", "email"], trends: ["social", "blog", "email"], proof: ["video"], pr: ["video"], referral: ["cro", "email"] };

/** What the owner told THIS agent in the company chat lately — standing
 *  instructions every normal run follows until he says otherwise. Read-only,
 *  best-effort: before supabase/agent-chat.sql runs there is simply no block. */
export async function ownerChatBlock(agentId) {
  try {
    const since = new Date(Date.now() - 14 * 86400e3).toISOString();
    const rows = await sb("GET", "agent_chat", {
      params: `kind=eq.message&created_at=gte.${since}&mentions=cs.{${agentId}}&select=from_id,body,created_at&order=created_at.desc&limit=8`,
    });
    if (!rows?.length) return "";
    const who = (id) => (id === "owner" ? "the owner" : id === "atlas" ? "Atlas (chief of staff)" : `my lead ${id[0].toUpperCase()}${id.slice(1)}`);
    const lines = rows.reverse().map((r) => `- ${r.created_at.slice(0, 10)} from ${who(r.from_id)}: ${String(r.body).replace(/\s+/g, " ").slice(0, 600)}`);
    return `\n---\nWHAT I WAS TOLD IN THE COMPANY CHAT (direct instructions to me, most recent last — follow them in today's work until the owner says otherwise; if one conflicts with my brief, the owner wins):\n${lines.join("\n")}`;
  } catch { return ""; }
}

/** File a request to another agent (e.g. social → video). Best-effort. */
export async function fileRequest({ from_agent, to_agent, kind, brief, for_item = null }) {
  if (!to_agent || !brief) return null;
  try {
    const [row] = await sb("POST", "agent_requests", { body: { from_agent, to_agent, kind: kind || "copy", brief: String(brief).slice(0, 2000), for_item }, prefer: "return=representation" });
    await say(partyOf(from_agent), partyOf(to_agent), `Request: ${String(brief).slice(0, 180)}`);
    return row?.id ?? null;
  } catch { return null; }
}

export async function fulfilRequest(requestId, itemId) {
  if (!requestId) return;
  try {
    await sb("PATCH", "agent_requests", { params: `id=eq.${requestId}&status=eq.open`, body: { status: "fulfilled", fulfilled_by: itemId ?? null, fulfilled_at: new Date().toISOString() } });
  } catch { /* best-effort */ }
}

// ── 3. Two options ───────────────────────────────────────────────────────────

export const TWO_OPTIONS_RULES = `
---
HOW YOU WORK TODAY (the brain):
1. RESEARCH FIRST. Before writing anything, research what to make TODAY for this role: what people in our audience are asking and saying right now, what is trending on the platform, what competitors just did, seasonality (the calendar date matters), and what you already made recently (below). Decide the single best thing to make today, and the single best alternative.
2. WRITE TWO COMPLETE OPTIONS for each item — A and B. Both finished, both ready to go as-is, genuinely different in angle (not the same idea reworded): e.g. a story vs. a how-to, a pain-point vs. a proof-point, two different people to reach. Each option must sway the reader towards SwiftCard — a real reason to try it, said the way a person says it, never a sales pitch.
3. Say WHY in one plain line per option ("why_this"), and give the research behind the item in 2-4 lines ("research") the owner can read in ten seconds.
4. The owner picks ONE. It posts. Never write a third, never merge them, never leave one half-done.`;

const AI_TELLS = [
  /i hope this (message |email )?finds you well/i, /i came across your/i, /i couldn'?t help but notice/i,
  /just wanted to reach out/i, /i'?d love to/i, /feel free to/i, /as someone who/i,
  /really resonated/i, /hope (that|this) helps!/i, /game.?changer/i, /seamless/i, /streamline/i, /leverage/i,
  /elevate your/i, /unlock (the|your)/i, /delve/i, /navigat(e|ing) the .{0,20}landscape/i, /in today'?s fast.?paced/i,
  /it'?s worth noting/i, /^(additionally|moreover|furthermore),/im, /not only .{3,60} but also/i, /best regards/i, /🚀|✨/u,
  // The cold-DM openers every inbox has learned to skip (owner order
  // 2026-09-08: "it can't just be generic — has to be personal").
  /i'?m reaching out/i, /hope you'?re (doing )?(well|great|good)/i, /hope you'?re having a/i, /i noticed (that )?you/i,
  /great (post|content|insight|point|share|question|stuff)\b/i, /love (this|your (content|work|page|profile|posts|feed|stuff))\b/i,
  /keep up the (great|good|amazing) work/i, /look no further/i, /happy to help/i, /^quick question/im, /i'?m a big fan/i,
  /your (content|work|posts?) (is|are) (amazing|incredible|inspiring|awesome)/i, /i stumbled (up)?on/i,
];
export function soundsHuman(text) {
  if (!text) return { ok: true };
  for (const re of AI_TELLS) { const m = String(text).match(re); if (m) return { ok: false, tell: m[0] }; }
  return { ok: true };
}

// ── Personal, not generic ────────────────────────────────────────────────────
// Agents that write to ONE specific person (a Reddit thread, a forum question,
// an Instagram bio, a creator, a partner, a reviewer). A phrase filter cannot
// tell a personal message from a template, so the model must name the hook —
// the verbatim detail from THEIR post/bio/review the draft hinges on — and the
// draft must actually use it. No hook, or a hook the text never touches, and
// the option is dropped like an AI tell.
export const PERSONAL_AGENTS = new Set(["mentions", "forums", "prospects", "outreach", "influencer", "partners", "industry", "reviews", "pr", "local", "proof"]);

const HOOK_STOPWORDS = new Set(["about", "after", "again", "also", "been", "being", "business", "card", "cards", "digital", "does", "doing", "from", "have", "here", "into", "just", "like", "more", "most", "need", "only", "other", "over", "really", "same", "some", "than", "that", "their", "them", "then", "there", "these", "they", "this", "very", "want", "were", "what", "when", "where", "which", "while", "with", "would", "your"]);
const hookWords = (s) => Array.from(new Set(String(s).toLowerCase().replace(/[^a-z0-9$%'\s-]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !HOOK_STOPWORDS.has(w))));

/**
 * Is this draft written to THIS person? `hook` is what the model quoted from
 * their post/bio; the content must reuse enough of it (numbers, names, the
 * words they chose) to make sense only as a reply to them.
 */
export function isPersonal(content, hook) {
  const h = String(hook ?? "").trim();
  if (h.split(/\s+/).length < 3) return { ok: false, why: "no personal_hook (a verbatim detail from their post/bio)" };
  const words = hookWords(h);
  if (!words.length) return { ok: false, why: "personal_hook has nothing specific in it" };
  const text = String(content ?? "").toLowerCase();
  const hits = words.filter((w) => text.includes(w.replace(/'s$/, "")));
  const needed = Math.min(2, words.length);
  if (hits.length < needed) return { ok: false, why: `draft never uses its own hook ("${h.slice(0, 60)}")` };
  return { ok: true };
}

export const PERSONAL_RULES = `
---
PERSONAL, NOT GENERIC (owner order — a defect if broken):
- Every option is written to THIS person and could not be sent to anyone else. Before you write it, read their actual post / bio / review / thread (WebFetch it) and pick ONE concrete detail — a number, a name, a phrase they used, the thing they showed — that the reply hinges on.
- Put that detail, verbatim, in "personal_hook" (3-12 words). Then USE it in the text: react to it, answer it, build on it. A draft that never touches its own hook is dropped by the pipeline before the owner sees it, same as an AI tell.
- Never open with a compliment that names nothing. Never restate their job title or recap their post back to them. Write like the sharp colleague who actually read it.`;

/** The JSON shape every brain agent returns (appended to the prompt). */
export const OPTIONS_JSON_SHAPE = `Return ONLY a JSON array (no prose before or after). Each element is ONE item with TWO options:
{"kind": "<item_type from the instructions>", "title": "<what this item is, 6-12 words>", "platform": "...", "target": "...", "target_url": "...", "dedupe_key": "<stable: platform:handle, thread URL, topic slug, or date+angle>",
 "research": "<2-4 lines: what you found today and why this item now>",
 "request_id": "<only if this answers a request listed above>",
 "signal_id": "<only if this answers a LIVE RADAR SIGNAL listed above — its signal_id, verbatim>",
 "options": [
   {"label": "A", "headline": "<the angle in one line>", "content": "<the COMPLETE finished text/post/script/email, ready as-is>", "why_this": "<one line>", "personal_hook": "<when the item is aimed at one specific person: the verbatim 3-12 word detail from THEIR post/bio/review this draft hinges on; omit otherwise>", "payload": { <type-specific extras from the instructions> }},
   {"label": "B", "headline": "...", "content": "...", "why_this": "...", "personal_hook": "...", "payload": { }}
 ]}
If nothing today is worth the owner's time, return [].`;

/**
 * Queue one choice item from a brain-shaped result. Person-facing text runs
 * through the AI-tell gate PER OPTION: an option that sounds like a robot is
 * dropped, and an item left with fewer than two options is not queued at all
 * (the owner is promised a choice, not a single take dressed as one).
 */
export async function queueChoice(run, it, { personFacing = false, personal = false } = {}) {
  const kind = String(it?.kind ?? it?.item_type ?? "").trim();
  if (!kind || !it?.title) return { result: "skipped" };
  let options = Array.isArray(it.options) ? it.options.filter((o) => o && typeof o.content === "string" && o.content.trim()) : [];
  let robotic = 0;
  if (personFacing) {
    options = options.filter((o) => {
      const check = soundsHuman(o.content);
      if (!check.ok) { robotic++; console.log(`dropped option (AI tell "${check.tell}"): ${it.title}`); }
      return check.ok;
    });
  }
  // Written to one person? Then it must be written to THAT person. A "DO NOT
  // POST —" item is the agent flagging a thread it may not answer; it carries
  // the reason, not a draft, so the hook rule does not apply to it.
  if (personal) {
    options = options.filter((o) => {
      if (/^DO NOT POST/i.test(String(o.content).trim())) return true;
      const check = isPersonal(o.content, o.personal_hook ?? o.payload?.personal_hook);
      if (!check.ok) { robotic++; console.log(`dropped option (generic: ${check.why}): ${it.title}`); }
      return check.ok;
    });
  }
  if (options.length < 2) return { result: robotic ? "robotic" : "skipped", robotic };
  options = options.slice(0, 2).map((o, i) => ({
    label: i === 0 ? "A" : "B",
    headline: String(o.headline ?? "").slice(0, 200),
    content: String(o.content),
    why_this: String(o.why_this ?? "").slice(0, 400),
    personal_hook: o.personal_hook ? String(o.personal_hook).slice(0, 200) : undefined,
    payload: o.payload && typeof o.payload === "object" ? o.payload : {},
  }));
  const content = options.map((o) => `OPTION ${o.label} — ${o.headline}\n${o.content}`).join("\n\n────────\n\n");
  const out = await run.addItem({
    item_type: "choice",
    title: it.title,
    content,
    context: [it.research ? `Research: ${it.research}` : null, options.map((o) => `${o.label}: ${o.why_this}`).join(" · ")].filter(Boolean).join("\n"),
    platform: it.platform ?? null,
    target: it.target ?? null,
    target_url: it.target_url ?? null,
    dedupe_key: it.dedupe_key ?? null,
    payload: { kind, options, research: it.research ?? null, request_id: it.request_id ?? null, signal_id: it.signal_id ?? null },
  });
  if (out.result === "added" && it.request_id) await fulfilRequest(it.request_id, out.id);
  return { ...out, robotic };
}

/** Read an agent's brief from disk (the instructions file). */
export function readBrief(agentId) {
  return readFileSync(new URL(`../agents/${agentId}.md`, import.meta.url), "utf8");
}
