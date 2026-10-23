import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Browser } from "playwright";
import { launchBrowser, appCss } from "./harness";

// ── The Agents tab (the office), measured ───────────────────────────────────
// The owner runs the office from a phone. A draft whose Approve button is
// pushed off-screen, a door switch that is covered, a chat box squeezed below
// a tap target: each is a control that silently doesn't work. Built from a
// MemoryStore through the real loadDashboard, rendered from the real view
// (CrewView) with the app's real CSS at a phone and a desktop width, then
// measured.

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
  await store.recordUsage({ run_id: null, agent_id: "replies-reddit", team: "replies", provider: "anthropic", model: "claude-sonnet-5-5", purpose: "draft", input_tokens: 4000, output_tokens: 500, cache_read: 2000, cache_write: 0, web_searches: 0, batch: false, cost_usd: 0.12 });
  return store;
}

async function renderView(browser: Browser, width: number, tab: string) {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { default: CrewView } = await import("@/app/admin/crew/CrewView");
  const { loadDashboard } = await import("@/lib/crew/dashboard");
  const { resolveTab, roomTeam } = await import("@/lib/crew/office-tabs");
  const data = await loadDashboard(await fixtureStore(), NOW, { room: roomTeam(resolveTab(tab)) });
  const css = await appCss();
  const markup = renderToStaticMarkup(createElement(CrewView, { data, tab, msg: "Approved. Post it, then tap “I posted it”." }));
  const page = await browser.newPage();
  await page.setViewportSize({ width, height: 1600 });
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style>
     <style>body{margin:0;background:#030712}</style></head>
     <body class="sc-app"><main style="max-width:72rem;margin:0 auto;padding:24px 20px">${markup}</main></body></html>`,
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

describe("the Agents tab (the office)", () => {
  let browser: Browser;
  beforeAll(async () => {
    // Set up like production: the Replies team has its key, so its people show their real status.
    vi.stubEnv("CREW_ANTHROPIC_API_KEY", "test");
    browser = await launchBrowser();
  }, 120_000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await browser?.close();
  });

  for (const tab of ["lobby", "replies", "watchdog", "contact", "leads", "office", "marketing", "desk", "settings"]) {
    for (const width of [390, 1280]) {
      it(`${tab} fits at ${width}px: nothing spills sideways, even with every panel open`, async () => {
        const page = await renderView(browser, width, tab);
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
  }

  for (const width of [390, 1280]) {
    it(`in a room, every Approve, Reject, "I posted it", Send and door button is visible, uncovered and tappable at ${width}px`, async () => {
      const page = await renderView(browser, width, "replies");
      try {
        const res = await measure(page, ["Approve", "Reject", "I posted it", "Copy & open", "Send", "Lock the door", "How did today go?", "Clear"]);
        expect(res.filter((r) => r.label === "Approve")).toHaveLength(3);
        for (const l of ["I posted it", "Send", "Lock the door", "How did today go?"]) expect(res.some((r) => r.label === l), l).toBe(true);
        for (const r of res) {
          expect(r.h, `${r.label} is shorter than a tap target`).toBeGreaterThanOrEqual(40);
          expect(r.covered, `${r.label} is covered`).toBe(false);
        }
        // The staff card's buttons sit behind "More".
        await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
        const staff = await measure(page, ["Take off the team", "Start a shift now", "Resume"]);
        for (const l of ["Take off the team", "Start a shift now", "Resume"]) expect(staff.some((r) => r.label === l), l).toBe(true);
        for (const r of staff) {
          expect(r.h, `${r.label} is shorter than a tap target`).toBeGreaterThanOrEqual(40);
          expect(r.covered, `${r.label} is covered`).toBe(false);
        }
      } finally {
        await page.close();
      }
    });

    it(`the lobby's office lock, door switches and room links are tappable at ${width}px`, async () => {
      const page = await renderView(browser, width, "lobby");
      try {
        const res = await measure(page, ["Lock the whole office", "Lock the door", "Open the door", "Enter room"]);
        expect(res.filter((r) => r.label === "Lock the whole office")).toHaveLength(1);
        expect(res.filter((r) => r.label === "Enter room")).toHaveLength(6);
        expect(res.filter((r) => r.label === "Open the door")).toHaveLength(2); // Marketing (by hand) and Contact (after hours)
        for (const r of res) {
          expect(r.h, `${r.label} is shorter than a tap target`).toBeGreaterThanOrEqual(40);
          expect(r.covered, `${r.label} is covered`).toBe(false);
        }
      } finally {
        await page.close();
      }
    });
  }

  it("a room shows its people, the chat, the second opinion and the model upgrade", async () => {
    const page = await renderView(browser, 390, "replies");
    try {
      const text = await page.evaluate(() => document.body.innerText);
      for (const s of ["Maya", "Reddit replies", "Working now", "Paused until 11:59pm", "Rachel", "Team chat", "writing", "Focus:", "ChatGPT asked for changes", "Upgraded to Opus", "Waiting for you (4)"]) expect(text, s).toContain(s);
    } finally {
      await page.close();
    }
  });

  it("'Not hired yet' starts collapsed", async () => {
    const page = await renderView(browser, 390, "leads");
    try {
      expect(await page.evaluate(() => document.body.innerText)).not.toContain("LinkedIn leads");
      await page.evaluate(() => document.querySelectorAll("details[data-not-hired]").forEach((d) => ((d as HTMLDetailsElement).open = true)));
      expect(await page.evaluate(() => document.body.innerText)).toContain("LinkedIn leads");
    } finally {
      await page.close();
    }
  });

  it("old links land in the lobby, which says what waits where", async () => {
    const page = await renderView(browser, 390, "inbox");
    try {
      const text = await page.evaluate(() => document.body.innerText);
      expect(text).toContain("The teams");
      expect(text).toContain("3 to decide");
      expect(text).toContain("1 to post");
      expect(text).toContain("Locked · opens tomorrow 9:00am"); // Contact: Mon–Fri 9–12, now 2pm
    } finally {
      await page.close();
    }
  });
});
