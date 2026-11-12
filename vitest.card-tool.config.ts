import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Not a test suite. scripts/card-builder.mjs runs tests/tools/card-builder.tool.ts
// through vitest so the Card Builder commands (.claude/commands/find-offices.md,
// build-card.md) can use the app's own TypeScript: the same form checks the
// admin uses, the same lead recorder the agents use, and the real preview page
// rendered in a real browser. Never part of `npm test` or CI.
export default defineConfig({
  test: {
    include: ["tests/tools/card-builder.tool.ts"],
    environment: "node",
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
