import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Pinned before the 2026 marketing push: each guard is what keeps a traffic
// spike (or a bot riding one) from becoming an outage or a bill.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

describe("a slow database fails fast instead of piling up functions", () => {
  it("the service-role client caps every call, longer for storage, and keeps a caller's own signal", () => {
    const s = read("src/lib/supabase-admin.ts");
    expect(s).toContain("global: { fetch: cappedFetch }");
    expect(s).toMatch(/AbortSignal\.timeout\(href\.includes\("\/storage\/v1\/"\) \? ADMIN_STORAGE_TIMEOUT_MS : ADMIN_TIMEOUT_MS\)/);
    expect(s).toContain("AbortSignal.any([init.signal, cap])");
  });
});

describe("public AI has one daily ceiling across all visitors", () => {
  it("sales chat, guest logo search and guest card design each share a global key", () => {
    expect(read("src/app/api/ai/sales/route.ts")).toContain('isRateLimited("ai-global:sales-chat"');
    expect(read("src/app/api/logo-suggest/route.ts")).toMatch(/!user && \(await isRateLimited\("ai-global:logo-suggest:guest"/);
  });
  it("a guest past the design ceiling still gets a design, from the engine, never an error", () => {
    expect(read("src/app/api/design-generate/route.ts")).toContain(
      'if (useModel && (await isRateLimited("ai-global:design-generate:guest", 5000, DAY))) useModel = false;',
    );
  });
});

describe("an error storm is one alert, not thousands of writes", () => {
  it("rows are capped per fingerprint (Bo's detector still sees 3+) and the chat alert is once per window", () => {
    const s = read("src/lib/report-error.ts");
    expect(s).toMatch(/isRateLimited\(`report-error:row:\$\{fingerprint\}`, 20, STORM_WINDOW\)/);
    expect(s).toMatch(/isRateLimited\(`report-error:alert:\$\{fingerprint\}`, 1, STORM_WINDOW\)/);
    expect(s).toContain("if (!rowCapped) {");
  });
});
