import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";

// Live CRM checks — the REAL sync code against REAL HubSpot / Pipedrive /
// GoHighLevel test accounts, read back through each CRM's own API and cleaned
// up afterwards. Never part of `npm test` or CI: it needs test-account tokens
// and talks to third parties.
//
// Run with: npx vitest run --config vitest.live.config.ts
//
// Tokens come from the environment first and .env.local second — the same
// rule every QA script follows — so it runs in CI too if the secrets are set:
//   QA_HUBSPOT_TOKEN, QA_PIPEDRIVE_TOKEN, QA_HIGHLEVEL_TOKEN + QA_HIGHLEVEL_LOCATION_ID
// A provider whose token is missing is skipped, and says so.

function localEnv(): Record<string, string> {
  const file = fileURLToPath(new URL("./.env.local", import.meta.url));
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(QA_[A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const fromFile = localEnv();
const env: Record<string, string> = {};
for (const k of ["QA_HUBSPOT_TOKEN", "QA_PIPEDRIVE_TOKEN", "QA_HIGHLEVEL_TOKEN", "QA_HIGHLEVEL_LOCATION_ID"]) {
  const v = process.env[k] || fromFile[k];
  if (v) env[k] = v;
}

export default defineConfig({
  test: {
    include: ["tests/live/**/*.test.ts"],
    environment: "node",
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // One provider at a time: these are real accounts with real rate limits.
    fileParallelism: false,
    env,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
