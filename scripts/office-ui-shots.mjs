// Reproduce the Office admin console on a real phone viewport, in the shell.
//
//   node scripts/office-ui-shots.mjs
//
// Seeds a throwaway office with an owner and two members, signs in as the
// owner, and captures the team page plus the member drawer at 390×844 with the
// iPhone safe-area insets simulated — which is the whole point: a `fixed
// inset-0` overlay opens flush with the PHYSICAL top of the screen under
// viewport-fit=cover, so anything in its first ~59px sits under the clock and
// the Dynamic Island. Deletes everything in a finally block.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { markInternal } from "./qa-internal.mjs";

const OUT = process.env.OUT || "app-store/screenshots/_officeui";
const BASE = process.env.BASE || "https://swiftcard.me";
mkdirSync(OUT, { recursive: true });

const env = readFileSync(".env.local", "utf8");
const g = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const SB = g("NEXT_PUBLIC_SUPABASE_URL"), SVC = g("SUPABASE_SERVICE_ROLE_KEY");
const adm = (p, i) => fetch(SB + p, {
  ...i,
  headers: { apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": "application/json", ...(i?.headers ?? {}) },
});

const stamp = Date.now().toString().slice(-8);
const ownerEmail = `officeui-${stamp}@swiftcard-test.invalid`;
const password = `Ui!aA1${stamp}`;
const users = [];
let officeId = null, browser;

async function makeUser(email, name, uname, plan) {
  const u = await (await adm("/auth/v1/admin/users", {
    method: "POST", body: JSON.stringify({ email, password, email_confirm: true }),
  })).json();
  if (!u.id) throw new Error("no user id: " + JSON.stringify(u).slice(0, 160));
  users.push(u.id);
  await adm("/rest/v1/profiles", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ id: u.id, username: uname, name, email, plan, customization: { _aiConsent: "accepted" } }),
  });
  await adm("/rest/v1/cards", {
    method: "POST",
    body: JSON.stringify({
      user_id: u.id, username: uname, name,
      // Long enough to expose truncation: a real company name and a long email
      // are exactly what overflowed.
      title: "Senior Client Partner, Enterprise Accounts",
      company: "Northbeam Commercial Real Estate Group",
      email, phone: "(415) 555-0192", template: "modern-bold",
    }),
  });
  return u.id;
}

try {
  const ownerId = await makeUser(ownerEmail, "Alex Rivera", `ui-owner-${stamp}`, "enterprise");
  const office = await (await adm("/rest/v1/offices", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ name: "Northbeam Commercial Real Estate Group", owner_id: ownerId, seats: 2 }),
  })).json();
  officeId = office?.[0]?.id;
  if (!officeId) throw new Error("no office: " + JSON.stringify(office).slice(0, 200));

  await adm("/rest/v1/office_members", {
    method: "POST",
    body: JSON.stringify({ office_id: officeId, user_id: ownerId, role: "owner", status: "active", joined_at: new Date().toISOString() }),
  });

  for (const [n, i] of [["Priyanka Balasubramanian", 1], ["Christopher Fairweather", 2]]) {
    const id = await makeUser(`officeui-${stamp}-m${i}@swiftcard-test.invalid`, n, `ui-m${i}-${stamp}`, "enterprise");
    await adm("/rest/v1/office_members", {
      method: "POST",
      body: JSON.stringify({ office_id: officeId, user_id: id, role: "employee", status: "active", joined_at: new Date().toISOString() }),
    });
  }
  console.log("seeded office", officeId);

  browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  });
  await markInternal(ctx, BASE);
  // The shell shim, before first paint (same as scripts/native-flows.mjs).
  await ctx.addInitScript(() => {
    window.webkit = { messageHandlers: { bridge: { postMessage() {} } } };
    window.Capacitor = {
      isNativePlatform: () => true, isNative: true, platform: "ios",
      getPlatform: () => "ios", isPluginAvailable: () => false, Plugins: {},
    };
  });
  // Only a visual marker for the screenshots. The INSETS themselves come from
  // CDP below — a stand-in stylesheet would only prove the stand-in works.
  await ctx.addInitScript(() => {
    const css = `body::before{content:"";position:fixed;top:0;left:0;right:0;
        height:env(safe-area-inset-top);z-index:2147483647;pointer-events:none;
        background:repeating-linear-gradient(45deg,rgba(255,0,0,.38) 0 8px,rgba(255,0,0,.14) 8px 16px);}`;
    const add = () => { const el = document.createElement("style"); el.textContent = css; document.head.appendChild(el); };
    if (document.head) add(); else document.addEventListener("DOMContentLoaded", add);
  });

  const page = await ctx.newPage();

  // THE REAL THING: Chromium can emulate the notch. Without this env() resolves
  // to 0 here, every safe-area rule silently evaluates to "no padding", and the
  // probe cheerfully passes a layout that is broken on the device.
  const cdp = await ctx.newCDPSession(page);
  const INSET_TOP = 59, INSET_BOTTOM = 34; // iPhone 15/16 portrait
  await cdp.send("Emulation.setSafeAreaInsetsOverride", {
    insets: { top: INSET_TOP, bottom: INSET_BOTTOM, left: 0, right: 0 },
  }).catch((e) => console.log("  ! safe-area emulation unavailable:", e.message.split("\n")[0]));

  // Simulate the iPhone 15/16 safe-area insets. WebKit resolves env() natively
  // from the real device; a desktop Chromium reports 0, which is exactly why
  // this bug is invisible in a browser and obvious on a phone.
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', ownerEmail);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Sign in →")');
  await page.waitForURL(/dashboard|onboarding|welcome/, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(3000);

  await page.goto(`${BASE}/office/admin/team`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  // A first-run guided tour covers the console and swallows the click.
  for (const label of ["Skip tour", "Skip", "Got it", "Close"]) {
    const b = page.locator(`button:has-text("${label}")`).first();
    if (await b.count().catch(() => 0)) { await b.click().catch(() => {}); await page.waitForTimeout(900); break; }
  }
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/1-team-list.png` });
  console.log("  captured team list");

  // Open the member drawer — the reported problem.
  const manage = page.locator('button:has-text("Manage")').first();
  if (await manage.count().catch(() => 0)) {
    await manage.click().catch(() => {});
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `${OUT}/2-member-drawer.png` });
    console.log("  captured member drawer");

    // Is the close button actually reachable, or is it under the status bar?
    const box = await page.locator('button[aria-label="Close"]').first().boundingBox().catch(() => null);
    console.log("  close button box:", JSON.stringify(box));
    if (box) console.log(box.y < INSET_TOP
      ? `  ✗ CLOSE BUTTON IS UNDER THE STATUS BAR (y=${box.y}, inset=${INSET_TOP})`
      : `  ✓ close button clears the status bar (y=${box.y} ≥ ${INSET_TOP})`);
    const envTop = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--x") ||
      (() => { const d = document.createElement("div"); d.style.paddingTop = "env(safe-area-inset-top)";
               document.body.appendChild(d); const v = getComputedStyle(d).paddingTop; d.remove(); return v; })());
    console.log("  env(safe-area-inset-top) resolves to:", envTop);

    const doc = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    console.log("  horizontal overflow:", doc.scrollW > doc.clientW ? `✗ ${doc.scrollW} > ${doc.clientW}` : "✓ none");
    // The QR sheet is centred, but it got the same insets — check it is whole.
    const qr = page.locator('button:has-text("Show QR code")').first();
    if (await qr.count().catch(() => 0)) {
      await qr.click().catch(() => {});
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${OUT}/3-qr-sheet.png` });
      const sheet = await page.locator('[role="dialog"][aria-label^="QR code"]').first().boundingBox().catch(() => null);
      console.log("  qr sheet box:", JSON.stringify(sheet));
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(600);
    } else {
      console.log("  ! no QR button (member has no card)");
    }

    // Bottom: can the last thing on the page clear the floating tab bar?
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(600);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(900);
    const bottom = await page.evaluate(() => {
      const bar = document.querySelector(".sc-tabbar");
      const barTop = bar ? bar.getBoundingClientRect().top : window.innerHeight;
      const main = document.querySelector("main");
      const lastKid = main?.lastElementChild?.getBoundingClientRect().bottom ?? 0;
      return { barTop: Math.round(barTop), lastContentBottom: Math.round(lastKid), viewport: window.innerHeight };
    });
    console.log("  bottom:", JSON.stringify(bottom),
      bottom.lastContentBottom <= bottom.barTop ? "✓ last content clears the tab bar" : "✗ content hidden behind the tab bar");
  } else {
    console.log("  ! no Manage button found");
  }
} catch (e) {
  console.error("FAILED:", e.message);
} finally {
  if (browser) await browser.close().catch(() => {});
  try {
    if (officeId) {
      // Unlink profiles first: profiles.office_id has no cascade, so deleting
      // the office while a profile points at it is refused (see qa-office-shell).
      await adm(`/rest/v1/profiles?office_id=eq.${officeId}`, { method: "PATCH", body: JSON.stringify({ office_id: null }) });
      await adm(`/rest/v1/office_members?office_id=eq.${officeId}`, { method: "DELETE" });
      const del = await adm(`/rest/v1/offices?id=eq.${officeId}`, { method: "DELETE" });
      if (!del.ok) console.error(`  OFFICE NOT DELETED (${del.status}) — remove manually: ${officeId}`);
    }
    for (const id of users) {
      await adm(`/rest/v1/cards?user_id=eq.${id}`, { method: "DELETE" });
      await adm(`/rest/v1/profiles?id=eq.${id}`, { method: "DELETE" });
      await adm(`/auth/v1/admin/users/${id}`, { method: "DELETE" });
    }
    console.log("cleaned up", users.length, "users");
  } catch (e) { console.error("CLEANUP FAILED:", e.message, users); }
}
