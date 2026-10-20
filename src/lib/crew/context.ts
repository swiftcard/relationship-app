import type { AgentDef } from "./agent-def";
import { BudgetStop, checkBudget, estimateUsd, pickTier } from "./budget";
import { crewHardDisabled, openAiPriceRaw } from "./env";
import type { ClaudeProvider, CriticProvider, CriticReply, Effort, LlmRequest, LlmResponse } from "./llm/types";
import { MODEL_ID, costUsd, priceFor } from "./models";
import { nyDayStart } from "./schedule";
import type { CrewStore } from "./store";
import type { AgentState, Settings, Tier, Usage } from "./types";

// ── What an agent gets when it runs ─────────────────────────────────────────
// `ctx.llm` is the only way to reach a model. Every call is budget-checked
// first and written to crew_usage after, so the meter, the caps and the daily
// reports all see the same numbers. Agents get read-only tools; anything that
// posts, sends or changes code lives in src/lib/crew/execute and runs only
// from the Approve button.

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
    },
  ) {}

  get hasCritic() {
    return !!this.o.providers.critic;
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

  private request(o: AskOptions): LlmRequest {
    return {
      model: MODEL_ID[o.tier ?? this.o.defaultTier],
      system: o.system,
      prompt: o.prompt,
      maxTokens: o.maxTokens ?? 4000,
      effort: o.effort ?? "medium",
      schema: o.schema,
      webSearch: o.webSearch,
    };
  }

  async ask(purpose: string, o: AskOptions): Promise<LlmResponse> {
    const claude = this.o.providers.claude;
    if (!claude) throw new BudgetStop("Needs CREW_ANTHROPIC_API_KEY.");
    const req = this.request(o);
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
    const reqs = items.map((i) => ({ id: i.id, req: this.request(i.o) }));
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
  stats: Record<string, number>;
  stat(key: string, n?: number): void;
  notes: string[];
  log(msg: string): void;
  config<T>(key: string, fallback: T): T;
  saveConfig(patch: Record<string, unknown>): Promise<void>;
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
  const picked = pickTier(o.def.tier, state.model_override, decisions);
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
    llm: new Llm({ store: o.store, def: o.def, state, settings, runId: o.runId, providers: o.providers, now, defaultTier: picked.tier }),
    tier: picked.tier,
    tierWhy: picked.why,
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
  };
  return ctx;
}
