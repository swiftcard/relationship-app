import { getAdminSupabase } from "@/lib/supabase-admin";
import { companyKey } from "./leads/quality";
import { paged } from "./paged";
import { DEFAULT_SETTINGS, DOOR_TEAMS, STALE_RUN_SUMMARY, defaultTeam, type CrewStore, type NewApproval, type ReportRow, type RunRow, type SuppressionRow, type UsageRow, type UsageTotals } from "./store";
import type { ActivityRow, AgentState, Approval, ApprovalKind, ApprovalStatus, ChatMessage, CrewInput, EditRow, Finding, Lead, OfficeHours, Platform, Settings, SheetRow, TeamId, TeamRow, TouchKind } from "./types";

// ── The real CrewStore: service-role Supabase, tables from supabase/crew.sql ─
// Server-only (it imports the service-role client; tests/server-only-boundary
// keeps every client component away from it).

type Row = Record<string, unknown>;

/** The columns supabase/crew-leads-quality.sql adds to crew_leads. */
const LEAD_QUALITY_COLUMNS = ["company_key", "email_status", "score", "why", "hook", "message"] as const;
function withoutQuality(l: Lead): Lead {
  const out: Record<string, unknown> = { ...l };
  for (const c of LEAD_QUALITY_COLUMNS) delete out[c];
  return out as Lead;
}
/** A column the database doesn't have yet (PostgREST's schema cache, or Postgres itself). */
function missingColumn(e: { code?: string; message: string }): boolean {
  return e.code === "PGRST204" || e.code === "42703" || /column .* does not exist|could not find the '.*' column/i.test(e.message);
}

function must<T>(res: { data: T; error: { message: string; code?: string } | null }, what: string): T {
  if (res.error) throw new Error(`crew store ${what}: ${res.error.message}`);
  return res.data;
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));

export class SupabaseStore implements CrewStore {
  private db = getAdminSupabase();

  async ready() {
    const { error } = await this.db.from("crew_settings").select("id").limit(1);
    return !error;
  }

  async getSettings(): Promise<Settings> {
    const { data } = await this.db.from("crew_settings").select("*").eq("id", 1).maybeSingle();
    if (!data) return { ...DEFAULT_SETTINGS };
    return {
      kill_all: !!data.kill_all,
      daily_usd_cap: num(data.daily_usd_cap),
      team_caps: (data.team_caps ?? {}) as Settings["team_caps"],
      disclosure_on: !!data.disclosure_on,
      disclosure: String(data.disclosure ?? DEFAULT_SETTINGS.disclosure),
      // Columns from supabase/crew-economy.sql; the defaults hold until it runs.
      economy: data.economy ?? DEFAULT_SETTINGS.economy,
      second_opinion: data.second_opinion ?? DEFAULT_SETTINGS.second_opinion,
    };
  }
  async updateSettings(patch: Partial<Settings>) {
    must(await this.db.from("crew_settings").upsert({ id: 1, ...patch, updated_at: new Date().toISOString() }), "settings");
  }

  private toState(r: Row): AgentState {
    return {
      id: String(r.id),
      enabled: !!r.enabled,
      model_override: (r.model_override as AgentState["model_override"]) ?? null,
      daily_usd_cap: r.daily_usd_cap == null ? null : num(r.daily_usd_cap),
      config: (r.config ?? {}) as Record<string, unknown>,
      last_run_at: (r.last_run_at as string) ?? null,
      next_run_at: (r.next_run_at as string) ?? null,
      lease_until: (r.lease_until as string) ?? null,
      status_note: (r.status_note as string) ?? null,
      // Columns from supabase/crew-office.sql.
      paused_until: (r.paused_until as string) ?? null,
      pause_note: (r.pause_note as string) ?? null,
    };
  }
  async listAgentStates() {
    const data = must(await this.db.from("crew_agents").select("*"), "agents");
    return (data ?? []).map((r) => this.toState(r));
  }
  async getAgentState(id: string) {
    const { data } = await this.db.from("crew_agents").select("*").eq("id", id).maybeSingle();
    return data ? this.toState(data) : this.toState({ id });
  }
  async patchAgentState(id: string, patch: Partial<Omit<AgentState, "id">>) {
    must(await this.db.from("crew_agents").upsert({ id, ...patch, updated_at: new Date().toISOString() }), "agent patch");
  }
  async claimLease(id: string, until: Date, now: Date) {
    // Make sure the row exists, then take the lease only if it is free.
    await this.db.from("crew_agents").upsert({ id }, { onConflict: "id", ignoreDuplicates: true });
    const { data } = await this.db
      .from("crew_agents")
      .update({ lease_until: until.toISOString() })
      .eq("id", id)
      .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`)
      .select("id");
    return (data ?? []).length === 1;
  }

  async startRun(agentId: string) {
    const data = must(await this.db.from("crew_runs").insert({ agent_id: agentId }).select("id").single(), "start run");
    return String((data as Row).id);
  }
  async finishRun(id: string, status: string, summary: string, stats: Record<string, number>, error?: string) {
    await this.db.from("crew_runs").update({ status, summary, stats, error: error ?? null, finished_at: new Date().toISOString() }).eq("id", id);
  }
  async recentRuns(agentId: string | null, limit: number, agentIds?: string[]) {
    return paged<RunRow>(
      (from, to) => {
        let q = this.db.from("crew_runs").select("*").order("started_at", { ascending: false }).order("id");
        if (agentId) q = q.eq("agent_id", agentId);
        if (agentIds) q = q.in("agent_id", agentIds);
        return q.range(from, to);
      },
      limit,
      "runs",
    );
  }
  async closeStaleRuns(before: Date, now: Date) {
    const data = must(
      await this.db.from("crew_runs")
        .update({ status: "error", summary: STALE_RUN_SUMMARY, error: STALE_RUN_SUMMARY, finished_at: now.toISOString() })
        .eq("status", "running").is("finished_at", null).lt("started_at", before.toISOString())
        .select("id"),
      "close stale runs",
    );
    return (data ?? []).length;
  }
  async runsSince(sinceIso: string, agentIds?: string[]) {
    return paged<RunRow>(
      (from, to) => {
        let q = this.db.from("crew_runs").select("*").gte("started_at", sinceIso).order("started_at").order("id");
        if (agentIds) q = q.in("agent_id", agentIds);
        return q.range(from, to);
      },
      20000,
      "runs since",
    );
  }

  async recordUsage(row: UsageRow) {
    // Never lose a usage row silently: the budget depends on it.
    must(await this.db.from("crew_usage").insert(row), "usage");
  }
  async usageTotals(sinceIso: string): Promise<UsageTotals> {
    // Every row, not the first 1,000: the budget check depends on this total.
    const data = await paged<Row>(
      (from, to) => this.db.from("crew_usage").select("id, agent_id, team, input_tokens, output_tokens, cache_read, cache_write, cost_usd").gte("created_at", sinceIso).order("id").range(from, to),
      200000,
      "usage totals",
    );
    const t: UsageTotals = { total: { usd: 0, tokens: 0, cacheRead: 0, input: 0 }, byAgent: {}, byTeam: {} };
    for (const u of data ?? []) {
      const tok = num(u.input_tokens) + num(u.output_tokens) + num(u.cache_read) + num(u.cache_write);
      const usd = num(u.cost_usd);
      t.total.usd += usd;
      t.total.tokens += tok;
      t.total.cacheRead += num(u.cache_read);
      t.total.input += num(u.input_tokens) + num(u.cache_read) + num(u.cache_write);
      const a = (t.byAgent[String(u.agent_id)] ??= { usd: 0, tokens: 0 });
      a.usd += usd;
      a.tokens += tok;
      const tm = (t.byTeam[String(u.team)] ??= { usd: 0, tokens: 0 });
      tm.usd += usd;
      tm.tokens += tok;
    }
    return t;
  }

  async insertApproval(a: NewApproval) {
    const res = await this.db
      .from("crew_approvals")
      .insert({
        agent_id: a.agent_id,
        team: a.team,
        kind: a.kind,
        title: a.title,
        summary: a.summary,
        body: a.body,
        platform: a.platform ?? null,
        target_url: a.target_url ?? null,
        person_id: a.person_id ?? null,
        debate: a.debate ?? null,
        model_used: a.model_used ?? null,
        meta: a.meta ?? {},
      })
      .select("id")
      .single();
    if (res.error?.code === "23505") return { conflict: true as const };
    const data = must(res, "approval insert");
    return { id: String((data as Row).id) };
  }
  async getApproval(id: string) {
    const { data } = await this.db.from("crew_approvals").select("*").eq("id", id).maybeSingle();
    return (data as Approval) ?? null;
  }
  async listApprovals(f: { status?: ApprovalStatus[]; agentId?: string; agentIds?: string[]; sinceIso?: string; limit?: number }) {
    return paged<Approval>(
      (from, to) => {
        let q = this.db.from("crew_approvals").select("*").order("created_at", { ascending: false }).order("id");
        if (f.status) q = q.in("status", f.status);
        if (f.agentId) q = q.eq("agent_id", f.agentId);
        if (f.agentIds) q = q.in("agent_id", f.agentIds);
        if (f.sinceIso) q = q.gte("created_at", f.sinceIso);
        return q.range(from, to);
      },
      f.limit ?? 100,
      "approvals",
    );
  }
  async updateApproval(id: string, patch: Partial<Approval>) {
    must(await this.db.from("crew_approvals").update(patch).eq("id", id), "approval update");
  }
  async countPending(agentId: string) {
    const { count } = await this.db.from("crew_approvals").select("id", { count: "exact", head: true }).eq("agent_id", agentId).eq("status", "pending");
    return count ?? 0;
  }
  async recentDecisions(agentId: string, kind: ApprovalKind, n: number) {
    const data = must(
      await this.db
        .from("crew_approvals")
        .select("status")
        .eq("agent_id", agentId)
        .eq("kind", kind)
        .in("status", ["approved", "done", "rejected"])
        .not("decided_at", "is", null)
        .order("decided_at", { ascending: false })
        .limit(n),
      "decisions",
    );
    return (data ?? []).map((r) => r.status as ApprovalStatus);
  }
  async countApprovalsCreatedSince(agentId: string, sinceIso: string) {
    const { count } = await this.db.from("crew_approvals").select("id", { count: "exact", head: true }).eq("agent_id", agentId).gte("created_at", sinceIso);
    return count ?? 0;
  }
  async expireOld(now: Date) {
    const data = must(
      await this.db.from("crew_approvals").update({ status: "expired" }).eq("status", "pending").lt("expires_at", now.toISOString()).select("id"),
      "expire",
    );
    for (const r of data ?? []) await this.releaseDmClaim(String(r.id));
    return (data ?? []).length;
  }

  async findPerson(platform: Platform, handleNorm: string) {
    const { data } = await this.db.from("crew_identities").select("person_id").eq("platform", platform).eq("handle_norm", handleNorm).maybeSingle();
    return data ? String(data.person_id) : null;
  }
  async createPerson(displayName: string | null, platform: Platform, handleNorm: string) {
    const existing = await this.findPerson(platform, handleNorm);
    if (existing) return existing;
    const p = must(await this.db.from("crew_people").insert({ display_name: displayName }).select("id").single(), "person");
    const id = String((p as Row).id);
    const res = await this.db.from("crew_identities").insert({ person_id: id, platform, handle_norm: handleNorm });
    if (res.error?.code === "23505") {
      // Another agent created this identity a moment ago: use theirs.
      await this.db.from("crew_people").delete().eq("id", id);
      return (await this.findPerson(platform, handleNorm)) ?? id;
    }
    must(res, "identity");
    return id;
  }
  async linkIdentity(personId: string, platform: Platform, handleNorm: string) {
    await this.db.from("crew_identities").upsert({ person_id: personId, platform, handle_norm: handleNorm }, { onConflict: "platform,handle_norm", ignoreDuplicates: true });
  }
  async addTouch(personId: string, platform: Platform, kind: TouchKind, approvalId: string | null) {
    must(await this.db.from("crew_touches").insert({ person_id: personId, platform, kind, approval_id: approvalId }), "touch");
  }
  async touchesFor(personId: string) {
    return (must(await this.db.from("crew_touches").select("platform, kind, at").eq("person_id", personId).order("at"), "touches") ?? []) as {
      platform: string;
      kind: TouchKind;
      at: string;
    }[];
  }
  async identitiesFor(personId: string) {
    return (must(await this.db.from("crew_identities").select("platform, handle_norm").eq("person_id", personId), "identities") ?? []) as {
      platform: string;
      handle_norm: string;
    }[];
  }
  async listTouchedPeople(limit: number) {
    const { data, error } = await this.db
      .from("crew_touches")
      .select("person_id, platform, kind, at, approval_id")
      .not("kind", "in", "(lead_listed,dm_drafted)")
      .order("at", { ascending: false })
      .limit(limit * 4);
    if (error || !data?.length) return [];
    const ids = [...new Set(data.map((t) => String(t.person_id)))].slice(0, limit);
    const [people, identities, touches] = await Promise.all([
      this.db.from("crew_people").select("id, display_name").in("id", ids),
      this.db.from("crew_identities").select("person_id, platform, handle_norm").in("person_id", ids),
      this.db.from("crew_touches").select("person_id, platform, kind, at, approval_id").in("person_id", ids).order("at"),
    ]);
    return ids.map((id) => ({
      id,
      display_name: (people.data ?? []).find((p) => String(p.id) === id)?.display_name ?? null,
      identities: (identities.data ?? []).filter((i) => String(i.person_id) === id).map((i) => ({ platform: String(i.platform), handle_norm: String(i.handle_norm) })),
      touches: (touches.data ?? []).filter((t) => String(t.person_id) === id).map((t) => ({ platform: String(t.platform), kind: t.kind as TouchKind, at: String(t.at), approval_id: t.approval_id ? String(t.approval_id) : null })),
    }));
  }
  async claimDm(personId: string, approvalId: string) {
    const data = must(await this.db.rpc("crew_claim_dm", { p_person: personId, p_approval: approvalId }), "claim dm");
    return data === true;
  }
  async releaseDmClaim(approvalId: string) {
    await this.db.from("crew_touches").delete().eq("approval_id", approvalId).eq("kind", "dm_drafted");
  }
  async countTouchesSince(platform: Platform, kinds: TouchKind[], sinceIso: string) {
    const { count } = await this.db.from("crew_touches").select("id", { count: "exact", head: true }).eq("platform", platform).in("kind", kinds).gte("at", sinceIso);
    return count ?? 0;
  }

  async getFinding(fp: string) {
    const { data } = await this.db.from("crew_findings").select("*").eq("fingerprint", fp).maybeSingle();
    return (data as Finding) ?? null;
  }
  async upsertFinding(f: Omit<Finding, "id" | "first_seen" | "approval_id"> & { approval_id?: string | null }) {
    const data = must(await this.db.from("crew_findings").upsert(f, { onConflict: "fingerprint" }).select("*").single(), "finding");
    return data as Finding;
  }
  async patchFinding(id: string, patch: Partial<Finding>) {
    await this.db.from("crew_findings").update(patch).eq("id", id);
  }
  async listFindings(status: Finding["status"][], limit: number) {
    return (must(await this.db.from("crew_findings").select("*").in("status", status).order("last_seen", { ascending: false }).limit(limit), "findings") ??
      []) as Finding[];
  }

  async saveReport(r: { agent_id: string; team: TeamId; day: string; body: string; stats: Record<string, unknown> }) {
    const data = must(await this.db.from("crew_reports").upsert(r, { onConflict: "agent_id,day" }).select("id").single(), "report");
    return String((data as Row).id);
  }
  async markReportEmailed(id: string) {
    await this.db.from("crew_reports").update({ emailed_at: new Date().toISOString() }).eq("id", id);
  }
  async listReports(limit: number, team?: TeamId) {
    let q = this.db.from("crew_reports").select("*").order("created_at", { ascending: false }).limit(limit);
    if (team) q = q.eq("team", team);
    return (must(await q, "reports") ?? []) as ReportRow[];
  }

  async addInput(i: { platform: Platform; kind: CrewInput["kind"]; url: string | null; text: string }) {
    const data = must(await this.db.from("crew_inputs").insert(i).select("id").single(), "input");
    return String((data as Row).id);
  }
  async takeInputs(platforms: Platform[], limit: number, agentId: string) {
    const rows = must(
      await this.db.from("crew_inputs").select("*").eq("status", "new").in("platform", platforms).order("created_at").limit(limit),
      "inputs",
    ) as CrewInput[];
    const taken: CrewInput[] = [];
    for (const r of rows ?? []) {
      // Claim each row; a parallel run that got there first wins it.
      const { data } = await this.db.from("crew_inputs").update({ status: "used", used_by: agentId }).eq("id", r.id).eq("status", "new").select("id");
      if ((data ?? []).length) taken.push(r);
    }
    return taken;
  }
  async listInputsSince(platforms: Platform[], sinceIso: string, limit: number) {
    return (must(await this.db.from("crew_inputs").select("*").in("platform", platforms).gt("created_at", sinceIso).order("created_at").limit(limit), "inputs since") ??
      []) as CrewInput[];
  }
  async countNewInputs(platforms: Platform[]) {
    const { count } = await this.db.from("crew_inputs").select("id", { count: "exact", head: true }).eq("status", "new").in("platform", platforms);
    return count ?? 0;
  }

  async getRateLimit(platform: Platform, action: string) {
    const { data } = await this.db.from("crew_rate_limits").select("ceiling, warmup_start").eq("platform", platform).eq("action", action).maybeSingle();
    return data ? { ceiling: num(data.ceiling), warmup_start: String(data.warmup_start) } : null;
  }
  async setRateLimit(platform: Platform, action: string, ceiling: number, warmupStart?: string) {
    must(
      await this.db.from("crew_rate_limits").upsert({ platform, action, ceiling, ...(warmupStart ? { warmup_start: warmupStart } : {}) }, { onConflict: "platform,action" }),
      "rate limit",
    );
  }

  async kvGet<T>(key: string) {
    const { data } = await this.db.from("crew_kv").select("value").eq("key", key).maybeSingle();
    return (data?.value as T) ?? null;
  }
  async kvSet(key: string, value: unknown) {
    must(await this.db.from("crew_kv").upsert({ key, value, updated_at: new Date().toISOString() }), "kv");
  }

  async isSuppressed(values: string[]) {
    if (!values.length) return false;
    const { data } = await this.db.from("crew_suppression").select("value").in("value", values.map((v) => v.toLowerCase())).limit(1);
    return (data ?? []).length > 0;
  }
  async addSuppression(value: string, reason: string, o: { source?: string; channel?: string } = {}) {
    // source/channel columns come from crew-sheets.sql; before it runs the plain upsert still works.
    const extra = o.source || o.channel ? { ...(o.source ? { source: o.source } : {}), ...(o.channel ? { channel: o.channel } : {}) } : {};
    const res = await this.db.from("crew_suppression").upsert({ value: value.toLowerCase(), reason, ...extra });
    if (res.error && Object.keys(extra).length) must(await this.db.from("crew_suppression").upsert({ value: value.toLowerCase(), reason }), "suppression");
    else must(res, "suppression");
  }
  async listSuppression(limit: number) {
    const data = await paged<Row>((from, to) => this.db.from("crew_suppression").select("*").order("added_at", { ascending: false }).order("value").range(from, to), limit, "suppression").catch(() => [] as Row[]);
    return data.map((r: Row) => ({ value: String(r.value), reason: String(r.reason ?? ""), added_at: String(r.added_at ?? ""), source: String(r.source ?? "manual"), channel: String(r.channel ?? "email") })) as SuppressionRow[];
  }
  /** False once crew_leads is known to lack the columns from supabase/crew-leads-quality.sql; leads are then saved without them. */
  private leadQualityColumns = true;
  async insertLeads(leads: Lead[]) {
    let n = 0;
    for (const l of leads) {
      let res = await this.db.from("crew_leads").insert(this.leadQualityColumns ? l : withoutQuality(l));
      if (res.error && this.leadQualityColumns && missingColumn(res.error)) {
        this.leadQualityColumns = false;
        res = await this.db.from("crew_leads").insert(withoutQuality(l));
      }
      if (!res.error) n++;
      else if (res.error.code !== "23505") throw new Error(`crew store lead: ${res.error.message}`);
    }
    return n;
  }
  async companyKeysTaken(keys: string[]) {
    const want = [...new Set(keys)];
    const out = new Set<string>();
    if (!want.length) return out;
    if (this.leadQualityColumns) {
      const res = await this.db.from("crew_leads").select("company_key").in("company_key", want);
      if (res.error && missingColumn(res.error)) this.leadQualityColumns = false;
      else for (const r of must(res, "company keys") ?? []) out.add(String((r as Row).company_key));
    }
    // Leads saved before company keys existed: their key is worked out from the site and the name.
    const legacy = await paged<Row>(
      (from, to) => {
        let q = this.db.from("crew_leads").select("id, company, source_url").order("id");
        if (this.leadQualityColumns) q = q.is("company_key", null);
        return q.range(from, to);
      },
      50000,
      "legacy company keys",
    );
    const wanted = new Set(want);
    for (const r of legacy) {
      const k = companyKey({ source_url: String(r.source_url ?? ""), company: (r.company as string | null) ?? null });
      if (k && wanted.has(k)) out.add(k);
    }
    return out;
  }
  async countLeadsSince(sinceIso: string, list?: Lead["list"]) {
    // Every row: a day of 1,000+ leads must count past 1,000, or the daily limit never trips.
    const rows = await paged<Row>(
      (from, to) => {
        let q = this.db.from("crew_leads").select("id, source_platform").gte("created_at", sinceIso).order("id");
        if (list) q = q.eq("list", list);
        return q.range(from, to);
      },
      500000,
      "lead counts",
    );
    const out: Record<string, number> = {};
    for (const r of rows) out[String(r.source_platform)] = (out[String(r.source_platform)] ?? 0) + 1;
    return out;
  }
  async getLead(id: string) {
    const { data } = await this.db.from("crew_leads").select("*").eq("id", id).maybeSingle();
    return (data as Lead & { id: string; created_at: string }) ?? null;
  }
  async unsyncedLeads(list: Lead["list"], limit: number) {
    return (must(
      await this.db.from("crew_leads").select("*").eq("list", list).is("sheet_synced_at", null).eq("region_restricted", false).order("created_at").limit(limit),
      "unsynced",
    ) ?? []) as (Lead & { id: string; created_at: string })[];
  }
  async markLeadsSynced(ids: string[]) {
    if (ids.length) await this.db.from("crew_leads").update({ sheet_synced_at: new Date().toISOString() }).in("id", ids);
  }
  async listLeads(list: Lead["list"], limit: number) {
    return paged<Lead & { id: string; created_at: string }>((from, to) => this.db.from("crew_leads").select("*").eq("list", list).order("created_at", { ascending: false }).order("id").range(from, to), limit, "leads");
  }

  async listTeams(): Promise<TeamRow[]> {
    // Table from supabase/crew-office.sql; until it runs every door reads open,
    // so the tick behaves exactly as before.
    const { data, error } = await this.db.from("crew_teams").select("*");
    const byTeam = new Map(error ? [] : (data ?? []).map((r: Row) => [String(r.team), r]));
    return DOOR_TEAMS.map((team) => {
      const r = byTeam.get(team);
      if (!r) return defaultTeam(team);
      return {
        team,
        door_open: r.door_open !== false,
        hours: (r.hours as OfficeHours | null) ?? null,
        override_open: r.override_open == null ? null : !!r.override_open,
        override_until: (r.override_until as string) ?? null,
        focus: (r.focus as string) ?? null,
        focus_until: (r.focus_until as string) ?? null,
        focus_by: (r.focus_by as string) ?? null,
      };
    });
  }
  async patchTeam(team: TeamId, patch: Partial<Omit<TeamRow, "team">>) {
    must(await this.db.from("crew_teams").upsert({ team, ...patch, updated_at: new Date().toISOString() }), "team patch");
  }

  async addChat(m: { team: TeamId; author: ChatMessage["author"]; body: string; status?: ChatMessage["status"]; meta?: Record<string, unknown> }) {
    const data = must(await this.db.from("crew_chat").insert({ team: m.team, author: m.author, body: m.body, status: m.status ?? "done", meta: m.meta ?? {} }).select("id").single(), "chat add");
    return String((data as Row).id);
  }
  async updateChat(id: string, patch: Partial<Pick<ChatMessage, "body" | "status" | "meta">>) {
    must(await this.db.from("crew_chat").update(patch).eq("id", id), "chat update");
  }
  async listChat(team: TeamId, limit: number) {
    const { data, error } = await this.db.from("crew_chat").select("*").eq("team", team).order("created_at", { ascending: false }).limit(limit);
    if (error) return [];
    return ((data ?? []) as ChatMessage[]).reverse();
  }

  async competitorFacts() {
    return (must(await this.db.from("crew_competitor_facts").select("competitor, fact, value, source_url, seen_at"), "facts") ?? []) as {
      competitor: string;
      fact: string;
      value: string;
      source_url: string;
      seen_at: string;
    }[];
  }
  async upsertCompetitorFact(f: { competitor: string; fact: string; value: string; source_url: string }) {
    const { data: prev } = await this.db.from("crew_competitor_facts").select("value").eq("competitor", f.competitor).eq("fact", f.fact).maybeSingle();
    must(await this.db.from("crew_competitor_facts").upsert({ ...f, seen_at: new Date().toISOString() }, { onConflict: "competitor,fact" }), "fact upsert");
    const previous = prev ? String(prev.value) : null;
    return { changed: previous !== f.value, previous };
  }

  // ── The Google Sheet (supabase/crew-sheets.sql) ──────────────────────────

  async sheetsReady() {
    // shown_status too: a database that ran an older copy of crew-sheets.sql is "not ready" until it runs this one.
    const { error } = await this.db.from("crew_sheet_rows").select("id, shown_status").limit(1);
    return !error;
  }
  private toSheetRow(r: Row): SheetRow {
    return {
      id: String(r.id),
      tab: String(r.tab),
      row_key: String(r.row_key),
      entity_kind: r.entity_kind as SheetRow["entity_kind"],
      entity_id: String(r.entity_id),
      status: String(r.status ?? "New"),
      owner_cols: (r.owner_cols ?? {}) as Record<string, string>,
      agent_hash: String(r.agent_hash ?? ""),
      shown_status: (r.shown_status as string) ?? null,
      created_at: String(r.created_at),
      synced_at: (r.synced_at as string) ?? null,
      owner_edited_at: (r.owner_edited_at as string) ?? null,
    };
  }
  async listSheetRows(tab?: string) {
    // All of them: a row missing here would read as "unknown" and be re-added or overwritten.
    const rows = await paged<Row>(
      (from, to) => {
        let q = this.db.from("crew_sheet_rows").select("*").order("created_at").order("id");
        if (tab) q = q.eq("tab", tab);
        return q.range(from, to);
      },
      1_000_000,
      "sheet rows",
    );
    return rows.map((r) => this.toSheetRow(r));
  }
  async getSheetRow(rowKey: string) {
    const { data } = await this.db.from("crew_sheet_rows").select("*").eq("row_key", rowKey).maybeSingle();
    return data ? this.toSheetRow(data) : null;
  }
  async sheetRowFor(kind: SheetRow["entity_kind"], entityId: string) {
    const { data } = await this.db.from("crew_sheet_rows").select("*").eq("entity_kind", kind).eq("entity_id", entityId).limit(1).maybeSingle();
    return data ? this.toSheetRow(data) : null;
  }
  async upsertSheetRow(r: Omit<SheetRow, "id" | "created_at">) {
    const data = must(await this.db.from("crew_sheet_rows").upsert(r, { onConflict: "row_key" }).select("*").single(), "sheet row upsert");
    return this.toSheetRow(data as Row);
  }
  async patchSheetRow(rowKey: string, patch: Partial<Omit<SheetRow, "id" | "row_key" | "created_at">>) {
    must(await this.db.from("crew_sheet_rows").update(patch).eq("row_key", rowKey), "sheet row patch");
  }
  async markShown(status: string, rowKeys: string[]) {
    // Only shown_status: the owner's Status (set through the hook a moment ago) is never touched here.
    for (let i = 0; i < rowKeys.length; i += 200) must(await this.db.from("crew_sheet_rows").update({ shown_status: status }).in("row_key", rowKeys.slice(i, i + 200)), "sheet rows shown");
  }

  async logActivity(a: Omit<ActivityRow, "id" | "at">) {
    // The audit trail must never break the action it records.
    await this.db.from("crew_activity").insert(a);
  }
  async listActivity(limit: number) {
    const { data, error } = await this.db.from("crew_activity").select("*").order("at", { ascending: false }).limit(limit);
    return error ? [] : ((data ?? []) as ActivityRow[]);
  }
  async activitySince(sinceIso: string) {
    return paged<ActivityRow>((from, to) => this.db.from("crew_activity").select("*").gte("at", sinceIso).order("at").order("id").range(from, to), 50000, "activity since").catch(() => [] as ActivityRow[]);
  }

  async getControls() {
    const { data, error } = await this.db.from("crew_controls").select("key, value");
    if (error) return { dry_run: true };
    const out: Record<string, unknown> = { dry_run: true };
    for (const r of data ?? []) out[String(r.key)] = r.value;
    return out;
  }
  async setControl(key: string, value: unknown, source: "sheet" | "admin" | "system") {
    must(await this.db.from("crew_controls").upsert({ key, value, source, updated_at: new Date().toISOString() }), "control");
  }

  async addEdit(e: Omit<EditRow, "id" | "at">) {
    await this.db.from("crew_edits").insert(e);
  }
  async recentEdits(agentId: string, kind: ApprovalKind, n: number) {
    const { data, error } = await this.db.from("crew_edits").select("*").eq("agent_id", agentId).eq("kind", kind).order("at", { ascending: false }).limit(n);
    return error ? [] : ((data ?? []) as EditRow[]);
  }
}
