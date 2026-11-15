#!/usr/bin/env node
/**
 * End-to-end check of every In-App Purchase surface, as App Review sees them.
 *
 * Run against production (default) or a local server:
 *   node scripts/verify-iap.mjs [baseUrl]
 *
 * Every assertion here corresponds to something that was wrong when Apple
 * rejected 1.0.0 (10) under Guideline 3.1.1:
 *   - a Pro account whose billing panel claimed a subscription "billed by
 *     card, outside the App Store" when no subscription existed at all;
 *   - a first-run guest Pro card with a feature list and no way to buy;
 *   - purchase buttons that vanish entirely if StoreKit is momentarily
 *     unreachable, leaving locked features with no purchase path.
 *
 * Credentials are the App Store Connect demo accounts; set
 * IAP_REVIEW_PW in the environment (never committed: the repo is public).
 */
import { localBase } from "./lib/qa-local.mjs";
import { chromium } from "playwright";
import { markInternal } from "./qa-internal.mjs";

const BASE = localBase(process.argv[2]);
const PW = process.env.IAP_REVIEW_PW;
if (!PW) { console.error("Set IAP_REVIEW_PW (the App Review demo password) — it is never kept in the repo."); process.exit(1); }
const FREE = "applereview-free@swiftcard.me";
const PRO = "applereview@swiftcard.me";
// App Review's rejection notice names an "iPad Air 11-inch (M3)", but the
// target is TARGETED_DEVICE_FAMILY = 1 and the only screenshot set is
// APP_IPHONE_67 — this is an iPhone-only app, so on that iPad it runs in
// iPhone compatibility mode and lays out at iPhone size. PHONE is therefore
// the viewport the reviewer actually saw; the wide one is kept only as a
// safety net in case iPad support is ever turned on.
const PHONE = { width: 390, height: 844 };
const WIDE = { width: 820, height: 1180 };
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) SwiftCardApp";

const failures = [];
const check = (name, ok, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

const browser = await chromium.launch();

async function shell(viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, userAgent: UA });
  await markInternal(context, BASE);
  await context.addInitScript(() => {
    window.webkit = { messageHandlers: { bridge: { postMessage() {} } } };
    window.Capacitor = {
      isNativePlatform: () => true, getPlatform: () => "ios",
      Plugins: { SplashScreen: { hide() { return Promise.resolve(); } } },
    };
  });
  return context;
}

async function signIn(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PW);
  await page.click('button:has-text("Sign in →")');
  await page.waitForTimeout(4500);
  // A reset account meets the AI-consent gate first (5.1.1(i)); answer it.
  const consent = page.locator('[aria-labelledby="ai-consent-title"] button', { hasText: /allow/i }).first();
  if (await consent.count()) { await consent.click(); await page.waitForTimeout(2000); }
  return !page.url().includes("/login");
}

const billingPanel = async (page) => {
  await page.goto(`${BASE}/settings/flows`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  // Wide layouts turn the settings sections into tabs; at phone width they are
  // stacked sections that are already on the page. Click only if it is a tab.
  const tab = page.locator('button:has-text("Plan and billing")').first();
  if (await tab.count()) { await tab.click().catch(() => {}); await page.waitForTimeout(3000); }
  await page.waitForTimeout(1500);
  return page.evaluate(() => document.body.innerText);
};

console.log(`\nIn-App Purchase verification against ${BASE}\n`);

console.log("Free account — the purchase path App Review must find (iPhone layout)");
{
  const context = await shell(PHONE);
  const page = await context.newPage();
  check("demo credentials in App Store Connect still sign in", await signIn(page, FREE));

  const text = await billingPanel(page);
  check("Settings > Plan and billing shows the plan", /Your plan: Free/.test(text));
  check("and offers the In-App Purchase", /Upgrade to Pro/.test(text));

  await page.locator('button:has-text("Upgrade to Pro")').first().click();
  await page.waitForTimeout(2500);
  const sheet = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return d ? { text: d.innerText, links: [...d.querySelectorAll("a")].map((a) => a.getAttribute("href")) } : null;
  });
  check("the paywall opens", !!sheet);
  if (sheet) {
    // 3.1.2: an auto-renewable subscription paywall must carry all of these.
    check("paywall offers Restore Purchases", /Restore Purchases/.test(sheet.text));
    check("paywall links Terms of Use", sheet.links.includes("/terms"));
    check("paywall links Privacy Policy", sheet.links.includes("/privacy"));
    check("paywall states the auto-renewal terms", /renew automatically/i.test(sheet.text));
    // 3.1.2: never a price the App Store did not supply.
    const hardcoded = sheet.text.match(/\$\d/g);
    check("paywall invents no price of its own", !hardcoded, hardcoded ? `found ${hardcoded.join(", ")}` : "StoreKit only");
    // 3.1.1: no steering to the website from the purchase surface.
    check("paywall never steers to the website", !/swiftcard\.me|our website|cheaper/i.test(sheet.text));
  }
  await context.close();
}

console.log("\nPro account — the screen the rejection quoted (iPhone layout)");
{
  const context = await shell(PHONE);
  const page = await context.newPage();
  await signIn(page, PRO);
  const text = await billingPanel(page);
  check("shows the plan as Pro", /Your plan: Pro/.test(text));
  // The account is a manual grant: no Apple sub, no Stripe sub, no customer.
  // Claiming it was bought anywhere is both untrue and a recital of 3.1.1.
  check("makes no false claim of an outside purchase",
    !/outside the App Store/i.test(text), /outside the App Store/i.test(text) ? "still says 'outside the App Store'" : "says only that Pro is enabled");
  await context.close();
}

console.log("\nGates and entry points still sell (both layouts)");
for (const [label, viewport] of [["phone", PHONE], ["wide ", WIDE]]) {
  const context = await shell(viewport);
  const page = await context.newPage();
  await signIn(page, FREE);
  for (const path of ["/upgrade", "/dashboard"]) {
    await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    const has = await page.evaluate(() =>
      [...document.querySelectorAll("button")].some((b) => /upgrade to pro|start free/i.test(b.innerText)));
    check(`${label} ${path} offers the purchase`, has);
    // 3.1.1: the shell must never show a web price or a checkout link.
    const leak = await page.evaluate(() => {
      const t = document.body.innerText;
      return { price: /\$\d+(\.\d\d)?\s*\/\s*(mo|month|yr|year)/i.test(t), checkout: !!document.querySelector('a[href*="/checkout"]') };
    });
    check(`${label} ${path} shows no web price or checkout link`, !leak.price && !leak.checkout,
      leak.price ? "web price visible" : leak.checkout ? "checkout link present" : "clean");
  }
  await context.close();
}

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILING: ${failures.join("; ")}\n` : "\nAll In-App Purchase checks passed.\n");
process.exit(failures.length ? 1 : 0);
