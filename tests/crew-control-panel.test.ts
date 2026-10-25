import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { activityFor } from "@/lib/crew/agent-detail";
import { JOBS, GROUP_NAME, agentName, agentStatus, askLine, nextRunLabel, plainFinding, plainNeeds, plainResult, scrub } from "@/lib/crew/agent-status";
import { PAUSE_FOREVER, doorState } from "@/lib/crew/doors";
import { AGENTS, agentById } from "@/lib/crew/registry";
import { SCHEDULE_OVERRIDES_KEY, effectiveSchedule, nextRun, parseScheduleForm, plainSchedule, validSchedule } from "@/lib/crew/schedule";
import { DEFAULT_SETTINGS, DOOR_TEAMS, defaultTeam } from "@/lib/crew/store";
import { MemoryStore } from "@/lib/crew/store-memory";
import { runTick } from "@/lib/crew/tick";
import type { AgentState } from "@/lib/crew/types";
import { fakeAgent } from "./crew-helpers";

// The Agents tab as a control panel: every agent has a plain name, a status
// word with a colour, a plain last result; the owner's schedule is what the
// clock follows; and nothing on screen leaks a setting name or model name.

const NOW = new Date("2026-10-21T18:00:00Z"); // Wed 2pm New York
const state = (over: Partial<AgentState> = {}): AgentState => ({ id: "x", enabled: true, model_override: null, daily_usd_cap: null, config: {}, last_run_at: null, next_run_at: null, lease_until: null, status_note: null, ...over });
const open = doorState(defaultTeam("replies"), { team: "replies", settings: DEFAULT_SETTINGS, hardDisabled: false }, NOW);
const shut = doorState({ ...defaultTeam("replies"), door_open: false }, { team: "replies", settings: DEFAULT_SETTINGS, hardDisabled: false }, NOW);
const JARGON = /CREW_|_KEY\b|_SECRET\b|\b(Haiku|Sonnet|Opus|Fable)\b|\btokens?\b|ChatGPT/;

describe("names and groups", () => {
  it("every agent has a plain, unique name and sits in exactly one job", () => {
    const names = AGENTS.map((d) => agentName(d));
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).not.toMatch(JARGON);
    const teams = JOBS.flatMap((j) => j.teams);
    expect(new Set(teams).size).toBe(teams.length);
    for (const t of [...DOOR_TEAMS, "system" as const]) expect(teams, t).toContain(t);
    for (const t of teams) expect(GROUP_NAME[t]).toBeTruthy();
  });

  it("anything that can reach the public says it always asks first; lead finders say they never send", () => {
    for (const d of AGENTS) {
      const a = askLine(d);
      if (d.approvalKind && d.approvalKind !== "ask" && d.role === "worker" && d.team !== "leads") expect(a, d.id).toEqual({ locked: true, text: "Asks you before anything goes out: always on" });
    }
    expect(askLine(agentById("leads-web")!).text).toBe("Saves leads to your list. Never sends email.");
  });
});

describe("status", () => {
  const maya = agentById("replies-reddit")!;
  const s = (st: Partial<AgentState>, o: { door?: typeof open; waiting?: number; lastRun?: Parameters<typeof plainResult>[0] & { id?: string } } = {}) =>
    agentStatus({
      def: maya,
      state: state(st),
      missing: [],
      door: o.door ?? open,
      now: NOW,
      lastRun: o.lastRun ? { id: "r", agent_id: maya.id, started_at: NOW.toISOString(), finished_at: NOW.toISOString(), stats: {}, error: null, ...o.lastRun } : null,
      waiting: o.waiting ?? 0,
      schedule: maya.schedule,
    });

  it("one word and one colour for each state", () => {
    expect(s({ lease_until: "2026-10-21T18:05:00Z" })).toMatchObject({ word: "Running", tone: "blue" });
    expect(s({ next_run_at: "2026-10-22T13:00:00Z" })).toMatchObject({ word: "On schedule", tone: "green", line: "Next run: Tomorrow 9:00am." });
    expect(s({ paused_until: PAUSE_FOREVER })).toMatchObject({ word: "Paused", tone: "amber", line: "Paused until you say go." });
    expect(s({}, { door: shut })).toMatchObject({ word: "Paused", line: "Its whole group is paused." });
    expect(s({}, { waiting: 2 })).toMatchObject({ word: "Needs you", tone: "violet" });
    expect(s({}, { lastRun: { status: "error", summary: "TypeError" } })).toMatchObject({ word: "Failed", tone: "red" });
    expect(s({ status_note: "Last run failed: boom" })).toMatchObject({ word: "Failed" });
    expect(s({ enabled: false })).toMatchObject({ word: "Off", tone: "gray" });
    expect(agentStatus({ def: maya, state: state(), missing: ["CREW_ANTHROPIC_API_KEY"], door: open, now: NOW, lastRun: null, waiting: 0, schedule: maya.schedule })).toMatchObject({
      word: "Needs setup",
      line: "Needs the Claude connection before it can run.",
    });
    expect(agentStatus({ def: agentById("leads-linkedin")!, state: state(), missing: [], door: open, now: NOW, lastRun: null, waiting: 0, schedule: maya.schedule }).word).toBe("Not available");
  });

  it("the last result is one plain sentence, never a raw error", () => {
    expect(plainResult(null)).toBe("Hasn't run yet.");
    expect(plainResult({ status: "ok", summary: "Found 3 threads, drafted 2 replies" })).toBe("Found 3 threads, drafted 2 replies.");
    expect(plainResult({ status: "error", summary: "TypeError: fetch failed ECONNRESET" })).toBe("Something went wrong, so it stopped. Tap Retry to try again.");
    expect(plainResult({ status: "budget", summary: "Agent cap $0.25 reached" })).toBe("Stopped early: it reached today's money limit.");
    expect(plainResult({ status: "locked", summary: "door" })).toBe("Stopped because it was paused.");
    expect(plainResult({ status: "ok", summary: "Wrote the report (email not sent: RESEND_API_KEY missing). Upgraded to Opus." })).not.toMatch(JARGON);
  });

  it("setting names and model names become words", () => {
    expect(plainNeeds(["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET", "CREW_ANTHROPIC_API_KEY"])).toBe("the Reddit connection and the Claude connection");
    expect(scrub("Needs CREW_STRIPE_READ_KEY; Sonnet 5.5 used 400 tokens")).toBe("Needs the Stripe connection; the AI used 400 AI use");
    expect(plainFinding({ kind: "bug", title: "TypeError: x is undefined on /dashboard/contacts", count: 3 })).toBe("Something broke for visitors on /dashboard/contacts (seen 3 times).");
  });

  it("next run in words", () => {
    expect(nextRunLabel(maya.schedule, { enabled: false, next_run_at: null }, NOW)).toBe("Not scheduled (turned off)");
    expect(nextRunLabel({ kind: "on_input", platforms: ["facebook"] }, { enabled: true, next_run_at: null }, NOW)).toBe("When you hand it something");
    expect(nextRunLabel(maya.schedule, { enabled: true, next_run_at: null }, NOW)).toBe("Within 15 minutes");
    expect(nextRunLabel(maya.schedule, { enabled: true, next_run_at: "2026-10-21T19:00:00Z" }, NOW)).toBe("Today 3:00pm");
  });

  it("the activity timeline is plain words, newest first", () => {
    const items = activityFor(
      [
        { id: "1", agent_id: "a", started_at: "2026-10-21T10:00:00Z", finished_at: "2026-10-21T10:01:00Z", status: "error", summary: "ECONNRESET", stats: {}, error: "ECONNRESET" },
        { id: "2", agent_id: "a", started_at: "2026-10-21T12:00:00Z", finished_at: "2026-10-21T12:01:00Z", status: "ok", summary: "Drafted 2 replies", stats: {}, error: null },
      ],
      [],
      "2026-10-14T00:00:00Z",
    );
    expect(items.map((i) => i.text)).toEqual(["Drafted 2 replies.", "Something went wrong, so it stopped. Tap Retry to try again."]);
  });
});

describe("your schedule", () => {
  it("reads the form, refuses anything faster than 15 minutes, and says it plainly", () => {
    const f = (o: Record<string, string>) => parseScheduleForm((k) => o[k] ?? "");
    expect(f({ mode: "every", every: "120" })).toEqual({ kind: "every", minutes: 120 });
    expect(f({ mode: "every", every: "5" })).toBe("Pick how often.");
    expect(f({ mode: "daily", time: "9:30" })).toEqual({ kind: "daily", hour: 9, minute: 30 });
    expect(f({ mode: "days", time: "8:00", day_1: "on", day_3: "on" })).toEqual({ kind: "daily", hour: 8, minute: 0, days: [1, 3] });
    expect(f({ mode: "days", time: "8:00" })).toBe("Pick at least one day.");
    expect(f({ mode: "daily", time: "25:00" })).toBe("Pick a time.");
    expect(validSchedule({ kind: "every", minutes: 1 })).toBe(false);
    expect(plainSchedule({ kind: "every", minutes: 15 })).toBe("Every 15 minutes");
    expect(plainSchedule({ kind: "every", minutes: 60 })).toBe("Every hour");
    expect(plainSchedule({ kind: "daily", hour: 9, minute: 0, days: [1, 2, 3, 4, 5] })).toBe("Weekdays at 9:00am");
    expect(plainSchedule({ kind: "daily", hour: 8, days: [0, 3] })).toBe("Sun and Wed at 8:00am");
  });

  it("an agent that runs on pasted input, or can never run, keeps its own trigger", () => {
    const fb = agentById("replies-facebook")!;
    expect(effectiveSchedule(fb, { [fb.id]: { kind: "every", minutes: 15 } })).toBe(fb.schedule);
    const li = agentById("leads-linkedin")!;
    expect(effectiveSchedule(li, { [li.id]: { kind: "every", minutes: 15 } })).toBe(li.schedule);
    const maya = agentById("replies-reddit")!;
    expect(effectiveSchedule(maya, { [maya.id]: { kind: "every", minutes: 3 } as never })).toBe(maya.schedule);
  });

  it("the clock follows your schedule when it sets the next run", async () => {
    const store = new MemoryStore();
    const a = fakeAgent({ id: "sched", schedule: { kind: "every", minutes: 60 } });
    await store.patchAgentState("sched", { enabled: true });
    await store.kvSet(SCHEDULE_OVERRIDES_KEY, { sched: { kind: "every", minutes: 360 } });
    const now = () => NOW;
    const r = await runTick({ store, providers: { claude: null, critic: null }, agents: [a], now });
    expect(r.ran.map((x) => x.agent)).toEqual(["sched"]);
    expect((await store.getAgentState("sched")).next_run_at).toBe(nextRun({ kind: "every", minutes: 360 }, NOW).toISOString());
  });

  it("a pause from the Agents tab holds an agent until you resume it", async () => {
    const store = new MemoryStore();
    const a = fakeAgent({ id: "held" });
    await store.patchAgentState("held", { enabled: true, paused_until: PAUSE_FOREVER, pause_note: "Paused by you." });
    const r = await runTick({ store, providers: { claude: null, critic: null }, agents: [a], now: () => NOW });
    expect(r.ran).toEqual([]);
    expect(r.skipped).toEqual([{ agent: "held", why: "paused until you say go" }]);
  });
});

describe("guards", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("the agent page checks admin before loading anything", () => {
    expect(read("src/app/admin/crew/agent/[id]/page.tsx")).toContain("if (!(await requireAdmin())) notFound();");
  });
  it("the agent route offers pause, stop and schedule; stop also pauses so a run under way halts at its next step", () => {
    const src = read("src/app/api/admin/crew/agents/[id]/route.ts");
    for (const a of ['"pause"', '"stop"', '"schedule"', '"reset_schedule"', '"run"', '"resume"']) expect(src).toContain(`action === ${a}`);
    expect(src).toMatch(/action === "stop"[\s\S]*?enabled: false, paused_until: PAUSE_FOREVER/);
  });
  it("the manager chat can't change schedules", () => {
    expect(read("src/lib/crew/manager-chat.ts")).not.toMatch(/SCHEDULE_OVERRIDES_KEY|schedule_overrides|kvSet\(/);
  });
});
