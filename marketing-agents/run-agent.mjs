// ── Generic LLM agent runner ─────────────────────────────────────────────────
// Usage: node marketing-agents/run-agent.mjs <agent_id>
//
// Loads marketing-agents/agents/<agent_id>.md (the agent's instructions), runs
// Claude Code CLI headless with ONLY research tools (WebSearch/WebFetch),
// parses the JSON the agent returns, and queues it for the owner's review.
//
// Every agent runs on the BRAIN (lib/brain.mjs, owner order 2026-09-08):
//   playbook (research the role, weekly) → research today → TWO complete
//   options per item → the owner picks one → it posts.
//
// STRUCTURALLY DRAFT-ONLY for third-party platforms: the CLI gets no Bash, no
// git, no gh, no posting API of any kind — its entire output is text parsed by
// this script, and this script's only write is Run.addItem() into our own
// queue tables. There is no code path that can post, DM, or comment anywhere.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { safeMain, parseClaudeJson, extractJson, standDownIfUsageExhausted, standDownForUsage, sb } from "./lib/agentkit.mjs";
import { dataBlock, focusBlock, teamOutputBlock } from "./lib/insights.mjs";
import { radarBlock, markSignalQueued } from "./lib/radar.mjs";
import {
  ensurePlaybook, playbookBlock, recentWorkBlock, intelBlock, openRequests, openRequestsBlock, ownerChatBlock,
  TWO_OPTIONS_RULES, OPTIONS_JSON_SHAPE, PERSONAL_RULES, PERSONAL_AGENTS, queueChoice, soundsHuman, isPersonal, fileRequest, CAN_REQUEST,
} from "./lib/brain.mjs";

const agentId = process.argv[2];
if (!agentId) { console.error("usage: run-agent.mjs <agent_id>"); process.exit(2); }

const config = JSON.parse(readFileSync(new URL("./config.json", import.meta.url), "utf8"));
const org = JSON.parse(readFileSync(new URL("./org.json", import.meta.url), "utf8"));
const voice = readFileSync(new URL("./BRAND_VOICE.md", import.meta.url), "utf8");
const instructions = readFileSync(new URL(`./agents/${agentId}.md`, import.meta.url), "utf8");
const roleOf = (id) => Object.values(org.parties).find((p) => p.agent_id === id)?.role ?? id;

// Agents that write TO real people also get the human-voice doctrine, and
// their output passes the tell-filter (lib/brain.mjs) before anything reaches
// the queue. A draft containing a high-precision AI-tell phrase is DISCARDED
// (counted in the run summary) rather than queued — the owner's rule is that
// robotic-sounding copy must never reach a real person, and a filter the model
// can't argue with beats an instruction it might drift from.
const PERSON_FACING = new Set(["outreach", "prospects", "mentions", "influencer", "social", "ads", "email", "industry", "forums", "partners", "listings", "reviews", "retention", "video", "pr", "local", "onboarding", "upsell", "churn", "proof"]);
const humanVoice = PERSON_FACING.has(agentId)
  ? "\n---\n" + readFileSync(new URL("./HUMAN_VOICE.md", import.meta.url), "utf8")
  : "";

/**
 * What the site already publishes, for agents whose job is to fill gaps rather
 * than repeat. Empty string for everyone else, and on any error — a failed
 * lookup must not stop the run, it just means Jake sees no exclusions and the
 * dedupe_key catches an accidental repeat downstream.
 */
async function creativePoolBlock(id) {
  if (id !== "ads" && id !== "social") return "";
  try {
    const { readyAssets } = await import("./lib/media-pool.mjs");
    const assets = await readyAssets({ limit: 25 });
    if (!assets.length) {
      return id === "ads"
        ? "\n---\nREADY CREATIVE POOL: EMPTY. Nothing has been rendered yet. Either build an angle around a NEW creative request to Vince (see requests below), or return []."
        : "\n---\nREADY CREATIVE POOL: EMPTY. Ask Vince for what you need (see requests below) and post text-first meanwhile.";
    }
    const lines = assets.map((a) => `- id ${a.id} · ${a.kind} · "${a.concept ?? "untitled"}" · ${a.url}`);
    return `\n---\nREADY CREATIVE POOL (already rendered and paid for — reuse these before requesting anything new):\n${lines.join("\n")}`;
  } catch {
    return "";
  }
}

async function existingPagesBlock(id) {
  if (id !== "seo") return "";
  try {
    const [posts, topics] = await Promise.all([
      sb("GET", "agent_blog_posts", { params: "select=slug,keyword,title&limit=200" }),
      sb("GET", "agent_blog_topics", { params: "select=slug,topic&limit=200" }),
    ]);
    const lines = [
      ...(posts ?? []).map((p) => `- /blog/${p.slug} — "${p.title}"${p.keyword ? ` (keyword: ${p.keyword})` : ""}`),
      ...(topics ?? []).filter((t) => t.slug && !(posts ?? []).some((p) => p.slug === t.slug)).map((t) => `- /blog/${t.slug} — drafted: "${t.topic}"`),
    ];
    return "\n---\nPAGES THAT ALREADY EXIST — do NOT write another page for any of these keywords or slugs:\n" +
      (lines.length ? lines.join("\n") : "(none yet — the site has no agent-written pages)") +
      "\nAlso already covered by hand-built pages, do not duplicate: /compare/linktree-alternative, /compare/popl-alternative, /compare/blinq-alternative, /compare/hihello-alternative, /pricing, /templates, /preview, and the /for/* industry pages.";
  } catch {
    return "";
  }
}

// Agents that may ask a colleague for something (creative from Vince, a data
// pull, a rewrite) come from CAN_REQUEST in lib/brain.mjs — a closed map, so
// a prompt cannot invent a recipient; the colleague answers on their next shift.

await safeMain(agentId, async (run) => {
  await standDownIfUsageExhausted(run);

  // 1. The playbook — research the role first (weekly), then work from it.
  const playbook = await ensurePlaybook(run, instructions, { role: roleOf(agentId), defaultCadence: config.agents[agentId]?.default_schedule ?? null });
  if (run.finished) return; // stood down mid-playbook

  await run.checkpoint();
  await run.note("Researching today's work…");
  const requests = await openRequests(agentId);
  const canAsk = CAN_REQUEST[agentId] ?? [];
  const prompt = [
    voice,
    humanVoice,
    "\n---\nCENTRAL CONFIG (target lists):\n" + JSON.stringify(config.targets, null, 1),
    `\n---\nTODAY: ${new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long", year: "numeric", month: "long", day: "numeric" })} (US Eastern).`,
    // The owner's one-line focus for the week (Settings) — read before anything else.
    await focusBlock(),
    playbookBlock(playbook),
    await recentWorkBlock(agentId),
    await intelBlock(),
    // Ana, Ollie, Uma, Cass, Pat, Lena and Axel start from our own numbers,
    // not from a guess about them (lib/insights.mjs — counts and segments only).
    await dataBlock(agentId),
    // What colleagues already shipped this week: repurpose before inventing.
    await teamOutputBlock(agentId),
    openRequestsBlock(requests),
    // Standing orders from the company chat ("@jake focus on realtors this
    // week") shape every run until the owner says otherwise.
    await ownerChatBlock(agentId),
    // The Radar's live signals (lib/radar.mjs): real threads code found on
    // Reddit, Telegram, Hacker News and the news feeds — worked before
    // anything the agent would search for itself. "" for everyone else.
    await radarBlock(agentId),
    // Jake must not write a second page for a keyword the site already covers —
    // two thin pages competing for one query is worse than one good page
    // (Google picks one and dilutes both). Handing him the live slug list is
    // what makes "return [] if everything is covered" an instruction he can
    // actually follow.
    await existingPagesBlock(agentId),
    // Paid and organic draw from ONE rendered pool, so a concept is paid for
    // once and the two channels stay visually identical.
    await creativePoolBlock(agentId),
    canAsk.length ? `\n---\nYOU MAY ASK A COLLEAGUE: add a top-level "requests": [{"to": "${canAsk.join("|")}", "kind": "video|image|copy", "brief": "<exactly what you need, one paragraph>"}] to any item that needs it. They answer on their next shift; do not wait for them — the item you queue today must stand on its own.` : "",
    `\n---\nOUTPUT CAP for this run: at most ${run.settings.output_cap} items. Quality over volume — fewer, better items always win.`,
    TWO_OPTIONS_RULES,
    // Writing to one person? The draft must hinge on something only that
    // person wrote — and the pipeline checks it (lib/brain.mjs isPersonal).
    PERSONAL_AGENTS.has(agentId) ? PERSONAL_RULES : "",
    "\n---\n" + instructions,
    "\n---\n" + OPTIONS_JSON_SHAPE,
  ].filter(Boolean).join("\n");

  await run.checkpoint();
  const t0 = Date.now();
  // The CLI exits non-zero when the shared Claude-plan session window is used
  // up, and execFileSync turns that into a throw — which safeMain recorded as
  // FAILED. So a routine "come back after the window resets" showed up as a red
  // Problem badge, indistinguishable from a real breakage: on 2026-09-01/02 six
  // of Maya's seven agents were red for exactly this reason and nothing was
  // actually wrong with them. standDownIfUsageExhausted only checks BEFORE the
  // call, and the window can close mid-flight (or read under 99% while the
  // session is already blocked), so the honest signal is the CLI's own reply.
  let stdout;
  try {
    stdout = execFileSync("claude", [
      "-p", prompt,
      "--output-format", "json",
      "--allowedTools", "WebSearch,WebFetch",
      "--max-turns", "40",
    ], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 25 * 60 * 1000 });
  } catch (e) {
    const out = String(e?.stdout ?? "");
    const limit = out.match(/(You've hit your (?:session|usage) limit[^"\\]*)/i)?.[1]
      ?? (/(session|usage) limit|rate.?limit|429/i.test(out) ? "the Claude plan's session window is used up" : null);
    if (!limit) throw e;
    await standDownForUsage(run, limit);
  }
  if (stdout === undefined) return; // stood down above

  const { text, costUsd, tokens } = parseClaudeJson(stdout);
  run.addUsage(costUsd, tokens);
  await run.note(`Research done in ${Math.round((Date.now() - t0) / 1000)}s ($${Number(costUsd).toFixed(2)}). Queuing options…`);
  await run.checkpoint();

  let items;
  try { items = extractJson(text); } catch { throw new Error("agent returned no parseable JSON items; raw output length " + text.length); }
  if (!Array.isArray(items)) items = [items];

  let added = 0, dup = 0, robotic = 0, single = 0, asked = 0;
  for (const it of items) {
    if (!it?.title) continue;
    // Legacy single-take shape (no options) still passes the tell gate, so an
    // agent that ignored the brain cannot slip a robotic draft through.
    if (!Array.isArray(it.options)) {
      if (!it.item_type) continue;
      if (PERSON_FACING.has(agentId)) {
        const check = soundsHuman(it.content ?? "");
        if (!check.ok) { robotic++; console.log(`discarded (AI tell "${check.tell}"): ${it.title}`); continue; }
      }
      if (PERSONAL_AGENTS.has(agentId) && !/^DO NOT POST/i.test(String(it.content ?? "").trim())) {
        const check = isPersonal(it.content ?? "", it.personal_hook ?? it.payload?.personal_hook);
        if (!check.ok) { robotic++; console.log(`discarded (generic: ${check.why}): ${it.title}`); continue; }
      }
      single++;
      const { result, id: singleId } = await run.addItem(it);
      if (result === "added") { added++; await markSignalQueued(it.signal_id ?? it.payload?.signal_id, singleId); }
      if (result === "duplicate") dup++;
      if (result === "cap") break;
      continue;
    }
    const out = await queueChoice(run, it, { personFacing: PERSON_FACING.has(agentId), personal: PERSONAL_AGENTS.has(agentId) });
    robotic += out.robotic ?? 0;
    if (out.result === "added") {
      added++;
      // A reply written for a Radar signal closes that signal (→ queued).
      await markSignalQueued(it.signal_id, out.id);
      for (const r of Array.isArray(it.requests) ? it.requests.slice(0, 2) : []) {
        if (!canAsk.includes(r?.to)) continue;
        if (await fileRequest({ from_agent: agentId, to_agent: r.to, kind: r.kind, brief: r.brief, for_item: out.id })) asked++;
      }
    }
    if (out.result === "duplicate") dup++;
    if (out.result === "cap") break;
  }
  const notes = [
    `${dup} duplicate(s) skipped`,
    robotic ? `${robotic} option(s) DISCARDED for AI-sounding language or generic copy` : null,
    single ? `${single} came without two options` : null,
    asked ? `${asked} request(s) filed with colleagues` : null,
    `${items.length} candidates`,
  ].filter(Boolean).join(", ");
  await run.finish("success", `${added} new item(s) queued, each with two options to pick from (${notes}). Spend $${run.usageUsd.toFixed(2)}.`);
});
