import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { MemoryStore } from "@/lib/crew/store-memory";
import { STALE_RUN_SUMMARY, type RunRow } from "@/lib/crew/store";
import { LEASE_MS, runTick } from "@/lib/crew/tick";
import { ALL_TABS } from "@/lib/crew/sheets/tabs";

// ── Agents: the four faults found checking them for the owner (2026-10-28) ──
// Owner: "make sure all the agents are properly connected to the sheet and
// working". Each block is one thing that was wrong in production.

const read = (p: string) => readFileSync(p, "utf8");

function run(over: Partial<RunRow> & { id: string; minsAgo: number }): RunRow {
  const { minsAgo, ...rest } = over;
  return { agent_id: "competitor-watch", started_at: new Date(Date.now() - minsAgo * 60_000).toISOString(), finished_at: null, status: "running", summary: null, stats: {}, error: null, ...rest };
}

describe("a run the platform cut off is closed, not 'running' forever", () => {
  // Six competitor-watch runs from 2026-10-21..26 were still "running" on
  // 10-28: the function hit its time limit and never reached finishRun.
  it("the tick closes runs whose lease is long gone, as errors that say why", async () => {
    const store = new MemoryStore();
    store.runs.push(run({ id: "dead", minsAgo: 60 * 24 * 3 }), run({ id: "live", minsAgo: 2 }), run({ id: "done", minsAgo: 90, status: "ok", finished_at: new Date().toISOString() }));
    const r = await runTick({ store, providers: { claude: null, critic: null }, agents: [] });
    expect(r.closed).toBe(1);
    const byId = Object.fromEntries(store.runs.map((x) => [x.id, x]));
    expect(byId.dead).toMatchObject({ status: "error", summary: STALE_RUN_SUMMARY });
    expect(byId.dead.finished_at).not.toBeNull();
    // Still inside its lease: genuinely running, left alone.
    expect(byId.live.status).toBe("running");
    expect(byId.done.status).toBe("ok");
  });

  it("even while Pause all is on (the runs are history, not work)", async () => {
    const store = new MemoryStore();
    await store.updateSettings({ kill_all: true });
    store.runs.push(run({ id: "dead", minsAgo: (LEASE_MS / 60_000) * 3 }));
    expect((await runTick({ store, providers: { claude: null, critic: null }, agents: [] })).closed).toBe(1);
  });
});

describe("the Sheet shows each agent's LATEST run", () => {
  // runsSince is oldest first, and the Performance and Dashboard tabs take an
  // agent's first run in the list as its latest — so a failure fixed days ago
  // still read "Failed", and a fresh failure read fine.
  it("runsSince is oldest first (the contract the sync has to sort against)", async () => {
    const store = new MemoryStore();
    store.runs.push(run({ id: "a", minsAgo: 30 }), run({ id: "b", minsAgo: 10 }));
    const rows = await store.runsSince(new Date(Date.now() - 3600_000).toISOString());
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("the sync sorts them newest first before any tab reads them", () => {
    const sync = read("src/lib/crew/sheets/sync.ts");
    expect(sync).toContain("store.runsSince(week).then((r) => [...r].sort((a, b) => (a.started_at < b.started_at ? 1 : a.started_at > b.started_at ? -1 : 0)))");
  });
});

describe("an admin Stop can't be undone by the Sheet", () => {
  it("what Controls shows is remembered only after the write landed", () => {
    const sync = read("src/lib/crew/sheets/sync.ts");
    const write = sync.indexOf("if (await rewrite(store, id, CONTROLS, controls, report)) {");
    const remember = sync.indexOf("await store.kvSet(CONTROLS_SHOWN_KEY");
    expect(write).toBeGreaterThan(-1);
    expect(remember).toBeGreaterThan(write);
    // No second, unconditional save of the shown values.
    expect(sync.split("store.kvSet(CONTROLS_SHOWN_KEY").length - 1).toBe(1);
  });
});

describe("the Dashboard's 'Messages ready to send' counts real tabs", () => {
  it("every tab it adds up exists (it named 'linkedin', which never did)", () => {
    const derived = read("src/lib/crew/sheets/derived.ts");
    const list = derived.match(/const messages = ready\.filter\(\(r\) => \[([^\]]+)\]/)?.[1] ?? "";
    const ids = [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(3);
    const real = new Set(ALL_TABS.map((t) => t.id));
    for (const id of ids) expect(real.has(id), `${id} is not a Sheet tab`).toBe(true);
    expect(ids).toContain("linkedin-connections");
  });
});
