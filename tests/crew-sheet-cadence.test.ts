import { describe, expect, it } from "vitest";
import { SHEET_AGENTS, sheetSync } from "@/lib/crew/agents/sheet-sync";
import { AGENTS } from "@/lib/crew/registry";
import { nextRun } from "@/lib/crew/schedule";
import { MemoryStore } from "@/lib/crew/store-memory";
import { LEASE_MS, TICK_SLACK_MS, nextRunAt, runTick } from "@/lib/crew/tick";
import type { Schedule } from "@/lib/crew/types";
import { fakeAgent } from "./crew-helpers";

// ── The Sheet sync runs on every 15-minute tick ─────────────────────────────
// 2026-10-28: the sync started at 05:00:03, finished at 05:00:35, and was next
// due at 05:15:35, 35 seconds after the 05:15 tick, so it ran only every 30
// minutes. The Sheet keepers now count from the start of the run.

const at = (hms: string) => new Date(`2026-10-28T${hms}Z`);
const every15: Schedule = { kind: "every", minutes: 15 };
const providers = { claude: null, critic: null };

/** A clock the test moves by hand. */
function clock(start: string) {
  let t = at(start);
  return { now: () => t, set: (hms: string) => void (t = at(hms)), add: (ms: number) => void (t = new Date(t.getTime() + ms)) };
}

describe("nextRunAt", () => {
  it("the Sheet sync is due on the next 15-minute tick, however long the run took", () => {
    const next = nextRunAt(sheetSync, every15, at("05:00:03"), at("05:00:35"));
    expect(next.getTime()).toBeLessThanOrEqual(at("05:15:00").getTime());
    expect(next.getTime()).toBeGreaterThan(at("05:00:35").getTime());
  });

  it("is never before the run finished, so a run longer than its interval is due on the next tick, not the same one", () => {
    expect(nextRunAt(sheetSync, every15, at("05:00:03"), at("05:20:00")).toISOString()).toBe(at("05:20:00").toISOString());
  });

  it("every other agent keeps counting from the finish, exactly as before", () => {
    const others = AGENTS.filter((a) => !a.infrastructure);
    expect(others.length).toBeGreaterThan(10);
    for (const def of others) {
      for (const s of [every15, { kind: "every", minutes: 60 } as Schedule, { kind: "daily", hour: 9 } as Schedule, def.schedule]) {
        expect(nextRunAt(def, s, at("05:00:03"), at("05:03:00")).toISOString()).toBe(nextRun(s, at("05:03:00")).toISOString());
      }
    }
  });

  it("the daily snapshot still runs once a day at 7:30 New York", () => {
    const daily = SHEET_AGENTS.find((a) => a.id === "sheet-daily")!;
    const next = nextRunAt(daily, daily.schedule, at("11:30:02"), at("11:31:00"));
    expect(next.toISOString()).toBe(nextRun(daily.schedule, at("11:31:00")).toISOString());
    expect(next.getTime() - at("11:30:00").getTime()).toBe(24 * 3600_000);
  });

  it("the slack is shorter than the lease is long and much shorter than the interval", () => {
    expect(TICK_SLACK_MS).toBeLessThan(15 * 60_000 - LEASE_MS);
  });
});

describe("runTick with a Sheet keeper", () => {
  const keeper = (run: () => Promise<{ summary: string }> = async () => ({ summary: "synced" })) => fakeAgent({ id: "keeper", infrastructure: true, schedule: every15, run });

  it("runs on every tick a quarter of an hour apart, starting a few seconds late each time", async () => {
    const store = new MemoryStore();
    const c = clock("05:00:00");
    const def = keeper(async () => (c.add(32_000), { summary: "synced" })); // each run takes 32 seconds
    const ran: string[] = [];
    for (const tick of ["05:00:03", "05:15:02", "05:30:04", "05:45:01", "06:00:03"]) {
      c.set(tick);
      const r = await runTick({ store, providers, now: c.now, agents: [def] });
      if (r.ran.length) ran.push(tick);
    }
    expect(ran).toEqual(["05:00:03", "05:15:02", "05:30:04", "05:45:01", "06:00:03"]);
  });

  it("an ordinary agent on the same clock is unchanged: due a full interval after it finished", async () => {
    const store = new MemoryStore();
    const c = clock("05:00:00");
    const def = fakeAgent({ id: "worker", schedule: every15, run: async () => (c.add(32_000), { summary: "ran" }) });
    await store.patchAgentState("worker", { enabled: true });
    c.set("05:00:03");
    await runTick({ store, providers, now: c.now, agents: [def] });
    expect((await store.getAgentState("worker")).next_run_at).toBe(at("05:15:35").toISOString());
  });

  it("two ticks at once never run the same sync twice", async () => {
    const store = new MemoryStore();
    const c = clock("05:00:03");
    let running = 0;
    let most = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const def = keeper(async () => {
      running++;
      most = Math.max(most, running);
      await gate;
      running--;
      return { summary: "synced" };
    });
    const first = runTick({ store, providers, now: c.now, agents: [def] });
    await new Promise((r) => setTimeout(r, 0));
    const second = await runTick({ store, providers, now: c.now, agents: [def] });
    expect(second.ran).toEqual([]);
    expect(second.skipped).toEqual([{ agent: "keeper", why: "already running" }]);
    release();
    expect((await first).ran.map((r) => r.agent)).toEqual(["keeper"]);
    expect(most).toBe(1);
  });

  it("a sync still running when it falls due again is not started a second time", async () => {
    const store = new MemoryStore();
    const c = clock("05:00:03");
    const def = keeper();
    // Due, but an earlier run is still holding its lease (it started and hasn't finished).
    await store.patchAgentState("keeper", { next_run_at: at("05:08:00").toISOString(), lease_until: at("05:10:03").toISOString() });
    c.set("05:09:00");
    const held = await runTick({ store, providers, now: c.now, agents: [def] });
    expect(held.ran).toEqual([]);
    expect(held.skipped).toEqual([{ agent: "keeper", why: "already running" }]);
    c.set("05:15:00");
    expect((await runTick({ store, providers, now: c.now, agents: [def] })).ran.map((r) => r.agent)).toEqual(["keeper"]);
  });
});
