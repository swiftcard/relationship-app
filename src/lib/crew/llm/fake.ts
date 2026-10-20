import type { ClaudeProvider, CriticProvider, CriticReply, LlmRequest, LlmResponse } from "./types";

// ── Deterministic fake models for tests and local dry runs ──────────────────
// A script decides each reply from the request, so tests can drive every
// branch (agree, revise, tie-break, refusal) without the network.

export type FakeScript = (req: LlmRequest, call: number) => string;

export class FakeClaude implements ClaudeProvider {
  calls: LlmRequest[] = [];
  batches = new Map<string, { id: string; req: LlmRequest }[]>();
  constructor(private script: FakeScript = defaultScript) {}

  async create(req: LlmRequest): Promise<LlmResponse> {
    this.calls.push(req);
    const text = this.script(req, this.calls.length);
    return {
      text,
      model: req.model,
      refused: text === "__REFUSE__",
      truncated: false,
      usage: { input: Math.ceil((req.system.length + req.prompt.length) / 4), output: Math.ceil(text.length / 4), cacheRead: 0, cacheWrite: 0, webSearches: req.webSearch ? 1 : 0 },
    };
  }
  async submitBatch(items: { id: string; req: LlmRequest }[]) {
    const id = `fakebatch_${this.batches.size + 1}`;
    this.batches.set(id, items);
    return id;
  }
  async batchResults(batchId: string) {
    const items = this.batches.get(batchId);
    if (!items) return {};
    const out: Record<string, LlmResponse | null> = {};
    for (const i of items) out[i.id] = await this.create(i.req);
    return out;
  }
}

export class FakeCritic implements CriticProvider {
  label = "ChatGPT";
  provider = "openai" as const;
  model = "fake-critic";
  calls: string[] = [];
  constructor(private verdicts: ("agree" | "revise")[] = ["agree"]) {}
  async critique(_system: string, prompt: string): Promise<CriticReply> {
    this.calls.push(prompt);
    const v = this.verdicts[Math.min(this.calls.length - 1, this.verdicts.length - 1)];
    const text = JSON.stringify({ verdict: v, issues: v === "agree" ? [] : ["sounds too much like an ad"], score: v === "agree" ? 0.9 : 0.4 });
    return { text, model: this.model, usage: { input: Math.ceil(prompt.length / 4), output: 30, cacheRead: 0, cacheWrite: 0, webSearches: 0 } };
  }
}

function defaultScript(req: LlmRequest): string {
  if (req.schema) return JSON.stringify(fakeFromSchema(req.schema));
  return `Fake reply for: ${req.prompt.slice(0, 60)}`;
}

/** Minimal valid object for a JSON schema (enough for our own schemas). */
export function fakeFromSchema(schema: Record<string, unknown>): unknown {
  const t = schema.type;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  if (t === "object") {
    const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, fakeFromSchema(v)]));
  }
  if (t === "array") return [];
  if (t === "number" || t === "integer") return 0;
  if (t === "boolean") return false;
  return "fake";
}
