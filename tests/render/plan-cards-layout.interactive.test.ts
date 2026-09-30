import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build, type Plugin } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";
import { TRIAL_DAYS, PLAN_PRICES } from "@/lib/plan";

// ─────────────────────────────────────────────────────────────────────────────
// THE PLAN STEP, AS A PERSON SEES IT — web and iPhone app, phone and desktop.
//
// Owner, 2026-09-30, after signing up in the app: no Free / Pro / Office tabs
// (scroll to find Free and Office), no Monthly / Annual choice, and a Pro card
// that didn't look like the website's. The real PlanCards is mounted in
// Chromium with the app's real CSS, inside .sc-app like /welcome, and what is
// asserted is what is on screen: which card shows, which tab is on, what the
// Pro card says, whether anything spills off a 390px phone.
//
// Stubbed, because a headless browser has neither: StoreKit (useIapOffer —
// the App Store's prices) and the app's Supabase session (so the Apple
// purchase button renders as it does for a signed-in person).
// ─────────────────────────────────────────────────────────────────────────────

const ORIGIN = "https://sc.test";
let browser: Browser;
let bundle = "";
let css = "";
let tmp: string;

beforeAll(async () => {
  browser = await launchBrowser();
  css = await appCss();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "plan-cards-"));
  writeFileSync(join(tmp, "iap-offer-stub.ts"), `
    export type IapOffer = any;
    export function useIapOffer() { return (window as any).__offer; }
  `);
  writeFileSync(join(tmp, "supabase-stub.ts"), `
    export function createBrowserClient() {
      return { auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) } };
    }
  `);
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import PlanCards from "@/components/PlanCards";
    (window as any).__paid = [];
    (window as any).mount = (trialEligible: boolean) => {
      createRoot(document.getElementById("root")!).render(
        h("main", { className: "sc-app min-h-screen bg-gray-950 px-5 py-12" },
          h("div", { className: "max-w-6xl mx-auto" },
            h(PlanCards, {
              onFree: () => {},
              onPaid: (plan: string, annual: boolean, seats: number) => (window as any).__paid.push({ plan, annual, seats }),
              trialEligible,
            }))),
      );
    };
  `);
  const stubs: Plugin = {
    name: "stubs",
    setup(b) {
      b.onResolve({ filter: /^@\/lib\/use-iap-price$/ }, () => ({ path: join(tmp, "iap-offer-stub.ts") }));
      b.onResolve({ filter: /^@supabase\/ssr$/ }, () => ({ path: join(tmp, "supabase-stub.ts") }));
    },
  };
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "@": resolve("src") },
    plugins: [stubs],
    loader: { ".svg": "text" },
    banner: { js: "var process = { env: { NODE_ENV: \"production\" } };" },
  });
  bundle = out.outputFiles[0].text;
}, 240_000);
afterAll(async () => { await browser?.close(); if (tmp) rmSync(tmp, { recursive: true, force: true }); });

// StoreKit's answer for a new Apple ID in the US storefront.
const STOREKIT = { status: "ready", monthly: "$4.99", annual: "$54.00", trial: true, annualPerMonth: "$4.50", annualSavePct: 10 };
/** The annual Pro price each surface should show: PLAN_PRICES on the web, StoreKit's in the app. */
const annualPrice = (native: boolean) => (native ? STOREKIT.annual : `$${PLAN_PRICES.PRO_ANNUAL_CENTS / 100}`);
const esc = (s: string) => s.replace(/[$.]/g, "\\$&");

async function open(o: { width: number; native?: boolean; light?: boolean; trialEligible?: boolean }): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: o.width, height: 900 } });
  const page = await ctx.newPage();
  await page.route(`${ORIGIN}/api/**`, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"eligible":true}' }));
  await page.route(`${ORIGIN}/`, (r) => r.fulfill({
    status: 200, contentType: "text/html",
    body: `<!doctype html><html${o.light ? ' data-sc-theme="light"' : ""}><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head>
           <body><div id="root"></div><script>${bundle}</script></body></html>`,
  }));
  await page.addInitScript((offer) => { (window as unknown as { __offer: unknown }).__offer = offer; }, STOREKIT);
  if (o.native) {
    // The shell: WKWebView's bridge, plus the ExternalPurchase plugin that
    // lets Office leave for the default browser.
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      w.webkit = { messageHandlers: { bridge: {} } };
      w.Capacitor = { isNativePlatform: () => true, Plugins: { ExternalPurchase: { open: async () => ({ opened: true }) } } };
    });
  }
  await page.goto(`${ORIGIN}/`);
  await page.evaluate((t) => (window as unknown as { mount: (t: boolean) => void }).mount(t), o.trialEligible ?? true);
  // Mount effects: native detection, the link-out check, and — in the app —
  // the purchase button, which renders only once its async status resolves.
  // Wait for the button itself rather than a fixed delay that a loaded CI
  // runner can outlast.
  await page.locator("button", { hasText: /^(Try Pro free for \d+ days →|Get Pro →)$/ }).first().waitFor({ state: "attached", timeout: 15_000 });
  await page.waitForTimeout(150);
  return page;
}

/** What is actually on screen. */
function snapshot(page: Page) {
  return page.evaluate(() => {
    const seen = (el: Element | null) => !!el && (el as HTMLElement).offsetParent !== null && getComputedStyle(el).visibility !== "hidden";
    const card = (heading: string) =>
      [...document.querySelectorAll("div.rounded-\\[28px\\]")].find((d) => d.querySelector("p")?.textContent?.startsWith(heading)) as HTMLElement | undefined;
    const free = card("Free"), pro = card("Pro"), office = card("Office");
    const tabs = [...document.querySelectorAll("button[aria-pressed]")].filter((b) => ["Free", "Pro", "Office"].includes(b.textContent ?? ""));
    const toggle = document.querySelector('button[aria-label="Toggle annual billing"]');
    const r = (el?: HTMLElement) => el?.getBoundingClientRect();
    return {
      freeShown: seen(free ?? null), proShown: seen(pro ?? null), officeShown: seen(office ?? null),
      tabs: tabs.filter(seen).map((b) => ({ label: b.textContent, on: b.getAttribute("aria-pressed") === "true" })),
      toggleShown: seen(toggle),
      proText: pro?.innerText ?? "",
      officeText: office?.innerText ?? "",
      proFeatureColor: pro ? getComputedStyle(pro.querySelector("li")!).color : "",
      tops: { free: r(free)?.top, pro: r(pro)?.top, office: r(office)?.top },
      lefts: { free: r(free)?.left, pro: r(pro)?.left, office: r(office)?.left },
      overflowX: document.scrollingElement!.scrollWidth - window.innerWidth,
      bodyText: document.body.innerText,
    };
  });
}

const tab = (page: Page, label: string) => page.locator("button[aria-pressed]", { hasText: new RegExp(`^${label}$`) }).click();

for (const native of [false, true]) {
  const who = native ? "iPhone app" : "website";

  describe(`${who}, phone (390px)`, () => {
    it("opens on the Pro tab with the Monthly / Annual switch — Free and Office one tap away, no scrolling", async () => {
      const page = await open({ width: 390, native });
      try {
        const s = await snapshot(page);
        expect(s.tabs).toEqual([{ label: "Free", on: false }, { label: "Pro", on: true }, { label: "Office", on: false }]);
        expect(s.toggleShown).toBe(true);
        expect(s.proShown).toBe(true);
        expect(s.freeShown).toBe(false);
        expect(s.officeShown).toBe(false);
        expect(s.overflowX).toBeLessThanOrEqual(0);

        await tab(page, "Free");
        const f = await snapshot(page);
        expect(f.freeShown && !f.proShown && !f.officeShown).toBe(true);
        expect(f.toggleShown, "the switch changes nothing on the Free tab").toBe(false);

        await tab(page, "Office");
        const o = await snapshot(page);
        expect(o.officeShown && !o.proShown && !o.freeShown).toBe(true);
        expect(o.officeText).toContain("FOR TEAMS");
        expect(o.overflowX).toBeLessThanOrEqual(0);
      } finally { await page.context().close(); }
    });

    it("Pro reads exactly like /pricing: Free for the first 14 days, then the price, and 'Try Pro free'", async () => {
      const page = await open({ width: 390, native });
      try {
        const m = await snapshot(page);
        expect(m.proText).toMatch(new RegExp(`Free\\s+for your first ${TRIAL_DAYS} days`));
        expect(m.proText).toMatch(/then \$4\.99 \/ month · cancel anytime/);
        expect(m.proText).toContain(`Try Pro free for ${TRIAL_DAYS} days →`);
        expect(m.proText).toContain("MOST POPULAR");

        await page.click('button[aria-label="Toggle annual billing"]');
        const a = await snapshot(page);
        expect(a.proText).toMatch(new RegExp(`then ${esc(annualPrice(native))} / year · cancel anytime`));
        expect(a.proText).toMatch(/~\$4\.50\/mo · Save 10%/);
        expect(a.bodyText).toContain("SAVE 10%");
      } finally { await page.context().close(); }
    });
  });

  describe(`${who}, desktop (1280px)`, () => {
    it("three cards side by side, no tabs, Pro raised", async () => {
      const page = await open({ width: 1280, native });
      try {
        const s = await snapshot(page);
        expect(s.tabs).toEqual([]);
        expect(s.freeShown && s.proShown && s.officeShown).toBe(true);
        expect(s.lefts.free!).toBeLessThan(s.lefts.pro!);
        expect(s.lefts.pro!).toBeLessThan(s.lefts.office!);
        expect(s.tops.pro!).toBeLessThan(s.tops.free!); // md:-mt-6
        expect(s.overflowX).toBeLessThanOrEqual(0);
      } finally { await page.context().close(); }
    });
  });

  it(`${who}: the Pro card keeps white ink in the light theme`, async () => {
    const page = await open({ width: 390, native, light: true });
    try {
      expect((await snapshot(page)).proFeatureColor).toBe("rgb(255, 255, 255)");
    } finally { await page.context().close(); }
  });
}

describe("what only the app does", () => {
  it("Office carries no price and leaves for swiftcard.me; no web price anywhere", async () => {
    const page = await open({ width: 390, native: true });
    try {
      await tab(page, "Office");
      const s = await snapshot(page);
      expect(s.officeText).toContain("Get Office on swiftcard.me →");
      expect(s.officeText).not.toMatch(/\$\d|per user|Team size/);
      // Every price on the page is StoreKit's (the stub), never PLAN_PRICES'.
      expect(s.bodyText).not.toMatch(/Get Office ·/);
    } finally { await page.context().close(); }
  });

  it("an Apple ID that can't get the trial sees the plain price and 'Get Pro'", async () => {
    const page = await open({ width: 390, native: true, trialEligible: false });
    try {
      const s = await snapshot(page);
      expect(s.proText).not.toMatch(/for your first/);
      expect(s.proText).toMatch(/\$4\.99\s*\/ month/);
      expect(s.proText).toContain("Get Pro →");
    } finally { await page.context().close(); }
  });
});

describe("what only the website does", () => {
  it("the switch reaches Stripe: annual Pro and annual Office with the seats picked", async () => {
    const page = await open({ width: 1280 });
    try {
      await page.click('button[aria-label="Toggle annual billing"]');
      await page.getByRole("button", { name: `Try Pro free for ${TRIAL_DAYS} days →` }).click();
      await page.getByRole("button", { name: "5 users", exact: true }).click();
      await page.getByRole("button", { name: /^Get Office · / }).click();
      const paid = await page.evaluate(() => (window as unknown as { __paid: unknown[] }).__paid);
      expect(paid).toEqual([{ plan: "pro", annual: true, seats: 1 }, { plan: "office", annual: true, seats: 5 }]);
    } finally { await page.context().close(); }
  });
});
