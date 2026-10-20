import Anthropic from "@anthropic-ai/sdk";
import type { Usage } from "../types";
import type { ClaudeProvider, LlmRequest, LlmResponse } from "./types";

// ── Claude via the official SDK ─────────────────────────────────────────────
// Current-model rules (Sonnet 5.5 / Opus 5.5 / Fable 5.1): adaptive thinking
// only (budget_tokens is a 400), no forced tool_choice, no prefill. Effort
// goes in output_config. Refusals fall back server-side ("default" routing);
// the Batches API rejects `fallbacks`, so batch requests go without it.

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

function usageOf(u: Anthropic.Messages.Usage | Anthropic.Beta.Messages.BetaUsage | undefined): Usage {
  return {
    input: u?.input_tokens ?? 0,
    output: u?.output_tokens ?? 0,
    cacheRead: u?.cache_read_input_tokens ?? 0,
    cacheWrite: u?.cache_creation_input_tokens ?? 0,
    webSearches: u?.server_tool_use?.web_search_requests ?? 0,
  };
}

function textOf(content: { type: string; text?: string }[]): string {
  return content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
}

function params(req: LlmRequest) {
  return {
    model: req.model,
    max_tokens: req.maxTokens,
    system: [{ type: "text" as const, text: req.system, cache_control: { type: "ephemeral" as const } }],
    messages: [{ role: "user" as const, content: req.prompt }],
    thinking: { type: "adaptive" as const },
    output_config: {
      effort: req.effort,
      ...(req.schema ? { format: { type: "json_schema" as const, schema: req.schema } } : {}),
    },
    ...(req.webSearch
      ? {
          tools: [
            {
              type: "web_search_20260209" as const,
              name: "web_search" as const,
              max_uses: req.webSearch.maxUses,
              ...(req.webSearch.allowedDomains?.length ? { allowed_domains: req.webSearch.allowedDomains } : {}),
            },
          ],
        }
      : {}),
  };
}

export class AnthropicProvider implements ClaudeProvider {
  private client: Anthropic;
  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 180_000 });
  }

  async create(req: LlmRequest): Promise<LlmResponse> {
    const msg = await this.client.beta.messages.create({ ...params(req), betas: [FALLBACK_BETA], fallbacks: "default" });
    return {
      text: textOf(msg.content as { type: string; text?: string }[]),
      usage: usageOf(msg.usage),
      model: msg.model,
      refused: msg.stop_reason === "refusal",
      truncated: msg.stop_reason === "max_tokens",
    };
  }

  async submitBatch(items: { id: string; req: LlmRequest }[]): Promise<string> {
    const batch = await this.client.messages.batches.create({
      requests: items.map((i) => ({ custom_id: i.id, params: params(i.req) })),
    });
    return batch.id;
  }

  async batchResults(batchId: string): Promise<Record<string, LlmResponse | null> | null> {
    const b = await this.client.messages.batches.retrieve(batchId);
    if (b.processing_status !== "ended") return null;
    const out: Record<string, LlmResponse | null> = {};
    for await (const r of await this.client.messages.batches.results(batchId)) {
      if (r.result.type === "succeeded") {
        const m = r.result.message;
        out[r.custom_id] = {
          text: textOf(m.content as { type: string; text?: string }[]),
          usage: usageOf(m.usage),
          model: m.model,
          refused: m.stop_reason === "refusal",
          truncated: m.stop_reason === "max_tokens",
        };
      } else {
        out[r.custom_id] = null;
      }
    }
    return out;
  }
}
