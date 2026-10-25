import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Browser } from "playwright";
import { launchBrowser, appCss } from "./harness";

// ── The Agents tab (the control panel), measured ────────────────────────────
// The owner runs the agents from a phone and must know in 10 seconds what's
// running, what got done, what needs them and how to pause everything. A
// Pause all below the fold, an Approve button pushed off-screen or covered,
// a raw error code on screen: each is a control or a sentence that silently
// doesn't work. Built from a MemoryStore through the real loaders, rendered
// from the real views (CrewView, AgentDetail) with the app's real CSS at a
// phone and a desktop width, then measured.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

const NOW = new Date("2026-10-21T18:00:00Z"); // Wed 2pm New York
const long = "Honestly two apps for this is overkill. I had Linktree plus a card app and kept paying for both. A card that has its own link page covers the same thing, and you can update it without reprinting anything. ".repeat(2);

async function fixtureStore() {
  const { MemoryStore } = await import("@/lib/crew/store-memory");
  const store = new MemoryStore();
  store.clock = () => NOW;
  await store.patchAgentState("replies-reddit", { enabled: true, lease_until: "2026-10-21T18:05:00Z" });
  await store.patchAgentState("replies-threads", { enabled: true, paused_until: "2026-10-22T03:59:00Z", pause_note: "Paused by Rachel from the team chat." });
  await store.patchAgentState("replies-bluesky", { enabled: true, next_run_at: "2026-10-21T19:00:00Z" });
  await store.patchAgentState("replies-manager", { enabled: true });
  await store.patchAgentState("watch-bugs", { enabled: true });
  await store.patchTeam("contact", { hours: { days: [1, 2, 3, 4, 5], open: 540, close: 720 } });
  await store.patchTeam("marketing", { door_open: false });
  await store.patchTeam("replies", { focus: "Dentists and dental offices in New York, and anyone asking about a card for a whole office team", focus_until: "2026-10-28T18:00:00Z", focus_by: "Rachel" });
  const add = async (o: Record<string, unknown>) => {
    const r = await store.insertApproval({
      agent_id: "replies-reddit",
      team: "replies",
      kind: "reply",
      title: "Reddit: a realtor in r/realtors thinks Linktree costs too much for what it does every month",
      summary: "Someone asked for a cheaper way to have a card and a link page. Here is a reply. Approve it, then post it yourself.",
      body: long,
      platform: "reddit",
      target_url: `https://www.reddit.com/r/realtors/comments/${String(o.n)}/is_there_a_cheaper_way_to_do_link_in_bio_and_a_business_card/`,
      debate: { skipped: false, rounds: 1, outcome: "revised_agreed", line: "ChatGPT asked for changes (sounds too much like an ad); the new version passed.", turns: [], critic: "ChatGPT" },
      meta: { tier_why: "Upgraded to Opus because 3 of the last 5 drafts were rejected." },
      ...o,
    });
    return "id" in r ? r.id : "";
  };
  await add({ n: 1 });
  await add({ n: 2, kind: "dm", agent_id: "replies-threads", body: "short dm", meta: {} });
  await add({ n: 3, kind: "post", agent_id: "replies-bluesky", platform: "instagram", body: "1. Card ...", debate: null, meta: { step: 1, options: [1, 2, 3].map((n) => ({ n, name: `A rather long option name number ${n} for the picker`, image: null })) } });
  const approvedId = await add({ n: 4 });
  await store.updateApproval(approvedId, { status: "approved", decided_at: "2026-10-21T17:00:00Z" });
  await store.addChat({ team: "replies", author: "owner", body: "How did today go? Anything I should look at before the end of the day?" });
  await store.addChat({ team: "replies", author: "manager", body: "Good day. Maya drafted 4 replies, 3 wait for you. Theo is paused until tonight like you asked.\n- Approve the realtor one first." });
  await store.addChat({ team: "replies", author: "system", body: "Done: Theo (Threads replies) is paused until 11:59pm." });
  await store.addChat({ team: "replies", author: "owner", body: "Thanks" });
  await store.addChat({ team: "replies", author: "manager", body: "", status: "pending" });
  await store.saveReport({ agent_id: "replies-manager", team: "replies", day: "2026-10-21", body: "Replies report for 2026-10-21\n\nWhat happened\n- The team ran 9 times.\n\nWhat I need from you\n- Look at the 3 waiting items.", stats: {} });
  await store.saveReport({ agent_id: "head", team: "system", day: "2026-10-21", body: "The plan for tomorrow\n- Approve the waiting replies.\n- Keep spending low.", stats: {} });
  await store.upsertFinding({ fingerprint: "f1", agent_id: "watch-bugs", kind: "bug", source: "sentry", title: "TypeError: Cannot read properties of undefined (reading 'map') on /dashboard/contacts/a-very-long-path-segment", detail: {}, count: 12, last_seen: "2026-10-21T17:30:00Z", status: "open" });
  await store.insertLeads(
    Array.from({ length: 4 }, (_, i) => ({ list: "cold" as const, email: `info${i}@a-very-long-realty-company-name-for-testing.com`, phone: "+17045550100", company: "Queen City Realty Group of Charlotte and the Surrounding Areas", business_type: "real estate offices", city: "Charlotte", region: "NC", country: "US", region_restricted: i === 3, source_platform: "web" as const, source_url: "https://www.queencityrealtygroup.example.com/contact-us/our-agents-and-staff" })),
  );
  // One agent whose last run failed, one that finished fine today.
  const bad = await store.startRun("watch-bugs");
  await store.finishRun(bad, "error", "TypeError: fetch failed ECONNRESET", {}, "TypeError: fetch failed ECONNRESET");
  await store.patchAgentState("watch-bugs", { last_run_at: "2026-10-21T17:45:00Z", status_note: "Last run failed: TypeError: fetch failed ECONNRESET" });
  const good = await store.startRun("replies-bluesky");
  await store.finishRun(good, "ok", "Found 6 posts and drafted 2 replies.", { drafts: 2 });
  await store.patchAgentState("replies-bluesky", { last_run_at: "2026-10-21T17:30:00Z" });
  await store.recordUsage({ run_id: null, agent_id: "replies-reddit", team: "replies", provider: "anthropic", model: "claude-sonnet-5-5", purpose: "draft", input_tokens: 4000, output_tokens: 500, cache_read: 2000, cache_write: 0, web_searches: 0, batch: false, cost_usd: 0.12 });
  return store;
}

type View = { tab?: string; filter?: string; edit?: string; agent?: string };

async function markup(v: View, store?: Awaited<ReturnType<typeof fixtureStore>>) {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const st = store ?? (await fixtureStore());
  if (v.agent) {
    const { default: AgentDetail } = await import("@/app/admin/crew/AgentDetail");
    const { loadAgentDetail } = await import("@/lib/crew/agent-detail");
    const x = await loadAgentDetail(st, v.agent, NOW);
    if (!x || !("row" in x)) throw new Error(`no agent ${v.agent}`);
    return renderToStaticMarkup(createElement(AgentDetail, { x, edit: v.edit, msg: "Reddit replies is paused." }));
  }
  const { default: CrewView } = await import("@/app/admin/crew/CrewView");
  const { loadDashboard } = await import("@/lib/crew/dashboard");
  const { resolveTab, roomTeam } = await import("@/lib/crew/office-tabs");
  const data = await loadDashboard(st, NOW, { room: roomTeam(resolveTab(v.tab)) });
  return renderToStaticMarkup(createElement(CrewView, { data, tab: v.tab, filter: v.filter, edit: v.edit, msg: "Approved. Post it, then tap “I posted it”." }));
}

async function renderView(browser: Browser, width: number, v: View, height = 1600) {
  const css = await appCss();
  const html = await markup(v);
  const page = await browser.newPage();
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style>
     <style>body{margin:0;background:#030712}</style></head>
     <body class="sc-app"><main style="max-width:72rem;margin:0 auto;padding:24px 20px">${html}</main></body></html>`,
    { waitUntil: "load" },
  );
  await page.waitForTimeout(100);
  return page;
}

/** Every visible control with one of these labels: its size and whether something covers it. */
async function measure(page: Awaited<ReturnType<typeof renderView>>, want: string[]) {
  return page.evaluate((want) => {
    const btns = [...document.querySelectorAll("button, a.inline-flex, summary")] as HTMLElement[];
    return btns
      .filter((b) => want.includes(b.innerText.trim()) && b.getClientRects().length > 0)
      .map((b) => {
        b.scrollIntoView({ block: "center" });
        const r = b.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { label: b.innerText.trim(), h: r.height, w: r.width, covered: !(top === b || b.contains(top)) };
      });
  }, want);
}

function tappable(res: { label: string; h: number; covered: boolean }[]) {
  for (const r of res) {
    expect(r.h, `${r.label} is shorter than a tap target`).toBeGreaterThanOrEqual(40);
    expect(r.covered, `${r.label} is covered`).toBe(false);
  }
}

/** The words on screen with every panel open, leaving out the "technical details" panels. */
async function plainText(page: Awaited<ReturnType<typeof renderView>>) {
  return page.evaluate(() => {
    document.querySelectorAll("details:not([data-technical])").forEach((d) => ((d as HTMLDetailsElement).open = true));
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("[data-technical]").forEach((d) => d.remove());
    document.body.appendChild(clone);
    const text = clone.innerText;
    clone.remove();
    return text;
  });
}

const VIEWS: View[] = [
  { tab: "lobby" },
  { tab: "tasks", filter: "waiting" },
  { tab: "tasks", filter: "next" },
  { tab: "tasks", filter: "done" },
  { tab: "tasks", filter: "failed" },
  { tab: "replies" },
  { tab: "watchdog" },
  { tab: "contact" },
  { tab: "leads" },
  { tab: "office" },
  { tab: "marketing" },
  { tab: "desk" },
  { tab: "settings" },
  { agent: "replies-reddit" },
  { agent: "watch-bugs" },
  { agent: "replies-facebook" },
];
const name = (v: View) => (v.agent ? `agent ${v.agent}` : `${v.tab}${v.filter ? `/${v.filter}` : ""}`);

describe("the Agents tab (the control panel)", () => {
  let browser: Browser;
  beforeAll(async () => {
    // Set up like production: the AI key exists, so agents show their real status.
    vi.stubEnv("CREW_ANTHROPIC_API_KEY", "test");
    browser = await launchBrowser();
  }, 120_000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await browser?.close();
  });

  for (const v of VIEWS) {
    for (const width of [390, 1280]) {
      it(`${name(v)} fits at ${width}px: nothing spills sideways, even with every panel open`, async () => {
        const page = await renderView(browser, width, v);
        try {
          await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
          const bad = await page.evaluate(() => {
            const out: string[] = [];
            const limit = document.documentElement.clientWidth + 1;
            document.querySelectorAll("main *").forEach((el) => {
              const r = el.getBoundingClientRect();
              if (r.width > 0 && r.right > limit && !el.closest("nav") && !el.closest(".overflow-x-auto")) out.push(`${el.tagName}.${String((el as HTMLElement).className).slice(0, 60)}`);
            });
            return { out, sideways: document.documentElement.scrollWidth > window.innerWidth };
          });
          expect(bad.out, `spills at ${width}px`).toEqual([]);
          expect(bad.sideways).toBe(false);
        } finally {
          await page.close();
        }
      });
    }

    it(`${name(v)} speaks plain English: no setting names, model names, raw errors or code`, async () => {
      const page = await renderView(browser, 390, v);
      try {
        const text = await plainText(page);
        for (const bad of [/CREW_|_KEY\b|_SECRET\b/, /\b(Haiku|Sonnet|Opus|Fable)\b/, /\btokens?\b/i, /TypeError|ECONNRESET|Error:/, /\{"|":\s/, /\bundefined\b|\bnull\b|NaN/, /supabase|\.sql\b|Vercel/i])
          expect(text, `${name(v)} shows ${bad}`).not.toMatch(bad);
      } finally {
        await page.close();
      }
    });
  }

  it("on a phone, Pause all and the three numbers are on the first screen, with no scrolling", async () => {
    const page = await renderView(browser, 390, { tab: "lobby" }, 844);
    try {
      const boxes = await page.evaluate(() => {
        const find = (t: string) => ([...document.querySelectorAll("button, a, span")] as HTMLElement[]).find((e) => e.innerText.trim() === t);
        return ["Pause all agents", "Running now", "Done today", "Needs you"].map((t) => {
          const e = find(t);
          const r = e?.getBoundingClientRect();
          return { t, found: !!e, bottom: r?.bottom ?? 9999, h: r?.height ?? 0 };
        });
      });
      for (const b of boxes) {
        expect(b.found, b.t).toBe(true);
        expect(b.bottom, `${b.t} is below the first screen`).toBeLessThanOrEqual(844);
      }
      tappable(await measure(page, ["Pause all agents"]));
    } finally {
      await page.close();
    }
  });

  for (const width of [390, 1280]) {
    it(`home: every Approve, Edit, Reject, Retry, Run now, Pause, Resume, Stop and group switch is tappable at ${width}px`, async () => {
      const page = await renderView(browser, width, { tab: "lobby" });
      try {
        const res = await measure(page, ["Approve", "Edit", "Reject", "Retry", "Run now", "Pause", "Resume", "Stop", "Pause group", "Resume group", "Pause all agents"]);
        expect(res.filter((r) => r.label === "Approve")).toHaveLength(3);
        for (const l of ["Edit", "Reject", "Retry", "Run now", "Pause", "Resume", "Stop", "Pause group", "Resume group"]) expect(res.some((r) => r.label === l), l).toBe(true);
        tappable(res);
      } finally {
        await page.close();
      }
    });

    it(`a group page: drafts, agents, the chat and the hours are tappable at ${width}px`, async () => {
      const page = await renderView(browser, width, { tab: "replies" });
      try {
        await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
        const res = await measure(page, ["Approve", "Edit", "Reject", "I posted it", "Copy & open", "Send", "Pause group", "How did today go?", "Clear", "Run now", "Pause", "Resume", "Stop", "Save hours"]);
        expect(res.filter((r) => r.label === "Approve")).toHaveLength(3);
        for (const l of ["I posted it", "Send", "Pause group", "How did today go?", "Resume", "Stop", "Save hours"]) expect(res.some((r) => r.label === l), l).toBe(true);
        tappable(res);
      } finally {
        await page.close();
      }
    });

    it(`an agent page: controls, the schedule form and Retry are tappable at ${width}px`, async () => {
      const page = await renderView(browser, width, { agent: "watch-bugs" });
      try {
        await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
        const res = await measure(page, ["Retry", "Pause", "Stop", "Change schedule", "Save schedule"]);
        for (const l of ["Retry", "Pause", "Stop", "Save schedule"]) expect(res.some((r) => r.label === l), l).toBe(true);
        tappable(res);
      } finally {
        await page.close();
      }
    });

    it(`the task list filters and Retry are tappable at ${width}px`, async () => {
      const page = await renderView(browser, width, { tab: "tasks", filter: "failed" });
      try {
        const res = await measure(page, ["Retry"]);
        expect(res).toHaveLength(1);
        tappable(res);
        const text = await page.evaluate(() => document.body.innerText);
        for (const s of ["Waiting on me", "Up next", "Done", "Failed", "Bug watch"]) expect(text, s).toContain(s);
      } finally {
        await page.close();
      }
    });
  }

  it("home says what is running, what got done and what needs you, with a word for every status", async () => {
    const page = await renderView(browser, 390, { tab: "lobby" });
    try {
      const text = await page.evaluate(() => document.body.innerText);
      for (const s of ["Running now", "Done today", "Needs you", "Bug watch", "didn't finish", "Dev", "Sales", "Outreach", "Marketing", "Planning", "Reddit replies", "Running", "Paused", "Failed", "Last run", "Next run", "Last result"]) expect(text, s).toContain(s);
      expect(text).toContain("Asks you before anything goes out: always on");
    } finally {
      await page.close();
    }
  });

  it("Edit opens the text box in place, with Save and approve", async () => {
    const store = await fixtureStore();
    const first = (await store.listApprovals({ status: ["pending"] })).find((a) => a.kind === "reply")!;
    const html = await markup({ tab: "replies", edit: first.id }, store);
    expect(html).toContain("Save and approve");
    expect(html).toContain('name="body"');
    expect(await markup({ tab: "replies" })).not.toContain("Save and approve");
  });

  it("'Not available' starts collapsed", async () => {
    const page = await renderView(browser, 390, { tab: "leads" });
    try {
      expect(await page.evaluate(() => document.body.innerText)).not.toContain("LinkedIn leads");
      await page.evaluate(() => document.querySelectorAll("details[data-unavailable]").forEach((d) => ((d as HTMLDetailsElement).open = true)));
      expect(await page.evaluate(() => document.body.innerText)).toContain("LinkedIn leads");
    } finally {
      await page.close();
    }
  });

  it("old links land somewhere sensible", async () => {
    const page = await renderView(browser, 390, { tab: "inbox" });
    try {
      const text = await page.evaluate(() => document.body.innerText);
      expect(text).toContain("Waiting on me");
      expect(await markup({ tab: "teams" })).toContain("Pause all agents");
      expect(await markup({ tab: "paste" })).toContain("Hand something to the agents");
    } finally {
      await page.close();
    }
  });
});
