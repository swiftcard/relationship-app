import type { AgentDef } from "./agent-def";
import { BudgetStop } from "./budget";
import { DoorLocked, buildContext, type Providers } from "./context";
import { blockedBy, doorState } from "./doors";
import { crewHardDisabled, missingEnv } from "./env";
import { AGENTS } from "./registry";
import { SCHEDULE_OVERRIDES_KEY, effectiveSchedule, isDue, nextRun, type ScheduleOverrides } from "./schedule";
import type { CrewStore } from "./store";
import type { Schedule } from "./types";

// ── One tick of the clock ───────────────────────────────────────────────────
// .github/workflows/crew-tick.yml calls /api/crew/tick every 15 minutes. Each
// tick: stop at once if Crew is switched off, expire week-old inbox items,
// then run every agent that is on, set up and due, until the time budget is
// spent. A lease per agent means two overlapping ticks can never run the same
// agent twice.

export const LEASE_MS = 10 * 60_000;
export const TICK_BUDGET_MS = 240_000;
/** How late after its tick a run may start and still be due on the tick one interval later (the clock fires at :00, the run starts seconds after). */
export const TICK_SLACK_MS = 2 * 60_000;
/** Workers that run at the same time in one tick. */
export const TICK_CONCURRENCY = 6;
/** A run's deadline is the tick budget plus this (the route's limit is 300 s; the budget is 240 s). */
export const DEADLINE_SLACK_MS = 30_000;

/**
 * When an agent is next due. Normally one interval after its run finished.
 * The Sheet keepers (infrastructure) on an "every" schedule count from when
 * the run STARTED, less the tick slack: counted from the finish, a 15-minute
 * sync that ends at :00:35 is due at :15:35, after the :15 tick, and so runs
 * only every 30 minutes. Never earlier than the finish, so a run longer than
 * its interval is simply due on the next tick. Overlap is the lease's job.
 */
export function nextRunAt(def: Pick<AgentDef, "infrastructure">, schedule: Schedule, started: Date, finished: Date): Date {
  if (!def.infrastructure || schedule.kind !== "every") return nextRun(schedule, finished);
  return new Date(Math.max(nextRun(schedule, started).getTime() - TICK_SLACK_MS, finished.getTime()));
}

export type TickOutcome = { agent: string; status: string; summary: string };
export type TickReport = { ready: boolean; stopped?: string; expired: number; closed?: number; ran: TickOutcome[]; skipped: { agent: string; why: string }[] };

/** The owner's schedule changes from the Agents tab; a missing or unreadable row means every agent keeps its default. */
export async function scheduleOverrides(store: CrewStore): Promise<ScheduleOverrides> {
  try {
    return (await store.kvGet<ScheduleOverrides>(SCHEDULE_OVERRIDES_KEY)) ?? {};
  } catch {
    return {};
  }
}

export async function runAgent(o: { def: AgentDef; store: CrewStore; providers: Providers; now?: () => Date; schedule?: Schedule; deadline?: number }): Promise<TickOutcome> {
  const now = o.now ?? (() => new Date());
  const started = now();
  const runId = await o.store.startRun(o.def.id);
  let status = "ok";
  let summary = "";
  let stats: Record<string, number> = {};
  let note: string | null = null;
  let rest = 0;
  try {
    const ctx = await buildContext({ def: o.def, store: o.store, providers: o.providers, runId, now, deadline: o.deadline });
    stats = ctx.stats;
    const r = await o.def.run(ctx);
    status = r.status ?? "ok";
    summary = r.summary;
    rest = r.restMinutes ?? 0;
    stats = { ...ctx.stats, ...(r.stats ?? {}) };
    if (ctx.tierWhy) note = ctx.tierWhy;
  } catch (e) {
    if (e instanceof DoorLocked) {
      // The door was locked (or the agent paused) mid-shift: stop quietly.
      status = "locked";
      summary = e.reason;
    } else if (e instanceof BudgetStop) {
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
  // A continuous agent with nothing new, or at today's ceiling, rests instead of paying for searches that find nothing.
  const next = new Date(Math.max(nextRunAt(o.def, o.schedule ?? o.def.schedule, started, t).getTime(), t.getTime() + rest * 60_000));
  await o.store.patchAgentState(o.def.id, {
    last_run_at: t.toISOString(),
    next_run_at: next.toISOString(),
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
  // Pause all stops every agent but the Sheet keepers (infrastructure): they
  // never send anything, and they are what reads the Sheet's Controls, so a
  // Pause all set in the Sheet can also be lifted from the Sheet.
  let settings = await o.store.getSettings();
  const readStates = async () => new Map((await o.store.listAgentStates()).map((s) => [s.id, s]));

  report.expired = await o.store.expireOld(now());
  // A run the platform cut off (the function's time limit) never reaches
  // finishRun, and stayed "running" forever: 6 competitor-watch runs from
  // 2026-10-21..26 were still running on 10-28. Once its lease is long gone
  // it is not running, so it is closed as an error and says why.
  report.closed = await o.store.closeStaleRuns(new Date(now().getTime() - LEASE_MS), now());
  let states = await readStates();
  const teams = new Map((await o.store.listTeams()).map((t) => [t.team, t]));
  let overrides = await scheduleOverrides(o.store);
  // The Sheet keepers go first; the switches are read again after them, so a
  // Start, Stop, schedule or Pause set in the Sheet applies in this same tick.
  const agents = [...(o.agents ?? AGENTS)].sort((a, b) => Number(!!b.infrastructure) - Number(!!a.infrastructure));
  let stale = false;
  const queue: { def: AgentDef; schedule: Schedule }[] = [];

  for (const def of agents) {
    if (stale && !def.infrastructure) {
      [settings, states, overrides] = await Promise.all([o.store.getSettings(), readStates(), scheduleOverrides(o.store)]);
      stale = false;
    }
    const st = states.get(def.id);
    if (!def.infrastructure) {
      if (settings.kill_all || !st?.enabled) continue;
      if (def.locked) {
        report.skipped.push({ agent: def.id, why: def.locked });
        continue;
      }
      // A locked door or a pause holds the shift; next_run_at stays put, so an
      // overdue agent runs once as soon as the door opens.
      const blocked = blockedBy(def, st, doorState(teams.get(def.team), { team: def.team, settings, hardDisabled: false }, now()), now());
      if (blocked) {
        report.skipped.push({ agent: def.id, why: blocked });
        continue;
      }
    }
    const missing = missingEnv(def.needs);
    if (missing.length) {
      await o.store.patchAgentState(def.id, { status_note: `Needs: ${missing.join(", ")}` });
      report.skipped.push({ agent: def.id, why: `needs ${missing.join(", ")}` });
      continue;
    }
    const due = def.schedule.kind === "on_input" ? (await o.store.countNewInputs(def.schedule.platforms)) > 0 : isDue(st?.next_run_at ?? null, now());
    if (!due) continue;
    if (now().getTime() - started > budget) {
      report.skipped.push({ agent: def.id, why: "out of time this tick" });
      continue;
    }
    if (!(await o.store.claimLease(def.id, new Date(now().getTime() + LEASE_MS), now()))) {
      report.skipped.push({ agent: def.id, why: "already running" });
      continue;
    }
    if (def.infrastructure) {
      report.ran.push(await runAgent({ def, store: o.store, providers: o.providers, now, schedule: effectiveSchedule(def, overrides) }));
      stale = true;
    } else queue.push({ def, schedule: effectiveSchedule(def, overrides) });
  }
  // The workers run side by side, a few at a time (2026-10-29): one after
  // another, a tick's 4 minutes fit 3 or 4 of them, so with 8 on each ran
  // about every 45 minutes, far short of 100 messages a day each. Each run
  // gets the tick's deadline and stops drafting in time (engine.ts).
  const deadline = started + budget + DEADLINE_SLACK_MS;
  const results: (TickOutcome | null)[] = new Array(queue.length).fill(null);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < queue.length; i = next++) {
      const { def, schedule } = queue[i];
      if (now().getTime() - started > budget) {
        // Its turn came too late in the tick: it runs first thing next tick.
        await o.store.patchAgentState(def.id, { lease_until: null });
        report.skipped.push({ agent: def.id, why: "out of time this tick" });
        continue;
      }
      results[i] = await runAgent({ def, store: o.store, providers: o.providers, now, schedule, deadline });
    }
  };
  await Promise.all(Array.from({ length: Math.min(TICK_CONCURRENCY, queue.length) }, worker));
  report.ran.push(...results.filter((r): r is TickOutcome => !!r));
  if (settings.kill_all) report.stopped = "The whole office is locked.";
  return report;
}
