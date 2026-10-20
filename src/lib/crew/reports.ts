import type { AgentDef } from "./agent-def";
import type { AgentContext } from "./context";
import { appBase } from "./env";
import { TIER_LABEL } from "./models";
import { numbersAreGrounded, readableEnough } from "./readability";
import { nyDay, nyDayStart } from "./schedule";
import type { CrewStore } from "./store";
import type { TeamId } from "./types";

// ── The managers' daily report ──────────────────────────────────────────────
// Code counts everything; the manager only puts it into words. Two checks run
// on the words before anyone sees them: every number must come from the
// counted facts (no invented results), and the reading level must be grade 5
// or lower. One rewrite is allowed; after that a plain template is sent, so a
// report always arrives and is always true.

export type TeamStats = {
  team: TeamId;
  day: string;
  money: { spent_usd: number; cache_share_pct: number; by_agent: { agent: string; usd: number }[] };
  runs: { total: number; errors: number; stopped_by_budget: number };
  inbox: { new_items: number; waiting_now: number; approved: number; rejected: number; posted_or_done: number };
  rejected_reasons: string[];
  counts: Record<string, number>;
  agents_on: string[];
  agents_needing_setup: { agent: string; needs: string[] }[];
  savings: string[];
};

export async function teamStats(store: CrewStore, team: TeamId, defs: AgentDef[], now: Date, missing: (d: AgentDef) => string[]): Promise<TeamStats> {
  const since = nyDayStart(new Date(now.getTime() - 3600_000)).toISOString();
  const members = defs.filter((d) => d.team === team);
  const ids = new Set(members.map((d) => d.id));
  const [totals, runs, approvals, states] = await Promise.all([
    store.usageTotals(since),
    store.runsSince(since),
    store.listApprovals({ sinceIso: since, limit: 1000 }),
    store.listAgentStates(),
  ]);
  const mine = approvals.filter((a) => ids.has(a.agent_id));
  const waiting = (await store.listApprovals({ status: ["pending"], limit: 1000 })).filter((a) => ids.has(a.agent_id)).length;
  const counts: Record<string, number> = {};
  for (const r of runs.filter((r) => ids.has(r.agent_id))) for (const [k, v] of Object.entries(r.stats ?? {})) counts[k] = (counts[k] ?? 0) + Number(v);
  const teamUsd = totals.byTeam[team]?.usd ?? 0;
  const cacheShare = totals.total.input ? Math.round((totals.total.cacheRead / totals.total.input) * 100) : 0;
  const on = new Set(states.filter((s) => s.enabled).map((s) => s.id));
  const savings: string[] = [];
  if (cacheShare > 0) savings.push(`${cacheShare}% of what the models read came from the cache, which costs a tenth.`);
  if ((counts.skipped_inbox_full ?? 0) > 0) savings.push("Some agents waited because the inbox was full, instead of writing more drafts.");
  if ((counts.skipped_already_contacted ?? 0) > 0) savings.push("Some people were skipped because someone already talked to them.");
  if ((counts.batched ?? 0) > 0) savings.push("Sorting work went through the half-price batch line.");
  if ((counts.no_llm_needed ?? 0) > 0) savings.push("Some checks needed no AI at all, so they cost nothing.");
  return {
    team,
    day: nyDay(now),
    money: {
      spent_usd: round2(teamUsd),
      cache_share_pct: cacheShare,
      by_agent: members.map((d) => ({ agent: d.name, usd: round2(totals.byAgent[d.id]?.usd ?? 0) })).filter((x) => x.usd > 0),
    },
    runs: {
      total: runs.filter((r) => ids.has(r.agent_id)).length,
      errors: runs.filter((r) => ids.has(r.agent_id) && r.status === "error").length,
      stopped_by_budget: runs.filter((r) => ids.has(r.agent_id) && r.status === "budget").length,
    },
    inbox: {
      new_items: mine.length,
      waiting_now: waiting,
      approved: mine.filter((a) => a.status === "approved").length,
      rejected: mine.filter((a) => a.status === "rejected").length,
      posted_or_done: mine.filter((a) => a.status === "done").length,
    },
    rejected_reasons: [...new Set(mine.filter((a) => a.status === "rejected" && a.reject_reason).map((a) => a.reject_reason!))].slice(0, 5),
    counts,
    agents_on: members.filter((d) => on.has(d.id) && d.role !== "manager").map((d) => d.name),
    agents_needing_setup: members.map((d) => ({ agent: d.name, needs: missing(d) })).filter((x) => x.needs.length > 0),
    savings,
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function templateReport(s: TeamStats, teamName: string): string {
  const lines = [
    `${teamName} report for ${s.day}`,
    "",
    "What happened",
    `- The team ran ${s.runs.total} times.${s.runs.errors ? ` ${s.runs.errors} runs had a problem.` : ""}`,
    `- It made ${s.inbox.new_items} new items for you. ${s.inbox.waiting_now} are waiting.`,
    ...Object.entries(s.counts)
      .filter(([k]) => !k.startsWith("skipped_"))
      .slice(0, 8)
      .map(([k, v]) => `- ${k.replace(/_/g, " ")}: ${v}`),
    "",
    "What I need from you",
    s.inbox.waiting_now ? `- Look at the ${s.inbox.waiting_now} waiting items. Tap Approve or Reject.` : "- Nothing right now.",
    ...s.agents_needing_setup.map((a) => `- ${a.agent} needs: ${a.needs.join(", ")}.`),
    "",
    "Money used today",
    `- $${s.money.spent_usd.toFixed(2)}.`,
    "",
    "How I saved tokens",
    ...(s.savings.length ? s.savings.map((x) => `- ${x}`) : ["- Most checks ran without AI."]),
  ];
  return lines.join("\n");
}

const REPORT_RULES = `Write a short daily report for the two owners of a small company. Use ONLY the numbers in the facts. Write like you are talking to a 10-year-old: short sentences, small words, no jargon, no em dashes.
Use exactly these four headings, each on its own line: What happened / What I need from you / Money used today / How I saved tokens.
Under each heading, 1 to 4 short lines starting with "- ". Under "What I need from you", say exactly what to tap or set up, or "Nothing right now."`;

/** Manager writes the report (Opus), checked for reading level and invented numbers. */
export async function writeReport(ctx: AgentContext, stats: TeamStats, teamName: string): Promise<string> {
  const facts = JSON.stringify(stats);
  let text = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await ctx.llm.ask("report", {
      effort: attempt === 0 ? "medium" : "high",
      maxTokens: 2000,
      system: REPORT_RULES,
      prompt: `TEAM: ${teamName}\nFACTS:\n${facts}${attempt ? `\n\nYour last try was too hard to read or used numbers that are not in the facts. Use shorter sentences and only numbers from the facts.\nLAST TRY:\n${text}` : ""}`,
    });
    text = res.text.trim();
    if (!res.refused && text && readableEnough(text) && numbersAreGrounded(text, stats).ok) return `${teamName} report for ${stats.day}\n\n${text}`;
  }
  ctx.stat("report_template_fallback");
  return templateReport(stats, teamName);
}

export function reportHtml(body: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = body.split("\n").map((l) => {
    if (/^(What happened|What I need from you|Money used today|How I saved tokens|The plan for tomorrow)\s*$/.test(l.trim())) return `<h3 style="margin:16px 0 4px;font-size:15px">${esc(l.trim())}</h3>`;
    if (l.startsWith("- ")) return `<div style="margin:2px 0 2px 8px">&bull; ${esc(l.slice(2))}</div>`;
    return l.trim() ? `<p style="margin:4px 0">${esc(l)}</p>` : "";
  });
  return `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;color:#111">${lines.join("")}<p style="margin-top:20px"><a href="${appBase()}/admin/crew">Open the Agents tab</a> to approve or reject.</p></div>`;
}

export function modelLine(ctx: AgentContext): string {
  return `${ctx.def.name} on ${TIER_LABEL[ctx.tier]}`;
}
