import type {
  AgentState,
  Approval,
  ApprovalKind,
  ApprovalStatus,
  CrewInput,
  Finding,
  Lead,
  Platform,
  Settings,
  TeamId,
  TouchKind,
} from "./types";

// ── Storage contract ────────────────────────────────────────────────────────
// Everything Crew persists goes through this interface. store-supabase.ts is
// the real one (service role, tables from supabase/crew.sql); store-memory.ts
// backs the tests, so the whole loop (tick → agent → debate → ledger →
// approval → decide) runs in CI with no database and no network.

export const DEFAULT_SETTINGS: Settings = {
  kill_all: false,
  daily_usd_cap: 2,
  team_caps: {},
  disclosure_on: true,
  disclosure: "(I work on SwiftCard, so I'm biased.)",
  economy: true,
  second_opinion: false,
};

export type UsageRow = {
  run_id: string | null;
  agent_id: string;
  team: TeamId;
  provider: "anthropic" | "openai";
  model: string;
  purpose: string;
  input_tokens: number;
  output_tokens: number;
  cache_read: number;
  cache_write: number;
  web_searches: number;
  batch: boolean;
  cost_usd: number;
};

export type UsageTotals = {
  total: { usd: number; tokens: number; cacheRead: number; input: number };
  byAgent: Record<string, { usd: number; tokens: number }>;
  byTeam: Record<string, { usd: number; tokens: number }>;
};

export type NewApproval = {
  agent_id: string;
  team: TeamId;
  kind: ApprovalKind;
  title: string;
  summary: string;
  body: string;
  platform?: Platform | null;
  target_url?: string | null;
  person_id?: string | null;
  debate?: Approval["debate"];
  model_used?: string | null;
  meta?: Record<string, unknown>;
};

export type RunRow = {
  id: string;
  agent_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  summary: string | null;
  stats: Record<string, number>;
  error: string | null;
};

export type ReportRow = { id: string; created_at: string; agent_id: string; team: TeamId; day: string; body: string; stats: Record<string, unknown>; emailed_at: string | null };

export interface CrewStore {
  /** False until supabase/crew.sql has been applied. */
  ready(): Promise<boolean>;

  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<void>;

  listAgentStates(): Promise<AgentState[]>;
  getAgentState(id: string): Promise<AgentState>;
  patchAgentState(id: string, patch: Partial<Omit<AgentState, "id">>): Promise<void>;
  /** Atomic: true only if no live lease exists. */
  claimLease(id: string, until: Date, now: Date): Promise<boolean>;

  startRun(agentId: string): Promise<string>;
  finishRun(id: string, status: string, summary: string, stats: Record<string, number>, error?: string): Promise<void>;
  recentRuns(agentId: string | null, limit: number): Promise<RunRow[]>;
  runsSince(sinceIso: string): Promise<RunRow[]>;

  recordUsage(row: UsageRow): Promise<void>;
  usageTotals(sinceIso: string): Promise<UsageTotals>;

  insertApproval(a: NewApproval): Promise<{ id: string } | { conflict: true }>;
  getApproval(id: string): Promise<Approval | null>;
  listApprovals(filter: { status?: ApprovalStatus[]; agentId?: string; sinceIso?: string; limit?: number }): Promise<Approval[]>;
  updateApproval(id: string, patch: Partial<Approval>): Promise<void>;
  countPending(agentId: string): Promise<number>;
  /** Most recent decided statuses (approved/done/rejected) for one agent and kind, newest first. */
  recentDecisions(agentId: string, kind: ApprovalKind, n: number): Promise<ApprovalStatus[]>;
  countApprovalsCreatedSince(agentId: string, sinceIso: string): Promise<number>;
  expireOld(now: Date): Promise<number>;

  findPerson(platform: Platform, handleNorm: string): Promise<string | null>;
  createPerson(displayName: string | null, platform: Platform, handleNorm: string): Promise<string>;
  linkIdentity(personId: string, platform: Platform, handleNorm: string): Promise<void>;
  addTouch(personId: string, platform: Platform, kind: TouchKind, approvalId: string | null): Promise<void>;
  touchesFor(personId: string): Promise<{ platform: string; kind: TouchKind; at: string }[]>;
  identitiesFor(personId: string): Promise<{ platform: string; handle_norm: string }[]>;
  /** The hard DM rule, atomically (SQL function crew_claim_dm). */
  claimDm(personId: string, approvalId: string): Promise<boolean>;
  releaseDmClaim(approvalId: string): Promise<void>;
  countTouchesSince(platform: Platform, kinds: TouchKind[], sinceIso: string): Promise<number>;

  getFinding(fingerprint: string): Promise<Finding | null>;
  upsertFinding(f: Omit<Finding, "id" | "first_seen" | "approval_id"> & { approval_id?: string | null }): Promise<Finding>;
  patchFinding(id: string, patch: Partial<Finding>): Promise<void>;
  listFindings(status: Finding["status"][], limit: number): Promise<Finding[]>;

  saveReport(r: { agent_id: string; team: TeamId; day: string; body: string; stats: Record<string, unknown> }): Promise<string>;
  markReportEmailed(id: string): Promise<void>;
  listReports(limit: number, team?: TeamId): Promise<ReportRow[]>;

  addInput(i: { platform: Platform; kind: CrewInput["kind"]; url: string | null; text: string }): Promise<string>;
  takeInputs(platforms: Platform[], limit: number, agentId: string): Promise<CrewInput[]>;
  countNewInputs(platforms: Platform[]): Promise<number>;
  /** Read-only look at pasted inputs (any status), oldest first. */
  listInputsSince(platforms: Platform[], sinceIso: string, limit: number): Promise<CrewInput[]>;

  getRateLimit(platform: Platform, action: string): Promise<{ ceiling: number; warmup_start: string } | null>;
  setRateLimit(platform: Platform, action: string, ceiling: number, warmupStart?: string): Promise<void>;

  kvGet<T>(key: string): Promise<T | null>;
  kvSet(key: string, value: unknown): Promise<void>;

  isSuppressed(emailOrDomain: string[]): Promise<boolean>;
  addSuppression(value: string, reason: string): Promise<void>;
  insertLeads(leads: Lead[]): Promise<number>;
  countLeadsSince(sinceIso: string, list?: Lead["list"]): Promise<Record<string, number>>;
  unsyncedLeads(list: Lead["list"], limit: number): Promise<(Lead & { id: string; created_at: string })[]>;
  markLeadsSynced(ids: string[]): Promise<void>;
  listLeads(list: Lead["list"], limit: number): Promise<(Lead & { id: string; created_at: string })[]>;

  competitorFacts(): Promise<{ competitor: string; fact: string; value: string; source_url: string; seen_at: string }[]>;
  upsertCompetitorFact(f: { competitor: string; fact: string; value: string; source_url: string }): Promise<{ changed: boolean; previous: string | null }>;
}
