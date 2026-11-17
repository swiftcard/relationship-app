import { readFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

// ── Card Builder's own calls to Claude (owner, 2026-11-16) ──────────────────
// Until now /build-card ran in Claude Code on the owner's Mac. To run on its
// own, the server does the same work through the API: the very same written
// rules (.claude/commands/build-card.md and find-offices.md are the system
// prompt, read at run time, so there is one copy of them), web search and web
// fetch for the research, and every answer checked by the same code the
// command-line tool uses before anything is saved.
//
// Key: CREW_ANTHROPIC_API_KEY (already in Vercel for the agents), or
// ANTHROPIC_API_KEY. Model: Claude Sonnet 5.5 (the owner's pick on 2026-11-17:
// about half Opus's cost per card at similar quality in a side-by-side test);
// a job pinned to Opus gets the server-side refusal fallback. Cost per prospect is recorded on its job row (data.usage).

export const MODEL = "claude-sonnet-5-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

// The models a job may be pinned to (job.data.model), to compare what a card
// costs and how good it is. Anything else means the default above.
export const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] as const;
export type ModelId = (typeof MODELS)[number];
export const modelOf = (v: unknown): ModelId => ((MODELS as readonly string[]).includes(v as string) ? (v as ModelId) : MODEL);

/** List prices, dollars per million tokens (input, output, cache read, 5-minute cache write). */
const PRICES: Record<ModelId, [number, number, number, number]> = {
  "claude-opus-5-5": [4, 20, 0.2, 5],
  "claude-sonnet-5-5": [2, 10, 0.1, 2.5],
  // Haiku 5.5 is $0.10/$0.50 up to a 100K-token prompt and $0.50/$2.50 above;
  // research prompts carry whole web pages, so the higher tier (an upper bound).
  "claude-haiku-5-5": [0.5, 2.5, 0.05, 0.625],
};

export function hasKey(): boolean {
  return !!(process.env.CREW_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY);
}

let client: Anthropic | null = null;
function api(): Anthropic {
  const apiKey = process.env.CREW_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("No Anthropic API key on the server (CREW_ANTHROPIC_API_KEY).");
  client ??= new Anthropic({ apiKey, maxRetries: 2 });
  return client;
}

const docCache = new Map<string, string>();
/** A project command's text, as its rules. Traced into the function by next.config.ts. */
export function commandText(name: "build-card" | "find-offices"): string {
  const hit = docCache.get(name);
  if (hit) return hit;
  const raw = readFileSync(join(process.cwd(), ".claude", "commands", `${name}.md`), "utf8")
    .replace(/^---[\s\S]*?---\s*/, "")
    .replaceAll("$ARGUMENTS", "the prospect in the request");
  docCache.set(name, raw);
  return raw;
}

/** A project agent's instructions (.claude/agents/<name>.md), without its front matter. Traced into the function by next.config.ts. */
export function agentText(name: "opener-judge"): string {
  const key = `agent:${name}`;
  const hit = docCache.get(key);
  if (hit) return hit;
  const raw = readFileSync(join(process.cwd(), ".claude", "agents", `${name}.md`), "utf8").replace(/^---[\s\S]*?---\s*/, "");
  docCache.set(key, raw);
  return raw;
}

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number; searches: number; fetches: number };
const addUsage = (a: Usage, u: Anthropic.Beta.Messages.BetaUsage | undefined): Usage => ({
  input: a.input + (u?.input_tokens ?? 0),
  output: a.output + (u?.output_tokens ?? 0),
  cacheRead: a.cacheRead + (u?.cache_read_input_tokens ?? 0),
  cacheWrite: a.cacheWrite + (u?.cache_creation_input_tokens ?? 0),
  searches: a.searches + (u?.server_tool_use?.web_search_requests ?? 0),
  fetches: a.fetches + ((u?.server_tool_use as { web_fetch_requests?: number } | undefined)?.web_fetch_requests ?? 0),
});
export const NO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, searches: 0, fetches: 0 };

/** Dollars, at the model's list prices plus $10 per 1,000 searches. */
export const dollarsOf = (u: Usage, model: ModelId = MODEL) => {
  const [i, o, r, w] = PRICES[model];
  return (u.input * i + u.output * o + u.cacheRead * r + u.cacheWrite * w) / 1e6 + u.searches * 0.01;
};

/** The answer: the text after the last tool block (web search narrates in between). */
function finalText(content: Anthropic.Beta.Messages.BetaContentBlock[]): string {
  let start = 0;
  content.forEach((b, i) => { if (b.type !== "text" && b.type !== "thinking" && b.type !== "redacted_thinking") start = i + 1; });
  return content.slice(start).filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text").map((b) => b.text).join("").trim();
}

/** The first JSON object in a reply, inside a ```json fence or bare. */
export function jsonIn(text: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    const v = JSON.parse(body) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export type Conversation = { messages: Anthropic.Beta.Messages.BetaMessageParam[]; usage: Usage; model?: ModelId };

/**
 * One turn of a conversation, resumed through pause_turn (the server's own
 * search loop pausing) up to four times. The reply is appended to `convo`
 * whole, so a follow-up turn ("that didn't save because…") continues it.
 */
export async function turn(convo: Conversation, opts: {
  system: string; web: boolean; effort: "low" | "medium" | "high"; signal: AbortSignal; maxTokens?: number;
  schema?: Record<string, unknown>;
}): Promise<string> {
  const model = convo.model ?? MODEL;
  const haiku = model === "claude-haiku-5-5";
  // Haiku has the basic web tools (no dynamic filtering) and no server-side fallback.
  const tools: Anthropic.Beta.Messages.BetaToolUnion[] = !opts.web ? [] : haiku
    ? [
        { type: "web_search_20250305", name: "web_search", max_uses: 15 },
        { type: "web_fetch_20250910", name: "web_fetch", max_uses: 25, max_content_tokens: 20_000 },
      ]
    : [
        { type: "web_search_20260209", name: "web_search", max_uses: 15 },
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: 25, max_content_tokens: 20_000 },
      ];
  for (let resumes = 0; ; resumes++) {
    const stream = api().beta.messages.stream({
      model,
      max_tokens: opts.maxTokens ?? 32_000,
      ...(model === "claude-opus-5-5" ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
      messages: convo.messages,
      thinking: { type: "adaptive" },
      output_config: { effort: opts.effort, ...(opts.schema ? { format: { type: "json_schema", schema: opts.schema } } : {}) },
      ...(tools.length ? { tools } : {}),
    }, { signal: opts.signal });
    const msg = await stream.finalMessage();
    convo.usage = addUsage(convo.usage, msg.usage);
    convo.messages.push({ role: "assistant", content: msg.content });
    if (msg.stop_reason === "pause_turn" && resumes < 4) continue;
    if (msg.stop_reason === "refusal") throw new Error("Claude declined this one (refusal).");
    if (msg.stop_reason === "max_tokens") throw new Error("The answer ran past its length limit.");
    return finalText(msg.content);
  }
}

/** Add the next user message to a conversation. */
export function say(convo: Conversation, text: string): void {
  convo.messages.push({ role: "user", content: text.toWellFormed() });
}
