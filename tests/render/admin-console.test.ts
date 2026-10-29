import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { chromium, webkit, type Browser, type Page } from "playwright";
import type { ReactElement } from "react";
import { appCss } from "./harness";

// ── The site admin (/admin), measured ───────────────────────────────────────
//
// The owner asked for the console to be light and "very organized and also
// visually organized" (2026-10-27). Neither can be checked by reading the
// source: a sidebar that spills, a tab row that drags the page sideways on a
// phone, a card that pokes past the screen edge, or a canvas that came out
// dark are all layout facts. So every admin page is rendered from its real
// components, inside the real shell, with the app's real CSS (globals.css +
// admin.css), at a phone and a computer width, in Chromium and WebKit, and
// measured.

const nav = vi.hoisted(() => ({ pathname: "/admin" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, prefetch() {} }),
  useSearchParams: () => new URLSearchParams(),
}));

let css = "";
const browsers: Record<string, Browser> = {};

beforeAll(async () => {
  css = (await appCss()) + readFileSync("src/app/admin/admin.css", "utf8");
  browsers.Chromium = await chromium.launch();
  browsers.WebKit = await webkit.launch();
}, 240_000);

afterAll(async () => {
  await Promise.all(Object.values(browsers).map((b) => b.close()));
});

/** The page's markup inside the real AdminShell, as the server would send it. */
async function inShell(pathname: string, page: ReactElement, unread: number | null = null): Promise<string> {
  nav.pathname = pathname;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { default: AdminShell } = await import("@/app/admin/AdminShell");
  return renderToStaticMarkup(createElement(AdminShell, { email: "hello@swiftcard.me", unread }, page));
}

async function open(engine: string, width: number, markup: string): Promise<Page> {
  const page = await browsers[engine].newPage({ viewport: { width, height: 900 } });
  // data-sc-theme="light" is what ForceLightTheme / the boot script set.
  await page.setContent(
    `<!doctype html><html data-sc-theme="light"><head><meta charset="utf-8">
     <meta name="viewport" content="width=device-width, initial-scale=1">
     <style>${css}</style><style>body{margin:0}</style></head><body>${markup}</body></html>`,
    { waitUntil: "load" },
  );
  await page.waitForTimeout(100);
  return page;
}

/** Nothing scrolls the page sideways, and no card, header or heading pokes past the screen. */
async function layoutProblems(page: Page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const spill: string[] = [];
    document.querySelectorAll(".adm-card, .adm-notracked, aside, header, h1, h2, .adm-tabs, main").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5)) spill.push(`${el.tagName}.${String(el.className).slice(0, 60)} → ${Math.round(r.left)}..${Math.round(r.right)}`);
    });
    // Nothing hidden may make the page longer than what's drawn (a screen-
    // reader <table> once added 768px of blank page under a chart).
    const canvas = document.querySelector(".sc-admin")!.getBoundingClientRect().bottom + window.scrollY;
    if (document.documentElement.scrollHeight > Math.max(canvas, window.innerHeight) + 2) spill.push(`page is ${document.documentElement.scrollHeight}px tall but the canvas ends at ${Math.round(canvas)}px`);
    return { sideways: document.documentElement.scrollWidth > vw, spill };
  });
}

const ENGINES = ["Chromium", "WebKit"] as const;

async function sandbox() {
  const { createElement } = await import("react");
  const { default: PlansClient } = await import("@/app/admin/plans/PlansClient");
  return inShell("/admin/plans", createElement(PlansClient, { userId: "u-admin", email: "hello@swiftcard.me", initialPlan: "pro" }));
}

// ── Fixture data: realistic, with the long strings that break layouts ───────
const day = (i: number) => new Date(Date.UTC(2026, 8, 28 + i)).toISOString().slice(0, 10);
const series = (f: (i: number) => number) => Array.from({ length: 30 }, (_, i) => ({ date: day(i), count: f(i) }));

const ANALYTICS = {
  funnel: {
    available: true,
    d30: { page_viewed: 1284, card_creation_started: 412, card_creation_completed: 173, plan_selected: 151, upgrade_prompt_viewed: 96, upgrade_started: 34, checkout_started: 12, checkout_completed: 3 },
    d7: { page_viewed: 300 },
    internal30: 57,
    topCtas: [["create_your_card_from_the_homepage_hero", 210], ["upgrade_to_pro", 34]] as [string, number][],
    lockedFeatures: [["colors-fonts", 51], ["swift-links-cap", 27]] as [string, number][],
  },
  ingest: {
    available: true,
    byReason: [["recorded", 900], ["bot", 120], ["deduped", 80]] as [string, number][],
    byClassification: [["human", 900], ["crawler", 150]] as [string, number][],
    byGeoAccuracy: [["city", 600], ["country", 200]] as [string, number][],
    counted7: 900, declined7: 200, relay7: 30,
    recentDeclines: [{ at: "2026-10-26T10:00:00Z", entity: "a-very-long-card-username-that-could-push-the-row-wide__links", event: "view", reason: "bot", classification: "crawler" }],
  },
  warmLead: { available: true as const, named: 40, pushes: 31, opened: 22, followedUp: 9, wrong: 1, wrongRate: 2.5, bindings: [["form", 20], ["link", 9]] as [string, number][] },
  accounts: {
    total: 318, today: 3, d7: 24, d30: 96, series: series((i) => (i * 7) % 6),
    recent: [
      { id: "u1", name: "Maya Rep", email: "maya@example.com", username: "maya", plan: "pro", created_at: "2026-10-27T09:00:00Z" },
      { id: "u2", name: "Bartholomew Featherstonehaugh-Montgomery", email: "bartholomew.featherstonehaugh@a-very-long-company-domain.example.com", username: "bart", plan: "enterprise", created_at: "2026-10-20T09:00:00Z" },
    ],
  },
  plans: { free: 280, pro: 31, office: 7, officeMembers: 12, gift: 2, apple: 1, paid: 22, conversion: 6.9, estMrr: 109.78, compedPaidPlans: 3 },
  revenue: {
    available: true, mode: "live",
    summary: {
      mrrCents: 10978, arrCents: 131736, atRiskCents: 499, paying: 22, payingPro: 19, payingOffice: 3, officeSeats: 14,
      trials: { active: 4, endingIn7Days: 2, convertsToCents: 1497, cancelling: 1 },
      cancelling: 1, pastDue: 1, newThisMonth: { count: 3, cents: 1497 }, lostThisMonth: { count: 1, cents: 499 }, excludedInternal: 2,
    },
  },
  numberCheck: [
    { label: "Every account was read", shown: 318, recount: 318, ok: true, how: "Accounts the admin read, against a plain count of every account." },
    { label: "Customers' contacts", shown: 1290, recount: 1290, ok: true, how: "The contacts total, against a plain count." },
  ],
  internal: { accounts: 34, subscriptionsLeftOut: 2 },
  acquisition: [
    { source: "direct", signups: 200, d30: 60, paid: 12, paidRate: 6 },
    { source: "referral", signups: 40, d30: 12, paid: 6, paidRate: 15 },
    { source: "swiftlinks_badge_on_a_very_long_source_key", signups: 12, d30: 4, paid: 0, paidRate: 0 },
  ],
  cards: { total: 410, perAccount: 1.3 },
  leads: { total: 1290, today: 4, d7: 51, series: series((i) => (i * 3) % 9), bySource: [["qr_code", 400], ["card_link", 300]] as [string, number][], perAccount: 4.1 },
  views: { total: 22000, d7: 1400, cardViews30: 4000, linkViews30: 1900 },
  engagement: { activatedCards: 120, activationRate: 29.3 },
  topCards: [{ username: "maya", count: 120 }, { username: "a-very-long-username-for-a-real-estate-team__links", count: 40 }],
};

const RETENTION = {
  rows: [
    { userId: "r1", email: "dana@example.com", plan: "pro", reason: "too-expensive", comment: "Honestly it was great, but I only go to two events a year and paying every month for that doesn't add up. ".repeat(3), at: "2026-10-25T12:00:00Z", outcome: "deleted" as const, savedBy: null, deleted: true },
    { userId: "r2", email: "sam@example.com", plan: "free", reason: "not-using", comment: "", at: "2026-10-22T12:00:00Z", outcome: "saved" as const, savedBy: "grant", deleted: false },
    { userId: "r3", email: null, plan: "free", reason: "testing", comment: "", at: "2026-10-12T12:00:00Z", outcome: "open" as const, savedBy: null, deleted: false },
  ],
  totals: { attempts: 3, saved: 1, deleted: 1, open: 1, saveRate: 50 },
  byReason: [{ reason: "too-expensive", attempts: 1, saved: 0 }, { reason: "not-using", attempts: 1, saved: 1 }, { reason: "testing", attempts: 1, saved: 0 }],
};

const REFERRALS = {
  ready: true, validSignups: 40, monthsClaimed: 6, monthsClaimable: 2, activeFreeMonths: 9, flagged: 2, selfReferral: 1,
  bySource: { direct: 200, referral: 40, swiftlinks_badge: 12 },
  flaggedList: [{ code: "MAYA-2026", reason: "same_device_as_referrer", created_at: "2026-10-20T00:00:00Z" }],
};

async function companyAnalytics(tab: string) {
  const { createElement } = await import("react");
  const { default: AnalyticsView } = await import("@/app/admin/analytics/AnalyticsView");
  return inShell("/admin/analytics", createElement(AnalyticsView, {
    tab: tab as never, now: Date.parse("2026-10-27T12:00:00Z"),
    initial: ANALYTICS as never, retention: RETENTION as never, referrals: REFERRALS,
  }));
}

describe.each(ENGINES)("Company Analytics (%s)", (engine) => {
  const TABS: [string, string[]][] = [
    ["growth", ["New accounts per day", "Where signups come from", "Plan mix", "Latest signups", "Not tracked yet"]],
    ["revenue", ["Stripe connection", "Monthly revenue", "$109.78", "at risk (payment failed)", "On a free trial", "New this month", "Office seats billed", "Who pays", "Paying through Apple", "Office team members"]],
    ["funnel", ["Visited the website", "Paid", "Started paying — from Stripe", "Which Pro features they want", "Most-clicked buttons"]],
    ["engagement", ["Contacts captured per day", "Where contacts come from", "Top cards by contacts"]],
    ["retention", ["Save rate", "Why they leave", "It costs more than I get out of it", "Reply to them", "Closed accounts per week"]],
    ["referrals", ["How the referral program works", "Signups by source", "Neither side is rewarded", "MAYA-2026"]],
    ["data", ["Number check", "All agree", "Tracking switched on", "Returning-contact alerts", "View decisions"]],
  ];
  for (const [tab, mustSay] of TABS) {
    for (const width of [390, 1280]) {
      it(`${tab} tab: everything there, nothing spilling at ${width}px`, async () => {
        const page = await open(engine, width, await companyAnalytics(tab));
        try {
          const p = await layoutProblems(page);
          expect(p.spill, `spills at ${width}px`).toEqual([]);
          expect(p.sideways, `the page scrolls sideways at ${width}px`).toBe(false);
          const text = await page.evaluate(() => document.body.innerText);
          for (const s of mustSay) expect(text, `"${s}" missing on the ${tab} tab`).toContain(s);
          // The tab row marks where you are.
          const current = await page.locator('.adm-tabs [aria-current="page"]').innerText();
          expect(current.toLowerCase()).toContain(tab === "data" ? "data quality" : tab);
        } finally { await page.close(); }
      });
    }
  }

  it("never shows a raw reason id like not-using", async () => {
    const page = await open(engine, 1280, await companyAnalytics("retention"));
    try {
      const text = await page.evaluate(() => document.body.innerText);
      for (const id of ["too-expensive", "not-using"]) expect(text).not.toContain(id);
      expect(text).toContain("I'm not really using it");
    } finally { await page.close(); }
  });
});

// The shape lib/admin-data/website.ts returns (2026-10-28).
const WEBSITE = {
  includeInternal: false,
  capHit: false,
  team: { pageviews: 4394, visits: 312, visitors: 9 },
  kpis: {
    pageviews: { d1: 120, d7: 940, d30: 4100 }, visitors: { d1: 61, d7: 410, d30: 1720 }, visits: { d1: 70, d7: 480, d30: 1990 },
    sessions: 1990, pagesPerSession: 2.1, avgDurationSec: 74, bounceRatePct: 48, cameBack: 230,
  },
  daily: Array.from({ length: 30 }, (_, i) => ({ date: day(i), views: 90 + ((i * 37) % 80), visitors: 40 + ((i * 17) % 35) })),
  topPages: [{ label: "/", count: 1900, avgSec: 41 }, { label: "/pricing", count: 700, avgSec: 95 }, { label: "/compare/a-very-long-comparison-page-slug-for-linktree-alternatives", count: 120, avgSec: null }],
  exitPages: [{ label: "/", count: 800 }, { label: "/cards/new", count: 260 }],
  topReferrers: [
    { label: "Google", count: 600, detail: "com.google.android.googlequicksearchbox, www.google.com" },
    { label: "Instagram", count: 210, detail: "l.instagram.com" },
    { label: "some-unknown-referrer-with-a-very-long-hostname.example.org", count: 12, detail: "some-unknown-referrer-with-a-very-long-hostname.example.org" },
  ],
  directVisits: 1168,
  topCountries: [{ label: "US", count: 3000 }, { label: "GB", count: 400 }, { label: "IL", count: 90 }],
  devices: [{ label: "phone", count: 1100 }, { label: "computer", count: 560 }, { label: "tablet", count: 60 }],
  campaigns: [{ label: "src=badge", count: 140 }, { label: "flyer · nyc-october-street-team-with-a-long-name", count: 22 }],
  builderBySource: [{ label: "No referrer", count: 120 }, { label: "Google", count: 44 }],
  detailSince: "2026-10-28T18:00:00Z",
};

async function website(tab: string) {
  const { createElement } = await import("react");
  const { default: WebsiteAnalyticsClient } = await import("@/app/admin/website/WebsiteAnalyticsClient");
  return inShell("/admin/website", createElement(WebsiteAnalyticsClient, { initialInternalDevice: true, tab: tab as never, initial: WEBSITE }));
}

describe.each(ENGINES)("Website (%s)", (engine) => {
  const TABS: [string, string[]][] = [
    ["traffic", ["In the last 7 days", "410", "people visited swiftcard.me", "480", "Google", "Home", "Visitors and pages viewed per day", "Left after one page"]],
    ["pages", ["Most-read pages", "Pricing", "/pricing", "1m 35s on average", "Where people leave", "Card builder"]],
    ["sources", ["Where visits come from", "Google", "Instagram", "www.google.com", "1,168", "Campaigns", "src=badge", "Went on to build a card"]],
    ["audience", ["Countries", "United States", "United Kingdom", "Came back", "230", "Phone or computer", "Phone", "Computer"]],
    ["settings", ["This device is excluded from the numbers.", "Count this device again", "What's counted here"]],
  ];
  for (const [tab, mustSay] of TABS) {
    for (const width of [390, 1280]) {
      it(`${tab} tab: everything there, nothing spilling at ${width}px`, async () => {
        const page = await open(engine, width, await website(tab));
        try {
          const p = await layoutProblems(page);
          expect(p.spill, `spills at ${width}px`).toEqual([]);
          expect(p.sideways, `the page scrolls sideways at ${width}px`).toBe(false);
          const text = await page.evaluate(() => document.body.innerText);
          for (const s of mustSay) expect(text, `"${s}" missing on the ${tab} tab`).toContain(s);
          // The device state and the team switch are in the header on every tab,
          // with what the switch is doing in words.
          expect(text).toContain("This device: excluded");
          expect(text).toContain("Include my team's visits");
          expect(text).toContain("Your team: 312 visits (4,394 pages) left out of these numbers.");
        } finally { await page.close(); }
      });
    }
  }
});

// /api/admin/agents-health, through the real wording (lib/admin-data/agents-health).
async function agentsFixture() {
  const { summarizeAgents, agentsAttention } = await import("@/lib/admin-data/agents-health");
  const at = (h: number) => new Date(Date.parse("2026-10-27T13:00:00Z") - h * 3600_000).toISOString();
  const err = (agent_id: string, h: number) => ({ agent_id, status: "error", started_at: at(h), finished_at: at(h), summary: "Google said no" });
  const health = summarizeAgents({
    killAll: true, settingsUpdatedAt: at(20),
    states: [{ id: "leads-web", enabled: true, next_run_at: null, status_note: null }],
    runs: [err("sheet-sync", 1), err("sheet-sync", 2), err("sheet-sync", 3), err("leads-web", 1), err("leads-web", 2), err("leads-web", 3)],
    sheetRows: [{ tab: "web-leads" }], waiting: 4,
  });
  return { ...health, attention: agentsAttention(health) };
}

async function overview(opts: { analytics?: boolean; agents?: boolean } = {}) {
  const { createElement } = await import("react");
  const { default: OverviewClient } = await import("@/app/admin/OverviewClient");
  return inShell("/admin", createElement(OverviewClient, {
    retention: {
      partway: 2,
      closedThisWeek: 1,
      recentClosed: [{ userId: "r1", email: "dana.with-a-long-address@a-very-long-company-domain.example.com", plan: "pro", at: "2026-10-25T12:00:00Z", reasonText: "It costs more than I get out of it" }],
    },
    initial: { analytics: opts.analytics === false ? null : (ANALYTICS as never), website: WEBSITE, referrals: REFERRALS as never, agents: opts.agents === false ? null : await agentsFixture(), updatedAt: Date.parse("2026-10-27T13:41:00Z") },
  }));
}

describe.each(ENGINES)("Overview (%s)", (engine) => {
  for (const width of [390, 1280]) {
    it(`leads with money and growth, then what needs you, at ${width}px`, async () => {
      const page = await open(engine, width, await overview());
      try {
        const p = await layoutProblems(page);
        expect(p.spill, `spills at ${width}px`).toEqual([]);
        expect(p.sideways, `the page scrolls sideways at ${width}px`).toBe(false);
        const text = await page.evaluate(() => document.body.innerText);
        for (const s of [
          "Monthly revenue", "$109.78", "Paying customers", "19 Pro · 3 Office", "New signups · 7 days", "Website visitors · 7 days", "410",
          "payments failed — Stripe is retrying", "free trials end this week",
          "Needs your attention", "account was closed this week", "people are partway through cancelling", "suspicious referral signups",
          "Plan mix", "Signups · last 30 days", "The journey · last 30 days", "Visited the site",
          "Newest signups", "Recently closed", "It costs more than I get out of it",
          "Create a card for a business", "Email your users", "Test a plan", "Export users",
          // The agents (2026-10-28): a failing Sheet sync, a failing agent, Pause all, drafts waiting.
          "Sheet syncs failed in a row", "failed 3 runs in a row: Web Leads", "Every agent is paused (Pause all is on)", "drafts are waiting for your Approve",
        ]) expect(text, `"${s}" missing`).toContain(s);
        // Money comes before the attention list, which comes before the lists of people.
        expect(text.indexOf("Monthly revenue")).toBeLessThan(text.indexOf("Needs your attention"));
        expect(text.indexOf("Needs your attention")).toBeLessThan(text.indexOf("Newest signups"));
        // Every KPI tile is a link to the page behind the number.
        const tiles = await page.locator("a.adm-kpi").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
        for (const href of ["/admin/analytics?tab=revenue", "/admin/users?tab=pro", "/admin/analytics", "/admin/website", "/admin/users?create=1"]) expect(tiles).toContain(href);
      } finally { await page.close(); }
    });
  }

  it("one source failing blanks only its own numbers and says so", async () => {
    const page = await open(engine, 1280, await overview({ analytics: false }));
    try {
      const text = await page.evaluate(() => document.body.innerText);
      expect(text).toContain("The company numbers didn't load");
      expect(text).toContain("410"); // the website still shows
      expect(text).toContain("It costs more than I get out of it"); // and who left
    } finally { await page.close(); }
  });

  it("the agents' status failing to load says so, and nothing else goes", async () => {
    const page = await open(engine, 390, await overview({ agents: false }));
    try {
      const text = await page.evaluate(() => document.body.innerText);
      expect(text).toContain("The agents' status didn't load");
      expect(text).toContain("$109.78");
    } finally { await page.close(); }
  });
});

// ── Notifications (2026-10-28) ──────────────────────────────────────────────
const NOTES = [
  { id: "n1", created_at: "2026-10-28T14:00:00Z", kind: "money", severity: "urgent", title: "A payment was disputed", body: "$49.90 — reason: product not received. Answer it in Stripe by November 7, 2026, or it's lost.", href: "/admin/analytics?tab=revenue", meta: { stripeUrl: "https://dashboard.stripe.com/disputes/dp_1" }, read_at: null },
  { id: "n2", created_at: "2026-10-28T13:00:00Z", kind: "leaving", severity: "important", title: "An account was closed", body: `bartholomew.featherstonehaugh@a-very-long-company-domain.example.com (Pro) closed their account. Why: "It costs more than I get out of it" In their words: "Honestly it was great, but I only go to two events a year and paying every month for that doesn't add up for me right now."`, href: "/admin/users/u9", meta: {}, read_at: null },
  { id: "n3", created_at: "2026-10-27T09:00:00Z", kind: "agents", severity: "important", title: "The agents have been paused for over a day", body: "Pause all has been on since October 26, 5:31 PM. Only the Sheet keeps updating.", href: "/admin/crew", meta: {}, read_at: "2026-10-27T10:00:00Z" },
];

async function notifications() {
  const { createElement } = await import("react");
  const { default: NotificationsView } = await import("@/app/admin/notifications/NotificationsView");
  return inShell("/admin/notifications", createElement(NotificationsView, { rows: NOTES as never, tab: "all", unreadOnly: false, unread: { all: 2, money: 1, leaving: 1, agents: 0 } }), 2);
}

describe.each(ENGINES)("Notifications (%s)", (engine) => {
  for (const width of [390, 1280]) {
    it(`the list, the tabs and the forms, nothing spilling at ${width}px`, async () => {
      const page = await open(engine, width, await notifications());
      try {
        const p = await layoutProblems(page);
        expect(p.spill, `spills at ${width}px`).toEqual([]);
        expect(p.sideways, `the page scrolls sideways at ${width}px`).toBe(false);
        const text = await page.evaluate(() => document.body.innerText);
        for (const s of ["Notifications", "A payment was disputed", "Urgent", "Open in Stripe", "An account was closed", "In their words", "The agents have been paused for over a day", "Mark all read", "Everything", "Unread", "Customers leaving"]) {
          expect(text, `"${s}" missing`).toContain(s);
        }
        // Two unread → two Mark read; the read one has none. Every form posts.
        expect(await page.getByRole("button", { name: "Mark read", exact: true }).count()).toBe(2);
        const forms = await page.locator("form").evaluateAll((els) => els.map((f) => [f.getAttribute("method"), f.getAttribute("action")]));
        expect(forms).toEqual(Array(3).fill(["post", "/api/admin/notifications/read"]));
        // The bell shows the unread count where it can be seen at this width.
        const bell = width < 1024 ? page.getByRole("link", { name: "Notifications, 2 unread" }) : page.locator(".adm-sidebar a[href='/admin/notifications']");
        expect(await bell.isVisible()).toBe(true);
        expect(await bell.locator(".adm-unread").innerText()).toBe("2");
      } finally { await page.close(); }
    });
  }
});

describe.each(ENGINES)("the admin shell (%s)", (engine) => {
  it("is light: the canvas is the app's grouped grey, cards are white", async () => {
    const page = await open(engine, 1280, await sandbox());
    try {
      const bg = await page.evaluate(() => ({
        canvas: getComputedStyle(document.querySelector(".sc-admin")!).backgroundColor,
        card: getComputedStyle(document.querySelector(".adm-card")!).backgroundColor,
      }));
      expect(bg.canvas).toBe("rgb(242, 242, 247)");
      expect(bg.card).toBe("rgb(255, 255, 255)");
    } finally { await page.close(); }
  });

  it("shows the sidebar on a computer, grouped, with the current section marked", async () => {
    const page = await open(engine, 1280, await sandbox());
    try {
      const s = await page.evaluate(() => {
        const aside = document.querySelector("aside")!;
        const menu = document.querySelector("summary")!;
        return {
          sidebar: getComputedStyle(aside).display !== "none" && aside.getBoundingClientRect().width > 200,
          menuHidden: menu.getBoundingClientRect().width === 0,
          groups: [...aside.querySelectorAll(".adm-nav-group")].map((g) => g.textContent),
          current: aside.querySelector('[aria-current="page"]')?.textContent,
        };
      });
      expect(s.sidebar).toBe(true);
      expect(s.menuHidden).toBe(true);
      expect(s.groups).toEqual(["Business", "Tools"]);
      expect(s.current).toBe("Sandbox");
    } finally { await page.close(); }
  });

  it("puts the same list behind Menu on a phone, inside the screen", async () => {
    const page = await open(engine, 390, await sandbox());
    try {
      expect(await page.locator("aside").isVisible()).toBe(false);
      const summary = page.locator("summary", { hasText: "Menu" });
      expect(await summary.isVisible()).toBe(true);
      expect(await page.locator(".adm-menu-panel").isVisible()).toBe(false);
      await summary.click();
      const panel = page.locator(".adm-menu-panel");
      await panel.waitFor({ state: "visible" });
      const box = (await panel.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      for (const label of ["Overview", "Notifications", "Users", "Company Analytics", "Website", "Marketing", "Agents", "Sandbox"]) {
        expect(await panel.getByRole("link", { name: label, exact: true }).isVisible(), label).toBe(true);
      }
      // Every item is a real tap target.
      const heights = await panel.locator(".adm-nav-item").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
    } finally { await page.close(); }
  });

  for (const width of [390, 1280]) {
    it(`lays the Sandbox out with nothing spilling at ${width}px`, async () => {
      const page = await open(engine, width, await sandbox());
      try {
        const p = await layoutProblems(page);
        expect(p.spill, `spills at ${width}px`).toEqual([]);
        expect(p.sideways, `the page scrolls sideways at ${width}px`).toBe(false);
        const text = await page.evaluate(() => document.body.innerText);
        for (const s of ["Sandbox", "Switch your plan", "Try it as this plan", "What each plan unlocks", "Open dashboard as Pro"]) expect(text).toContain(s);
      } finally { await page.close(); }
    });
  }
});
