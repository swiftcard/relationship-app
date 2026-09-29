import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// ── The Agent Flow BRAIN, pinned (owner order 2026-09-08) ────────────────────
// "All my agents should have a brain like that": every agent researches its
// role (a playbook, with its own working rhythm), researches what to make
// today, hands the owner TWO finished options, and the one he picks goes out.
// These tests make that contract a build failure to break.

const config = JSON.parse(read("marketing-agents/config.json")) as {
  agents: Record<string, { workflow?: string; default_schedule?: string; continuous?: boolean; mode?: string }>;
};
const orgJson = JSON.parse(read("marketing-agents/org.json")) as { parties: Record<string, { kind: string; reports_to?: string; agent_id?: string }> };
const parties = Object.entries(orgJson.parties).map(([id, p]) => ({ id, ...p }));
const brain = read("marketing-agents/lib/brain.mjs");
const runner = read("marketing-agents/run-agent.mjs");
const itemsRoute = read("src/app/api/admin/agents/items/route.ts");
const client = read("src/app/admin/agent-flow/AgentFlowClient.tsx");

// Agents whose runs are LLM-driven (the code-only watchdogs and the Fixer are
// wired differently and carry no playbook).
const LLM_AGENTS = Object.entries(config.agents)
  .filter(([id, a]) => !a.continuous && id !== "fixer" && id !== "manager")
  .map(([id]) => id);

describe("brain: every LLM agent researches its role and works from a playbook", () => {
  it("the shared brain owns playbooks, two-option queuing and the tell filter", () => {
    expect(brain).toMatch(/export async function ensurePlaybook/);
    expect(brain).toMatch(/export async function queueChoice/);
    expect(brain).toMatch(/export const TWO_OPTIONS_RULES/);
    expect(brain).toMatch(/const AI_TELLS = \[/);
    expect(brain).toMatch(/agent_playbooks/);
  });

  it("the generic runner, the blog writer and the competitor watch all run on the brain", () => {
    for (const f of ["marketing-agents/run-agent.mjs", "marketing-agents/agent-blog.mjs", "marketing-agents/agent-competitors.mjs"]) {
      const src = read(f);
      expect(src, `${f} must import the brain`).toMatch(/from "\.\/lib\/brain\.mjs"/);
      expect(src, `${f} must build its playbook`).toMatch(/ensurePlaybook\(/);
      expect(src, `${f} must queue two options`).toMatch(/queueChoice\(/);
    }
  });

  it("every LLM agent has a brief, a workflow, a config entry, an org party and a seed", () => {
    const seed = read("supabase/agent-flow.sql");
    for (const id of LLM_AGENTS) {
      const a = config.agents[id];
      expect(existsSync(`marketing-agents/agents/${id}.md`), `${id} needs a brief`).toBe(true);
      expect(a.workflow, `${id} needs a workflow`).toBeTruthy();
      expect(existsSync(`.github/workflows/${a.workflow}`), `${id}'s workflow file ${a.workflow} is missing`).toBe(true);
      expect(parties.some((p) => p.agent_id === id), `${id} needs an org party`).toBe(true);
      expect(seed, `${id} needs an agent_settings seed`).toContain(`('${id}'`);
      expect(client, `${id} needs a role in the UI`).toMatch(new RegExp(`(^|[\\s{,])${id}: "`, "m"));
    }
  });

  it("every LLM agent's brief tells it to research first and to hand over TWO options", () => {
    for (const id of LLM_AGENTS) {
      const brief = read(`marketing-agents/agents/${id}.md`);
      expect(brief, `${id}.md must research before writing`).toMatch(/research/i);
      expect(brief, `${id}.md must produce two options`).toMatch(/TWO (options|complete)|two options|OPTION A|A and B/);
    }
  });

  it("the playbook writes a rhythm the clock understands — and never overrides the owner's", () => {
    // The owner's hand outranks research: 'owner' source is never touched.
    expect(brain).toMatch(/schedule_source === "owner"\) return/);
    expect(brain).toMatch(/schedule_source: "playbook"/);
    expect(brain).toMatch(/isValidSchedule\(/);
    const settings = read("src/app/api/admin/agents/settings/route.ts");
    expect(settings).toMatch(/schedule_source = patch\.schedule \? "owner" : "default"/);
    // The weekly grammar the playbook uses ("a few times a week") is real.
    const sched = read("marketing-agents/lib/schedule.mjs");
    expect(sched).toMatch(/weekly@\(sun\|mon\|tue\|wed\|thu\|fri\|sat\)/);
    expect(client).toMatch(/weekly@/);
  });
});

describe("brain: two options in, one picked, and it goes out", () => {
  it("a choice item carries exactly two finished options, A and B", () => {
    expect(brain).toMatch(/if \(options\.length < 2\) return/);
    expect(brain).toMatch(/options\.slice\(0, 2\)/);
    expect(brain).toMatch(/label: i === 0 \? "A" : "B"/);
    expect(brain).toMatch(/item_type: "choice"/);
  });

  it("person-facing options pass the AI-tell filter before they are queued", () => {
    expect(brain).toMatch(/if \(personFacing\)/);
    expect(runner).toMatch(/queueChoice\(run, it, \{ personFacing: PERSON_FACING\.has\(agentId\), personal: PERSONAL_AGENTS\.has\(agentId\) \}\)/);
  });

  it("choose is admin-gated, one item at a time, and takes the same road as Approve", () => {
    expect(itemsRoute).toMatch(/requireAdmin/);
    expect(itemsRoute).toMatch(/requested === "choose" && \(ids\.length !== 1 \|\| !\(optionIndex === 0 \|\| optionIndex === 1\)\)/);
    expect(itemsRoute).toMatch(/function resolveChoice/);
    // Once resolved the item is approved — the connector posts it or it is
    // saved for the copy flow; a chosen blog post goes live in the same step.
    expect(itemsRoute).toMatch(/const action = chosen \? "approved" : requested/);
    expect(itemsRoute).toMatch(/chosen && item\.item_type === "blog_post"/);
    // A two-option item can never be bulk-approved past the owner's pick.
    expect(itemsRoute).toMatch(/item\.item_type === "choice" && \(requested === "approved"/);
    expect(client).toMatch(/i\.status === "pending" && i\.item_type !== "choice"/);
  });

  it("the UI shows A and B side by side with a pick for each and a Neither", () => {
    expect(client).toMatch(/choice: "Pick A or B"/);
    expect(client).toMatch(/act\(\[it\.id\], "choose", undefined, idx\)/);
    expect(client).toMatch(/Neither/);
  });
});

describe("brain: the competitor watch spends nothing when nothing changed", () => {
  const src = read("marketing-agents/agent-competitors.mjs");
  it("hashes every tracked page and only wakes the model on a real change or the Monday sweep", () => {
    expect(src).toMatch(/agent_competitor_snapshots/);
    expect(src).toMatch(/if \(!changes\.length && !doSweep\)/);
    expect(src).toMatch(/No tokens spent/);
    expect(src.indexOf("No tokens spent")).toBeLessThan(src.indexOf("askClaude("));
    expect(src).toMatch(/nyWeekday\(\) === "mon"/);
  });

  it("starts with Blinq and HiHello seeded and lets the owner add more from a found item", () => {
    const sql = read("supabase/agent-brain.sql");
    expect(sql).toMatch(/agent_competitors/);
    expect(sql).toMatch(/'blinq'/);
    expect(sql).toMatch(/'hihello'/);
    expect(itemsRoute).toMatch(/item\.item_type === "competitor_found" && optionIndex === 0\) await addCompetitor/);
  });
});

describe("brain: the roster covers every free channel the owner named", () => {
  it("link-in-bio prospecting, industry outreach, Reddit, forums, partners, listings, reviews, support, retention, video, email, CRO, competitors", () => {
    for (const id of ["prospects", "industry", "mentions", "forums", "partners", "listings", "reviews", "support", "retention", "video", "email", "cro", "competitors"])
      expect(config.agents[id], `${id} is missing from config`).toBeTruthy();
    const prospects = read("marketing-agents/agents/prospects.md");
    for (const tool of ["Linktree", "LinkMe", "HiHello"]) expect(prospects).toContain(tool);
    expect(read("marketing-agents/agents/industry.md")).toMatch(/realtor|real estate/i);
    expect(read("marketing-agents/agents/competitors.md")).toMatch(/Blinq/);
  });

  it("every worker reports to a lead and every lead to the chief", () => {
    const byId = new Map(parties.map((p) => [p.id, p]));
    for (const p of parties) {
      if (p.kind === "worker") expect(byId.get(p.reports_to ?? "")?.kind, `${p.id} must report to a lead`).toBe("lead");
      if (p.kind === "lead") expect(byId.get(p.reports_to ?? "")?.kind, `${p.id} must report to the chief`).toBe("chief");
    }
  });

  it("agents other than the four watchdogs run on a rhythm, never hot-looped", () => {
    for (const f of readdirSync(".github/workflows").filter((f) => f.startsWith("agent-"))) {
      const src = read(`.github/workflows/${f}`);
      expect(src, `${f} must be dispatchable`).toMatch(/workflow_dispatch/);
    }
    // Requests between agents are how the hand-offs work (e.g. Milo → Vince for a video).
    expect(brain).toMatch(/export async function fileRequest/);
    expect(brain).toMatch(/agent_requests/);
    expect(runner).toMatch(/CAN_REQUEST/);
  });
});

// ── Personal, not generic (owner order 2026-09-08) ───────────────────────────
// "It has to sound human … it can't just be generic. Has to be personal."
// A phrase filter can't tell a template from a real reply, so every agent that
// writes to ONE person must quote the detail its draft hinges on, and the
// draft must use it — or the option is dropped before the owner sees it.
describe("brain: a message to one person is written to THAT person", () => {
  const personalIds = ["mentions", "forums", "prospects", "outreach", "influencer", "partners", "industry", "reviews"];

  it("the personal gate exists, is exported, and covers every per-person agent", () => {
    expect(brain).toMatch(/export function isPersonal\(/);
    expect(brain).toMatch(/export const PERSONAL_RULES/);
    const m = brain.match(/export const PERSONAL_AGENTS = new Set\(\[([^\]]+)\]\)/);
    expect(m).toBeTruthy();
    const ids = m![1].split(",").map((s) => s.trim().replace(/"/g, ""));
    for (const id of personalIds) expect(ids, `${id} writes to one person`).toContain(id);
    for (const id of ids) expect(config.agents[id], `${id} is a real agent`).toBeTruthy();
  });

  it("the runner and the chat turn both prompt the rule and enforce it on every option", () => {
    expect(runner).toMatch(/PERSONAL_AGENTS\.has\(agentId\) \? PERSONAL_RULES : ""/);
    expect(runner).toMatch(/queueChoice\(run, it, \{ personFacing: PERSON_FACING\.has\(agentId\), personal: PERSONAL_AGENTS\.has\(agentId\) \}\)/);
    expect(runner).toMatch(/isPersonal\(it\.content \?\? ""/); // the legacy single-take shape too
    const chat = read("marketing-agents/chat-turn.mjs");
    expect(chat).toMatch(/PERSONAL_AGENTS\.has\(agentId\) \? PERSONAL_RULES : ""/);
    expect(chat).toMatch(/personal: PERSONAL_AGENTS\.has\(agentId\)/);
    expect(brain).toMatch(/if \(personal\) \{[\s\S]*?isPersonal\(o\.content, o\.personal_hook/);
    expect(brain).toMatch(/OPTIONS_JSON_SHAPE[\s\S]*"personal_hook":/);
  });

  it("the gate itself: no hook, or a draft that never touches its hook, fails; a real reply passes", async () => {
    const { isPersonal, soundsHuman } = await import("../marketing-agents/lib/brain.mjs");
    expect(isPersonal("Hey, love what you're doing, ever tried a digital card?", "").ok).toBe(false);
    expect(isPersonal("Hey, love what you're doing, ever tried a digital card?", "photos").ok).toBe(false);
    expect(isPersonal("totally agree, paper cards are dead", "the van in the driveway").ok).toBe(false);
    expect(isPersonal("the van in the driveway shot is the best listing photo i've seen all month — did that get you calls?", "the van in the driveway").ok).toBe(true);
    // A thread the agent may not answer is flagged, not drafted — no hook needed.
    expect(brain).toMatch(/\^DO NOT POST\/i\.test\(String\(o\.content\)/);
    // The cold-DM openers everyone has learned to skip are tells now.
    for (const s of ["I noticed you use Linktree", "Great post! Quick one", "I'm reaching out because", "Hope you're doing well", "love your content", "I'd love to hear more"]) {
      expect(soundsHuman(s).ok, `"${s}" must be caught`).toBe(false);
    }
    expect(soundsHuman("that open-house QR trick is clever — how many scans did it get?").ok).toBe(true);
  });

  it("the blog writer is held to the same bar: no generic titles", () => {
    const blog = read("marketing-agents/agent-blog.mjs");
    expect(blog).not.toMatch(/"Why you should have a digital business card"/);
    expect(blog).toMatch(/SPECIFIC, NEVER GENERIC/);
    expect(read("marketing-agents/agents/blog.md")).toMatch(/## Specific, never generic/);
  });
});

// ── Nothing depends on SQL the owner hasn't run yet ──────────────────────────
describe("brain: missing tables degrade, they don't fail runs or hide agents", () => {
  it("no playbook table → no research spent, no failed run; a failed save keeps the shift", () => {
    expect(brain).toMatch(/async function playbookTableMissing/);
    expect(brain).toMatch(/if \(!existing && \(await playbookTableMissing\(\)\)\)[\s\S]*?return null;/);
    expect(brain).toMatch(/try \{ await sb\("POST", "agent_playbooks"[\s\S]*?catch \(e\) \{[\s\S]*?return row; \}/);
  });

  it("an agent added after the seed gets a settings row from the tab AND the runner — rested", () => {
    const board = read("src/app/api/admin/agents/route.ts");
    expect(board).toMatch(/async function seedMissingSettings/);
    expect(board).toMatch(/paused: true, output_cap/);
    expect(board).toMatch(/ignoreDuplicates: true/);
    const kit = read("marketing-agents/lib/agentkit.mjs");
    expect(kit).toMatch(/async function seedSettings\(agentId\)/);
    expect(kit).toMatch(/enabled: true, paused: true, output_cap/);
    expect(kit).toMatch(/resolution=ignore-duplicates/);
    const sql = read("supabase/agent-brain.sql");
    for (const id of ["video", "email", "cro", "competitors", "industry", "forums", "partners", "listings", "reviews", "support", "retention"]) {
      expect(sql, `${id} seeded`).toMatch(new RegExp(`\\('${id}',\\s+true, true`));
    }
  });

  it("the watchdog closes runs that died mid-flight and keeps the chat moving even while the office is closed", () => {
    const wd = read("marketing-agents/watchdog.mjs");
    expect(wd).toMatch(/async function sweepStaleRuns/);
    expect(wd).toMatch(/status=eq\.running&started_at=lt\./);
    const sweeps = wd.indexOf("await sweepChatOrders()");
    const gate = wd.indexOf("if (sys.paused)");
    expect(sweeps).toBeGreaterThan(0);
    expect(sweeps, "sweeps run before the pause gate").toBeLessThan(gate);
    expect(wd.indexOf("await sweepStaleRuns()")).toBeLessThan(gate);
  });
});
