import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright";
import { appCss } from "./harness";

// ── Users and a user's page, driven (owner, 2026-10-27) ─────────────────────
//
// "On Users, we have All, Free, Pro, and Office and then we should also have
// Closed Accounts so we know which users close their accounts. When we click
// on that user, it'll tell us why they closed the account: all the
// description they put in." Driven in a real browser (hydrated, the API
// mocked) at a phone and a computer width, in Chromium and WebKit:
//   - the Closed accounts tab lists each person with the reason in words and
//     their own comment, and the address follows the tab;
//   - opened straight onto a later tab on a phone, the tab row slides that
//     tab into view instead of leaving it off the edge;
//   - a closed account's page says when, why, in their words, and when it is
//     permanently deleted;
//   - nothing scrolls the page sideways.

const ORIGIN = "https://sc.test";
let css: string;
let bundle: string;
let tmp: string;
const browsers: Record<string, Browser> = {};

const USERS = [
  { id: "u1", username: "maya", primary_username: "maya", name: "Maya Rep", email: "maya@example.com", plan: "pro", plan_expires_at: null, signup_source: "referral", company: "Coastline Homes", title: null, created_at: "2026-10-01T00:00:00Z", card_count: 2, lead_count: 14, view_count: 230 },
  { id: "u2", username: "bart", primary_username: null, name: "Bartholomew Featherstonehaugh-Montgomery", email: "bartholomew.featherstonehaugh@a-very-long-company-domain.example.com", plan: "free", plan_expires_at: null, signup_source: null, company: "A Company With A Remarkably Long Registered Name LLC", title: null, created_at: "2026-09-01T00:00:00Z", card_count: 1, lead_count: 0, view_count: 3 },
  { id: "u3", username: "ola", primary_username: "ola", name: "Ola Office", email: "ola@example.com", plan: "enterprise", plan_expires_at: "2026-11-20T00:00:00Z", signup_source: "direct", company: null, title: null, created_at: "2026-08-01T00:00:00Z", card_count: 3, lead_count: 40, view_count: 900 },
];
const LONG = "Honestly it was great, but I only go to two events a year and paying every month for that doesn't add up for me right now.";
const CLOSED = [
  { id: "c1", name: "Dana Ellis", email: "dana@example.com", plan: "pro", closed_at: "2026-10-25T12:00:00Z", reason: "too-expensive", reason_text: "It costs more than I get out of it", comment: LONG, purge_at: "2099-11-24T12:00:00Z" },
  { id: "c2", name: null, email: "sam@example.com", plan: "free", closed_at: "2026-10-20T12:00:00Z", reason: "testing", reason_text: "I was just testing / signed up by mistake", comment: null, purge_at: "2099-11-19T12:00:00Z" },
];
// Our own and QA's accounts (Users › Internal & test). Never counted.
const INTERNAL = [
  { id: "i1", kind: "test", username: "qa1", primary_username: null, name: null, email: "qa-and-pro-1@swiftcard-test.invalid", plan: "pro", effective_plan: "pro", plan_expires_at: null, signup_source: null, company: null, title: null, created_at: "2026-10-27T00:00:00Z", card_count: 0, lead_count: 0, view_count: 0, link_view_count: 0, locked_lead_count: 0, office_role: null, billing: { source: "none", trialEndsAt: null, pastDue: false, cancelling: false, everPaid: false } },
];
// A customer who never typed a profile name and has no card name yet: the
// list must show their email, never a dash.
const NAMELESS = { id: "u4", username: "u4", primary_username: null, name: null, email: "nameless@example.com", plan: "free", plan_expires_at: null, signup_source: null, company: null, title: null, created_at: "2026-07-01T00:00:00Z", card_count: 0, lead_count: 0, view_count: 0 };

const DETAIL = {
  user: {
    id: "c1", username: "dana", name: "Dana Ellis", email: "dana@example.com", plan: "free", plan_expires_at: null, created_at: "2026-06-01T00:00:00Z",
    company: "Northbeam", title: "Broker", phone: null, website: null, photo_url: null, signup_source: "direct", referral_code: "DANA",
    referred_by: null, referral_reward_earned: false, deleted: true, billing: "none",
  },
  subscription: {
    status: "trialing", plan: "pro", interval: "monthly", unitCents: 499, quantity: 1, monthlyCents: 499,
    discount: { percentOff: 50, amountOff: null, duration: "repeating", end: 4_102_444_800 },
    trialEnd: "2099-11-05T00:00:00Z", periodEnd: "2099-11-05T00:00:00Z", cancelAtPeriodEnd: true, created: "2026-10-20T00:00:00Z", livemode: true,
  },
  leaving: {
    closed: true, closed_at: "2026-10-25T12:00:00Z", purge_at: "2099-11-24T12:00:00Z", plan_at_close: "pro",
    reason_text: "It costs more than I get out of it", comment: LONG,
    surveys: [
      { at: "2026-09-02T12:00:00Z", plan: "pro", reason_text: "I'm not using it enough to justify it", comment: "Busy season is over." },
      { at: "2026-10-25T12:00:00Z", plan: "pro", reason_text: "It costs more than I get out of it", comment: LONG },
    ],
    saved_by_text: null, saved_at: null,
  },
  cards: [{ id: "k1", username: "dana", label: null, name: "Dana Ellis", title: "Broker", company: "Northbeam", template: "classic-pro", created_at: "2026-06-01T00:00:00Z", leads: 9, cardViews: 120, linkViews: 30, is_offline: false }],
  profileCard: null,
  totals: { leads: 9, views: 150, leads30: 2, views30: 40, referred: 1, referralMonthsClaimed: 0, referralMonthsClaimable: 0 },
  series: Array.from({ length: 30 }, (_, i) => ({ date: new Date(Date.UTC(2026, 8, 28 + i)).toISOString().slice(0, 10), views: i % 4, leads: i % 7 === 0 ? 1 : 0 })),
  recentLeads: [{ id: "l1", name: "Pat Buyer", email: "pat@example.com", phone: null, source: "qr_code", card_owner: "dana", created_at: "2026-10-10T00:00:00Z" }],
};

beforeAll(async () => {
  css = (await appCss()) + readFileSync("src/app/admin/admin.css", "utf8");
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "adminusers-"));
  writeFileSync(join(tmp, "nav-stub.tsx"), `
    export function useRouter() { return { push(u) { window.__pushed = u; }, replace() {}, refresh() {}, back() {}, prefetch() {} }; }
    export function usePathname() { return location.pathname; }
    export function useSearchParams() { return new URLSearchParams(location.search); }
  `);
  // next/link needs Next's router; outside the app it is a plain anchor.
  writeFileSync(join(tmp, "link-stub.tsx"), `
    import { createElement as h } from "react";
    export default function Link({ href, children, scroll, prefetch, ...rest }) { return h("a", { href, ...rest }, children); }
  `);
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import UsersClient from "@/app/admin/users/UsersClient";
    import UserDetailClient from "@/app/admin/users/[id]/UserDetailClient";
    const v = window.__VIEW;
    const el = v.view === "detail" ? h(UserDetailClient, { userId: "c1", initialTab: v.tab }) : h(UsersClient, { initialTab: v.tab });
    createRoot(document.getElementById("root")).render(
      h("div", { className: "sc-app sc-admin min-h-screen" }, h("main", { className: "px-4 sm:px-6 pt-5 pb-16" }, el))
    );
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")],
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    loader: { ".css": "empty" },
    define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_SUPABASE_URL": '"https://x"', "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '"k"' },
    alias: { "next/navigation": join(tmp, "nav-stub.tsx"), "next/link": join(tmp, "link-stub.tsx"), "@": resolve("src") },
  });
  bundle = out.outputFiles[0].text;
  browsers.Chromium = await chromium.launch();
  browsers.WebKit = await webkit.launch();
}, 240_000);

afterAll(async () => {
  await Promise.all(Object.values(browsers).map((b) => b.close()));
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

async function open(engine: string, width: number, view: { view: "users" | "detail"; tab?: string }): Promise<Page> {
  const ctx = await browsers[engine].newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/admin/")) {
      return route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><html data-sc-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><style>body{margin:0}</style></head><body><div id="root"></div><script>window.process={env:{}};window.__VIEW=${JSON.stringify(view)};</script><script>${bundle}</script></body></html>` });
    }
    if (url.pathname === "/api/admin/users") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ users: [...USERS, NAMELESS], internal: INTERNAL, closed: CLOSED }) });
    if (url.pathname === "/api/admin/users/c1") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DETAIL) });
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  const path = view.view === "detail" ? "/admin/users/c1" : "/admin/users";
  await page.goto(`${ORIGIN}${path}${view.tab ? `?tab=${view.tab}` : ""}`);
  return page;
}

const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

describe.each(["Chromium", "WebKit"])("%s", (engine) => {
  for (const width of [390, 1280]) {
    it(`Users: the six tabs with counts, and nothing sideways at ${width}px`, async () => {
      const page = await open(engine, width, { view: "users" });
      try {
        await page.getByText("Maya Rep").waitFor();
        const tabs = await page.locator('[role="tablist"] [role="tab"]').allInnerTexts();
        expect(tabs.map((t) => t.replace(/\s+/g, " ").trim())).toEqual(["All 4", "Free 2", "Pro 1", "Office 1", "Closed accounts 2", "Internal & test 1"]);
        expect(await sideways(page), `sideways at ${width}px`).toBe(false);
        // The free month shows as words, not an icon.
        expect(await page.getByText(/Free month · ends/).count()).toBeGreaterThan(0);
      } finally { await page.context().close(); }
    });

    it(`Closed accounts: who, why in words, their own comment, and the address follows (${width}px)`, async () => {
      const page = await open(engine, width, { view: "users" });
      try {
        await page.getByText("Maya Rep").waitFor();
        await page.getByRole("tab", { name: /Closed accounts/ }).click();
        await page.getByText("Dana Ellis").waitFor();
        const text = await page.evaluate(() => document.body.innerText);
        expect(text).toContain("It costs more than I get out of it");
        expect(text).toContain("I was just testing / signed up by mistake");
        expect(text).toContain("Honestly it was great");
        expect(text).not.toContain("too-expensive");
        expect(text).toMatch(/permanently deleted in \d+ days/);
        expect(new URL(page.url()).searchParams.get("tab")).toBe("closed");
        expect(await sideways(page), `sideways at ${width}px`).toBe(false);
        await page.getByText("Dana Ellis").click();
        expect(await page.evaluate(() => (window as unknown as { __pushed?: string }).__pushed)).toBe("/admin/users/c1");
      } finally { await page.context().close(); }
    });
  }

  it("opened on Closed accounts on a phone, the tab row shows that tab", async () => {
    const page = await open(engine, 390, { view: "users", tab: "closed" });
    try {
      await page.getByText("Dana Ellis").waitFor();
      const seen = await page.evaluate(() => {
        const row = document.querySelector(".adm-tabs")!.getBoundingClientRect();
        const tab = document.querySelector('.adm-tabs [aria-current="page"]')!.getBoundingClientRect();
        return { inside: tab.left >= row.left - 1 && tab.right <= row.right + 1, label: document.querySelector('.adm-tabs [aria-current="page"]')!.textContent };
      });
      expect(seen.label).toContain("Closed accounts");
      expect(seen.inside, "the current tab is off the edge of the row").toBe(true);
    } finally { await page.context().close(); }
  });

  for (const width of [390, 1280]) {
    it(`a closed account's page says when, why, in their words, and when it's gone (${width}px)`, async () => {
      const page = await open(engine, width, { view: "detail" });
      try {
        await page.getByText(/Closed their account on/).waitFor();
        const text = await page.evaluate(() => document.body.innerText);
        expect(text).toContain("Closed their account on October 25, 2026");
        expect(text).toMatch(/permanently deleted in \d+ days/);
        expect(text).toContain("It costs more than I get out of it");
        expect(text).toContain("In their words");
        expect(text).toContain("Honestly it was great");
        expect(text).toContain("Had plan");
        // The earlier answer is one tap away, not lost.
        await page.getByText("1 earlier answer").click();
        await page.getByText("Busy season is over.").waitFor();
        expect(await sideways(page), `sideways at ${width}px`).toBe(false);
        // The tabs are there, and Cards keeps the takedown switch.
        await page.getByRole("tab", { name: /Cards/ }).click();
        await page.getByRole("button", { name: "Take offline" }).waitFor();
        await page.getByRole("tab", { name: /Plan & billing/ }).click();
        await page.getByRole("button", { name: /Grant 1 month of Pro/ }).waitFor();
        expect(new URL(page.url()).searchParams.get("tab")).toBe("plan");
      } finally { await page.context().close(); }
    });
  }

  it("a customer with no name shows their email — never a dash", async () => {
    const page = await open(engine, 1280, { view: "users" });
    try {
      await page.getByText("Maya Rep").waitFor();
      const rows = await page.locator("ul.adm-divide > li").allInnerTexts();
      const nameless = rows.find((r) => r.includes("nameless@example.com"))!;
      expect(nameless, "the nameless customer's row").toBeTruthy();
      expect(nameless.split("\n")[0].trim()).not.toBe("—");
      expect(rows.join("\n")).not.toMatch(/^—$/m);
    } finally { await page.context().close(); }
  });

  it("Internal & test lists our own and QA's accounts, apart from customers, and says they aren't counted", async () => {
    const page = await open(engine, 390, { view: "users" });
    try {
      await page.getByText("Maya Rep").waitFor();
      await page.getByRole("tab", { name: /Internal & test/ }).click();
      await page.getByText("qa-and-pro-1@swiftcard-test.invalid").waitFor();
      const text = await page.evaluate(() => document.body.innerText);
      expect(text).toContain("None of them is counted in any number");
      expect(text).toContain("QA test account");
      expect(text).not.toContain("Maya Rep");
      expect(new URL(page.url()).searchParams.get("tab")).toBe("internal");
    } finally { await page.context().close(); }
  });

  it("Plan & billing shows the live Stripe subscription: status, price, discount, dates, cancelling", async () => {
    const page = await open(engine, 390, { view: "detail", tab: "plan" });
    try {
      await page.getByText("Live from Stripe").waitFor();
      const text = await page.evaluate(() => document.body.innerText);
      for (const s of ["Free trial", "Pro · $4.99 / month", "$4.99 a month once the trial ends", "50% off", "Trial ends", "cancelled: it ends"]) expect(text, s).toContain(s);
      expect(await sideways(page)).toBe(false);
    } finally { await page.context().close(); }
  });
});
