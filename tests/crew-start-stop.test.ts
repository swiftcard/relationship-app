import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agentName } from "@/lib/crew/agent-status";
import { bioCandidates } from "@/lib/crew/agents/contact";
import { applyDisclosure, hasRequiredDisclosure } from "@/lib/crew/disclosure";
import { exactPostLink, exactProfileLink, instagramDmLink, instagramHandle, redditMessageLink } from "@/lib/crew/exact-links";
import { AGENTS, agentById } from "@/lib/crew/registry";
import { QUIET_REST_MINUTES, exactTarget, pairs, rotate, runEngagement, type Candidate } from "@/lib/crew/replies/engine";
import { effectiveSchedule, minutesToTomorrow } from "@/lib/crew/schedule";
import { loadSheetAgents, sheetAgentDefs, sheetAgentState } from "@/lib/crew/sheet-agents";
import { AGENT_TABS, tabsForAgent } from "@/lib/crew/sheets/tabs";
import { toHits } from "@/lib/crew/sources/hackernews";
import { DEFAULT_SETTINGS } from "@/lib/crew/store";
import { MemoryStore } from "@/lib/crew/store-memory";
import { runAgent } from "@/lib/crew/tick";
import { HUMAN_VOICE, stripEmDashes } from "@/lib/crew/voice";
import { writingProblems } from "@/lib/crew/writing-check";
import { fakeAgent, setup } from "./crew-helpers";

// ── Start / Stop, one tab per agent, exact links, the voice ─────────────────
// The owner's model (2026-10-27): one Sheet, one tab per agent named after
// it; Start on the admin page and the agent keeps adding rows (a person, a
// message written for them, the exact link to send it) until Stop. Pinned
// here: every link is the exact post, comment, question or chat; the agents
// keep going and rest when there is nothing new; Start/Stop and the Sheet's
// Controls are one switch; the messages never use dashes and say "I built"
// instead of a tacked-on disclosure.

const NOW = new Date("2026-10-27T16:00:00Z"); // Tue noon New York

describe("exact links", () => {
  it("Reddit: a thread or a comment, never a subreddit, a search or a profile", () => {
    expect(exactPostLink("reddit", "https://old.reddit.com/r/realtors/comments/1abcd2/is_there_a_cheaper_way/")).toBe("https://www.reddit.com/r/realtors/comments/1abcd2/is_there_a_cheaper_way/");
    expect(exactPostLink("reddit", "https://www.reddit.com/r/realtors/comments/1abcd2/is_there/kx9z1q/?context=3")).toBe("https://www.reddit.com/r/realtors/comments/1abcd2/is_there/kx9z1q/");
    expect(exactPostLink("reddit", "https://www.reddit.com/r/realtors/")).toBeNull();
    expect(exactPostLink("reddit", "https://www.reddit.com/r/realtors/search?q=linktree")).toBeNull();
    expect(exactPostLink("reddit", "https://www.reddit.com/user/jane/")).toBeNull();
    expect(redditMessageLink("u/Jane_Sells")).toBe("https://www.reddit.com/message/compose/?to=Jane_Sells");
  });

  it("Threads, Quora, LinkedIn, Indie Hackers, Bluesky, Hacker News: the post itself", () => {
    expect(exactPostLink("threads", "https://www.threads.net/@jane.sells/post/C9xYz_1")).toBe("https://www.threads.com/@jane.sells/post/C9xYz_1");
    expect(exactPostLink("threads", "https://www.threads.com/@jane.sells")).toBeNull();
    expect(exactPostLink("quora", "https://www.quora.com/What-is-the-best-digital-business-card-app/answer/John-Smith-12")).toBe("https://www.quora.com/What-is-the-best-digital-business-card-app");
    expect(exactPostLink("quora", "https://www.quora.com/profile/John-Smith-12")).toBeNull();
    expect(exactPostLink("quora", "https://www.quora.com/topic/Business-Cards")).toBeNull();
    expect(exactPostLink("linkedin", "https://www.linkedin.com/posts/jane-doe_networking-activity-7123456789012345678-abcd")).toBe("https://www.linkedin.com/posts/jane-doe_networking-activity-7123456789012345678-abcd/");
    expect(exactPostLink("linkedin", "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/")).toBe("https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/");
    expect(exactPostLink("linkedin", "https://www.linkedin.com/in/jane-doe/")).toBeNull();
    expect(exactPostLink("indiehackers", "https://www.indiehackers.com/post/how-i-got-my-first-100-users-abc123")).toBe("https://www.indiehackers.com/post/how-i-got-my-first-100-users-abc123");
    expect(exactPostLink("indiehackers", "https://www.indiehackers.com/")).toBeNull();
    expect(exactPostLink("bluesky", "https://bsky.app/profile/jane.bsky.social/post/3kq2abc")).toBe("https://bsky.app/profile/jane.bsky.social/post/3kq2abc");
    expect(exactPostLink("hackernews", "https://news.ycombinator.com/item?id=50198336")).toBe("https://news.ycombinator.com/item?id=50198336");
    expect(exactPostLink("hackernews", "https://news.ycombinator.com/news")).toBeNull();
    expect(exactPostLink("instagram", "https://www.instagram.com/p/Cxyz123/?igsh=abc")).toBe("https://www.instagram.com/p/Cxyz123/");
    expect(exactPostLink("instagram", "https://www.instagram.com/explore/tags/realtor/")).toBeNull();
  });

  it("people: a real Instagram or LinkedIn profile, and the Instagram chat link opens the DM", () => {
    expect(exactProfileLink("instagram", "https://instagram.com/Jane.Realtor/")).toBe("https://www.instagram.com/jane.realtor/");
    expect(exactProfileLink("instagram", "https://www.instagram.com/p/Cxyz/")).toBeNull();
    expect(exactProfileLink("instagram", "https://www.instagram.com/explore/")).toBeNull();
    expect(exactProfileLink("linkedin", "https://www.linkedin.com/in/jane-doe-1")).toBe("https://www.linkedin.com/in/jane-doe-1/");
    expect(instagramHandle("@Jane.Realtor")).toBe("jane.realtor");
    expect(instagramHandle("https://www.instagram.com/jane.realtor/")).toBe("jane.realtor");
    expect(instagramHandle("explore")).toBeNull();
    expect(instagramDmLink("jane.realtor")).toBe("https://ig.me/m/jane.realtor");
  });

  it("a found item without an exact link never becomes a row; a pasted one keeps what was pasted", () => {
    const base: Candidate = { platform: "reddit", url: "", author: "a", title: "t", text: "x", community: null, promoAllowed: true };
    expect(exactTarget({ ...base, url: "https://www.reddit.com/r/realtors/" })).toBeNull();
    expect(exactTarget({ ...base, url: "https://www.reddit.com/r/realtors/comments/abc/x/" })).toBe("https://www.reddit.com/r/realtors/comments/abc/x/");
    expect(exactTarget({ ...base, url: "paste:123", fromPaste: true })).toBe("paste:123");
    expect(exactTarget({ ...base, platform: "instagram", url: "https://www.instagram.com/jane/" }, "profile")).toBe("https://www.instagram.com/jane/");
  });

  it("the engine drafts only for exact links, and rests when there's nothing new", async () => {
    const draft = "Honestly the card plus a link page in one place is what fixed it for me. I built SwiftCard because of that exact problem.";
    const { ctx, store } = await setup({
      def: fakeAgent({ id: "replies-reddit", maxPending: 50 }),
      script: (req) => {
        if (req.schema && JSON.stringify(req.schema).includes("asks_for_tools")) {
          const n = (req.prompt.match(/^#\d+/gm) ?? []).length;
          return JSON.stringify({ items: Array.from({ length: n }, (_, i) => ({ i, score: 0.9, why: "They want one tool", angle: "card plus link page", asks_for_tools: false, business_pro: true })) });
        }
        return draft;
      },
    });
    // A warmed-up account (past the five-week ramp), so the second run is limited by "nothing new", not the daily cap.
    await store.setRateLimit("reddit", "reply", 100, "2026-01-01");
    const find = async (): Promise<Candidate[]> => [
      { platform: "reddit", url: "https://www.reddit.com/r/realtors/", author: "a", title: "Linktree alternatives?", text: "linktree too pricey", community: "realtors", promoAllowed: true },
      { platform: "reddit", url: "https://www.reddit.com/r/realtors/comments/9z9z9z/linktree_alternatives/", author: "b", title: "Linktree alternatives?", text: "linktree too pricey", community: "realtors", promoAllowed: true },
    ];
    const r = await runEngagement(ctx, { platform: "reddit", kind: "reply", action: "reply", ceiling: 8, register: "", length: "", label: (c) => c.title, find });
    const made = store.approvals.filter((a) => a.agent_id === "replies-reddit");
    expect(made.map((a) => a.target_url)).toEqual(["https://www.reddit.com/r/realtors/comments/9z9z9z/linktree_alternatives/"]);
    expect(ctx.stats.skipped_no_exact_link).toBe(1);
    expect(r.summary).toMatch(/added 1 to the Sheet/);
    // Same search again: nothing new, so it rests instead of paying for the same results.
    const again = await runEngagement(ctx, { platform: "reddit", kind: "reply", action: "reply", ceiling: 8, register: "", length: "", label: (c) => c.title, find });
    expect(again.restMinutes).toBe(QUIET_REST_MINUTES);
  });

  it("at today's ceiling it stops for the day and rests until tomorrow, at no cost", async () => {
    const { ctx, claude } = await setup({ def: fakeAgent({ id: "replies-reddit", maxPending: 50 }) });
    // A ceiling of 1 a day, already used.
    await ctx.store.setRateLimit("reddit", "reply", 1, "2026-01-01");
    await ctx.store.insertApproval({ agent_id: "replies-reddit", team: "replies", kind: "reply", title: "t", summary: "s", body: "b", platform: "reddit", target_url: "https://www.reddit.com/r/x/comments/1/a/" });
    const r = await runEngagement(ctx, { platform: "reddit", kind: "reply", action: "reply", ceiling: 1, register: "", length: "", label: (c) => c.title, find: async () => [] });
    expect(r.summary).toMatch(/^Done for today/);
    expect(r.restMinutes).toBeGreaterThanOrEqual(15);
    expect(claude.calls).toHaveLength(0);
  });
});

describe("one tab per agent, named after it", () => {
  it("every agent with a tab has exactly one, every tab has exactly one agent, and the names match", () => {
    const live = AGENT_TABS.filter((t) => t.layout === "rows");
    for (const t of live) expect(t.agents, t.name).toHaveLength(1);
    const ids = live.map((t) => t.agents[0]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      const def = agentById(id);
      expect(def, id).toBeDefined();
      expect(tabsForAgent(id).map((t) => t.name)).toEqual([agentName(def!)]);
    }
    // Every worker outside the Watchdog that drafts something is on the list.
    const workers = AGENTS.filter((d) => d.role === "worker" && d.team !== "watchdog" && d.team !== "system" && !d.locked);
    for (const d of workers) expect(ids, d.id).toContain(d.id);
  });

  it("the Instagram LinkedIn Bio tab belongs to the LinkedIn-in-bio finder", () => {
    expect(tabsForAgent("contact-instagram-linkinbio")[0].name).toBe("Instagram LinkedIn Bio");
    expect(agentById("contact-instagram-linkinbio")!.purpose).toMatch(/LinkedIn/);
  });
});

describe("continuous: Start and it keeps going", () => {
  it("finders run every tick while on; content agents keep their day; paste agents wait for a paste", () => {
    // Facebook Groups and Instagram Comments search on their own since 2026-10-29 (100 a day), so they run every tick too.
    for (const id of ["contact-instagram-linkinbio", "contact-instagram", "replies-reddit", "contact-reddit", "replies-x", "replies-tiktok", "contact-x", "contact-tiktok", "replies-threads", "replies-hackernews", "contact-linkedin", "replies-facebook", "replies-instagram", "leads-web", "office-outreach"]) {
      expect(effectiveSchedule(agentById(id)!, {}), id).toEqual({ kind: "every", minutes: 15 });
    }
    expect(effectiveSchedule(agentById("contact-alignable")!, {}).kind).toBe("on_input");
  });

  it("a run that asks to rest is not woken before then; tomorrow means just after New York midnight", async () => {
    const store = new MemoryStore();
    const def = fakeAgent({ id: "rest-me", continuous: true, run: async () => ({ summary: "Done for today", restMinutes: 300 }) });
    await store.patchAgentState(def.id, { enabled: true });
    await runAgent({ def, store, providers: { claude: null, critic: null }, now: () => NOW, schedule: { kind: "every", minutes: 15 } });
    expect((await store.getAgentState(def.id)).next_run_at).toBe(new Date(NOW.getTime() + 300 * 60_000).toISOString());
    expect(minutesToTomorrow(NOW)).toBe(12 * 60 + 5);
  });

  it("each run looks somewhere new, and picks up where it stopped", async () => {
    const { ctx } = await setup();
    const list = pairs(["realtors", "loan officers"], ["Miami", "Austin", "Denver"]);
    expect(list).toHaveLength(6);
    const seen = [];
    for (let i = 0; i < 6; i++) seen.push((await rotate(ctx, "where_i", list, 1))[0].join(" "));
    expect(new Set(seen).size).toBe(6);
    expect(ctx.config("where_i", 0)).toBe(6);
  });
});

describe("Start / Stop on the admin page", () => {
  it("lists every Sheet agent once, by its tab name, in the workbook's order", () => {
    const rows = sheetAgentDefs();
    expect(rows[0]).toMatchObject({ tab: "X Replies" });
    expect(new Set(rows.map((r) => r.def.id)).size).toBe(rows.length);
    expect(rows.some((r) => r.def.team === "watchdog")).toBe(false);
    expect(rows.some((r) => r.def.locked)).toBe(false);
  });

  it("says plainly whether each one is going", () => {
    const def = agentById("replies-hackernews")!; // needs the Claude key, which tests don't have
    const state = (o: Record<string, unknown> = {}) => ({ id: def.id, enabled: true, model_override: null, daily_usd_cap: null, config: {}, last_run_at: null, next_run_at: null, lease_until: null, status_note: null, ...o });
    const at = (o: Partial<Parameters<typeof sheetAgentState>[0]>) => sheetAgentState({ def: { ...def, needs: [] }, state: state(), lastRun: null, now: NOW, settings: DEFAULT_SETTINGS, hardDisabled: false, ...o }).kind;
    expect(sheetAgentState({ def, state: state(), lastRun: null, now: NOW, settings: DEFAULT_SETTINGS, hardDisabled: false }).kind).toBe("setup");
    expect(at({ state: state({ enabled: false }) })).toBe("stopped");
    expect(at({})).toBe("running");
    expect(at({ state: state({ lease_until: "2026-10-27T16:05:00Z" }) })).toBe("working");
    expect(at({ settings: { ...DEFAULT_SETTINGS, kill_all: true } })).toBe("paused");
    expect(at({ lastRun: { id: "r", agent_id: def.id, started_at: "", finished_at: "", status: "ok", summary: "Done for today: 3 drafts is today's limit.", stats: {}, error: null } })).toBe("done_today");
    expect(at({ lastRun: { id: "r", agent_id: def.id, started_at: "", finished_at: "", status: "error", summary: "boom", stats: {}, error: "boom" } })).toBe("failed");
  });

  it("counts what each one added today and links to its tab", async () => {
    const store = new MemoryStore();
    store.clock = () => NOW;
    await store.insertApproval({ agent_id: "replies-hackernews", team: "replies", kind: "reply", title: "t", summary: "s", body: "b", platform: "hackernews", target_url: "https://news.ycombinator.com/item?id=1" });
    await store.insertLeads([{ list: "cold", email: "a@b.com", source_platform: "web", source_url: "https://b.com" }]);
    const rows = await loadSheetAgents(store, { now: NOW, settings: DEFAULT_SETTINGS, hardDisabled: false, states: [], runs: [], overrides: null, sheetId: "SHEET", gids: { "Hacker News": 42 } });
    expect(rows.find((r) => r.id === "replies-hackernews")).toMatchObject({ name: "Hacker News", addedToday: 1, tabUrl: "https://docs.google.com/spreadsheets/d/SHEET/edit#gid=42", running: false });
    expect(rows.find((r) => r.id === "leads-web")).toMatchObject({ name: "Web Leads", addedToday: 1 });
  });

  it("Start turns it on, clears any pause and runs it now; Stop is the same switch the Sheet uses", () => {
    const route = readFileSync("src/app/api/admin/crew/agents/[id]/route.ts", "utf8");
    const start = route.slice(route.indexOf('if (action === "start")'));
    expect(start).toContain("enabled: true");
    expect(start).toContain("paused_until: null");
    expect(start).toContain("next_run_at: now.toISOString()");
    expect(start).toContain("claimLease(");
    expect(start).toContain("after(");
    const view = readFileSync("src/app/admin/crew/SheetAgents.tsx", "utf8");
    expect(view).toMatch(/<form method="post" action=\{`\/api\/admin\/crew\/agents\/\$\{r\.id\}`\}>/);
    expect(view).toContain('value="start"');
    expect(view).toContain('value="stop"');
    const controls = readFileSync("src/lib/crew/sheets/controls.ts", "utf8");
    expect(controls).toMatch(/key: `agent:\$\{def\.id\}`[\s\S]{0,600}patchAgentState\(def\.id, v \? \{ enabled: true/);
  });
});

describe("the messages sound like a person", () => {
  it("no dashes of any kind slip through, and no hyphenated words either (owner, 2026-10-29)", () => {
    expect(stripEmDashes("Saw your post — nice. Open houses – tough. Busy week - right?")).toBe("Saw your post, nice. Open houses, tough. Busy week, right?");
    expect(stripEmDashes("A follow-up text works.")).toBe("A follow up text works.");
    expect(writingProblems("Busy week – right?")).toContain("uses an en dash");
    expect(writingProblems("Busy week - right?")).toContain("uses a hyphen as a dash");
    expect(HUMAN_VOICE).toMatch(/No hyphens at all/);
    expect(HUMAN_VOICE).toMatch(/Menash/);
  });

  it("'I built…' in the sentence is the disclosure; nothing is tacked on", () => {
    const opts = { on: true, disclosure: "(I work on SwiftCard, so I'm biased.)" };
    for (const t of ["I built SwiftCard for exactly this.", "We made SwiftCard because our own cards kept getting tossed.", "SwiftCard, which I built, does both.", "I'm building SwiftCard, happy to show you."]) {
      expect(hasRequiredDisclosure(t, opts), t).toBe(true);
      expect(applyDisclosure(t, opts)).toBe(t);
    }
    expect(applyDisclosure("SwiftCard does both.", opts)).toBe(`SwiftCard does both.\n\n${opts.disclosure}`);
  });
});

describe("the new finders", () => {
  it("Instagram LinkedIn Bio keeps only real profiles whose bio links a real LinkedIn", () => {
    const out = bioCandidates([
      { username: "@Jane.Realtor", name: "Jane Doe", occupation: "Realtor", company: "Compass", location: "Austin, TX", linkedin_url: "https://www.linkedin.com/in/janedoe", bio: "Austin realtor. linkedin.com/in/janedoe" },
      { username: "mike.loans", name: "Mike", occupation: "Loan officer", company: "", location: "", linkedin_url: "", bio: "Loans in Miami. linkedin.com/in/mike-loans-1" },
      { username: "no.linkedin", name: "Sam", occupation: "Realtor", company: "", location: "", linkedin_url: "", bio: "DM me" },
      { username: "explore", name: "x", occupation: "", company: "", location: "", linkedin_url: "https://www.linkedin.com/in/x", bio: "" },
    ]);
    expect(out.map((c) => c.url)).toEqual(["https://www.instagram.com/jane.realtor/", "https://www.instagram.com/mike.loans/"]);
    expect(out[0].extra).toMatchObject({ name: "Jane Doe", occupation: "Realtor", company: "Compass", location: "Austin, TX", linkedin: "https://www.linkedin.com/in/janedoe/" });
    expect(out[1].extra?.linkedin).toBe("https://www.linkedin.com/in/mike-loans-1/");
  });

  it("Hacker News hits link to the exact comment, with the HTML stripped", () => {
    const hits = toHits([
      { objectID: "50198336", _tags: ["comment", "story_50197533"], author: "steve", story_title: "Where wealth is moving", comment_text: "We&#x27;d hand out <i>cards</i> at events.<p>Never followed up.", created_at_i: 1 },
      { objectID: "x", author: "bad" },
    ]);
    expect(hits).toEqual([expect.objectContaining({ url: "https://news.ycombinator.com/item?id=50198336", kind: "comment", author: "steve", title: "Re: Where wealth is moving", text: "We'd hand out cards at events.\nNever followed up." })]);
  });
});
