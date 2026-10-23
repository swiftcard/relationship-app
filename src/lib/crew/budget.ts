import type { UsageTotals } from "./store";
import type { AgentState, ApprovalStatus, Settings, TeamId, Tier } from "./types";

// ── Budgets, the kill switch and model escalation ───────────────────────────
// Checked BEFORE every model call, not after: a cap that is only read at the
// end of a run is a report, not a cap. Pure functions so the tests can pin
// every branch.

export class BudgetStop extends Error {
  constructor(public reason: string) {
    super(reason);
    this.name = "BudgetStop";
  }
}

export type BudgetCheck = { ok: true } | { ok: false; reason: string };

export function checkBudget(i: {
  hardDisabled: boolean;
  settings: Settings;
  state: AgentState;
  agent: { id: string; team: TeamId; dailyUsd: number };
  totals: UsageTotals;
  estUsd: number;
}): BudgetCheck {
  if (i.hardDisabled) return { ok: false, reason: "CREW_DISABLED is set, so every agent is stopped." };
  if (i.settings.kill_all) return { ok: false, reason: "The whole office is locked, so nobody works." };
  if (!i.state.enabled) return { ok: false, reason: "This agent is switched off." };

  const agentCap = i.state.daily_usd_cap ?? i.agent.dailyUsd;
  const agentSpent = i.totals.byAgent[i.agent.id]?.usd ?? 0;
  if (agentSpent + i.estUsd > agentCap) {
    return { ok: false, reason: `Hit its daily limit: $${agentSpent.toFixed(2)} of $${agentCap.toFixed(2)}.` };
  }
  const teamCap = i.settings.team_caps[i.agent.team]?.usd;
  const teamSpent = i.totals.byTeam[i.agent.team]?.usd ?? 0;
  if (teamCap !== undefined && teamSpent + i.estUsd > teamCap) {
    return { ok: false, reason: `The ${i.agent.team} team hit its daily limit: $${teamSpent.toFixed(2)} of $${teamCap.toFixed(2)}.` };
  }
  if (i.totals.total.usd + i.estUsd > i.settings.daily_usd_cap) {
    return { ok: false, reason: `All agents together hit today's limit: $${i.totals.total.usd.toFixed(2)} of $${i.settings.daily_usd_cap.toFixed(2)}.` };
  }
  return { ok: true };
}

/** One step up when drafts keep getting rejected. */
const NEXT_TIER: Partial<Record<Tier, Tier>> = { haiku: "sonnet", sonnet: "opus" };
const NAME: Record<Tier, string> = { haiku: "Haiku", sonnet: "Sonnet", opus: "Opus", fable: "Fable" };

/**
 * Cheapest model that is getting approved. Rule: 3 or more rejections in the
 * last 5 decisions → one step up (Haiku → Sonnet, Sonnet → Opus); 3 approvals
 * in a row → back to the base model. `decisions` is newest first. A manual
 * override always wins.
 */
export function pickTier(base: Tier, override: Tier | null, decisions: ApprovalStatus[]): { tier: Tier; why: string | null } {
  if (override) return { tier: override, why: override === base ? null : "Set by hand in the Agents tab." };
  const up = NEXT_TIER[base];
  if (!up) return { tier: base, why: null };
  const last3 = decisions.slice(0, 3);
  if (last3.length === 3 && last3.every((s) => s !== "rejected")) return { tier: base, why: null };
  const rejected = decisions.slice(0, 5).filter((s) => s === "rejected").length;
  if (rejected >= 3) return { tier: up, why: `Upgraded to ${NAME[up]} because ${rejected} of the last ${Math.min(5, decisions.length)} drafts were rejected.` };
  return { tier: base, why: null };
}

/** Rough upper estimate before a call, so the check runs before the money is spent. */
export function estimateUsd(promptChars: number, maxTokens: number, price: { input: number; output: number }, webSearches = 0): number {
  const inTok = promptChars / 3.5;
  const outTok = maxTokens * 0.5;
  return (inTok * price.input + outTok * price.output) / 1_000_000 + webSearches * 0.01;
}
