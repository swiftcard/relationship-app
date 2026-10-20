// Manual end-to-end check against the real Claude API (not in CI: tests/live
// is excluded). Costs about 20 cents. Run with:
//   K=<anthropic key> RESEND_API_KEY= npx vitest run --config vitest.live.crew.ts
import { it, expect } from "vitest";
import { buildContext } from "@/lib/crew/context";
import { AnthropicProvider } from "@/lib/crew/llm/anthropic";
import { MemoryStore } from "@/lib/crew/store-memory";
import { searchPlatform } from "@/lib/crew/sources/web-discovery";
import { linkedinComments } from "@/lib/crew/agents/replies";
import { officeOutreach } from "@/lib/crew/agents/office";

const claude = new AnthropicProvider(process.env.K!);

it("LinkedIn discovery returns real posts", async () => {
  const store = new MemoryStore();
  await store.patchAgentState(linkedinComments.id, { enabled: true });
  const ctx = await buildContext({ def: linkedinComments, store, providers: { claude, critic: null }, runId: null });
  const found = await searchPlatform(ctx, "linkedin", ["posts by realtors, recruiters, sales coaches or small business owners about networking, personal branding or getting more leads"], 10);
  console.log("linkedin found:", found.length, found.slice(0, 3).map((f) => f.url));
  console.log("cost:", store.usage.map((u) => u.cost_usd));
  expect(found.length).toBeGreaterThan(0);
}, 240_000);

it("Office outreach makes call-ready rows", async () => {
  const store = new MemoryStore();
  await store.patchAgentState(officeOutreach.id, { enabled: true });
  const ctx = await buildContext({ def: officeOutreach, store, providers: { claude, critic: null }, runId: null });
  const r = await officeOutreach.run(ctx);
  console.log("office:", r.summary);
  console.log("rows:", store.leads.slice(0, 6).map((l) => `${l.name ?? "-"} | ${l.title} | ${l.company} | ${l.phone} | ${l.email}`));
  console.log("drafts:", store.approvals.map((a) => a.title));
  console.log("cost $", store.usage.reduce((n, u) => n + u.cost_usd, 0).toFixed(3), store.usage.map((u) => `${u.purpose}:${u.model}`));
  expect(store.leads.length).toBeGreaterThan(0);
}, 300_000);
