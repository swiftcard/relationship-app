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

describe("the Sheet no longer carries run, Controls or Dashboard copies (2026-10-29)", () => {
  // Three fixes of 2026-10-28 lived in code the Name, Message, Link Sheet
  // removed: the Performance and Dashboard tabs (they read a week-old run as
  // each agent's latest), the Controls tab (a failed write could undo a Stop
  // pressed in the admin) and the Dashboard's "Messages ready" count (it named
  // a tab that never existed). With those tabs gone none of it can come back.
  it("runsSince is still oldest first, for anything that reads it", async () => {
    const store = new MemoryStore();
    store.runs.push(run({ id: "a", minsAgo: 30 }), run({ id: "b", minsAgo: 10 }));
    const rows = await store.runsSince(new Date(Date.now() - 3600_000).toISOString());
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("the sync writes no copies of runs, Controls or the Dashboard any more", () => {
    const sync = read("src/lib/crew/sheets/sync.ts");
    for (const gone of ["runsSince", "CONTROLS_SHOWN_KEY", "dashboardCells", "controlsRows"]) expect(sync, gone).not.toContain(gone);
    for (const t of ALL_TABS) expect(["Dashboard", "Controls", "Agent Performance"]).not.toContain(t.name);
  });
});
