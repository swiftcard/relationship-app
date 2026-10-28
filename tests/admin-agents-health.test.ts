import { describe, it, expect } from "vitest";
import { agentsAttention, failuresInARow, summarizeAgents, FAILING_AFTER, type AgentRun } from "@/lib/admin-data/agents-health";
import type { AgentDef } from "@/lib/crew/agent-def";

// ── The admin's picture of the agents (owner, 2026-10-28) ───────────────────
// "make sure all the agents are properly connected to the sheet and working".
// Pause all had been on for a day with nothing in the admin saying so; the
// Sheet sync's failures showed nowhere outside the Agents tab.

const at = (minsAgo: number) => new Date(Date.parse("2026-10-28T16:00:00Z") - minsAgo * 60_000).toISOString();
const r = (agent_id: string, status: string, minsAgo: number, summary: string | null = null): AgentRun => ({ agent_id, status, started_at: at(minsAgo), finished_at: status === "running" ? null : at(minsAgo - 1), summary });

const DEFS = [
  { id: "sheet-sync", name: "Sheet sync", infrastructure: true, needs: [] },
  { id: "leads-web", name: "Web Leads", needs: [] },
  { id: "leads-reddit", name: "Reddit Leads", needs: ["REDDIT_CLIENT_ID"] },
  { id: "old", name: "Retired", needs: [], locked: "retired" },
] as unknown as AgentDef[];
const missing = (d: AgentDef) => (d.id === "leads-reddit" ? ["REDDIT_CLIENT_ID"] : []);

describe("failures in a row", () => {
  it("counts errors back from the newest, ignoring a run still going, until one that wasn't", () => {
    expect(failuresInARow([r("a", "running", 1), r("a", "error", 5), r("a", "error", 20), r("a", "ok", 40), r("a", "error", 60)])).toBe(2);
    expect(failuresInARow([r("a", "ok", 1), r("a", "error", 5)])).toBe(0);
    expect(failuresInARow([])).toBe(0);
  });
});

describe("summarizeAgents", () => {
  const h = summarizeAgents({
    killAll: true,
    settingsUpdatedAt: at(1440),
    states: [{ id: "leads-web", enabled: true, next_run_at: at(-15), status_note: null }, { id: "leads-reddit", enabled: true, next_run_at: null, status_note: null }],
    runs: [
      r("sheet-sync", "error", 1, "Google: protected range"), r("sheet-sync", "error", 16), r("sheet-sync", "error", 31), r("sheet-sync", "ok", 46),
      r("leads-web", "ok", 10, "saved 1 new business"), r("leads-web", "error", 100),
    ],
    sheetRows: [{ tab: "web-leads" }, { tab: "web-leads" }, { tab: "office-prospects" }],
    waiting: 3,
    defs: DEFS,
    missing,
  });

  it("Pause all, and since when", () => {
    expect(h.paused).toBe(true);
    expect(h.pausedSince).toBe(at(1440));
  });

  it("the Sheet: last good sync, the failing streak and its reason, rows per tab", () => {
    expect(h.sheet.lastGoodSync).toBe(at(45));
    expect(h.sheet.failuresInARow).toBe(3);
    expect(h.sheet.lastError).toBe("Google: protected range");
    expect(h.sheet.rowsByTab).toEqual([{ tab: "web-leads", rows: 2 }, { tab: "office-prospects", rows: 1 }]);
  });

  it("each agent's LATEST run, never an older one; retired agents are left out", () => {
    const web = h.agents.find((a) => a.id === "leads-web")!;
    expect(web).toMatchObject({ on: true, lastStatus: "ok", lastSummary: "saved 1 new business", failuresInARow: 0, nextRunAt: at(-15) });
    expect(h.agents.map((a) => a.id)).not.toContain("old");
    // The Sheet keepers are always on.
    expect(h.agents.find((a) => a.id === "sheet-sync")!.on).toBe(true);
  });

  it("names the connection an agent is missing", () => {
    expect(h.agents.find((a) => a.id === "leads-reddit")!.needs).toEqual(["REDDIT_CLIENT_ID"]);
  });

  it("tells the owner, worst first", () => {
    const keys = agentsAttention(h).map((x) => x.key);
    expect(keys).toEqual(["sheet", "paused", "setup", "waiting"]);
    const text = agentsAttention(h).map((x) => x.text).join(" | ");
    expect(text).toContain("Reddit Leads (REDDIT_CLIENT_ID)");
    expect(text).toContain("drafts are waiting for your Approve");
  });
});

describe("an agent that keeps failing", () => {
  it(`is named once it has failed ${FAILING_AFTER} times in a row — and only while it's on`, () => {
    const runs = [r("leads-web", "error", 1), r("leads-web", "error", 2), r("leads-web", "error", 3)];
    const on = summarizeAgents({ killAll: false, settingsUpdatedAt: null, states: [{ id: "leads-web", enabled: true, next_run_at: null, status_note: null }], runs, sheetRows: [], waiting: 0, defs: DEFS, missing: () => [] });
    expect(agentsAttention(on)).toEqual([{ key: "failing", tone: "bad", n: 1, text: `agent has failed ${FAILING_AFTER} runs in a row: Web Leads` }]);
    const off = summarizeAgents({ killAll: false, settingsUpdatedAt: null, states: [{ id: "leads-web", enabled: false, next_run_at: null, status_note: null }], runs, sheetRows: [], waiting: 0, defs: DEFS, missing: () => [] });
    expect(agentsAttention(off)).toEqual([]);
  });

  it("nothing wrong says nothing", () => {
    const h = summarizeAgents({ killAll: false, settingsUpdatedAt: null, states: [], runs: [r("sheet-sync", "ok", 1)], sheetRows: [], waiting: 0, defs: DEFS, missing: () => [] });
    expect(agentsAttention(h)).toEqual([]);
    expect(h.pausedSince).toBeNull();
  });
});
