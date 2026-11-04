// One controlled real-world run of the Instagram LinkedIn Bio agent (manual,
// never in `npm test` or CI): real web search, real Claude, an in-memory
// store, so nothing reaches Supabase, the Sheet or Instagram, and nothing is
// posted or sent. Run with:
//   K=<crew anthropic key> OUT=ig-live.json npx vitest run --config vitest.live.crew.ts tests/live/crew-ig-conversations.live.ts
//
// Spending, worst case (owner authorised $0.50, 2026-11-04):
// - one run, one search call with at most 2 web searches; the search reserves
//   its measured worst case ($0.055 a search beyond the fee) before it starts
// - at most 3 drafts, each with at most one rewrite (800 output tokens each)
// - no SDK retries (a timeout set on every call turns them off)
// - the shared and the agent limit are both $0.40 in this store, and this file
//   refuses any call once $0.35 has been spent
// Worst case: about $0.38 (search ~$0.19, or twice that if the server-side
// refusal fallback re-runs it; drafts stop at $0.35 plus the call in flight).
import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { AGENT_ID, instagramLinkedinBio } from "@/lib/crew/agents/instagram-conversations";
import { BudgetStop } from "@/lib/crew/budget";
import { AnthropicProvider } from "@/lib/crew/llm/anthropic";
import type { ClaudeProvider, LlmRequest, LlmResponse } from "@/lib/crew/llm/types";
import { MemoryStore } from "@/lib/crew/store-memory";
import { runAgent } from "@/lib/crew/tick";

const LIMIT = 0.4;
const HARD_STOP = 0.35;

it("finds real Instagram conversations and drafts comments, within $0.50", async () => {
  const key = process.env.K;
  if (!key) throw new Error("K is not set");
  const store = new MemoryStore();
  const real = new AnthropicProvider(key);
  const spent = () => store.usage.reduce((n, u) => n + u.cost_usd, 0);
  const calls: { model: string; webSearch: boolean; prompt: string; text: string; stop: string | null }[] = [];
  const claude: ClaudeProvider = {
    async create(req: LlmRequest): Promise<LlmResponse> {
      if (spent() >= HARD_STOP) throw new BudgetStop(`live test stop: $${spent().toFixed(3)} spent`);
      const r = await real.create({ ...req, timeoutMs: req.timeoutMs ?? 170_000 });
      calls.push({ model: r.model, webSearch: !!req.webSearch, prompt: req.prompt.slice(0, 4000), text: r.text, stop: r.stopReason ?? null });
      return r;
    },
    submitBatch: () => Promise.reject(new Error("no batches in the live test")),
    batchResults: () => Promise.reject(new Error("no batches in the live test")),
  };

  await store.updateSettings({ daily_usd_cap: LIMIT, economy: true, second_opinion: false });
  await store.patchAgentState(AGENT_ID, { enabled: true, daily_usd_cap: LIMIT, config: { search_max_uses: 2, drafts_per_run: 3 } });
  const out = await runAgent({ def: instagramLinkedinBio, store, providers: { claude, critic: null } });
  const [run] = await store.recentRuns(AGENT_ID, 1);

  const result = {
    status: out.status ?? run.status,
    summary: run.summary,
    stats: run.stats,
    error: run.error,
    cost_usd: Number(spent().toFixed(4)),
    usage: store.usage.map((u) => ({ purpose: u.purpose, model: u.model, web_searches: u.web_searches, input: u.input_tokens, output: u.output_tokens, cache_read: u.cache_read, cache_write: u.cache_write, cost_usd: u.cost_usd })),
    drafts: store.approvals.map((a) => ({ status: a.status, kind: a.kind, post: a.target_url, title: a.title, comment: a.body, why: a.meta?.why, reply_fit: a.meta?.reply_fit, score: a.meta?.score, post_kind: a.meta?.post_kind, mention_ok: a.meta?.mention_ok, caption: a.meta?.excerpt })),
    calls,
  };
  writeFileSync(process.env.OUT ?? "ig-live.json", JSON.stringify(result, null, 2));
  console.log(`status=${result.status} cost=$${result.cost_usd} drafts=${result.drafts.length}\n${run.summary}\n${JSON.stringify(run.stats)}`);
  expect(result.cost_usd).toBeLessThanOrEqual(0.5);
  expect(store.approvals.every((a) => a.status === "pending" && a.kind === "comment")).toBe(true);
}, 600_000);
