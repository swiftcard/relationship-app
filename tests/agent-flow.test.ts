import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// ── The Agent Flow safety contract, pinned ───────────────────────────────────
// The marketing agents' core promise is STRUCTURAL draft-only behavior on
// third-party platforms. These tests make that promise a build failure to
// break, not a code-review hope.
describe("agent flow: draft-only agents are structurally unable to post", () => {
  it("no agent code path contains a posting/DM API", () => {
    const forbidden = /api\.twitter\.com|graph\.facebook\.com|graph\.instagram\.com|api\.linkedin\.com|oauth\.reddit\.com|reddit\.com\/api\/submit|\/comments\/submit|chat\.postMessage/i;
    for (const f of readdirSync("marketing-agents").filter((f) => f.endsWith(".mjs")))
      expect(read(`marketing-agents/${f}`), `${f} contains a platform API`).not.toMatch(forbidden);
    expect(read("marketing-agents/lib/agentkit.mjs")).not.toMatch(forbidden);
  });

  it("agent workflows cannot push, merge, or deploy", () => {
    for (const f of readdirSync(".github/workflows").filter((f) => f.startsWith("agent-"))) {
      const src = read(`.github/workflows/${f}`);
      expect(src, `${f} must never merge a PR`).not.toMatch(/gh pr merge/);
      expect(src, `${f} must be manually triggerable`).toMatch(/workflow_dispatch/);
      if (f === "agent-fixer.yml") continue; // its own contract is pinned below
      expect(src, `${f} must not push`).not.toMatch(/git push/);
      if (f !== "agent-scheduler.yml") expect(src, `${f} should be contents: read`).toMatch(/contents: read/);
    }
  });

  it("the Fixer drafts on branches and can never touch main", () => {
    const src = read(".github/workflows/agent-fixer.yml");
    expect(src).toMatch(/--draft/);
    expect(src).not.toMatch(/gh pr merge/);
    // Both the branch-create and the push step refuse to operate on main.
    expect((src.match(/Refusing to (operate on|push from)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // Deterministic branch name → a re-run dedupes instead of duplicating.
    expect(src).toMatch(/agent-fix\//);
    // The secret-holding step is SHA-pinned, mirroring sentry-triage.
    expect(src).toMatch(/claude-code-action@be7b93b1907a4abad570368f3c74b6fe3807510b/);
    // No eslint in the agent allowlist: `npx eslint *` is a wildcard and
    // eslint can execute arbitrary JS via --rulesdir/config — an escape hatch
    // in a secret-holding step. CI lints the PR branch instead.
    expect(src).not.toMatch(/Bash\(npx eslint/);
    expect(read(".github/workflows/sentry-triage.yml")).not.toMatch(/Bash\(npx eslint/);
    // finding.md is declared untrusted inside the prompt itself.
    expect(src).toMatch(/UNTRUSTED DATA/);
  });

  it("the loop closes: clean reports self-file, findings dispatch the Fixer", () => {
    for (const a of ["marketing-agents/agent-perf.mjs", "marketing-agents/agent-flowcheck.mjs"])
      expect(read(a), `${a} must self-file clean reports`).toMatch(/status: findings\.length \? "pending" : "acknowledged"/);
    for (const w of [".github/workflows/agent-perf.yml", ".github/workflows/agent-flowcheck.yml"])
      expect(read(w), `${w} must hand findings to the Fixer`).toMatch(/agent-fixer\.yml -f item_id/);
    expect(read("marketing-agents/lib/agentkit.mjs")).toMatch(/return \{ result: "added", id:/);
  });

  it("Flow Check is strictly read-only against the live site", () => {
    const src = read("marketing-agents/agent-flowcheck.mjs");
    // Every probe is a GET; the agent never signs up, posts, or mutates.
    expect(src).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)/i);
    expect(src).toMatch(/READ-ONLY/);
    // It watches the exact leg of the 2026-09-02 LinkedIn headshot bug.
    expect(src).toMatch(/integrations\/linkedin\/connect\?guest=1/);
    expect(src).toMatch(/redirect_uri/);
    // No LLM: immune to Claude usage limits by construction.
    expect(src).not.toMatch(/standDownIfUsageExhausted|execFileSync/);
  });
});

describe("agent flow: schema and config integrity", () => {
  const schema = read("supabase/agent-flow.sql");
  const config = JSON.parse(read("marketing-agents/config.json"));

  it("every agent table has RLS enabled (service-role only)", () => {
    for (const t of ["agent_settings", "agent_system", "agent_runs", "agent_queue_items", "agent_action_history", "agent_blog_topics", "agent_blog_posts", "agent_messages"]) {
      expect(schema).toContain(`create table if not exists ${t}`);
      expect(schema, `${t} missing RLS`).toMatch(new RegExp(`alter table ${t}\\s+enable row level security`));
    }
  });

  it("every configured agent's workflow file exists", () => {
    for (const [id, a] of Object.entries(config.agents as Record<string, { workflow: string }>))
      expect(existsSync(`.github/workflows/${a.workflow}`), `${id} → ${a.workflow}`).toBe(true);
  });

  it("the work-hours auto-stop is enforced everywhere it must be", () => {
    // Reached auto_pause_at behaves exactly like Pause All: agents refuse to
    // start, checkpoint out mid-run, and the scheduler dispatches nothing.
    expect(read("supabase/agent-flow.sql")).toMatch(/auto_pause_at timestamptz/);
    const kit = read("marketing-agents/lib/agentkit.mjs");
    expect(kit).toMatch(/function autoStopped/);
    expect(kit).toMatch(/system\.paused \|\| autoStopped\(system\)/);
    expect(read("marketing-agents/scheduler.mjs")).toMatch(/auto_pause_at/);
  });

  it("the MONTHLY cap is re-checked mid-run, not just at start", () => {
    // A parallel agent can cross the cap while another is running — the
    // pre-start gate alone cannot catch that.
    const kit = read("marketing-agents/lib/agentkit.mjs");
    const checkpoint = kit.slice(kit.indexOf("async checkpoint()"), kit.indexOf("addUsage"));
    // Caps are TOKENS (owner order 2026-09-02: the system runs on the Claude
    // plan — usage and tokens, never dollars). No gate may read a $ column.
    expect(checkpoint).toMatch(/monthTokensUsed\(\)/);
    expect(checkpoint).toMatch(/monthly_usage_cap_tokens/);
    expect(checkpoint).toMatch(/usage_cap_tokens/);
    expect(kit).not.toMatch(/monthly_usage_cap_usd/);
    // Migration + code fallbacks agree.
    const mig = read("supabase/agent-flow-tokens.sql");
    expect(mig).toMatch(/usage_cap_tokens bigint not null default 500000/);
    expect(mig).toMatch(/monthly_usage_cap_tokens bigint not null default 6000000/);
    expect(kit).toMatch(/DEFAULT_RUN_CAP_TOKENS = 500_000/);
    expect(kit).toMatch(/DEFAULT_MONTHLY_CAP_TOKENS = 6_000_000/);
  });

  it("schedules support the owner's ET times, DST-correct", () => {
    // Parsing moved to lib/schedule.mjs when Atlas gained a second daily slot —
    // it is now shared by BOTH dispatchers so they cannot disagree.
    const sched = read("marketing-agents/lib/schedule.mjs");
    expect(sched).toMatch(/daily@/);
    expect(sched).toMatch(/America\/New_York/);
    // Multi-time support is what makes "noon and 5pm" expressible at all.
    expect(sched).toMatch(/split\(","\)/);
  });

  it("the system is inert by default — via the master pause, not empty schedules", () => {
    // Since the default-rhythm order (2026-09-02) every agent HAS a schedule
    // (config default when the DB's is NULL), so inertness comes from the
    // ship-state master pause + Start resting every team: the scheduler
    // hard-exits on a paused system, and the DB seeds no schedule values of
    // its own for the config defaults to fight with.
    expect(schema).not.toMatch(/schedule.*default\s+'[^n]/i);
    const sched = read("marketing-agents/scheduler.mjs");
    expect(sched).toMatch(/System paused — dispatching nothing/);
    expect(sched).toMatch(/No awake, active agents/);
  });
});

describe("agent flow: the org chart and comms log stay coherent", () => {
  const org = JSON.parse(read("marketing-agents/org.json"));
  const config = JSON.parse(read("marketing-agents/config.json"));

  it("every runnable agent has exactly one persona, and vice versa", () => {
    const personaAgents = Object.values(org.parties as Record<string, { agent_id?: string }>).map((p) => p.agent_id).filter(Boolean).sort();
    expect(personaAgents).toEqual(Object.keys(config.agents).sort());
    expect(new Set(personaAgents).size).toBe(personaAgents.length);
  });

  it("every reporting line points at a real party, up to the owner", () => {
    const parties = org.parties as Record<string, { kind: string; reports_to?: string }>;
    for (const [pid, p] of Object.entries(parties)) {
      if (p.kind === "human") continue;
      expect(p.reports_to, `${pid} has no reports_to`).toBeTruthy();
      expect(parties[p.reports_to!], `${pid} reports to unknown '${p.reports_to}'`).toBeTruthy();
    }
    // Workers report to leads, leads to the chief, the chief to the owner.
    for (const [pid, p] of Object.entries(parties)) {
      if (p.kind === "worker") expect(["lead", "chief"], `${pid}'s boss kind`).toContain(parties[p.reports_to!].kind);
      if (p.kind === "lead") expect(parties[p.reports_to!].kind).toBe("chief");
      if (p.kind === "chief") expect(parties[p.reports_to!].kind).toBe("human");
    }
  });

  it("comms writes are best-effort and only ever touch agent_messages", () => {
    const kit = read("marketing-agents/lib/agentkit.mjs");
    const sayFn = kit.slice(kit.indexOf("export async function say"), kit.indexOf("export async function getSettings"));
    expect(sayFn).toMatch(/agent_messages/);
    expect(sayFn).toMatch(/catch/); // a comms hiccup must never fail a run
    expect(sayFn).not.toMatch(/agent_queue_items|agent_runs|agent_settings/);
  });

  it("LLM agents stand down gracefully at the usage limit; watchers are untouched", () => {
    const kit = read("marketing-agents/lib/agentkit.mjs");
    expect(kit).toMatch(/export async function standDownIfUsageExhausted/);
    expect(kit).toMatch(/skipped_usage/);
    // No-LLM watchers never consult it.
    for (const f of ["agent-perf.mjs", "agent-security.mjs"])
      expect(read(`marketing-agents/${f}`), `${f} needs no usage gate (no LLM)`).not.toMatch(/standDownIfUsageExhausted/);
  });

  it("run lifecycle emits real events: dispatch, ack, report-back, escalation", () => {
    const kit = read("marketing-agents/lib/agentkit.mjs");
    expect(kit).toMatch(/GO — start your run now/);
    expect(kit).toMatch(/On it — starting now/);
    expect(kit).toMatch(/Done — \$\{this\.outputCount\} item\(s\) queued/);
    expect(kit).toMatch(/Escalating: /);
  });
});

describe("agent flow: person-facing copy is guarded against sounding like AI", () => {
  it("the human-voice doctrine exists and ends with the self-check", () => {
    const doc = read("marketing-agents/HUMAN_VOICE.md");
    expect(doc).toMatch(/Never write these/);
    expect(doc).toMatch(/Final self-check/);
    expect(doc).toMatch(/Could this exact text go to anyone else/);
  });

  it("drafts with AI tells are DISCARDED, never queued", () => {
    // The filter is a hard gate the model cannot argue with — sentinel tells.
    // The list lives in the shared brain.
    const brain = read("marketing-agents/lib/brain.mjs");
    for (const tell of ["finds you well", "came across your", "game.?changer", "delve"])
      expect(brain, `filter lost the "${tell}" tell`).toContain(tell);
  });

});

describe("agent flow: approve-to-execute stays owner-gated", () => {
  it("the owner's Connect flow is admin-gated and the callback checks state + browser binding", () => {
    const start = read("src/app/api/admin/connect/[provider]/route.ts");
    const cb = read("src/app/api/admin/connect/[provider]/callback/route.ts");
    expect(start).toMatch(/requireAdmin/);
    expect(cb).toMatch(/requireAdmin/);
    expect(cb).toMatch(/verifyState\(state\) !== user\.id/);
    expect(cb).toMatch(/stateBoundToBrowser/);
    // Tokens are encrypted at rest.
    expect(read("src/lib/agent-connections.ts")).toMatch(/encryptToken\(c\.access_token\)/);
  });

});

describe("agent flow: blog publishes only reviewed content", () => {
  it("public pages read published rows only", () => {
    expect(read("src/app/blog/page.tsx")).toMatch(/eq\("status", "published"\)/);
    expect(read("src/app/blog/[slug]/page.tsx")).toMatch(/eq\("status", "published"\)/);
  });
  it("blog agent defaults to draft mode", () => {
    const config = JSON.parse(read("marketing-agents/config.json"));
    expect(config.blog.publish_mode).toBe("draft");
  });
  it("a markdown link can never break out of the href attribute", () => {
    // The post author is an LLM reading the open web — markdown is a
    // prompt-injection surface even with human review before publish.
    const src = read("src/lib/blog-md.ts");
    expect(src).toContain(String.raw`[^)\s"'<>]`);
  });
  it("dynamic JSON-LD goes through the escaping serializer", () => {
    expect(read("src/app/blog/[slug]/page.tsx")).toMatch(/jsonLdScript\(jsonLd\)/);
    expect(read("src/lib/brand.ts")).toMatch(/u003c/);
  });
  it("the markdown renderer escapes HTML before anything else", () => {
    const src = read("src/lib/blog-md.ts");
    expect(src).toMatch(/replace\(\/</);
    expect(src.indexOf("esc(")).toBeLessThan(src.indexOf("inline("));
  });
});

// ── Every agent always has a rhythm (owner order 2026-09-02) ─────────────────
// "Manual only" is not a state: an awake, Active agent works its schedule, and
// an empty schedule means the default_schedule from config.json. The scheduler
// and the UI read the SAME defaults, pinned against each other here.
describe("default rhythms — no schedule-less agents", () => {
  const cfg = JSON.parse(read("marketing-agents/config.json")) as { agents: Record<string, { default_schedule?: string }> };

  it("config carries a default_schedule for every scheduled agent — the watch excepted", () => {
    for (const [id, a] of Object.entries(cfg.agents as Record<string, { default_schedule?: string; continuous?: boolean }>)) {
      // The four watchdogs have no rhythm by owner order (2026-09-03) — they
      // watch continuously. Everyone else must carry one.
      if (a.continuous) { expect(a.default_schedule, `${id} is a watchdog — no cadence`).toBeUndefined(); continue; }
      // daily@ accepts a comma-separated list of times (Atlas: noon + 5pm ET).
      expect(a.default_schedule, `${id} needs a default_schedule`).toMatch(/^(every@\d{1,2}h|daily@\d{1,2}:\d{2}(,\d{1,2}:\d{2})*|weekly@[a-z,]+@\d{1,2}:\d{2}(,\d{1,2}:\d{2})*)$/);
    }
  });

  it("the scheduler falls back to the config default for empty schedules", () => {
    const sched = read("marketing-agents/scheduler.mjs");
    expect(sched).toMatch(/r\.schedule \|\| config\.agents\[r\.agent_id\]\?\.default_schedule/);
    // And it no longer filters empty schedules out of the query.
    expect(sched).not.toMatch(/schedule=not\.is\.null/);
  });

});

// ── Email policy (owner order 2026-09-02): reports + 🔴 criticals ONLY ───────
// hello@swiftcard.me gets Atlas's daily digest and the three critical alarms
// (site health, broken user journey, security). Nothing else — cap events and
// other little things live in the comms log, run history, and the digest.
describe("agent emails: digest and criticals only", () => {
  // agent-watch.mjs is the shared full pass for Rex's nine servicing watchdogs
  // (2026-09-08) and agent-layout.mjs is Pix's browser pass — same rule: one
  // email, critical only.
  // scorecard.mjs is the Sunday growth sheet the owner asked for on
  // 2026-09-28 — a report, like the digest, not an alarm.
  const MAY_EMAIL = ["agent-perf.mjs", "agent-security.mjs", "agent-flowcheck.mjs", "agent-watch.mjs", "agent-layout.mjs", "scorecard.mjs"];
  it("exactly these files may email, and agentkit itself sends none", () => {
    expect(read("marketing-agents/lib/agentkit.mjs")).not.toMatch(/await email\(/);
    for (const f of MAY_EMAIL)
      expect((read(`marketing-agents/${f}`).match(/await email\(/g) ?? []).length, f).toBe(1);
    for (const f of readdirSync("marketing-agents").filter((x) => x.endsWith(".mjs") && !MAY_EMAIL.includes(x)))
      expect(read(`marketing-agents/${f}`), `${f} must not email`).not.toMatch(/await email\(/);
  });

  it("the non-digest emails fire only on CRITICAL findings", () => {
    for (const f of MAY_EMAIL.filter((f) => f !== "scorecard.mjs")) {
      const src = read(`marketing-agents/${f}`);
      const at = src.indexOf("await email(");
      expect(src.slice(Math.max(0, at - 400), at), `${f} email must be critical-gated`).toMatch(/critical/i);
    }
  });
});

// ── The watch: Finn, Bo, Vera, Dash ─────────────────────────────────────────
// Owner order 2026-09-03, and he has given it more than once: these four are
// WATCHDOGS. No schedules, no "next check-in" — they watch continuously while
// the office is open and their Active box is ticked, and only he stops them.
// Every pin below exists so no future change can quietly put them back on a
// cadence.
describe("continuous watchdogs have no schedule", () => {
  const config = JSON.parse(read("marketing-agents/config.json"));
  // 2026-09-08: Rex's servicing watch joined the loop — same rule, no cadence.
  const WATCH = ["flowcheck", "bugwatch", "security", "perf", "cards", "links", "payments", "deliverability", "renewals", "deps", "data", "appstore", "layout"];

  it("every watchdog is marked continuous and carries NO default_schedule", () => {
    for (const id of WATCH) {
      expect(config.agents[id].continuous, `${id} must be continuous`).toBe(true);
      expect(config.agents[id].default_schedule, `${id} must have no cadence`).toBeUndefined();
    }
  });

  it("no other agent is marked continuous — scheduled agents keep their rhythms", () => {
    for (const [id, a] of Object.entries(config.agents as Record<string, { continuous?: boolean }>))
      if (!WATCH.includes(id)) expect(a.continuous, `${id} must not be continuous`).toBeFalsy();
  });

  it("the clock skips them — the scheduler must never dispatch a watchdog", () => {
    const s = read("marketing-agents/scheduler.mjs");
    expect(s).toMatch(/if \(config\.agents\[r\.agent_id\]\?\.continuous\) continue;/);
    // and the skip must come BEFORE the dispatch call itself
    expect(s.indexOf("continuous) continue")).toBeLessThan(s.indexOf("await fetch("));
  });

  it("the loop stands down ONLY on the owner's switches, and does not re-arm when it does", () => {
    const w = read("marketing-agents/watchdog.mjs");
    expect(w).toMatch(/sys\.paused/);           // Pause All
    expect(w).toMatch(/auto_pause_at/);          // auto-stop
    expect(w).toMatch(/r\.enabled && !r\.paused/); // Active box
    expect(w).toMatch(/WATCHDOG_REARM=/);
    // No cadence logic anywhere in the loop.
    expect(w).not.toMatch(/every@|daily@/);
  });

  it("detection is code-only — the loop spends no tokens to watch", () => {
    for (const file of ["detectors.mjs", "detectors-servicing.mjs", "probe.mjs"]) {
      const d = read(`marketing-agents/lib/${file}`);
      for (const forbidden of ["claude", "anthropic", "openai", "gemini"])
        expect(d.toLowerCase(), `${file} must not call an LLM (${forbidden})`).not.toContain(forbidden);
    }
    // …and the shared full-pass runners spend nothing either.
    for (const file of ["agent-watch.mjs", "agent-layout.mjs"]) expect(read(`marketing-agents/${file}`)).not.toMatch(/standDownIfUsageExhausted|execFileSync|askClaude/);
  });

  it("findings dedupe, so a long outage reports once rather than every tick", () => {
    const w = read("marketing-agents/watchdog.mjs");
    expect(w).toMatch(/dedupe_key/);
    expect(w).toMatch(/if \(open\.has\(key\)\) continue;/);
  });

});

// ── A blind watchdog must say so ─────────────────────────────────────────────
// Bo was Active, shown "on watch", and had NEVER run — his detector returned
// [] because VERCEL_TOKEN was absent, which is indistinguishable from "nothing
// is wrong". These pins make a missing credential a REPORTED finding, so the
// board can never again imply a watch that isn't happening.
describe("watchdogs report their own blindness", () => {
  it("a missing credential is a finding, not a silent all-clear", async () => {
    const d = await import("../marketing-agents/lib/detectors.mjs");
    const before = { ...process.env };
    delete process.env.VERCEL_TOKEN; delete process.env.VERCEL_PROJECT_ID;
    const blind = await d.blindnessFindings("bugwatch");
    expect(blind).toHaveLength(1);
    expect(blind[0].title).toMatch(/cannot see/i);
    // The fix must be IN the report — a finding you can't act on wastes the alert.
    expect(blind[0].detail).toMatch(/error-events\.sql/);
    expect(blind[0].detail).toMatch(/CONFIGURATION gap/);
    process.env.VERCEL_TOKEN = "x"; process.env.VERCEL_PROJECT_ID = "y";
    expect(await d.blindnessFindings("bugwatch")).toHaveLength(0);
    Object.assign(process.env, before);
  });

  it("the loop checks blindness BEFORE trusting a detector's all-clear", () => {
    const w = read("marketing-agents/watchdog.mjs");
    // Open findings are handed to the detector so a rotating sample (Cara's
    // six cards, Lyn's seven pages) re-checks what it already reported instead
    // of silently closing it when the sample moves on.
    expect(w).toMatch(/await blindnessFindings\(agentId\)\), \.\.\.\(await DETECTORS\[agentId\]\(\{ openKeys: \[\.\.\.open\.keys\(\)\] \}\)\)/);
  });

  it("a used-up Claude window stands the agent down instead of failing it red", () => {
    const kit = read("marketing-agents/lib/agentkit.mjs");
    expect(kit).toMatch(/export async function standDownForUsage/);
    // Recorded as capacity, never as a breakage.
    expect(kit).toMatch(/run\.finish\("skipped_usage"/);
  });
});

// ── Multi-slot daily times (e.g. "noon and 5pm") and catch-up dispatch: late
// runs, never skips. Shared by the watchdog loop and the old cron.
describe("schedule: multi-slot times and catch-up dispatch, reliably", () => {
  it("the schedule parser yields precisely those two slots", async () => {
    const s = await import("../marketing-agents/lib/schedule.mjs");
    expect(s.dueTimesToday("daily@12:00,17:00")).toEqual([720, 1020]);
    // Single times and every@Nh still parse — other agents depend on them.
    expect(s.dueTimesToday("daily@07:30")).toEqual([450]);
    expect(s.dueTimesToday("every@8h")).toEqual([0, 480, 960]);
    expect(s.dueTimesToday("")).toEqual([]);
    expect(s.dueTimesToday("nonsense")).toEqual([]);
  });

  it("dispatch is CATCH-UP, not a fragile window: late runs, never skips", async () => {
    const s = await import("../marketing-agents/lib/schedule.mjs");
    const S = "daily@12:00,17:00";
    // ET is UTC-4 in September, so ET hour h == UTC hour h+4.
    const et = (h: number, m: number) => new Date(Date.UTC(2026, 8, 3, h + 4, m));
    expect(s.isDue(S, null, et(11, 59))).toBe(false);        // not due yet
    expect(s.isDue(S, null, et(12, 1))).toBe(true);          // due
    expect(s.isDue(S, null, et(12, 40))).toBe(true);         // dispatcher was late → still runs
    expect(s.isDue(S, et(12, 2).toISOString(), et(12, 5))).toBe(false);  // already ran
    expect(s.isDue(S, et(12, 2).toISOString(), et(16, 0))).toBe(false);  // between slots
    expect(s.isDue(S, et(12, 2).toISOString(), et(17, 3))).toBe(true);   // 2nd report owed
    expect(s.isDue(S, et(17, 5).toISOString(), et(17, 30))).toBe(false); // both done
    // A whole day of missed dispatch does not deliver a stale midday report at night.
    expect(s.isDue(S, null, et(21, 0))).toBe(false);
  });

  it("the always-on loop is the clock, and the old cron shares its logic", () => {
    const w = read("marketing-agents/watchdog.mjs");
    expect(w).toMatch(/async function dispatchScheduled/);
    expect(w).toMatch(/isDue\(schedule, lastRunAt/);
    expect(w).toMatch(/continuous\) continue/); // watchdogs excluded from the clock
    // Both dispatchers ask the same question, so neither double-fires.
    const sched = read("marketing-agents/scheduler.mjs");
    expect(sched).toMatch(/import \{ isDue \} from "\.\/lib\/schedule\.mjs"/);
    expect(sched).toMatch(/isDue\(schedule,/);
    // The old ±30-minute window logic is gone for good.
    expect(sched).not.toMatch(/Math\.abs\(Number/);
  });

});

describe("the shared creative pool", () => {
  it("generation results are captured into media_assets, not dropped", () => {
    // The old connector stored a job id and nothing ever polled it, so the
    // finished media URL was never recorded and no one could reuse it.
    const pool = read("marketing-agents/lib/media-pool.mjs");
    expect(pool).toMatch(/export async function pollMediaPool/);
    expect(pool).toMatch(/export async function readyAssets/);
  });

  it("the always-on loop polls the pool — the only reliable clock we have", () => {
    const w = read("marketing-agents/watchdog.mjs");
    expect(w).toMatch(/pollMediaPool/);
  });

  it("a stuck generation job cannot be polled forever", () => {
    expect(read("marketing-agents/lib/media-pool.mjs")).toMatch(/6 \* 60 \* 60 \* 1000/);
  });
});

// ── Every watchdog's report must be actionable in the UI ─────────────────────
// Cara (cards) reached Menash on 2026-09-09 showing ONLY a Reject button: the
// acknowledge button was gated on a hardcoded list of five item types, and the
// nine servicing watchdogs added the night before were not on it. Two separate
// regressions are pinned here so neither can come back quietly.
describe("watchdog findings are approvable, and reported once", () => {
  it("the loop wakes a watchdog once per cycle, not once per finding", () => {
    const loop = read("marketing-agents/watchdog.mjs");
    // The dispatch must live OUTSIDE the per-finding loop, guarded by a count.
    expect(loop).toMatch(/if \(newFindings\.length\) \{\s*\n\s*await dispatchAgent\(/);
    expect(loop, "dispatching inside the findings loop files one duplicate report per finding")
      .not.toMatch(/await dispatchAgent\(agentId, f\.title\)/);
  });

  it("the full-pass report carries a dedupe key so a repeat pass collapses", () => {
    const watch = read("marketing-agents/agent-watch.mjs");
    expect(watch).toMatch(/dedupe_key: `watchdog:report:\$\{agentId\}:\$\{signature\}`/);
    expect(watch, "keying on the timestamp would never dedupe").not.toMatch(/dedupe_key:[^\n]*stamp\}`/);
  });
});
