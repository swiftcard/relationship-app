import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTACT } from "@/lib/crew/agents/contact";
import { REPLIES, SHEET_AGENT_USD, SHEET_DAILY_TARGET, SHEET_MAX_PENDING } from "@/lib/crew/agents/replies";
import { checkBudget } from "@/lib/crew/budget";
import { buildContext } from "@/lib/crew/context";
import { FakeClaude } from "@/lib/crew/llm/fake";
import { emptyRest, exactTarget, runEngagement, type Candidate } from "@/lib/crew/replies/engine";
import { tabsForAgent } from "@/lib/crew/sheets/tabs";
import { DEFAULT_SETTINGS } from "@/lib/crew/store";
import { MemoryStore } from "@/lib/crew/store-memory";
import { runTick } from "@/lib/crew/tick";
import { fakeAgent, setup } from "./crew-helpers";

// The owner, 2026-10-29: "I want each of these agents to generate me 100 new
// leads a day for what they're supposed to do and that's for every single
// marketing agent. For some reason I only see one right now in my Google
// Sheets and it's working very slowly." What held them to one or two a day:
// 5-10 a day ceilings at 20% for a warm-up, one agent at a time in each tick,
// searches that dropped every Instagram and X result, pasted-only Facebook and
// Instagram comments, and the Blog Writer's spending counted in the agents'
// shared $3. Each is pinned here.

const sheetAgents = [...REPLIES, ...CONTACT].filter((a) => tabsForAgent(a.id).length > 0);

describe("100 a day from every Sheet agent", () => {
  it("the target is 100, from day one, with a budget and an inbox sized for it", () => {
    expect(SHEET_DAILY_TARGET).toBe(100);
    expect(SHEET_MAX_PENDING).toBeGreaterThanOrEqual(7 * SHEET_DAILY_TARGET);
    expect(sheetAgents.length).toBeGreaterThanOrEqual(15);
    for (const a of sheetAgents) {
      expect(a.dailyUsd, a.id).toBe(SHEET_AGENT_USD);
      expect(a.maxPending, a.id).toBe(SHEET_MAX_PENDING);
    }
  });

  it("no agent keeps a small ceiling of its own", () => {
    for (const f of ["src/lib/crew/agents/replies.ts", "src/lib/crew/agents/contact.ts"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/ceiling: \d/);
    }
  });

  it("the owner's eight search on their own (none waits only for pasted posts)", () => {
    for (const id of ["replies-x", "contact-x", "replies-reddit", "contact-reddit", "replies-facebook", "contact-instagram", "contact-instagram-linkinbio", "replies-instagram"]) {
      const a = sheetAgents.find((x) => x.id === id)!;
      expect(a, id).toBeTruthy();
      expect(a.continuous, id).toBe(true);
      expect(a.schedule.kind, id).not.toBe("on_input");
    }
  });

  it("an X or Instagram person found by their profile is kept (all 5 were dropped live)", () => {
    const c = (platform: Candidate["platform"], url: string): Candidate => ({ platform, url, author: "jo", title: "", text: "", community: null, promoAllowed: true });
    expect(exactTarget(c("x", "https://x.com/jorealty"), "either")).toBe("https://x.com/jorealty");
    expect(exactTarget(c("x", "https://x.com/jorealty/status/123"), "either")).toBe("https://x.com/jorealty/status/123");
    expect(exactTarget(c("instagram", "https://www.instagram.com/jo.sells.homes/"), "either")).toBe("https://www.instagram.com/jo.sells.homes/");
    expect(exactTarget(c("x", "https://x.com/search?q=realtor"), "either")).toBeNull();
  });

  it("a pasted Facebook group post becomes a message (it was skipped as 'no promotion')", async () => {
    const { ctx, store } = await setup({
      def: fakeAgent({ id: "replies-facebook", maxPending: 10 }),
      script: (req) =>
        req.schema ? JSON.stringify({ items: [{ i: 0, score: 0.9, why: "wants a card", angle: "card", asks_for_tools: true, business_pro: true }] }) : "Paper cards run out at every open house. I built SwiftCard so people tap your phone and save you. Free to start. What do you hand out now?",
    });
    const pastedPost: Candidate = { platform: "facebook", url: "https://www.facebook.com/groups/realtors/posts/1", author: "Jo", title: "What do you all hand out at open houses?", text: "Paper cards keep running out.", community: null, promoAllowed: true, fromPaste: true };
    await runEngagement(ctx, { platform: "facebook", kind: "reply", action: "reply", ceiling: SHEET_DAILY_TARGET, keywordFilter: false, register: "", length: "", label: (c) => c.title, find: async () => [pastedPost] });
    expect(store.approvals).toHaveLength(1);
  });

  it("out of time inside a tick, the good posts not drafted yet start the next run", async () => {
    const store = new MemoryStore();
    const def = fakeAgent({ id: "replies-x", maxPending: 50 });
    await store.patchAgentState(def.id, { enabled: true });
    const claude = new FakeClaude((req) => {
      if (req.schema) {
        const n = (req.prompt.match(/^#\d+/gm) ?? []).length;
        return JSON.stringify({ items: Array.from({ length: n }, (_, i) => ({ i, score: 0.9, why: "wants a card", angle: "card", asks_for_tools: false, business_pro: true })) });
      }
      return "Losing leads after events hurts. I built SwiftCard so they save you with one tap. Free to start. How do you follow up now?";
    });
    const post = (i: number): Candidate => ({ platform: "x", url: `https://x.com/jo${i}/status/${i}`, author: `jo${i}`, title: `business cards keep running out ${i}`, text: "networking event tonight", community: null, promoAllowed: true });
    const o = { platform: "x" as const, kind: "reply" as const, action: "reply", ceiling: SHEET_DAILY_TARGET, register: "", length: "", label: (c: Candidate) => c.title };
    // A deadline already passed: nothing is drafted, all three are kept.
    const late = await buildContext({ def, store, providers: { claude, critic: null }, runId: null, deadline: Date.now() - 1 });
    const first = await runEngagement(late, { ...o, find: async () => [post(1), post(2), post(3)] });
    expect(store.approvals).toHaveLength(0);
    expect(first.restMinutes).toBeUndefined(); // posts are waiting: no rest
    const next = await buildContext({ def, store, providers: { claude, critic: null }, runId: null });
    await runEngagement(next, { ...o, find: async () => [] });
    expect(store.approvals).toHaveLength(3);
  });

  it("a run that adds nothing rests longer each time, and a good run resets it", async () => {
    const { ctx } = await setup();
    expect([await emptyRest(ctx), await emptyRest(ctx), await emptyRest(ctx), await emptyRest(ctx), await emptyRest(ctx), await emptyRest(ctx)]).toEqual([30, 60, 120, 240, 240, 240]);
  });

  it("the Blog Writer's own spending doesn't use up the agents' shared limit", () => {
    const totals = { total: { usd: 2.9, tokens: 0, cacheRead: 0, input: 0 }, byAgent: { "blog-writer": { usd: 2.5, tokens: 0 }, a: { usd: 0.4, tokens: 0 } }, byTeam: {} };
    const state = { id: "a", enabled: true, model_override: null, daily_usd_cap: null, config: {}, last_run_at: null, next_run_at: null, lease_until: null, status_note: null };
    const check = (cap: number) => checkBudget({ hardDisabled: false, settings: { ...DEFAULT_SETTINGS, daily_usd_cap: cap }, state, agent: { id: "a", team: "replies", dailyUsd: 5 }, totals, estUsd: 0.1 });
    expect(check(3).ok).toBe(true);
    expect(check(0.45).ok).toBe(false);
  });
});

describe("the tick runs the agents side by side", () => {
  it("two workers are running at the same time (one after another, a tick fit 3 or 4)", async () => {
    const store = new MemoryStore();
    let running = 0;
    let most = 0;
    const slow = (id: string) =>
      fakeAgent({
        id,
        run: async () => {
          running++;
          most = Math.max(most, running);
          await new Promise((r) => setTimeout(r, 30));
          running--;
          return { summary: "ran" };
        },
      });
    const agents = [slow("w1"), slow("w2"), slow("w3")];
    for (const a of agents) await store.patchAgentState(a.id, { enabled: true });
    const report = await runTick({ store, providers: { claude: null, critic: null }, agents });
    expect(report.ran.map((r) => r.agent)).toEqual(["w1", "w2", "w3"]);
    expect(most).toBeGreaterThan(1);
  });
});
