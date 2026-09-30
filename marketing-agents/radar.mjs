// ── Radar · one scan, now ────────────────────────────────────────────────────
// Usage: node marketing-agents/radar.mjs
//
// The Radar normally ticks inside watchdog.mjs (every 15 min while the office
// is open). This is the "Scan now" button (agent-radar.yml) and the local
// way to try it: one full pass over every active source, then wake the agents
// with something to answer. Code only — nothing here calls a model.
import { radarTick } from "./lib/radar.mjs";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("./config.json", import.meta.url), "utf8"));
const REPO = process.env.GITHUB_REPOSITORY ?? "swiftcard/relationship-app";

async function dispatch(agentId, reason, trigger = "radar") {
  const wf = config.agents[agentId]?.workflow;
  if (!wf || !process.env.GH_TOKEN) { console.log(`  ! cannot wake ${agentId} (${wf ? "GH_TOKEN missing" : "no workflow"})`); return false; }
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${wf}/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json" },
    body: JSON.stringify({ ref: "main", inputs: { trigger } }),
  }).catch(() => null);
  console.log(`  → woke ${agentId} (${wf}) status ${res?.status ?? "network"}: ${reason}`);
  return res?.status === 204;
}

const out = await radarTick({ dispatch, force: true });
if (!out) { console.log("Radar: nothing to do."); process.exit(0); }
if (out.skipped) { console.log(`Radar skipped: ${out.skipped}`); process.exit(0); }
console.log(`Radar: ${out.sources} source(s), ${out.fetched} post(s) read, ${out.inserted} new signal(s).`);
for (const e of out.errors ?? []) console.log(`  ⚠ ${e}`);
process.exit(0);
