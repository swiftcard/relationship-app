import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Browser } from "playwright";
import { launchBrowser, appCss } from "./harness";

// ── The Agents tab's inbox and teams, measured ──────────────────────────────
// The owner approves drafts from a phone. A card whose Approve button is
// pushed off-screen, covered, or squeezed below a tap target is a draft that
// never goes out. Rendered from the real view (CrewView) with the app's real
// CSS at a phone and a desktop width, then measured.

const now = new Date("2026-10-20T14:00:00Z").toISOString();
const long = "Honestly two apps for this is overkill. I had Linktree plus a card app and kept paying for both. A card that has its own link page covers the same thing, and you can update it without reprinting anything. ".repeat(2);

function fixture() {
  const approval = (o: Record<string, unknown>) => ({
    id: String(o.id), created_at: now, agent_id: "system-test", team: "system", kind: "reply", status: "pending",
    title: "Reddit: a realtor in r/realtors thinks Linktree costs too much for what it does every month",
    summary: "Someone asked for a cheaper way to have a card and a link page. Here is a reply. Approve it, then post it yourself.",
    body: long, platform: "reddit", target_url: "https://www.reddit.com/r/realtors/comments/abc123/is_there_a_cheaper_way_to_do_link_in_bio_and_a_business_card/",
    person_id: null, debate: { skipped: false, rounds: 1, outcome: "revised_agreed", line: "ChatGPT asked for changes (sounds too much like an ad); the new version passed.", turns: [], critic: "ChatGPT" },
    model_used: "sonnet", meta: { tier_why: "Upgraded to Opus because 3 of the last 5 drafts were rejected." }, decided_at: null, reject_reason: null, done_at: null, expires_at: now, ...o,
  });
  const totals = { total: { usd: 1.23, tokens: 52000, cacheRead: 20000, input: 40000 }, byAgent: { "system-test": { usd: 0.12, tokens: 4000 } }, byTeam: { system: { usd: 0.12, tokens: 4000 } } };
  return { totals, approval };
}

async function renderView(browser: Browser, width: number, tab: string) {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { default: CrewView } = await import("@/app/admin/crew/CrewView");
  const { AGENTS } = await import("@/lib/crew/registry");
  const { totals, approval } = fixture();
  const data = {
    ready: true as const,
    hardDisabled: false,
    settings: { kill_all: false, daily_usd_cap: 2, team_caps: {}, disclosure_on: true, disclosure: "(I work on SwiftCard, so I'm biased.)", economy: true, second_opinion: false },
    agents: AGENTS.map((def, i) => ({
      def,
      state: { id: def.id, enabled: i === 0, model_override: null, daily_usd_cap: null, config: {}, last_run_at: now, next_run_at: null, lease_until: null, status_note: i === 1 ? "Needs: CREW_ANTHROPIC_API_KEY" : null },
      missing: i === 1 ? (["CREW_ANTHROPIC_API_KEY"] as const) : [],
      schedule: "daily 7:00am",
      today: { usd: 0.12, tokens: 4000 },
      cap: def.dailyUsd,
      lastRun: { id: "r", agent_id: def.id, started_at: now, finished_at: now, status: "ok", summary: "Put one practice draft in the inbox.", stats: {}, error: null },
    })),
    inbox: [
      approval({ id: "a1" }),
      approval({ id: "a2", kind: "dm", body: "short dm", meta: {} }),
      approval({ id: "a4", kind: "post", platform: "instagram", body: "1. Card ...", debate: null, meta: { step: 1, options: [1, 2, 3].map((n) => ({ n, name: `A rather long option name number ${n} for the picker`, image: null })) } }),
    ],
    approved: [approval({ id: "a3", status: "approved" })],
    recentDone: [],
    today: totals,
    week: totals,
    reports: [],
    findings: [],
    leads: {
      todayBySource: { web: 41, reddit: 2 },
      officeToday: { web: 12 },
      recent: Array.from({ length: 4 }, (_, i) => ({ id: `l${i}`, created_at: now, list: "cold", name: null, email: `info${i}@a-very-long-realty-company-name-for-testing.com`, phone: "+17045550100", company: "Queen City Realty Group of Charlotte and the Surrounding Areas", business_type: "real estate offices", city: "Charlotte", region: "NC", country: "US", region_restricted: i === 3, source_platform: "web", source_url: "https://www.queencityrealtygroup.example.com/contact-us/our-agents-and-staff" })),
      office: [],
    },
    envNeeded: [{ key: "CREW_OPENAI_API_KEY", help: "OpenAI API key for the second opinion (platform.openai.com → API keys).", agents: ["Test agent"] }],
  };
  const css = await appCss();
  const markup = renderToStaticMarkup(createElement(CrewView, { data: data as never, tab, msg: "Approved. Post it, then tap “I posted it”." }));
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

describe("the Agents tab", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await launchBrowser(); }, 120_000);
  afterAll(async () => { await browser?.close(); });

  for (const tab of ["inbox", "teams", "usage", "settings", "paste", "leads", "reports"]) {
    for (const width of [390, 1280]) {
      it(`${tab} fits at ${width}px: nothing spills sideways`, async () => {
        const page = await renderView(browser, width, tab);
        try {
          const bad = await page.evaluate(() => {
            const out: string[] = [];
            const limit = document.documentElement.clientWidth + 1;
            document.querySelectorAll("main *").forEach((el) => {
              const r = el.getBoundingClientRect();
              if (r.width > 0 && r.right > limit && !el.closest("nav")) out.push(`${el.tagName}.${String((el as HTMLElement).className).slice(0, 60)}`);
            });
            return { out, sideways: document.documentElement.scrollWidth > window.innerWidth };
          });
          expect(bad.out, `spills at ${width}px`).toEqual([]);
          expect(bad.sideways).toBe(false);
        } finally { await page.close(); }
      });
    }
  }

  for (const width of [390, 1280]) {
    it(`every Approve, Reject and "I posted it" button is visible, uncovered and tappable at ${width}px`, async () => {
      const page = await renderView(browser, width, "inbox");
      try {
        const res = await page.evaluate(() => {
          const btns = [...document.querySelectorAll("button, a.inline-flex")] as HTMLElement[];
          const want = ["Approve", "Reject", "I posted it", "Copy & open"];
          const found = btns.filter((b) => want.includes(b.innerText.trim()));
          return found.map((b) => {
            b.scrollIntoView({ block: "center" });
            const r = b.getBoundingClientRect();
            const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return { label: b.innerText.trim(), h: r.height, w: r.width, covered: !(top === b || b.contains(top)) };
          });
        });
        expect(res.filter((r) => r.label === "Approve")).toHaveLength(3);
        expect(res.some((r) => r.label === "I posted it")).toBe(true);
        for (const r of res) {
          expect(r.h, `${r.label} is shorter than a tap target`).toBeGreaterThanOrEqual(40);
          expect(r.covered, `${r.label} is covered`).toBe(false);
        }
      } finally { await page.close(); }
    });
  }

  it("shows the second opinion and the model upgrade on the card", async () => {
    const page = await renderView(browser, 390, "inbox");
    try {
      const text = await page.evaluate(() => document.body.innerText);
      expect(text).toContain("ChatGPT asked for changes");
      expect(text).toContain("Upgraded to Opus");
    } finally { await page.close(); }
  });
});
