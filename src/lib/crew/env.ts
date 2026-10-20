import type { EnvKey } from "./types";

// ── The only place Crew reads its environment ───────────────────────────────
// Crew has its OWN key names. src/lib/ai.ts picks the product's AI provider by
// whichever of OPENAI_API_KEY / GEMINI_API_KEY / ANTHROPIC_API_KEY exists, and
// that choice is shown to users in the App Store consent notice
// (aiProviderName). If Crew used ANTHROPIC_API_KEY, setting it up for the
// agents could silently change who the app says receives people's data.
// tests/crew-env.test.ts pins that nothing under src/lib/crew reads those names.

export const ENV_HELP: Record<EnvKey, string> = {
  CREW_ANTHROPIC_API_KEY: "Anthropic API key for the agents (console.anthropic.com → API keys).",
  CREW_OPENAI_API_KEY: "OpenAI API key for the second opinion (platform.openai.com → API keys).",
  CREW_OPENAI_MODEL: "Which OpenAI model gives the second opinion, e.g. the current flagship id from platform.openai.com/docs/models.",
  CREW_TICK_SECRET: "Any long random string. Same value in Vercel and in GitHub → Settings → Secrets → Actions.",
  CREW_GITHUB_TOKEN: "Fine-grained GitHub token for this repo only: Actions read/write, Contents read/write, Pull requests read/write.",
  CREW_STRIPE_READ_KEY: "Stripe restricted key with READ access only (Dashboard → Developers → API keys → Create restricted key).",
  VERCEL_TOKEN: "Optional. Vercel token, lets the security agent read traffic and firewall data.",
  REDDIT_CLIENT_ID: "Reddit app client id (reddit.com/prefs/apps).",
  REDDIT_CLIENT_SECRET: "Reddit app secret.",
  REDDIT_USER_AGENT: "e.g. web:me.swiftcard.crew:v1 (by /u/yourname)",
  GOOGLE_SHEETS_SA_JSON: "Google Cloud service-account key (the whole JSON). Share each sheet with its client_email.",
  CREW_LEADS_SHEET_ID: "The id in the cold-lead sheet's URL (docs.google.com/spreadsheets/d/<id>/edit).",
  CREW_OFFICE_SHEET_ID: "The id in the Office-prospects sheet's URL.",
};

export function env(key: EnvKey): string | undefined {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : undefined;
}

export function hasEnv(key: EnvKey): boolean {
  return env(key) !== undefined;
}

export function missingEnv(keys: readonly EnvKey[]): EnvKey[] {
  return keys.filter((k) => !hasEnv(k));
}

/** CREW_DISABLED=1 stops every agent with no database needed. */
export function crewHardDisabled(): boolean {
  const v = process.env.CREW_DISABLED;
  return v === "1" || v === "true";
}

/** The deterministic fake model, for local runs and tests. Never in production. */
export function fakeLlmEnabled(): boolean {
  return process.env.CREW_FAKE_LLM === "1" && process.env.NODE_ENV !== "production";
}

export function openAiPriceRaw(): string | undefined {
  return process.env.CREW_OPENAI_PRICE || undefined;
}

export function appBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me").replace(/\/$/, "");
}
