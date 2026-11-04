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
// Owner, 2026-11-04: a new account redeemed SWIFTNYC on Apple's page and came
// back to "Choose your plan" — no Pro, no card, and no webhook ever came.
// RevenueCat does NOT notice a code redeemed on Apple's page by itself; its
// guide for that flow says to call syncPurchases when the person comes back.
// The old stub here reported Pro the moment "Apple" had the code, which is
// exactly the assumption that was wrong, so it passed while every real
// redemption failed. This RevenueCat stub knows about a redemption only once
// it has been told — by syncPurchases or restorePurchases — like the real one.
//
// The real PlanCards and the real lib/iap run here. Stubbed, because a
// headless browser has none of them: the app shell (its bridge and the
// ExternalPurchase plugin, recording what it opens), RevenueCat (recording
// every call), StoreKit's prices, and the signed-in session (window.__uid).
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
  // __redeemed: Apple has the subscription (the code was redeemed on its
  // page). __rcHas: RevenueCat knows about it. Only syncPurchases or
  // restorePurchases carries the first to the second.
  writeFileSync(join(tmp, "rc-stub.ts"), `
    const w = window as any;
    const log = (s: string) => w.__rc.push(s);
    const info = () => ({ entitlements: { active: w.__rcHas ? { pro: {} } : {} } });
    const listeners: Record<string, (i: any) => void> = {};
    const learn = () => {
      if (!w.__redeemed || w.__rcHas) return;
      w.__rcHas = true;
      for (const l of Object.values(listeners)) l(info());
    };
    export const Purchases = {
      configure: async (o: any) => log("configure:" + o.appUserID),
      logIn: async (o: any) => log("logIn:" + o.appUserID),
      getOfferings: async () => ({ current: { availablePackages: [] }, all: {} }),
      checkTrialOrIntroductoryPriceEligibility: async () => ({}),
      presentCodeRedemptionSheet: async () => log("sheet"),
      invalidateCustomerInfoCache: async () => {},
      syncPurchases: async () => { log("syncPurchases"); learn(); },
      restorePurchases: async () => { log("restore"); learn(); return { customerInfo: info() }; },
      getCustomerInfo: async () => ({ customerInfo: info() }),
      addCustomerInfoUpdateListener: async (l: (i: any) => void) => { const id = "l" + Object.keys(listeners).length; listeners[id] = l; return id; },
      removeCustomerInfoUpdateListener: async (o: any) => { delete listeners[o.listenerToRemove]; return { wasRemoved: true }; },
    };
  `);
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import PlanCards from "@/components/PlanCards";
    (window as any).mount = (o: { builder?: boolean } = {}) => {
      const w = window as any;
      createRoot(document.getElementById("root")!).render(
        h("main", { className: "sc-app min-h-screen bg-gray-950 px-5 py-12" },
          h("div", { className: "max-w-6xl mx-auto" },
            h(PlanCards, {
              onFree: () => {},
              onPaid: () => { w.__paidViaStripe = true; },
              onIapPurchased: () => { w.__purchased = true; },
              trialEligible: true,
              // The builder's plan gate: save the card, then hand over.
              ...(o.builder ? {
                onBeforeAppleRedeem: async (code: string) => {
                  w.__savedFor = code;
                  return { handoff: (opened: boolean) => { w.__handoff = opened; } };
                },
              } : {}),
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

type OpenOpts = {
  plugin?: boolean;
  builder?: boolean;
  /** A redemption written down by an earlier page (the reload / relaunch /
   *  hand-off case), and whether Apple already has it. */
  pending?: { uid: string; code: string };
  redeemed?: boolean;
};

async function open(o: OpenOpts = {}): Promise<Page> {
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
  await page.addInitScript((opts) => {
    const w = window as unknown as Record<string, unknown>;
    const opened: string[] = [];
    w.__opened = opened; w.__rc = []; w.__uid = "u1"; w.__redeemed = !!opts.redeemed; w.__rcHas = false;
    w.__purchased = false; w.__synced = 0;
    w.webkit = { messageHandlers: { bridge: {} } };
    w.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => "ios",
      Plugins: opts.plugin ? { ExternalPurchase: { open: async (a: { url: string }) => { opened.push(a.url); return { opened: true }; } } } : {},
    };
    if (opts.pending) localStorage.setItem("sc_apple_redeem", JSON.stringify({ ...opts.pending, at: Date.now() }));
    else localStorage.removeItem("sc_apple_redeem");
  }, { plugin: o.plugin !== false, pending: o.pending ?? null, redeemed: o.redeemed ?? false });
  await page.goto(`${ORIGIN}/`);
  await page.evaluate((builder) => (window as unknown as { mount: (o: { builder?: boolean }) => void }).mount({ builder }), !!o.builder);
  await page.locator("button", { hasText: /^Try Pro free for \d+ days →$/ }).first().waitFor({ timeout: 15_000 });
  return page;
}

async function applyCode(page: Page) {
  await page.getByRole("button", { name: "Have a promo code?" }).click();
  await page.getByLabel("Promo code").fill("demisha");
  await page.getByRole("button", { name: "Apply" }).click();
  await page.getByRole("button", { name: "Try Pro free for two months →" }).waitFor({ timeout: 5_000 });
}

/** Apple redeems the code on its page; the person comes back to the app. */
async function comeBack(page: Page, o: { redeemed: boolean }) {
  await page.evaluate((redeemed) => {
    (window as unknown as { __redeemed: boolean }).__redeemed = redeemed;
    document.dispatchEvent(new Event("visibilitychange"));
  }, o.redeemed);
}

const get = <T,>(page: Page, key: string) => page.evaluate((k) => (window as unknown as Record<string, unknown>)[k], key) as Promise<T>;
const marker = (page: Page) => page.evaluate(() => localStorage.getItem("sc_apple_redeem"));
const purchased = (page: Page, timeout = 15_000) =>
  page.waitForFunction(() => (window as unknown as { __purchased: boolean }).__purchased === true, null, { timeout });

describe("a promo code in the iPhone app is redeemed through Apple", () => {
  it("opens Apple's code page with the code filled in, for the signed-in account, and writes it down first", async () => {
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
      // Remembered on the device, for whichever page they come back to.
      expect(JSON.parse((await marker(page)) ?? "{}")).toMatchObject({ uid: "u1", code: "DEMISHA" });
      await page.getByText("Finish on Apple's page, then come back here.").waitFor();
    } finally { await page.context().close(); }
  });

  it("coming back after redeeming hands the purchase to RevenueCat, switches Pro on and carries on", async () => {
    const page = await open();
    try {
      await applyCode(page);
      await page.getByRole("button", { name: "Try Pro free for two months →" }).click();
      await page.getByText("Finish on Apple's page, then come back here.").waitFor();
      await comeBack(page, { redeemed: true });
      // THE 2026-11-04 BUG: without syncPurchases RevenueCat never hears of
      // the redemption, and this never happens.
      await purchased(page);
      expect(await get<string[]>(page, "__rc")).toContain("syncPurchases");
      expect(await get<number>(page, "__synced")).toBeGreaterThan(0);
      expect(await marker(page)).toBeNull();
    } finally { await page.context().close(); }
  });

  it("Apple slower than the wait: it says so, and Check again finishes it", async () => {
    const page = await open();
    try {
      await applyCode(page);
      await page.getByRole("button", { name: "Try Pro free for two months →" }).click();
      await comeBack(page, { redeemed: false });
      await page.getByRole("button", { name: "Confirming with Apple…" }).waitFor({ timeout: 5_000 });
      await page.getByText("Apple hasn't confirmed it yet.").waitFor({ timeout: 45_000 });
      expect(await get<boolean>(page, "__purchased")).toBe(false);
      await page.getByRole("button", { name: "Restore Purchases" }).first().waitFor();
      // Apple's transaction lands; "Check again".
      await page.evaluate(() => { (window as unknown as { __redeemed: boolean }).__redeemed = true; });
      await page.getByRole("button", { name: "Check again" }).click();
      await purchased(page);
    } finally { await page.context().close(); }
  }, 90_000);

  it("Restore Purchases on the plan step connects an Apple subscription and carries on", async () => {
    // The owner's own account (2026-11-04): redeemed on Apple, never synced,
    // no code in the box any more. Restore posts the receipt for this account.
    const page = await open({ redeemed: true });
    try {
      await page.getByText("Already subscribed or redeemed a code?").waitFor();
      await page.getByRole("button", { name: "Restore Purchases" }).click();
      await purchased(page);
      expect(await get<string[]>(page, "__rc")).toContain("restore");
      expect(await get<number>(page, "__synced")).toBeGreaterThan(0);
    } finally { await page.context().close(); }
  });

  it("Restore Purchases with nothing on Apple says so, and nothing carries on", async () => {
    const page = await open({ redeemed: false });
    try {
      await page.getByRole("button", { name: "Restore Purchases" }).click();
      await page.getByText("No purchase was found for this Apple account.").waitFor({ timeout: 15_000 });
      expect(await get<boolean>(page, "__purchased")).toBe(false);
    } finally { await page.context().close(); }
  });

  it("a page that did not start the redemption finishes it by itself (reload, relaunch, the builder's hand-off)", async () => {
    const page = await open({ pending: { uid: "u1", code: "DEMISHA" }, redeemed: true });
    try {
      // No tap: the plan step finds what the earlier page wrote down.
      await purchased(page);
      expect(await get<string[]>(page, "__rc")).toContain("syncPurchases");
      expect(await marker(page)).toBeNull();
    } finally { await page.context().close(); }
  });

  it("another account's redemption on this device is not finished as this one", async () => {
    const page = await open({ pending: { uid: "someone-else", code: "DEMISHA" }, redeemed: true });
    try {
      await page.waitForTimeout(1_500);
      expect(await get<string[]>(page, "__rc")).not.toContain("syncPurchases");
      expect(await get<boolean>(page, "__purchased")).toBe(false);
      expect(await page.getByText("Finishing your offer from Apple").count()).toBe(0);
    } finally { await page.context().close(); }
  });

  it("the builder saves the card before Apple opens, then hands the plan step on (and does not check twice)", async () => {
    const page = await open({ builder: true });
    try {
      await applyCode(page);
      await page.getByRole("button", { name: "Try Pro free for two months →" }).click();
      await page.waitForFunction(() => (window as unknown as { __handoff?: boolean }).__handoff === true);
      expect(await get<string>(page, "__savedFor")).toBe("DEMISHA");
      expect(await get<string[]>(page, "__opened")).toHaveLength(1);
      // The page it hands to finishes the redemption from the marker; this one
      // must not also run a check when they come back.
      expect(JSON.parse((await marker(page)) ?? "{}")).toMatchObject({ uid: "u1", code: "DEMISHA" });
      await comeBack(page, { redeemed: true });
      await page.waitForTimeout(1_500);
      expect(await get<string[]>(page, "__rc")).not.toContain("syncPurchases");
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
      expect(await marker(page)).toBeNull();
    } finally { await page.context().close(); }
  });
});
