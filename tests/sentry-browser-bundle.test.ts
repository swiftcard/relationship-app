import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// ── The browser loads three Sentry functions, not the whole SDK (audit P-02) ──
//
// `import("@sentry/nextjs")` kept the entire barrel: Session Replay, the
// feedback widget and the AI-provider instrumentation, a 585 KB chunk every
// visitor would download the day a DSN is set (with replay switched off).
// Going through named re-exports took it to 231 KB. Turbopack ignores the
// webpack-only tree-shake options, so this import shape is the whole fix.

const client = readFileSync("src/instrumentation-client.ts", "utf8");
const sdk = readFileSync("src/lib/sentry-client-sdk.ts", "utf8");

describe("Sentry browser bundle", () => {
  it("never dynamic-imports the @sentry/nextjs barrel", () => {
    expect(client).not.toMatch(/import\(\s*["']@sentry\//);
    expect(client).toMatch(/import\(\s*["']@\/lib\/sentry-client-sdk["']\s*\)/);
  });

  it("the SDK module is named re-exports only", () => {
    const code = sdk.replace(/^\s*\/\/.*$/gm, "").trim();
    expect(code).toMatch(/^export \{[^}]+\} from "@sentry\/nextjs";$/);
    expect(code).not.toMatch(/\*/);
    expect(code).not.toMatch(/replay|feedback/i);
  });

  it("does not use the deprecated disableLogger option", () => {
    expect(readFileSync("next.config.ts", "utf8")).not.toMatch(/disableLogger\s*:/);
  });
});
