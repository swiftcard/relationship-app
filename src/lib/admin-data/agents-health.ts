import { getAdminSupabase } from "@/lib/supabase-admin";
import { paged } from "@/lib/crew/paged";
import { AGENTS } from "@/lib/crew/registry";
import { missingEnv } from "@/lib/crew/env";
import type { AgentDef } from "@/lib/crew/agent-def";

// ── Are the agents working? One read-only answer for the admin ──────────────
//
// The owner, 2026-10-28: "make sure all the agents are properly connected to
// the sheet and working". On that day Pause all had been on for a day and
// nothing in the admin said so, the Sheet sync's failures were invisible
// outside the Agents tab, and six runs had said "running" for a week. This is
// what the Overview's "Needs your attention" and the notification center read.
// It only reads; Start, Stop and Pause all stay on the Agents tab.

/** How many failed runs in a row make an agent "failing". */
export const FAILING_AFTER = 3;

export type AgentRun = { agent_id: string; status: string; started_at: string; finished_at: string | null; summary: string | null };
export type AgentStateRow = { id: string; enabled: boolean; next_run_at: string | null; status_note: string | null };

export type AgentHealth = {
  id: string;
  name: string;
  on: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastSummary: string | null;
  nextRunAt: string | null;
  failuresInARow: number;
  /** Connection keys it can't run without, by name only. */
  needs: string[];
};

export type AgentsHealth = {
  paused: boolean;
  /** When the settings last changed while paused — when Pause all went on. */
  pausedSince: string | null;
  sheet: { lastGoodSync: string | null; failuresInARow: number; lastError: string | null; rowsByTab: { tab: string; rows: number }[] };
  agents: AgentHealth[];
  /** Drafts waiting for the owner's Approve. */
  waiting: number;
};

/** Failed runs since the last one that wasn't, newest first in `runs`. */
export function failuresInARow(runs: AgentRun[]): number {
  let n = 0;
  for (const r of runs) {
    if (r.status === "running") continue; // not an answer yet
    if (r.status !== "error") break;
    n++;
  }
  return n;
}

/** The pure part: everything the reader fetched, in one picture. `runs` newest first. */
export function summarizeAgents(o: {
  killAll: boolean;
  settingsUpdatedAt: string | null;
  states: AgentStateRow[];
  runs: AgentRun[];
  sheetRows: { tab: string }[];
  waiting: number;
  defs?: AgentDef[];
  missing?: (d: AgentDef) => string[];
}): AgentsHealth {
  const defs = (o.defs ?? AGENTS).filter((d) => !d.locked);
  const missing = o.missing ?? ((d: AgentDef) => missingEnv(d.needs));
  const byAgent = new Map<string, AgentRun[]>();
  for (const r of o.runs) {
    const list = byAgent.get(r.agent_id) ?? [];
    list.push(r);
    byAgent.set(r.agent_id, list);
  }
  const state = new Map(o.states.map((s) => [s.id, s]));

  const sync = byAgent.get("sheet-sync") ?? [];
  const lastGood = sync.find((r) => r.status === "ok" && r.finished_at);
  const lastBad = sync.find((r) => r.status === "error");

  const tabs = new Map<string, number>();
  for (const r of o.sheetRows) tabs.set(r.tab, (tabs.get(r.tab) ?? 0) + 1);

  return {
    paused: o.killAll,
    pausedSince: o.killAll ? o.settingsUpdatedAt : null,
    sheet: {
      lastGoodSync: lastGood?.finished_at ?? null,
      failuresInARow: failuresInARow(sync),
      lastError: failuresInARow(sync) > 0 ? lastBad?.summary ?? null : null,
      rowsByTab: [...tabs.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tab, rows]) => ({ tab, rows })),
    },
    agents: defs.map((d) => {
      const runs = byAgent.get(d.id) ?? [];
      const last = runs.find((r) => r.status !== "running") ?? runs[0];
      const st = state.get(d.id);
      return {
        id: d.id,
        name: d.name,
        on: !!st?.enabled || !!d.infrastructure,
        lastRunAt: last?.finished_at ?? last?.started_at ?? null,
        lastStatus: last?.status ?? null,
        lastSummary: last?.summary ?? null,
        nextRunAt: st?.next_run_at ?? null,
        failuresInARow: failuresInARow(runs),
        needs: missing(d),
      };
    }),
    waiting: o.waiting,
  };
}

/** The live read. Runs from the last 14 days are enough to see a streak. */
export async function agentsHealth(now = new Date()): Promise<AgentsHealth> {
  const admin = getAdminSupabase();
  const since = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const [settings, states, runs, sheetRows, waiting] = await Promise.all([
    admin.from("crew_settings").select("kill_all, updated_at").limit(1).maybeSingle(),
    paged<AgentStateRow>((f, t) => admin.from("crew_agents").select("id, enabled, next_run_at, status_note").order("id").range(f, t), 5000, "agents"),
    paged<AgentRun>((f, t) => admin.from("crew_runs").select("agent_id, status, started_at, finished_at, summary").gte("started_at", since)
      .order("started_at", { ascending: false }).order("id").range(f, t), 50_000, "runs"),
    paged<{ tab: string }>((f, t) => admin.from("crew_sheet_rows").select("tab").order("id").range(f, t), 100_000, "sheet rows"),
    admin.from("crew_approvals").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  return summarizeAgents({
    killAll: settings.data?.kill_all === true,
    settingsUpdatedAt: (settings.data?.updated_at as string | undefined) ?? null,
    states,
    runs,
    sheetRows,
    waiting: waiting.count ?? 0,
  });
}

/** What the owner should hear about, worst first. Shared by the Overview and the notification center. */
export function agentsAttention(h: AgentsHealth): { key: string; tone: "bad" | "warn"; n: number; text: string }[] {
  const failing = h.agents.filter((a) => a.on && a.failuresInARow >= FAILING_AFTER && a.id !== "sheet-sync");
  const needSetup = h.agents.filter((a) => a.on && a.needs.length > 0);
  return [
    { key: "sheet", tone: "bad" as const, n: h.sheet.failuresInARow >= FAILING_AFTER ? h.sheet.failuresInARow : 0, text: "Sheet syncs failed in a row — the Google Sheet isn't updating" },
    { key: "failing", tone: "bad" as const, n: failing.length, text: `${failing.length === 1 ? "agent has" : "agents have"} failed ${FAILING_AFTER} runs in a row: ${failing.map((a) => a.name).join(", ")}` },
    { key: "paused", tone: "warn" as const, n: h.paused ? 1 : 0, text: "Every agent is paused (Pause all is on) — only the Sheet keeps updating" },
    { key: "setup", tone: "warn" as const, n: needSetup.length, text: `${needSetup.length === 1 ? "agent needs" : "agents need"} a connection before it can run: ${needSetup.map((a) => `${a.name} (${a.needs.join(", ")})`).join("; ")}` },
    { key: "waiting", tone: "warn" as const, n: h.waiting, text: `${h.waiting === 1 ? "draft is" : "drafts are"} waiting for your Approve` },
  ].filter((x) => x.n > 0);
}
