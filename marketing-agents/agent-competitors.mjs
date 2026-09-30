// ── Cleo · Competitor Watch ──────────────────────────────────────────────────
// Owner order (2026-09-08): monitor Blinq, HiHello and the rest, find new
// competitors, and flag every update — price changes, new features, new plans,
// new app versions.
//
// Same shape as the watchdogs: the WATCHING is code and costs nothing (fetch
// each tracked page, hash its visible text, compare with the last snapshot);
// the THINKING is on demand. Only when a page actually changed does the LLM
// read the before/after and write the owner a plain note — with two options
// for how SwiftCard should respond. Once a week (Mondays) she also sweeps for
// competitors nobody has listed yet and proposes adding them.
//
// Runs every 6 hours, so "24/7" here means a change is noticed within six
// hours without a single token spent on a quiet day.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { safeMain, sb, extractJson, standDownIfUsageExhausted } from "./lib/agentkit.mjs";
import { askClaude, ensurePlaybook, playbookBlock, recentWorkBlock, ownerChatBlock, queueChoice } from "./lib/brain.mjs";
import { focusBlock } from "./lib/insights.mjs";
import { chatterBlock } from "./lib/radar.mjs";
import { nyWeekday } from "./lib/schedule.mjs";

const config = JSON.parse(readFileSync(new URL("./config.json", import.meta.url), "utf8"));
const voice = readFileSync(new URL("./BRAND_VOICE.md", import.meta.url), "utf8");
const instructions = readFileSync(new URL("./agents/competitors.md", import.meta.url), "utf8");

const EXCERPT_CHARS = 6000;

/** Visible text of a page: tags, scripts, styles and whitespace collapsed. */
function visibleText(html) {
  return String(html)
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fetch with a hard timeout; never throws. A fetch failure is NOT a change. */
async function fetchText(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (compatible; SwiftCardBot/1.0; +https://swiftcard.me)" } });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; } finally { clearTimeout(timer); }
}

/** App Store listing via the public lookup API — version + release notes. */
async function appStoreText(url) {
  const id = String(url ?? "").match(/id(\d+)/)?.[1];
  if (!id) return null;
  const raw = await fetchText(`https://itunes.apple.com/lookup?id=${id}`);
  if (!raw) return null;
  try {
    const r = JSON.parse(raw)?.results?.[0];
    if (!r) return null;
    return `${r.trackName} · version ${r.version} · updated ${String(r.currentVersionReleaseDate ?? "").slice(0, 10)} · rating ${r.averageUserRating ?? "?"} (${r.userRatingCount ?? 0}) · price ${r.formattedPrice ?? "?"}\nRelease notes: ${String(r.releaseNotes ?? "").slice(0, 1500)}`;
  } catch { return null; }
}

const sha = (s) => createHash("sha256").update(s).digest("hex");

/** Compare every tracked page with its last snapshot. Returns the changes. */
async function detectChanges(run) {
  const competitors = (await sb("GET", "agent_competitors", { params: "active=is.true&select=id,name,site,pages,app_store" })) ?? [];
  const changes = [];
  let checked = 0, unreachable = 0, firstSeen = 0;
  for (const c of competitors) {
    const pages = [...(Array.isArray(c.pages) ? c.pages : []), ...(c.app_store ? [{ key: "app_store", url: c.app_store }] : [])];
    for (const p of pages) {
      if (!p?.url || !p?.key) continue;
      checked++;
      const text = p.key === "app_store" ? await appStoreText(p.url) : (await fetchText(p.url).then((h) => (h ? visibleText(h) : null)));
      if (!text || text.length < 80) { unreachable++; continue; }
      const excerpt = text.slice(0, EXCERPT_CHARS);
      const hash = sha(excerpt);
      const prev = (await sb("GET", "agent_competitor_snapshots", { params: `competitor_id=eq.${c.id}&page_key=eq.${p.key}&select=hash,excerpt,fetched_at&order=fetched_at.desc&limit=1` }))?.[0];
      if (prev?.hash === hash) continue;
      await sb("POST", "agent_competitor_snapshots", { body: { competitor_id: c.id, page_key: p.key, url: p.url, hash, excerpt } });
      if (!prev) { firstSeen++; continue; } // baseline — nothing to compare yet
      changes.push({ competitor: c.name, id: c.id, page: p.key, url: p.url, before: prev.excerpt ?? "", after: excerpt, since: prev.fetched_at });
    }
  }
  await run.note(`Checked ${checked} page(s) across ${competitors.length} competitor(s): ${changes.length} changed, ${firstSeen} baselined, ${unreachable} unreachable.`);
  return { changes, competitors };
}

await safeMain("competitors", async (run) => {
  const { changes, competitors } = await detectChanges(run);
  await run.checkpoint();

  const sweepDay = nyWeekday() === "mon";
  const alreadySwept = sweepDay && ((await sb("GET", "agent_runs", { params: `agent_id=eq.competitors&status=eq.success&summary=like.*sweep*&started_at=gte.${new Date(Date.now() - 20 * 3600e3).toISOString()}&select=id&limit=1` }))?.length ?? 0) > 0;
  const doSweep = sweepDay && !alreadySwept;
  if (!changes.length && !doSweep) {
    await run.finish("success", "All quiet — no competitor page changed since the last check. No tokens spent.");
    return;
  }

  // Something changed (or it is sweep day): now the LLM earns its keep.
  await standDownIfUsageExhausted(run);
  const playbook = await ensurePlaybook(run, instructions, { role: "Competitor Watch", defaultCadence: config.agents.competitors?.default_schedule ?? null });
  if (run.finished) return;
  await run.checkpoint();

  const changeBlock = changes.length
    ? "\n---\nPAGES THAT CHANGED SINCE THE LAST CHECK (before → after, visible text):\n" + changes.map((ch) =>
      `### ${ch.competitor} · ${ch.page} · ${ch.url} (last seen unchanged ${String(ch.since).slice(0, 10)})\nBEFORE:\n${ch.before.slice(0, 3000)}\nAFTER:\n${ch.after.slice(0, 3000)}`).join("\n\n")
    : "";
  const sweepBlock = doSweep
    ? `\n---\nWEEKLY SWEEP: it is Monday. Also search for digital business card / NFC card / link-in-bio-for-networking products we are NOT tracking yet (tracked: ${competitors.map((c) => c.name).join(", ")}). Propose up to 3 new ones worth watching, as "competitor_found" items, each with the exact pricing-page URL and App Store URL if any.`
    : "";

  await run.note(changes.length ? `Reading ${changes.length} change(s)…` : "Weekly sweep for new competitors…");
  const prompt = [
    voice,
    `\n---\nTODAY: ${new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long", year: "numeric", month: "long", day: "numeric" })}.`,
    await focusBlock(),
    playbookBlock(playbook),
    await recentWorkBlock("competitors"),
    await ownerChatBlock("competitors"),
    // What real people said about the tracked competitors this week (the
    // Radar) — read-only intel; it costs nothing until Cleo wakes anyway.
    await chatterBlock(),
    `\n---\nSWIFTCARD'S OWN PRICING for comparison: read https://swiftcard.me/pricing before judging whether a competitor move matters.`,
    changeBlock,
    sweepBlock,
    "\n---\n" + instructions,
    `\n---\nReturn ONLY a JSON array (no prose). One element per REAL update (ignore cosmetic edits, cookie banners, rotating testimonials, date stamps, A/B copy jitter — if a diff is noise, skip it):
{"kind": "competitor_update" | "competitor_found", "title": "<Competitor: what changed, 6-12 words>", "platform": "web", "target": "<competitor id>", "target_url": "<the page>", "dedupe_key": "<competitor>:<page>:<date>",
 "research": "<2-4 plain lines: exactly what changed, old → new, with numbers; why it matters to SwiftCard>",
 "options": [
   {"label": "A", "headline": "<how SwiftCard should respond, option A>", "content": "<the complete response: e.g. a ready-to-post comparison note for /compare, a pricing-page line change, a social post, or 'no action — here is why' — written in full>", "why_this": "<one line>", "payload": {"competitor": "...", "page": "...", "change_type": "price|feature|plan|app_update|new_competitor|other", "before": "...", "after": "..."}},
   {"label": "B", "headline": "...", "content": "...", "why_this": "...", "payload": {}}
 ]}
For "competitor_found", payload must also carry {"id": "<slug>", "name": "...", "site": "...", "pages": [{"key": "pricing", "url": "..."}], "app_store": "<url or null>"}; option A = add them to the watch list (content = one paragraph on who they are), option B = do not track (content = why).`,
  ].filter(Boolean).join("\n");

  const text = await askClaude(run, prompt, { maxTurns: 30 });
  if (text === null) return;
  await run.checkpoint();

  let items;
  try { items = extractJson(text); } catch { throw new Error("competitor agent returned no parseable JSON; raw output length " + text.length); }
  if (!Array.isArray(items)) items = [items];
  let added = 0, dup = 0;
  for (const it of items) {
    const out = await queueChoice(run, it);
    if (out.result === "added") added++;
    if (out.result === "duplicate") dup++;
    if (out.result === "cap") break;
  }
  await run.finish("success", `${added} competitor update(s) written up for you${dup ? ` (${dup} already reported)` : ""}${doSweep ? " — includes this week's sweep for new competitors" : ""}. Changed pages: ${changes.map((c) => `${c.competitor}/${c.page}`).join(", ") || "none"}. $${run.usageUsd.toFixed(2)}.`);
});
