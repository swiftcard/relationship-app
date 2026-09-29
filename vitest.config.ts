import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Browser-based render tests live in their own config (vitest.render.config.ts)
    // so this suite stays fast and needs no Chromium. Run them with `npm run test:render`.
    exclude: ["tests/render/**"],
    environment: "node",
    // 30s, not vitest's 5s default. A handful of tripwires do real work — the
    // server-only boundary walks the whole import graph, wallet-strip renders
    // with sharp, line-endings asks git about every tracked file — and each
    // takes 1-3s alone but 15-25s when the suite shares the machine with a
    // `next build` or a second session. Under that load six of them timed out
    // on 2026-09-28 and looked like product failures. A test that genuinely
    // hangs still fails, just 25 seconds later; a slow one no longer lies.
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
