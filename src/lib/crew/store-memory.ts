import { randomUUID } from "node:crypto";
import { DEFAULT_SETTINGS, type CrewStore, type NewApproval, type ReportRow, type RunRow, type UsageRow, type UsageTotals } from "./store";
import type { AgentState, Approval, ApprovalKind, ApprovalStatus, CrewInput, Finding, Lead, Platform, Settings, TeamId, TouchKind } from "./types";

// ── In-memory CrewStore for tests and local dry runs ───────────────────────
// Mirrors the SQL semantics that matter: the one-reply-per-thread unique
// index, the crew_claim_dm rule, lease claiming and lead de-duplication.

type Touch = { id: string; person_id: string; platform: string; kind: TouchKind; approval_id: string | null; at: string };

export class MemoryStore implements CrewStore {
  settings: Settings = { ...DEFAULT_SETTINGS, team_caps: {} };
  agents = new Map<string, AgentState>();
  runs: RunRow[] = [];
  usage: (UsageRow & { created_at: string })[] = [];
  approvals: Approval[] = [];
  people = new Map<string, { id: string; display_name: string | null }>();
  identities: { person_id: string; platform: string; handle_norm: string }[] = [];
  touches: Touch[] = [];
  findings: Finding[] = [];
  reports: ReportRow[] = [];
  inputs: CrewInput[] = [];
  limits = new Map<string, { ceiling: number; warmup_start: string }>();
  kv = new Map<string, unknown>();
  suppression = new Map<string, string>();
  leads: (Lead & { id: string; created_at: string; sheet_synced_at: string | null })[] = [];
  facts: { competitor: string; fact: string; value: string; source_url: string; seen_at: string }[] = [];
  isReady = true;
  clock: () => Date = () => new Date();

  private now() {
    return this.clock().toISOString();
  }

  async ready() {
    return this.isReady;
  }
  async getSettings() {
    return { ...this.settings };
  }
  async updateSettings(patch: Partial<Settings>) {
    this.settings = { ...this.settings, ...patch };
  }

  private blank(id: string): AgentState {
    return { id, enabled: false, model_override: null, daily_usd_cap: null, config: {}, last_run_at: null, next_run_at: null, lease_until: null, status_note: null };
  }
  async listAgentStates() {
    return [...this.agents.values()].map((a) => ({ ...a }));
  }
  async getAgentState(id: string) {
    return { ...(this.agents.get(id) ?? this.blank(id)) };
  }
  async patchAgentState(id: string, patch: Partial<Omit<AgentState, "id">>) {
    this.agents.set(id, { ...(this.agents.get(id) ?? this.blank(id)), ...patch });
  }
  async claimLease(id: string, until: Date, now: Date) {
    const a = this.agents.get(id) ?? this.blank(id);
    if (a.lease_until && new Date(a.lease_until).getTime() > now.getTime()) return false;
    this.agents.set(id, { ...a, lease_until: until.toISOString() });
    return true;
  }

  async startRun(agentId: string) {
    const id = randomUUID();
    this.runs.push({ id, agent_id: agentId, started_at: this.now(), finished_at: null, status: "running", summary: null, stats: {}, error: null });
    return id;
  }
  async finishRun(id: string, status: string, summary: string, stats: Record<string, number>, error?: string) {
    const r = this.runs.find((x) => x.id === id);
    if (r) Object.assign(r, { status, summary, stats, error: error ?? null, finished_at: this.now() });
  }
  async recentRuns(agentId: string | null, limit: number) {
    return this.runs.filter((r) => !agentId || r.agent_id === agentId).slice(-limit).reverse();
  }
  async runsSince(sinceIso: string) {
    return this.runs.filter((r) => r.started_at >= sinceIso);
  }

  async recordUsage(row: UsageRow) {
    this.usage.push({ ...row, created_at: this.now() });
  }
  async usageTotals(sinceIso: string): Promise<UsageTotals> {
    const t: UsageTotals = { total: { usd: 0, tokens: 0, cacheRead: 0, input: 0 }, byAgent: {}, byTeam: {} };
    for (const u of this.usage.filter((x) => x.created_at >= sinceIso)) {
      const tok = u.input_tokens + u.output_tokens + u.cache_read + u.cache_write;
      t.total.usd += u.cost_usd;
      t.total.tokens += tok;
      t.total.cacheRead += u.cache_read;
      t.total.input += u.input_tokens + u.cache_read + u.cache_write;
      (t.byAgent[u.agent_id] ??= { usd: 0, tokens: 0 }).usd += u.cost_usd;
      t.byAgent[u.agent_id].tokens += tok;
      (t.byTeam[u.team] ??= { usd: 0, tokens: 0 }).usd += u.cost_usd;
      t.byTeam[u.team].tokens += tok;
    }
    return t;
  }

  async insertApproval(a: NewApproval) {
    const live: ApprovalStatus[] = ["pending", "approved", "done"];
    if ((a.kind === "reply" || a.kind === "comment") && a.target_url) {
      const clash = this.approvals.find(
        (x) => (x.kind === "reply" || x.kind === "comment") && x.platform === (a.platform ?? null) && x.target_url === a.target_url && live.includes(x.status),
      );
      if (clash) return { conflict: true as const };
    }
    const id = randomUUID();
    const created = this.clock();
    this.approvals.push({
      id,
      created_at: created.toISOString(),
      agent_id: a.agent_id,
      team: a.team,
      kind: a.kind,
      status: "pending",
      title: a.title,
      summary: a.summary,
      body: a.body,
      platform: a.platform ?? null,
      target_url: a.target_url ?? null,
      person_id: a.person_id ?? null,
      debate: a.debate ?? null,
      model_used: a.model_used ?? null,
      meta: a.meta ?? {},
      decided_at: null,
      reject_reason: null,
      done_at: null,
      expires_at: new Date(created.getTime() + 7 * 86400_000).toISOString(),
    });
    return { id };
  }
  async getApproval(id: string) {
    const a = this.approvals.find((x) => x.id === id);
    return a ? { ...a } : null;
  }
  async listApprovals(f: { status?: ApprovalStatus[]; agentId?: string; sinceIso?: string; limit?: number }) {
    return this.approvals
      .filter((a) => (!f.status || f.status.includes(a.status)) && (!f.agentId || a.agent_id === f.agentId) && (!f.sinceIso || a.created_at >= f.sinceIso))
      .slice()
      .reverse()
      .slice(0, f.limit ?? 100);
  }
  async updateApproval(id: string, patch: Partial<Approval>) {
    const a = this.approvals.find((x) => x.id === id);
    if (a) Object.assign(a, patch);
  }
  async countPending(agentId: string) {
    return this.approvals.filter((a) => a.agent_id === agentId && a.status === "pending").length;
  }
  async recentDecisions(agentId: string, kind: ApprovalKind, n: number) {
    return this.approvals
      .filter((a) => a.agent_id === agentId && a.kind === kind && ["approved", "done", "rejected"].includes(a.status) && a.decided_at)
      .sort((x, y) => (y.decided_at! > x.decided_at! ? 1 : -1))
      .slice(0, n)
      .map((a) => a.status);
  }
  async countApprovalsCreatedSince(agentId: string, sinceIso: string) {
    return this.approvals.filter((a) => a.agent_id === agentId && a.created_at >= sinceIso).length;
  }
  async expireOld(now: Date) {
    let n = 0;
    for (const a of this.approvals) {
      if (a.status === "pending" && new Date(a.expires_at).getTime() < now.getTime()) {
        a.status = "expired";
        n++;
        await this.releaseDmClaim(a.id);
      }
    }
    return n;
  }

  async findPerson(platform: Platform, handleNorm: string) {
    return this.identities.find((i) => i.platform === platform && i.handle_norm === handleNorm)?.person_id ?? null;
  }
  async createPerson(displayName: string | null, platform: Platform, handleNorm: string) {
    // Synchronous check-and-insert, like the unique (platform, handle_norm) index.
    const existing = this.identities.find((i) => i.platform === platform && i.handle_norm === handleNorm)?.person_id;
    if (existing) return existing;
    const id = randomUUID();
    this.people.set(id, { id, display_name: displayName });
    this.identities.push({ person_id: id, platform, handle_norm: handleNorm });
    return id;
  }
  async linkIdentity(personId: string, platform: Platform, handleNorm: string) {
    if (!this.identities.some((i) => i.platform === platform && i.handle_norm === handleNorm)) {
      this.identities.push({ person_id: personId, platform, handle_norm: handleNorm });
    }
  }
  async addTouch(personId: string, platform: Platform, kind: TouchKind, approvalId: string | null) {
    this.touches.push({ id: randomUUID(), person_id: personId, platform, kind, approval_id: approvalId, at: this.now() });
  }
  async touchesFor(personId: string) {
    return this.touches.filter((t) => t.person_id === personId).map(({ platform, kind, at }) => ({ platform, kind, at }));
  }
  async identitiesFor(personId: string) {
    return this.identities.filter((i) => i.person_id === personId).map(({ platform, handle_norm }) => ({ platform, handle_norm }));
  }
  async claimDm(personId: string, approvalId: string) {
    if (this.touches.some((t) => t.person_id === personId && t.kind !== "lead_listed")) return false;
    const a = this.approvals.find((x) => x.id === approvalId);
    this.touches.push({ id: randomUUID(), person_id: personId, platform: a?.platform ?? "unknown", kind: "dm_drafted", approval_id: approvalId, at: this.now() });
    return true;
  }
  async releaseDmClaim(approvalId: string) {
    this.touches = this.touches.filter((t) => !(t.approval_id === approvalId && t.kind === "dm_drafted"));
  }
  async countTouchesSince(platform: Platform, kinds: TouchKind[], sinceIso: string) {
    return this.touches.filter((t) => t.platform === platform && kinds.includes(t.kind) && t.at >= sinceIso).length;
  }

  async getFinding(fp: string) {
    const f = this.findings.find((x) => x.fingerprint === fp);
    return f ? { ...f } : null;
  }
  async upsertFinding(f: Omit<Finding, "id" | "first_seen" | "approval_id"> & { approval_id?: string | null }) {
    const ex = this.findings.find((x) => x.fingerprint === f.fingerprint);
    if (ex) {
      Object.assign(ex, f, { approval_id: f.approval_id ?? ex.approval_id });
      return { ...ex };
    }
    const row: Finding = { ...f, id: randomUUID(), first_seen: this.now(), approval_id: f.approval_id ?? null };
    this.findings.push(row);
    return { ...row };
  }
  async patchFinding(id: string, patch: Partial<Finding>) {
    const f = this.findings.find((x) => x.id === id);
    if (f) Object.assign(f, patch);
  }
  async listFindings(status: Finding["status"][], limit: number) {
    return this.findings.filter((f) => status.includes(f.status)).slice(-limit).reverse();
  }

  async saveReport(r: { agent_id: string; team: TeamId; day: string; body: string; stats: Record<string, unknown> }) {
    const ex = this.reports.find((x) => x.agent_id === r.agent_id && x.day === r.day);
    if (ex) {
      Object.assign(ex, r);
      return ex.id;
    }
    const id = randomUUID();
    this.reports.push({ ...r, id, created_at: this.now(), emailed_at: null });
    return id;
  }
  async markReportEmailed(id: string) {
    const r = this.reports.find((x) => x.id === id);
    if (r) r.emailed_at = this.now();
  }
  async listReports(limit: number, team?: TeamId) {
    return this.reports.filter((r) => !team || r.team === team).slice(-limit).reverse();
  }

  async addInput(i: { platform: Platform; kind: CrewInput["kind"]; url: string | null; text: string }) {
    const id = randomUUID();
    this.inputs.push({ ...i, id, created_at: this.now(), status: "new" });
    return id;
  }
  async takeInputs(platforms: Platform[], limit: number) {
    const picked = this.inputs.filter((i) => i.status === "new" && platforms.includes(i.platform)).slice(0, limit);
    for (const p of picked) p.status = "used";
    return picked.map((p) => ({ ...p }));
  }
  async countNewInputs(platforms: Platform[]) {
    return this.inputs.filter((i) => i.status === "new" && platforms.includes(i.platform)).length;
  }

  async getRateLimit(platform: Platform, action: string) {
    return this.limits.get(`${platform}:${action}`) ?? null;
  }
  async setRateLimit(platform: Platform, action: string, ceiling: number, warmupStart?: string) {
    const prev = this.limits.get(`${platform}:${action}`);
    this.limits.set(`${platform}:${action}`, { ceiling, warmup_start: warmupStart ?? prev?.warmup_start ?? this.now().slice(0, 10) });
  }

  async kvGet<T>(key: string) {
    return (this.kv.has(key) ? (this.kv.get(key) as T) : null) as T | null;
  }
  async kvSet(key: string, value: unknown) {
    this.kv.set(key, value);
  }

  async isSuppressed(values: string[]) {
    return values.some((v) => this.suppression.has(v.toLowerCase()));
  }
  async addSuppression(value: string, reason: string) {
    this.suppression.set(value.toLowerCase(), reason);
  }
  async insertLeads(leads: Lead[]) {
    let n = 0;
    for (const l of leads) {
      if (l.email && this.leads.some((x) => x.list === l.list && x.email?.toLowerCase() === l.email!.toLowerCase())) continue;
      this.leads.push({ ...l, id: randomUUID(), created_at: this.now(), sheet_synced_at: null });
      n++;
    }
    return n;
  }
  async countLeadsSince(sinceIso: string, list?: Lead["list"]) {
    const out: Record<string, number> = {};
    for (const l of this.leads.filter((x) => x.created_at >= sinceIso && (!list || x.list === list))) out[l.source_platform] = (out[l.source_platform] ?? 0) + 1;
    return out;
  }
  async unsyncedLeads(list: Lead["list"], limit: number) {
    return this.leads.filter((l) => l.list === list && !l.sheet_synced_at && !l.region_restricted).slice(0, limit);
  }
  async markLeadsSynced(ids: string[]) {
    for (const l of this.leads) if (ids.includes(l.id)) l.sheet_synced_at = this.now();
  }
  async listLeads(list: Lead["list"], limit: number) {
    return this.leads.filter((l) => l.list === list).slice(-limit).reverse();
  }

  async competitorFacts() {
    return this.facts.map((f) => ({ ...f }));
  }
  async upsertCompetitorFact(f: { competitor: string; fact: string; value: string; source_url: string }) {
    const ex = this.facts.find((x) => x.competitor === f.competitor && x.fact === f.fact);
    if (ex) {
      const previous = ex.value;
      Object.assign(ex, f, { seen_at: this.now() });
      return { changed: previous !== f.value, previous };
    }
    this.facts.push({ ...f, seen_at: this.now() });
    return { changed: true, previous: null };
  }
}
