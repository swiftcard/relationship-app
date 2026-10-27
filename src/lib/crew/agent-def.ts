import type { AgentContext } from "./context";
import type { ApprovalKind, EnvKey, Role, RunResult, Schedule, TeamId, Tier } from "./types";

// ── What one agent is ───────────────────────────────────────────────────────
// Every agent in the system is one of these, listed in registry.ts. An agent
// starts switched OFF; one whose `needs` are missing shows "Needs: X" in the
// Agents tab and cannot be switched on.

export type AgentDef = {
  id: string;
  /** Short friendly name shown in the tab, e.g. "Reddit replies". */
  name: string;
  team: TeamId;
  role: Role;
  tier: Tier;
  /** The model in economy mode (Settings → Economy), when cheaper than `tier`. */
  economyTier?: Tier;
  /** Runs with no AI at all in economy mode (the Watchdog and the managers). */
  freeInEconomy?: boolean;
  schedule: Schedule;
  /** Default daily $ cap; the tab can lower or raise it per agent. */
  dailyUsd: number;
  needs: EnvKey[];
  /** Stops drafting while this many of its items wait in the inbox. */
  maxPending: number;
  /** One plain sentence: what it does. */
  purpose: string;
  approvalKind?: ApprovalKind;
  /** Set when it must never be switched on (e.g. it would break a platform's rules). */
  locked?: string;
  /**
   * While it is on, it keeps working: a run every clock tick (15 minutes)
   * until today's ceiling, each run trying new searches so it never repeats
   * itself. Start / Stop on the admin page turns it on and off. A run can ask
   * to rest (RunResult.restMinutes) when there is nothing new or the day's
   * ceiling is reached, so an idle agent costs nothing.
   */
  continuous?: boolean;
  /**
   * Runs on its schedule whether or not anyone switched it on, and through
   * Pause all (only CREW_DISABLED stops it). For code-only plumbing that never
   * sends, posts or calls a model: the Sheet sync and the daily snapshot.
   */
  infrastructure?: boolean;
  run(ctx: AgentContext): Promise<RunResult>;
};
