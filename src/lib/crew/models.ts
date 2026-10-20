import type { Tier, Usage } from "./types";

// ── Models and what they cost ───────────────────────────────────────────────
// IDs and per-million-token prices verified 2026-10-20 against the claude-api
// reference (cached 2026-10-06). Update here and nowhere else: the usage meter,
// the budget check and every report read these numbers.
//
// The OpenAI critic's model is chosen by CREW_OPENAI_MODEL (never guessed in
// code); its price comes from CREW_OPENAI_PRICE ("in,out" $/MTok) when set, else
// the conservative default below, so the meter over-counts rather than under.

export const MODEL_ID: Record<Tier, string> = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
  fable: "claude-fable-5-1",
};

export const TIER_LABEL: Record<Tier, string> = {
  haiku: "Haiku 5.5",
  sonnet: "Sonnet 5.5",
  opus: "Opus 5.5",
  fable: "Fable 5.1",
};

type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };

const ANTHROPIC_PRICES: Record<string, Price> = {
  // Prompts up to 100K tokens (every Crew prompt is far below that).
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
};

/** $ per search for the Claude web_search server tool ($10 per 1,000). */
export const WEB_SEARCH_USD = 0.01;
/** Message Batches API: half price on tokens. */
export const BATCH_DISCOUNT = 0.5;

const DEFAULT_OPENAI_PRICE: Price = { input: 5, output: 20, cacheRead: 0.5, cacheWrite: 5 };

export function openAiPrice(raw: string | undefined): Price {
  if (!raw) return DEFAULT_OPENAI_PRICE;
  const [i, o] = raw.split(",").map((n) => Number(n.trim()));
  if (!Number.isFinite(i) || !Number.isFinite(o) || i < 0 || o < 0) return DEFAULT_OPENAI_PRICE;
  return { input: i, output: o, cacheRead: i / 10, cacheWrite: i };
}

export function priceFor(provider: "anthropic" | "openai", model: string, openAiPriceRaw?: string): Price {
  if (provider === "openai") return openAiPrice(openAiPriceRaw);
  return ANTHROPIC_PRICES[model] ?? ANTHROPIC_PRICES["claude-opus-5-5"];
}

/** Dollars for one call. `input` excludes cached tokens, as the APIs report it. */
export function costUsd(
  provider: "anthropic" | "openai",
  model: string,
  u: Usage,
  opts?: { batch?: boolean; openAiPriceRaw?: string },
): number {
  const p = priceFor(provider, model, opts?.openAiPriceRaw);
  const tokens =
    (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1_000_000;
  const discounted = opts?.batch ? tokens * BATCH_DISCOUNT : tokens;
  return round6(discounted + u.webSearches * WEB_SEARCH_USD);
}

export function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export const ZERO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, webSearches: 0 };

export function totalTokens(u: Usage): number {
  return u.input + u.output + u.cacheRead + u.cacheWrite;
}
