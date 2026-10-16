import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build, type Plugin } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";

// ─────────────────────────────────────────────────────────────────────────────
// THE ANDROID APP SELLS NOTHING — every purchase surface, as Android shows it.
//
// Owner, 2026-10-08: the Android app shows no price, no trial and no button
// that buys; a Pro feature wears a plain "Pro" marker. Google Play has no
// StoreKit, there is no Play Billing product, and a link to a web checkout is
// what Play calls steering.
//
// Until then every one of these surfaces painted the iPhone's In-App Purchase
// path inside the Android app — "Get Pro →", "cancel anytime in your Apple
// account", and a sheet that said "Plans aren't available right now" with
// "Restore Purchases". A source scan can't see that: the branch that picks
// Apple is a runtime platform read. So each component is mounted for real,
// once as the Android shell and once as the iPhone shell, and what is on the
// screen is read. Android must show none of it; iPhone must still show its
// purchase path, or this test would pass by deleting the iOS one too.
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
  tmp = mkdtempSync(join(cache, "android-sells-"));
  // StoreKit's answer for a new Apple ID (US) — what the iPhone sees. Android
  // never asks: lib/iap returns no plugin there.
  writeFileSync(join(tmp, "iap-offer-stub.ts"), `
    export type IapOffer = any;
    export function useIapOffer() { return { status: "ready", monthly: "$4.99", annual: "$54.99", trial: true }; }
  `);
  writeFileSync(join(tmp, "supabase-stub.ts"), `
    export function createBrowserClient() {
      return { auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) } };
    }
  `);
  writeFileSync(join(tmp, "nav-stub.ts"), `
    export function useRouter() { return { push() {}, replace() {}, refresh() {}, back() {}, prefetch() {} }; }
    export const usePathname = () => "/dashboard";
    export const useSearchParams = () => new URLSearchParams();
  `);
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import PlanCards from "@/components/PlanCards";
    import IapSubscribeButton, { IapProPill, IapProLock } from "@/components/NativePaywall";
    import ProRequiredDialog from "@/components/ProRequiredDialog";
    import { SecondCardSheet } from "@/components/AddCardButton";
    import FreeDesignChoice from "@/components/FreeDesignChoice";
    import ProEndedPanel from "@/components/ProEndedPanel";
    import BillingManager from "@/components/BillingManager";
    import { PlanNotice } from "@/components/PlanGate";
    const noop = () => {};
    const SURFACES: Record<string, () => any> = {
      "plan-step": () => h(PlanCards, { onFree: () => ((window as any).__free = true), onPaid: noop, busy: null, trialEligible: true, freeLabel: "Continue with Free →" }),
      "gate": () => h("div", null, h(PlanNotice, { tier: "pro", copy: "Pro feature — Scanning business cards is only available on the Pro plan" }), h(IapSubscribeButton, {})),
      "pills": () => h("div", null, h(IapProPill, {}), h(IapProLock, {})),
      "pro-required": () => h(ProRequiredDialog, { features: ["Premium finish"], onSaveWithoutPro: noop, onCancel: noop, trialEligible: true }),
      "second-card": () => h(SecondCardSheet, { trialEligible: true, onClose: noop }),
      "free-design": () => h(FreeDesignChoice, { changes: ["Your colors go back to the template's"], onKeepWithTrial: noop, onContinueFree: noop, onIapPurchased: noop, trialEligible: true }),
      "pro-ended": () => h(ProEndedPanel, { wasTrial: true, cards: [{ id: "a", label: "Main" }, { id: "b", label: "Side" }], defaultLiveCardId: "a", designChanges: [] }),
      "billing": () => h(BillingManager, {}),
    };
    (window as any).mount = (name: string) => {
      createRoot(document.getElementById("root")!).render(
        h("main", { className: "sc-app min-h-screen bg-gray-950 px-5 py-8" }, h("div", { className: "max-w-6xl mx-auto" }, SURFACES[name]())),
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
    alias: { "@": resolve("src"), "next/navigation": join(tmp, "nav-stub.ts") },
    plugins: [stubs],
    loader: { ".svg": "text" },
    banner: { js: "var process = { env: { NODE_ENV: \"production\" } };" },
  });
  bundle = out.outputFiles[0].text;
}, 240_000);
afterAll(async () => { await browser?.close(); if (tmp) rmSync(tmp, { recursive: true, force: true }); });

type Shell = "android" | "ios";

/** The subscription the Billing panel reads, per case. */
const FREE_SUB = { plan: "free", planSource: null, hasStripeSubscription: false };

async function open(surface: string, shell: Shell, sub: object = FREE_SUB): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  // Playwright tries the LAST-registered route first: the catch-all goes on
  // before the specific one, or it answers the subscription read with {}.
  await page.route(`${ORIGIN}/api/**`, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route(`${ORIGIN}/api/stripe/subscription`, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sub) }));
  await page.route(`${ORIGIN}/`, (r) => r.fulfill({
    status: 200, contentType: "text/html",
    body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head>
           <body><div id="root"></div><script>${bundle}</script></body></html>`,
  }));
  await page.addInitScript((s) => {
    const w = window as unknown as Record<string, unknown>;
    // Exactly what each shell exposes before any page script runs:
    // @capacitor/core and lib/platform both read the bridge first.
    if (s === "android") w.androidBridge = { postMessage() {} };
    else w.webkit = { messageHandlers: { bridge: { postMessage() {} } } };
    w.Capacitor = { isNativePlatform: () => true, getPlatform: () => s, Plugins: {} };
  }, shell);
  await page.goto(`${ORIGIN}/`);
  await page.evaluate((n) => (window as unknown as { mount: (n: string) => void }).mount(n), surface);
  // Mount effects (platform read, the purchase status, the billing fetch).
  await page.waitForTimeout(700);
  return page;
}

// What the Android app must never show. Each is something that does not exist
// on that phone (Apple's account, the App Store) or something that sells.
const FORBIDDEN_ON_ANDROID = [
  /\$\s?\d/, /\/\s?month/i, /Get Pro/i, /Upgrade/i, /Keep Pro/i, /Try (Pro|it) free/i, /free trial/i, /days? free/i,
  /Restore Purchases/i, /Apple account/i, /App Store/i, /cancel anytime/i, /renews/i, /Billed by Apple/i,
];

const visibleText = (page: Page) => page.evaluate(() => document.body.innerText);
const buttons = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll("button, a[href]")]
    .filter((b) => (b as HTMLElement).offsetParent !== null)
    .map((b) => ((b as HTMLElement).innerText || b.getAttribute("aria-label") || "").trim()));

function expectNoSelling(text: string, where: string) {
  for (const re of FORBIDDEN_ON_ANDROID) expect(text, `${where}: ${re} is on screen in the Android app`).not.toMatch(re);
}

describe("the Android app sells nothing", () => {
  it("the plan step is Free alone — no Pro card, no tabs, no price — and its button settles Free", async () => {
    const page = await open("plan-step", "android");
    try {
      const text = await visibleText(page);
      expectNoSelling(text, "plan step");
      expect(text).toMatch(/Free/);
      const tabs = await page.locator("button[aria-pressed]").count();
      expect(tabs, "no Free / Pro tabs when there is only Free").toBe(0);
      await page.locator("button", { hasText: "Continue with Free →" }).click();
      expect(await page.evaluate(() => (window as unknown as { __free?: boolean }).__free)).toBe(true);
    } finally { await page.context().close(); }
  });

  it("a locked feature is a plain Pro notice with nothing to tap", async () => {
    const page = await open("gate", "android");
    try {
      expectNoSelling(await visibleText(page), "gate");
      expect(await visibleText(page)).toMatch(/Pro feature/);
      expect(await buttons(page), "the gate grew a button").toEqual([]);
    } finally { await page.context().close(); }
  });

  it("row-level PRO pills are static badges, not buttons", async () => {
    const page = await open("pills", "android");
    try {
      expectNoSelling(await visibleText(page), "pills");
      expect(await buttons(page)).toEqual([]);
    } finally { await page.context().close(); }
  });

  it("the Pro-design dialog names the features and saves without them — no trial, no price", async () => {
    const page = await open("pro-required", "android");
    try {
      const text = await visibleText(page);
      expectNoSelling(text, "pro-required");
      expect(text).toMatch(/Premium finish/);
      expect(text).toMatch(/isn.t sold in the Android app/);
      expect(await buttons(page)).toContain("Save without them");
    } finally { await page.context().close(); }
  });

  it("the second-card dialog explains, and only closes", async () => {
    const page = await open("second-card", "android");
    try {
      const text = await visibleText(page);
      expectNoSelling(text, "second-card");
      expect(text).toMatch(/More than one card is part of Pro/);
      const b = (await buttons(page)).filter(Boolean);
      expect(b.every((l) => /^(Not now|Close)$/.test(l)), `unexpected buttons: ${b.join(" | ")}`).toBe(true);
    } finally { await page.context().close(); }
  });

  it("'Your card uses Pro design' offers Free as the way on, with no Apple trial", async () => {
    const page = await open("free-design", "android");
    try {
      const text = await visibleText(page);
      expectNoSelling(text, "free-design");
      expect(await buttons(page)).toEqual(["Continue with Free and redesign using free features only"]);
    } finally { await page.context().close(); }
  });

  it("'Your Pro trial has ended' has no Keep Pro", async () => {
    const page = await open("pro-ended", "android");
    try {
      const text = await visibleText(page);
      expectNoSelling(text, "pro-ended");
      expect(await buttons(page)).toEqual(["Continue on Free"]);
    } finally { await page.context().close(); }
  });

  it("Billing on Free says Free, and nothing buys or manages", async () => {
    const page = await open("billing", "android");
    try {
      const text = await visibleText(page);
      expectNoSelling(text, "billing free");
      expect(text).toMatch(/You.re on the Free plan/);
      expect(await buttons(page)).toEqual([]);
    } finally { await page.context().close(); }
  });

  it("Billing for a subscription bought on an iPhone says where it lives, with no dead button", async () => {
    const page = await open("billing", "android", { plan: "pro", planSource: "apple", hasStripeSubscription: false });
    try {
      const text = await visibleText(page);
      expect(text).toMatch(/bought on an iPhone or iPad/);
      expect(text).not.toMatch(/Apple account/);
      expect(await buttons(page), "Manage subscription does nothing on Android").toEqual([]);
    } finally { await page.context().close(); }
  });
});

describe("…and the iPhone app still sells, exactly as before", () => {
  it("the plan step still has the Pro card and its purchase button", async () => {
    const page = await open("plan-step", "ios");
    try {
      await page.locator("button", { hasText: /^(Try Pro free for \d+ days →|Get Pro →)$/ }).first().waitFor({ state: "attached", timeout: 15_000 });
      expect(await visibleText(page)).toMatch(/Apple account/);
    } finally { await page.context().close(); }
  });

  it("a locked feature still carries the Apple purchase button", async () => {
    const page = await open("gate", "ios");
    try {
      // PlanNotice carries its own purchase button, and the gate mounts one more.
      await page.locator("button", { hasText: "Upgrade to Pro" }).first().waitFor({ state: "attached", timeout: 15_000 });
    } finally { await page.context().close(); }
  });

  it("'Your Pro trial has ended' still offers Keep Pro", async () => {
    const page = await open("pro-ended", "ios");
    try {
      await page.locator("button", { hasText: "Keep Pro" }).waitFor({ state: "attached", timeout: 15_000 });
    } finally { await page.context().close(); }
  });
});
