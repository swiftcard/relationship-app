import type { AgentDef } from "./agent-def";
import { BudgetStop } from "./budget";
import { buildContext, type Providers } from "./context";
import { crewHardDisabled, missingEnv } from "./env";
import { AGENTS } from "./registry";
import { isDue, nextRun } from "./schedule";
import type { CrewStore } from "./store";

// ── One tick of the clock ───────────────────────────────────────────────────
// .github/workflows/crew-tick.yml calls /api/crew/tick every 15 minutes. Each
// tick: stop at once if Crew is switched off, expire week-old inbox items,
// then run every agent that is on, set up and due, until the time budget is
// spent. A lease per agent means two overlapping ticks can never run the same
// agent twice.

export const LEASE_MS = 10 * 60_000;
export const TICK_BUDGET_MS = 240_000;

export type TickOutcome = { agent: string; status: string; summary: string };
export type TickReport = { ready: boolean; stopped?: string; expired: number; ran: TickOutcome[]; skipped: { agent: string; why: string }[] };

export async function runAgent(o: { def: AgentDef; store: CrewStore; providers: Providers; now?: () => Date }): Promise<TickOutcome> {
  const now = o.now ?? (() => new Date());
  const runId = await o.store.startRun(o.def.id);
  let status = "ok";
  let summary = "";
  let stats: Record<string, number> = {};
  let note: string | null = null;
  try {
    const ctx = await buildContext({ def: o.def, store: o.store, providers: o.providers, runId, now });
    stats = ctx.stats;
    const r = await o.def.run(ctx);
    status = r.status ?? "ok";
    summary = r.summary;
    stats = { ...ctx.stats, ...(r.stats ?? {}) };
    if (ctx.tierWhy) note = ctx.tierWhy;
  } catch (e) {
    if (e instanceof BudgetStop) {
      status = "budget";
      summary = e.reason;
      note = e.reason;
    } else {
      status = "error";
      summary = e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300);
      note = `Last run failed: ${summary}`;
      try {
        const { reportError } = await import("@/lib/report-error");
        await reportError(`crew:${o.def.id}`, e);
      } catch {
        /* reporting must never break the tick */
      }
    }
  }
  await o.store.finishRun(runId, status, summary, stats, status === "error" ? summary : undefined);
  const t = now();
  await o.store.patchAgentState(o.def.id, {
    last_run_at: t.toISOString(),
    next_run_at: nextRun(o.def.schedule, t).toISOString(),
    lease_until: null,
    status_note: note,
  });
  return { agent: o.def.id, status, summary };
}

export async function runTick(o: { store: CrewStore; providers: Providers; now?: () => Date; budgetMs?: number; agents?: AgentDef[] }): Promise<TickReport> {
  const now = o.now ?? (() => new Date());
  const started = now().getTime();
  const budget = o.budgetMs ?? TICK_BUDGET_MS;
  const report: TickReport = { ready: true, expired: 0, ran: [], skipped: [] };
  if (!(await o.store.ready())) return { ...report, ready: false, stopped: "Run supabase/crew.sql first." };
  if (crewHardDisabled()) return { ...report, stopped: "CREW_DISABLED is set." };
  const settings = await o.store.getSettings();
  if (settings.kill_all) return { ...report, stopped: "The big red switch is on." };

  report.expired = await o.store.expireOld(now());
  const states = new Map((await o.store.listAgentStates()).map((s) => [s.id, s]));

  for (const def of o.agents ?? AGENTS) {
    const st = states.get(def.id);
    if (!st?.enabled) continue;
    if (def.locked) {
      report.skipped.push({ agent: def.id, why: def.locked });
      continue;
    }
    const missing = missingEnv(def.needs);
    if (missing.length) {
      await o.store.patchAgentState(def.id, { status_note: `Needs: ${missing.join(", ")}` });
      report.skipped.push({ agent: def.id, why: `needs ${missing.join(", ")}` });
      continue;
    }
    const due = def.schedule.kind === "on_input" ? (await o.store.countNewInputs(def.schedule.platforms)) > 0 : isDue(st.next_run_at, now());
    if (!due) continue;
    if (now().getTime() - started > budget) {
      report.skipped.push({ agent: def.id, why: "out of time this tick" });
      continue;
    }
    if (!(await o.store.claimLease(def.id, new Date(now().getTime() + LEASE_MS), now()))) {
      report.skipped.push({ agent: def.id, why: "already running" });
      continue;
    }
    report.ran.push(await runAgent({ def, store: o.store, providers: o.providers, now }));
  }
  return report;
}
