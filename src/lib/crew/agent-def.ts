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
  run(ctx: AgentContext): Promise<RunResult>;
};
