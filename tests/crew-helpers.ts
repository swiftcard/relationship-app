import type { AgentDef } from "@/lib/crew/agent-def";
import { buildContext } from "@/lib/crew/context";
import { FakeClaude, FakeCritic, type FakeScript } from "@/lib/crew/llm/fake";
import { MemoryStore } from "@/lib/crew/store-memory";
import type { Settings } from "@/lib/crew/types";

// Shared fixtures for the crew-* tests: an in-memory store, fake models and a
// minimal agent, so the whole loop runs with no database and no network.

export function fakeAgent(over: Partial<AgentDef> = {}): AgentDef {
  return {
    id: "t-agent",
    name: "T agent",
    team: "replies",
    role: "worker",
    tier: "sonnet",
    schedule: { kind: "every", minutes: 60 },
    dailyUsd: 1,
    needs: [],
    maxPending: 5,
    purpose: "test",
    approvalKind: "reply",
    run: async () => ({ summary: "ran" }),
    ...over,
  };
}

/** The original, full-power setup: AI triage, Opus tie-breaks, the ChatGPT second opinion. */
export const FULL: Partial<Settings> = { economy: false, second_opinion: true };

export async function setup(o: { def?: AgentDef; script?: FakeScript; verdicts?: ("agree" | "revise")[]; enabled?: boolean; settings?: Partial<Settings> } = {}) {
  const store = new MemoryStore();
  if (o.settings) await store.updateSettings(o.settings);
  const def = o.def ?? fakeAgent();
  await store.patchAgentState(def.id, { enabled: o.enabled ?? true });
  const claude = new FakeClaude(o.script);
  const critic = new FakeCritic(o.verdicts);
  const ctx = await buildContext({ def, store, providers: { claude, critic }, runId: null });
  return { store, def, claude, critic, ctx };
}
