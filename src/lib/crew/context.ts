import type { AgentDef } from "./agent-def";
import { BudgetStop, checkBudget, estimateUsd, pickTier } from "./budget";
import { blockedBy, doorState } from "./doors";
import { crewHardDisabled, openAiPriceRaw } from "./env";
import type { ClaudeProvider, CriticProvider, CriticReply, Effort, LlmRequest, LlmResponse } from "./llm/types";
import { MODEL_ID, costUsd, priceFor } from "./models";
import { nyDayStart } from "./schedule";
import type { CrewStore } from "./store";
import type { AgentState, ApprovalKind, Settings, Tier, Usage } from "./types";

// ── What an agent gets when it runs ─────────────────────────────────────────
// `ctx.llm` is the only way to reach a model. Every call is budget-checked
// first and written to crew_usage after, so the meter, the caps and the daily
// reports all see the same numbers. Agents get read-only tools; anything that
// posts, sends or changes code lives in src/lib/crew/execute and runs only
// from the Approve button.

/** A worker's team door was locked (or the agent paused) during its shift. */
export class DoorLocked extends BudgetStop {
  constructor(reason: string) {
    super(reason);
    this.name = "DoorLocked";
  }
}

/** Calls that follow the manager's standing order; checks, reports and tie-breaks don't. */
export const FOCUS_PURPOSES = ["discover", "research", "score", "triage", "draft", "revise", "idea", "captions", "answer"];

export type Providers = { claude: ClaudeProvider | null; critic: CriticProvider | null };

export type AskOptions = {
  system: string;
  prompt: string;
  maxTokens?: number;
  effort?: Effort;
  schema?: Record<string, unknown>;
  webSearch?: LlmRequest["webSearch"];
  tier?: Tier;
};

export class Llm {
  constructor(
    private o: {
      store: CrewStore;
      def: AgentDef;
      state: AgentState;
      settings: Settings;
      runId: string | null;
      providers: Providers;
      now: () => Date;
      defaultTier: Tier;
      /** The manager's standing order for this team, or null. */
      focus?: string | null;
    },
  ) {}

  get hasCritic() {
    return !!this.o.providers.critic;
  }

  /** False when no Claude key is set: callers that can work without a model check this first. */
  get hasClaude() {
    return !!this.o.providers.claude;
  }

  private async guard(estUsd: number) {
    const totals = await this.o.store.usageTotals(nyDayStart(this.o.now()).toISOString());
    const c = checkBudget({
      hardDisabled: crewHardDisabled(),
      settings: this.o.settings,
      state: this.o.state,
      agent: { id: this.o.def.id, team: this.o.def.team, dailyUsd: this.o.def.dailyUsd },
      totals,
      estUsd,
    });
    if (!c.ok) throw new BudgetStop(c.reason);
    // Re-read the door and the pause before every model call, so a lock takes
    // effect mid-shift, not only at the next tick.
    if (this.o.def.role === "worker") {
      const now = this.o.now();
      const [teams, state] = await Promise.all([this.o.store.listTeams(), this.o.store.getAgentState(this.o.def.id)]);
      const door = doorState(teams.find((t) => t.team === this.o.def.team), { team: this.o.def.team, settings: this.o.settings, hardDisabled: false }, now);
      const why = blockedBy(this.o.def, state, door, now);
      if (why) throw new DoorLocked(`Stopped: ${why}.`);
    }
  }

  private async record(provider: "anthropic" | "openai", model: string, purpose: string, u: Usage, batch = false) {
    await this.o.store.recordUsage({
      run_id: this.o.runId,
      agent_id: this.o.def.id,
      team: this.o.def.team,
      provider,
      model,
      purpose,
      input_tokens: u.input,
      output_tokens: u.output,
      cache_read: u.cacheRead,
      cache_write: u.cacheWrite,
      web_searches: u.webSearches,
      batch,
      cost_usd: costUsd(provider, model, u, { batch, openAiPriceRaw: openAiPriceRaw() }),
    });
  }

  private request(o: AskOptions, purpose = ""): LlmRequest {
    return {
      model: MODEL_ID[routeTier({ asked: o.tier, agentTier: this.o.defaultTier, purpose, economy: this.o.settings.economy, webSearch: !!o.webSearch })],
      system: o.system,
      // The focus goes on the prompt, never the system text, so the prompt cache still hits.
      prompt: this.o.focus && FOCUS_PURPOSES.includes(purpose) ? `${o.prompt}

THE OWNER'S ORDERS FOR THIS TEAM RIGHT NOW (follow them unless they break a rule above):
- ${this.o.focus}` : o.prompt,
      maxTokens: o.maxTokens ?? 4000,
      effort: o.effort ?? "medium",
      schema: o.schema,
      webSearch: o.webSearch,
    };
  }

  async ask(purpose: string, o: AskOptions): Promise<LlmResponse> {
    const claude = this.o.providers.claude;
    if (!claude) throw new BudgetStop("Needs CREW_ANTHROPIC_API_KEY.");
    const req = this.request(o, purpose);
    await this.guard(estimateUsd(req.system.length + req.prompt.length, req.maxTokens, priceFor("anthropic", req.model), req.webSearch?.maxUses ?? 0));
    const res = await claude.create(req);
    await this.record("anthropic", req.model, purpose, res.usage);
    return res;
  }

  /** Structured output, parsed. Null when the model refused or the JSON is unusable. */
  async askJson<T>(purpose: string, o: AskOptions & { schema: Record<string, unknown> }): Promise<T | null> {
    const res = await this.ask(purpose, o);
    if (res.refused) return null;
    return parseJson<T>(res.text);
  }

  /** The second opinion: ChatGPT when connected, else a Claude "skeptic" pass. */
  async critique(system: string, prompt: string, schema: Record<string, unknown>): Promise<CriticReply & { label: string }> {
    const critic = this.o.providers.critic;
    if (critic) {
      await this.guard(estimateUsd(system.length + prompt.length, 1500, priceFor("openai", critic.model, openAiPriceRaw())));
      const r = await critic.critique(system, prompt, schema);
      await this.record("openai", r.model, "critique", r.usage);
      return { ...r, label: critic.label };
    }
    const r = await this.ask("critique", { system, prompt, schema, maxTokens: 1500, effort: "low", tier: "sonnet" });
    return { text: r.text, usage: r.usage, model: r.model, label: "Claude (skeptic; ChatGPT not connected)" };
  }

  async submitBatch(purpose: string, items: { id: string; o: AskOptions }[]): Promise<string> {
    const claude = this.o.providers.claude;
    if (!claude) throw new BudgetStop("Needs CREW_ANTHROPIC_API_KEY.");
    const reqs = items.map((i) => ({ id: i.id, req: this.request(i.o, purpose) }));
    const est = reqs.reduce((n, r) => n + estimateUsd(r.req.system.length + r.req.prompt.length, r.req.maxTokens, priceFor("anthropic", r.req.model)) / 2, 0);
    await this.guard(est);
    const batchId = await claude.submitBatch(reqs);
    const pending = (await this.o.store.kvGet<{ id: string; purpose: string; at: string }[]>(`batches:${this.o.def.id}`)) ?? [];
    await this.o.store.kvSet(`batches:${this.o.def.id}`, [...pending, { id: batchId, purpose, at: this.o.now().toISOString() }]);
    return batchId;
  }

  /** Results of this agent's finished batches (usage recorded at half price); unfinished ones stay queued. */
  async collectBatches(): Promise<{ purpose: string; results: Record<string, LlmResponse | null> }[]> {
    const claude = this.o.providers.claude;
    const key = `batches:${this.o.def.id}`;
    const pending = (await this.o.store.kvGet<{ id: string; purpose: string; at: string }[]>(key)) ?? [];
    if (!claude || !pending.length) return [];
    const done: { purpose: string; results: Record<string, LlmResponse | null> }[] = [];
    const still: typeof pending = [];
    for (const b of pending) {
      const results = await claude.batchResults(b.id).catch(() => null);
      if (!results) {
        // Batches finish within 24h; drop anything older so a lost id can't pile up.
        if (this.o.now().getTime() - new Date(b.at).getTime() < 26 * 3600_000) still.push(b);
        continue;
      }
      for (const r of Object.values(results)) if (r) await this.record("anthropic", r.model, b.purpose, r.usage, true);
      done.push({ purpose: b.purpose, results });
    }
    await this.o.store.kvSet(key, still);
    return done;
  }
}

/** Sorting, scoring and pulling fields out of text: Haiku does these well. */
export const CHEAP_PURPOSES = ["score", "triage", "extract", "classify", "partners"];

/**
 * Which model a call uses:
 *  - a tier the caller asked for wins (in economy, an Opus tie-break becomes Sonnet);
 *  - in economy, sorting/scoring/extracting purposes use Haiku;
 *  - otherwise the agent's own tier (after escalation);
 *  - web search always runs on Sonnet or better: Haiku 5.5 has no dynamic-filtering search tool.
 */
export function routeTier(o: { asked?: Tier; agentTier: Tier; purpose: string; economy: boolean; webSearch: boolean }): Tier {
  let t: Tier = o.asked ?? (o.economy && CHEAP_PURPOSES.includes(o.purpose) ? "haiku" : o.agentTier);
  if (o.economy && o.asked === "opus" && o.purpose === "tiebreak") t = "sonnet";
  if (o.webSearch && t === "haiku") t = "sonnet";
  return t;
}

export function parseJson<T>(text: string): T | null {
  const t = text.trim();
  const candidates = [t, t.replace(/^```(?:json)?\s*|\s*```$/g, "")];
  const brace = t.indexOf("{");
  const bracket = t.indexOf("[");
  const start = brace === -1 ? bracket : bracket === -1 ? brace : Math.min(brace, bracket);
  if (start > 0) candidates.push(t.slice(start, Math.max(t.lastIndexOf("}"), t.lastIndexOf("]")) + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c) as T;
    } catch {
      /* try the next shape */
    }
  }
  return null;
}

export type AgentContext = {
  def: AgentDef;
  state: AgentState;
  settings: Settings;
  store: CrewStore;
  runId: string | null;
  now: () => Date;
  llm: Llm;
  tier: Tier;
  tierWhy: string | null;
  /** The manager's standing order for this team (set from the team chat), or null. */
  teamFocus: string | null;
  stats: Record<string, number>;
  stat(key: string, n?: number): void;
  notes: string[];
  log(msg: string): void;
  config<T>(key: string, fallback: T): T;
  saveConfig(patch: Record<string, unknown>): Promise<void>;
  /**
   * How the owner rewrote this agent's earlier drafts (up to the last 30
   * edits made in the Sheet), as a block for the draft prompt, or "" when
   * there are none. Goes on the prompt, never the system text.
   */
  ownerExamples(kind: ApprovalKind): Promise<string>;
};

export async function buildContext(o: {
  def: AgentDef;
  store: CrewStore;
  providers: Providers;
  runId: string | null;
  now?: () => Date;
  state?: AgentState;
  settings?: Settings;
}): Promise<AgentContext> {
  const now = o.now ?? (() => new Date());
  const state = o.state ?? (await o.store.getAgentState(o.def.id));
  const settings = o.settings ?? (await o.store.getSettings());
  const decisions = o.def.approvalKind && o.def.role === "worker" ? await o.store.recentDecisions(o.def.id, o.def.approvalKind, 5) : [];
  const base = settings.economy && o.def.economyTier ? o.def.economyTier : o.def.tier;
  const picked = pickTier(base, state.model_override, decisions);
  const team = o.def.team === "system" ? undefined : (await o.store.listTeams()).find((t) => t.team === o.def.team);
  const teamFocus = team?.focus && (!team.focus_until || new Date(team.focus_until).getTime() > now().getTime()) ? team.focus : null;
  const stats: Record<string, number> = {};
  const notes: string[] = [];
  let config = { ...state.config };
  const ctx: AgentContext = {
    def: o.def,
    state,
    settings,
    store: o.store,
    runId: o.runId,
    now,
    llm: new Llm({ store: o.store, def: o.def, state, settings, runId: o.runId, providers: o.providers, now, defaultTier: picked.tier, focus: teamFocus }),
    tier: picked.tier,
    tierWhy: picked.why,
    teamFocus,
    stats,
    stat(key, n = 1) {
      stats[key] = (stats[key] ?? 0) + n;
    },
    notes,
    log(msg) {
      notes.push(msg);
    },
    config<T>(key: string, fallback: T): T {
      return (config[key] as T) ?? fallback;
    },
    async saveConfig(patch) {
      config = { ...config, ...patch };
      await o.store.patchAgentState(o.def.id, { config });
    },
    async ownerExamples(kind) {
      const edits = await o.store.recentEdits(o.def.id, kind, 30).catch(() => []);
      return formatExamples(edits);
    },
  };
  return ctx;
}

/** The owner's edits as examples: what the draft said, what they changed it to. Private details are not copied forward: only the pair is shown, trimmed. */
export function formatExamples(edits: { before: string; after: string }[]): string {
  const pairs = edits.filter((e) => e.after.trim() && e.after.trim() !== e.before.trim()).slice(0, 30);
  if (!pairs.length) return "";
  const cut = (s: string) => s.trim().replace(/\s+/g, " ").slice(0, 400);
  return `HOW THE OWNER REWRITES DRAFTS (match this taste; never reuse names, numbers or private details from these):\n${pairs.map((e, i) => `${i + 1}. Draft: "${cut(e.before)}"\n   Owner's version: "${cut(e.after)}"`).join("\n")}`;
}
