// Manual live checks for the agent system (tests/live/crew-*.live.ts): real
// network, real Claude API. Never part of `npm test` or CI.
import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({ resolve: { alias: { "@": path.resolve(__dirname, "src") } }, test: { include: ["tests/live/crew-*.live.ts"], testTimeout: 300_000 } });
