import { describe, expect, it } from "vitest";
import { doorState } from "@/lib/crew/doors";
import { AGENTS, agentById } from "@/lib/crew/registry";
import { STAFF, notHired, staffStatus } from "@/lib/crew/staff";
import { DEFAULT_SETTINGS, defaultTeam } from "@/lib/crew/store";
import { teamTimeline } from "@/lib/crew/timeline";
import type { AgentState, Approval } from "@/lib/crew/types";

// The office's people: every agent has a name and a title, the clutter sits
// in "Not hired yet" (never something that is switched on), and each card's
// status says plainly what the person is doing.

const NOW = new Date("2026-10-21T18:00:00Z");
const state = (over: Partial<AgentState> = {}): AgentState => ({ id: "x", enabled: true, model_override: null, daily_usd_cap: null, config: {}, last_run_at: null, next_run_at: null, lease_until: null, status_note: null, ...over });
const open = doorState(defaultTeam("replies"), { team: "replies", settings: DEFAULT_SETTINGS, hardDisabled: false }, NOW);
const locked = doorState({ ...defaultTeam("replies"), door_open: false }, { team: "replies", settings: DEFAULT_SETTINGS, hardDisabled: false }, NOW);

describe("staff", () => {
  it("every agent has a person, and first names are unique", () => {
    for (const d of AGENTS) expect(STAFF[d.id], d.id).toBeDefined();
    const names = AGENTS.map((d) => STAFF[d.id].first);
    expect(new Set(names).size).toBe(names.length);
  });

  it("locked agents are never hired; an agent that is on is never hidden", () => {
    for (const d of AGENTS.filter((a) => a.locked)) expect(notHired(d, { enabled: true }), d.id).toBe(true);
    const faye = agentById("leads-facebook")!;
    expect(notHired(faye, { enabled: false })).toBe(true);
    expect(notHired(faye, { enabled: true })).toBe(false);
    expect(notHired(agentById("replies-reddit")!, { enabled: false })).toBe(false);
  });

  it("status says what they are doing", () => {
    const maya = agentById("replies-reddit")!;
    const s = (st: Partial<AgentState>, door = open, missing: never[] | ["CREW_ANTHROPIC_API_KEY"] = []) => staffStatus({ def: maya, state: state(st), missing, door, now: NOW });
    expect(s({ lease_until: "2026-10-21T18:05:00Z" }).kind).toBe("working");
    expect(s({}, open, ["CREW_ANTHROPIC_API_KEY"]).kind).toBe("setup");
    expect(s({ enabled: false }).label).toBe("Off duty");
    expect(s({ paused_until: "2026-10-22T03:59:00Z" }).label).toBe("Paused until 11:59pm");
    expect(s({ paused_until: "2099-12-31T00:00:00Z" }).label).toBe("Paused until you say go");
    expect(s({}, locked).label).toBe("Locked out");
    expect(s({ next_run_at: "2026-10-21T19:00:00Z" })).toMatchObject({ kind: "break", line: "Next shift 3:00pm." });
    expect(staffStatus({ def: agentById("watchdog-manager")!, state: state(), missing: [], door: locked, now: NOW }).kind).toBe("break");
    expect(staffStatus({ def: agentById("leads-linkedin")!, state: state(), missing: [], door: open, now: NOW }).kind).toBe("not_hired");
  });
});

describe("the team chat timeline", () => {
  const approval = (o: Partial<Approval>): Approval => ({
    id: "a",
    created_at: "2026-10-21T15:00:00Z",
    agent_id: "replies-reddit",
    team: "replies",
    kind: "reply",
    status: "pending",
    title: "Reddit: a realtor asks about cards",
    summary: "",
    body: "secret draft text",
    platform: "reddit",
    target_url: null,
    person_id: null,
    debate: null,
    model_used: null,
    meta: {},
    decided_at: null,
    reject_reason: null,
    done_at: null,
    expires_at: "2026-10-28T15:00:00Z",
    ...o,
  });
  const run = (o: { id: string; agent_id: string; status: string; started_at: string }) => ({ ...o, finished_at: o.started_at, summary: `${o.status} summary`, stats: {}, error: null });

  it("merges the chat, drafts, decisions and problems, oldest first, this team only", () => {
    const items = teamTimeline({
      team: "replies",
      defs: AGENTS,
      now: NOW,
      chat: [
        { id: "c1", created_at: "2026-10-21T16:00:00Z", team: "replies", author: "owner", body: "How did today go?", status: "done", meta: {} },
        { id: "c2", created_at: "2026-10-21T16:01:00Z", team: "replies", author: "manager", body: "", status: "pending", meta: {} },
        { id: "c3", created_at: "2026-10-21T17:59:00Z", team: "replies", author: "manager", body: "", status: "pending", meta: {} },
      ],
      approvals: [
        approval({ id: "a1" }),
        approval({ id: "a2", status: "rejected", created_at: "2026-10-21T14:00:00Z", decided_at: "2026-10-21T15:30:00Z", reject_reason: "Too salesy" }),
        approval({ id: "a3", agent_id: "contact-reddit", team: "contact" }),
        approval({ id: "a4", created_at: "2026-10-01T00:00:00Z" }), // older than a week
      ],
      reports: [],
      runs: [run({ id: "r1", agent_id: "replies-reddit", status: "error", started_at: "2026-10-21T13:00:00Z" }), run({ id: "r2", agent_id: "replies-reddit", status: "ok", started_at: "2026-10-21T13:30:00Z" })],
      findings: [],
    });
    expect(items.map((i) => i.key)).toEqual(["u-r1", "a-a2", "a-a1", "d-a2", "c-c1", "c-c2", "c-c3"]);
    expect(items.find((i) => i.key === "a-a1")).toMatchObject({ body: "Maya drafted a reply: Reddit: a realtor asks about cards", href: "#a-a1" });
    expect(items.find((i) => i.key === "d-a2")!.body).toBe("You rejected Maya's draft (too salesy).");
    // A reply that never came back says so; one still being written stays pending.
    expect(items.find((i) => i.key === "c-c2")).toMatchObject({ status: "failed", body: "No answer came back. Ask me again." });
    expect(items.find((i) => i.key === "c-c3")!.status).toBe("pending");
    expect(JSON.stringify(items)).not.toContain("secret draft text");
  });
});
