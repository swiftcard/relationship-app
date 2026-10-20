import OpenAI from "openai";
import type { CriticProvider, CriticReply } from "./types";

// ── ChatGPT as the second opinion (OpenAI Responses API) ────────────────────
// An API key in an env var, never a ChatGPT login. The model id comes from
// CREW_OPENAI_MODEL so a new OpenAI model is a setting, not a code change.

export class OpenAiCritic implements CriticProvider {
  label = "ChatGPT";
  provider = "openai" as const;
  private client: OpenAI;
  constructor(
    apiKey: string,
    public model: string,
  ) {
    this.client = new OpenAI({ apiKey, maxRetries: 2, timeout: 120_000 });
  }

  async critique(system: string, prompt: string, schema: Record<string, unknown>): Promise<CriticReply> {
    const r = await this.client.responses.create({
      model: this.model,
      instructions: system,
      input: prompt,
      max_output_tokens: 1500,
      text: { format: { type: "json_schema", name: "critique", schema, strict: true } },
    });
    const cached = r.usage?.input_tokens_details?.cached_tokens ?? 0;
    return {
      text: r.output_text ?? "",
      model: r.model ?? this.model,
      usage: {
        input: Math.max(0, (r.usage?.input_tokens ?? 0) - cached),
        output: r.usage?.output_tokens ?? 0,
        cacheRead: cached,
        cacheWrite: 0,
        webSearches: 0,
      },
    };
  }
}
