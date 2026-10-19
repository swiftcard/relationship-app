import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

// ── Audit round 29 (2026-10-18): a silent AI, a poll that never stopped, and
//    the dashboard's slowest read ───────────────────────────────────────────
//
// I-05  A configured AI provider that failed (expired key, 429, empty reply)
//       returned null with nothing logged: features quietly fell back to
//       templates and no one could see why. (Still one provider per call —
//       a second would receive data the consent notice doesn't name.)
// P-08  /checkout/success re-asked every 2 s for as long as the tab was open:
//       a sign-in check, a database read and a Stripe call each time.
// P-05  The dashboard chart read up to 50 pages of views one after another.

const reported: { ctx: string; extra?: Record<string, unknown> }[] = [];
vi.mock("@/lib/report-error", () => ({ reportError: async (ctx: string, _e: unknown, extra?: Record<string, unknown>) => { reported.push({ ctx, extra }); } }));

import { aiComplete } from "@/lib/ai";

const read = (p: string) => readFileSync(p, "utf8");
const env = { ...process.env };

beforeEach(() => { reported.length = 0; });
afterEach(() => { process.env = { ...env }; vi.unstubAllGlobals(); });

describe("I-05: a failing AI provider is seen", () => {
  it("a configured provider that answers with an error is reported, naming it", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 })));
    expect(await aiComplete("hi")).toBeNull();
    expect(reported).toEqual([{ ctx: "ai.provider_failed", extra: { kind: "complete", provider: "OpenAI" } }]);
  });

  it("a success reports nothing, and no provider at all is not a failure", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "hello" } }] }), { status: 200 })));
    expect(await aiComplete("hi")).toBe("hello");
    delete process.env.OPENAI_API_KEY; delete process.env.GEMINI_API_KEY; delete process.env.ANTHROPIC_API_KEY;
    expect(await aiComplete("hi")).toBeNull();
    expect(reported).toEqual([]);
  });
});

describe("P-08: the checkout wait backs off and stops", () => {
  const src = read("src/app/checkout/success/AwaitingPlan.tsx");

  it("no fixed 2-second interval; a schedule that ends in about three minutes", () => {
    expect(src).not.toMatch(/setInterval\(/);
    const steps = JSON.parse(src.match(/const STEPS = (\[[^\]]+\]);/)![1]) as number[];
    expect(steps.slice(0, 5).every((s) => s === 2000)).toBe(true);
    const total = steps.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(120_000);
    expect(total).toBeLessThan(300_000);
    expect(src).toContain("if (i >= STEPS.length) return;");
  });
});

describe("P-05: the dashboard chart reads its pages together", () => {
  const dash = read("src/app/dashboard/page.tsx");

  it("one counted first page, then the rest six at a time", () => {
    expect(dash).toContain('.select("viewed_at, username, visitor_id", withCount ? { count: "exact" } : undefined)');
    expect(dash).toContain("const pages = Math.min(MAX_PAGES, Math.ceil((first.count ?? all.length) / PAGE));");
    expect(dash).toContain("Array.from({ length: Math.min(6, pages - p) }, (_, k) => page(p + k))");
  });
});
