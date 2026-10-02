import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build, type Plugin } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";

// ─────────────────────────────────────────────────────────────────────────────
// A PROMO CODE, REDEEMED THROUGH APPLE — driven end to end in Chromium.
//
// Owner, 2026-10-02: in the iPhone app a two-months-free code said it applied,
// the Pro button sold the plain subscription, and the code was gone. "Any time
// a promo code is added it has to work completely, even if it's billed
// through Apple."
//
// The real PlanCards and the real lib/iap run here. Stubbed, because a
// headless browser has none of them: the app shell (its bridge and the
// ExternalPurchase plugin, recording what it opens), RevenueCat (recording
// every call, and reporting Pro active once "Apple" has redeemed the code),
// StoreKit's prices, and the signed-in session (window.__uid).
// ─────────────────────────────────────────────────────────────────────────────

const ORIGIN = "https://sc.test";
const APP_ID = "6798875872";
let browser: Browser;
let bundle = "";
let css = "";
let tmp: string;

beforeAll(async () => {
  browser = await launchBrowser();
  css = await appCss();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "apple-offer-"));
  writeFileSync(join(tmp, "iap-offer-stub.ts"), `
    export type IapOffer = any;
    export function useIapOffer() { return { status: "ready", monthly: "$4.99", annual: "$53.99", trial: true }; }
  `);
  writeFileSync(join(tmp, "supabase-stub.ts"), `
    export function createBrowserClient() {
      return { auth: { getSession: async () => ({ data: { session: (window as any).__uid ? { user: { id: (window as any).__uid } } : null } }) } };
    }
  `);
  writeFileSync(join(tmp, "rc-stub.ts"), `
    const w = window as any;
    const log = (s: string) => w.__rc.push(s);
    export const Purchases = {
      configure: async (o: any) => log("configure:" + o.appUserID),
      logIn: async (o: any) => log("logIn:" + o.appUserID),
      getOfferings: async () => ({ current: { availablePackages: [] }, all: {} }),
      checkTrialOrIntroductoryPriceEligibility: async () => ({}),
      presentCodeRedemptionSheet: async () => log("sheet"),
      invalidateCustomerInfoCache: async () => {},
      syncPurchases: async () => log("syncPurchases"),
      getCustomerInfo: async () => ({ customerInfo: { entitlements: { active: w.__redeemed ? { pro: {} } : {} } } }),
    };
  `);
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import PlanCards from "@/components/PlanCards";
    (window as any).mount = () => {
      createRoot(document.getElementById("root")!).render(
        h("main", { className: "sc-app min-h-screen bg-gray-950 px-5 py-12" },
          h("div", { className: "max-w-6xl mx-auto" },
            h(PlanCards, {
              onFree: () => {},
              onPaid: () => { (window as any).__paidViaStripe = true; },
              onIapPurchased: () => { (window as any).__purchased = true; },
              trialEligible: true,
            }))),
      );
    };
  `);
  const stubs: Plugin = {
    name: "stubs",
    setup(b) {
      b.onResolve({ filter: /^@\/lib\/use-iap-price$/ }, () => ({ path: join(tmp, "iap-offer-stub.ts") }));
      b.onResolve({ filter: /^@supabase\/ssr$/ }, () => ({ path: join(tmp, "supabase-stub.ts") }));
      b.onResolve({ filter: /^@revenuecat\/purchases-capacitor$/ }, () => ({ path: join(tmp, "rc-stub.ts") }));
    },
  };
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env.NEXT_PUBLIC_RC_APPLE_API_KEY": '"appl_test"',
      "process.env.NEXT_PUBLIC_APP_STORE_ID": `"${APP_ID}"`,
    },
    alias: { "@": resolve("src") },
    plugins: [stubs],
    loader: { ".svg": "text" },
    banner: { js: "var process = { env: { NODE_ENV: \"production\" } };" },
  });
  bundle = out.outputFiles[0].text;
}, 240_000);
afterAll(async () => { await browser?.close(); if (tmp) rmSync(tmp, { recursive: true, force: true }); });

const DEMISHA = { ok: true, code: "DEMISHA", label: "Two months free", detail: "This code is for Pro, billed monthly. Choose that plan below.", forPro: true, apple: true };

async function open(o: { plugin?: boolean } = {}): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const page = await ctx.newPage();
  await page.route(`${ORIGIN}/api/**`, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"eligible":true}' }));
  await page.route(`${ORIGIN}/api/promo/check`, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DEMISHA) }));
  await page.route(`${ORIGIN}/api/iap/sync`, (r) => {
    void page.evaluate(() => { (window as unknown as { __synced: number }).__synced++; }).catch(() => {});
    return r.fulfill({ status: 200, contentType: "application/json", body: '{"applied":"grant"}' });
  });
  await page.route(`${ORIGIN}/`, (r) => r.fulfill({
    status: 200, contentType: "text/html",
    body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head>
           <body><div id="root"></div><script>${bundle}</script></body></html>`,
  }));
  await page.addInitScript((withPlugin) => {
    const w = window as unknown as Record<string, unknown>;
    const opened: string[] = [];
    w.__opened = opened; w.__rc = []; w.__uid = "u1"; w.__redeemed = false; w.__purchased = false; w.__synced = 0;
    w.webkit = { messageHandlers: { bridge: {} } };
    w.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => "ios",
      Plugins: withPlugin ? { ExternalPurchase: { open: async (a: { url: string }) => { opened.push(a.url); return { opened: true }; } } } : {},
    };
  }, o.plugin !== false);
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(() => (window as unknown as { mount: () => void }).mount());
  await page.locator("button", { hasText: /^Try Pro free for \d+ days →$/ }).first().waitFor({ timeout: 15_000 });
  return page;
}

async function applyCode(page: Page) {
  await page.getByRole("button", { name: "Have a promo code?" }).click();
  await page.getByLabel("Promo code").fill("demisha");
  await page.getByRole("button", { name: "Apply" }).click();
  await page.getByRole("button", { name: "Try Pro free for two months →" }).waitFor({ timeout: 5_000 });
}

const get = <T,>(page: Page, key: string) => page.evaluate((k) => (window as unknown as Record<string, unknown>)[k], key) as Promise<T>;

describe("a promo code in the iPhone app is redeemed through Apple", () => {
  it("opens Apple's code page with the code filled in, for the signed-in account", async () => {
    const page = await open();
    try {
      await applyCode(page);
      await page.getByRole("button", { name: "Try Pro free for two months →" }).click();
      await page.waitForFunction(() => (window as unknown as { __opened: string[] }).__opened.length > 0);
      expect(await get<string[]>(page, "__opened")).toEqual([`https://apps.apple.com/redeem?ctx=offercodes&id=${APP_ID}&code=DEMISHA`]);
      // RevenueCat was identified as THIS account before Apple was opened, so
      // the redemption is credited to it. Nothing went near Stripe.
      expect(await get<string[]>(page, "__rc")).toContain("configure:u1");
      expect(await get<boolean>(page, "__paidViaStripe")).toBeFalsy();
      await page.getByText("Redeemed it with Apple?").waitFor();
    } finally { await page.context().close(); }
  });

  it("coming back after redeeming switches Pro on and carries on (onPurchased)", async () => {
    const page = await open();
    try {
      await applyCode(page);
      await page.getByRole("button", { name: "Try Pro free for two months →" }).click();
      await page.getByText("Redeemed it with Apple?").waitFor();
      // Apple redeems the code; the person comes back to the app.
      await page.evaluate(() => {
        (window as unknown as { __redeemed: boolean }).__redeemed = true;
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.waitForFunction(() => (window as unknown as { __purchased: boolean }).__purchased === true, null, { timeout: 15_000 });
      expect(await get<number>(page, "__synced")).toBeGreaterThan(0);
      expect(await get<string[]>(page, "__rc")).not.toContain("syncPurchases");
    } finally { await page.context().close(); }
  });

  it("'Continue' before redeeming says Pro isn't on yet — never a silent no-op", async () => {
    const page = await open();
    try {
      await applyCode(page);
      await page.getByRole("button", { name: "Try Pro free for two months →" }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByText("Pro isn't on yet", { exact: false }).waitFor({ timeout: 15_000 });
      expect(await get<boolean>(page, "__purchased")).toBe(false);
      // …and finishing on Apple then tapping Continue does carry on.
      await page.evaluate(() => { (window as unknown as { __redeemed: boolean }).__redeemed = true; });
      await page.getByRole("button", { name: "Continue" }).click();
      await page.waitForFunction(() => (window as unknown as { __purchased: boolean }).__purchased === true, null, { timeout: 15_000 });
    } finally { await page.context().close(); }
  });

  it("an account switched without a reload redeems as the NEW account", async () => {
    const page = await open();
    try {
      await applyCode(page);
      await page.evaluate(() => { (window as unknown as { __uid: string }).__uid = "u2"; });
      await page.getByRole("button", { name: "Try Pro free for two months →" }).click();
      await page.waitForFunction(() => (window as unknown as { __opened: string[] }).__opened.length > 0);
      expect(await get<string[]>(page, "__rc")).toContain("logIn:u2");
    } finally { await page.context().close(); }
  });

  it("signed out, nothing is redeemed and it says so", async () => {
    const page = await open();
    try {
      await applyCode(page);
      await page.evaluate(() => { (window as unknown as { __uid: string | null }).__uid = null; });
      await page.getByRole("button", { name: "Try Pro free for two months →" }).click();
      await page.getByText("Couldn't open Apple's code page", { exact: false }).waitFor({ timeout: 10_000 });
      expect(await get<string[]>(page, "__opened")).toEqual([]);
    } finally { await page.context().close(); }
  });
});
