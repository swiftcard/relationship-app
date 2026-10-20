import type { Usage } from "../types";

export type Effort = "low" | "medium" | "high";

export type LlmRequest = {
  model: string;
  /** Byte-stable across calls (no dates, no ids) so the prompt cache hits. */
  system: string;
  prompt: string;
  maxTokens: number;
  effort: Effort;
  /** Structured output: the reply is JSON matching this schema. */
  schema?: Record<string, unknown>;
  /** The Claude web_search server tool. */
  webSearch?: { maxUses: number; allowedDomains?: string[] };
};

export type LlmResponse = {
  text: string;
  usage: Usage;
  model: string;
  /** Safety classifiers declined (stop_reason "refusal"), even after fallback. */
  refused: boolean;
  /** Hit max_tokens: the text is cut off. */
  truncated: boolean;
};

export interface ClaudeProvider {
  create(req: LlmRequest): Promise<LlmResponse>;
  submitBatch(items: { id: string; req: LlmRequest }[]): Promise<string>;
  /** null while still processing. */
  batchResults(batchId: string): Promise<Record<string, LlmResponse | null> | null>;
}

export type CriticReply = { text: string; usage: Usage; model: string };

export interface CriticProvider {
  /** Shown on cards: "ChatGPT" or "Claude (skeptic)". */
  label: string;
  provider: "openai" | "anthropic";
  model: string;
  critique(system: string, prompt: string, schema: Record<string, unknown>): Promise<CriticReply>;
}
