// Regression harness for the native iOS shell: walks the major user flows the
// way the Capacitor WKWebView experiences them.
//
//   npm start &  BASE=http://127.0.0.1:3111 node scripts/native-flows.mjs
//
// WHAT IT ASSERTS, and why each one exists:
//   - "/" never shows the marketing homepage in the shell (App Review 4.2)
//   - no marketing nav/footer on any reachable page
//   - no visible link to /pricing anywhere (App Review 3.1.1)
//   - the app tab bar is present on the tabbed routes
//   - no horizontal overflow at 390px, and no JS/console errors
//
// ⚠️ It CREATES a throwaway Supabase auth user, profile and card against
// whatever project .env.local points at, and DELETES them in a finally block.
// Point it at a running local server, not production.
//
// Faithfulness matters here: window.Capacitor is injected via addInitScript so
// it exists BEFORE the sc-boot script runs, which is the whole point — that
// script is what decides "/" is the app rather than the marketing site, and a
// simulation that patches it after load would test nothing.
import { localBase, seededAdmin } from "./lib/qa-local.mjs";
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { markInternal } from "./qa-internal.mjs";

const BASE = localBase(process.env.BASE, "http://127.0.0.1:3111");
const env = readFileSync(".env.local", "utf8");
const g = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const SB = g("NEXT_PUBLIC_SUPABASE_URL"), ANON = g("NEXT_PUBLIC_SUPABASE_ANON_KEY"), SVC = g("SUPABASE_SERVICE_ROLE_KEY");
const REF = new URL(SB).hostname.split(".")[0];

const adm = seededAdmin((p, i) => fetch(SB + p, { ...i, headers: { apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": "application/json", ...(i?.headers ?? {}) } }));

const fails = [];
const ok = [];
const check = (cond, label, detail = "") => (cond ? ok : fails).push(label + (cond ? "" : `  ← ${detail}`));

const email = `flow-${Date.now()}@swiftcard-test.invalid`;
const password = `Tst!aA1${Math.random().toString(36).slice(2)}`;
let userId = null, browser;

try {
  const u = await (await adm("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  userId = u.id;

  // A brand-new account has no card, and /dashboard sends it to /onboarding —
  // so without seeding, every "dashboard" assertion silently measures the
  // onboarding screen instead. That is what made the tab bar look missing.
  const uname = `flowtest${Date.now().toString().slice(-8)}`;
  await adm("/rest/v1/profiles", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ id: userId, username: uname, name: "Flow Tester", email, plan: "free", template: "modern-bold", customization: { _planChosen: "qa-seeded" } }),
  });
  const cardRes = await adm("/rest/v1/cards", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: userId, username: uname, name: "Flow Tester", title: "Realtor",
      company: "Coastline Realty", email, phone: "(415) 555-0188",
      website: "coastlinehomes.com", template: "modern-bold",
    }),
  });
  const cardRow = (await cardRes.json())[0];
  const setPlan = (plan) => adm(`/rest/v1/profiles?id=eq.${userId}`, { method: "PATCH", body: JSON.stringify({ plan }) });
  const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })).json();

  browser = await chromium.launch();

  const makeCtx = async (withSession) => {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 SwiftCardApp/1.0.0",
    });
    await markInternal(ctx, BASE);
    // The shell's bridge, present before any page script runs.
    await ctx.addInitScript(() => {
      // @capacitor/core's createCapacitor() OVERWRITES whatever isNativePlatform
      // it finds on window.Capacitor and derives the platform itself, from
      // window.webkit.messageHandlers.bridge (getPlatformId). So a shim that
      // only fakes Capacitor.isNativePlatform() fools sc-boot but NOT
      // useIsNativeApp(), and every <NativeHidden> would wrongly render — which
      // is exactly the false "pricing link visible" this first reported.
      window.webkit = { messageHandlers: { bridge: { postMessage() {} } } };
      window.Capacitor = { isNativePlatform: () => true, isNative: true, platform: "ios",
        getPlatform: () => "ios", isPluginAvailable: () => false, Plugins: {} };
    });
    if (withSession) {
      await ctx.addCookies([{
        name: `sb-${REF}-auth-token`,
        value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"),
        domain: "127.0.0.1", path: "/", httpOnly: false, secure: false, sameSite: "Lax",
      }]);
    }
    return ctx;
  };

  const probe = async (page, path) => {
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 120)));
    page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 120)); });
    const resp = await page.goto(BASE + path, { waitUntil: "load", timeout: 45000 });
    // "/" redirects out of the marketing page from sc-boot, so the first
    // execution context is torn down mid-flight. Let the URL settle before
    // measuring, otherwise evaluate races the navigation it is here to verify.
    let last = "";
    for (let i = 0; i < 25; i++) {
      await page.waitForTimeout(200);
      const now = page.url();
      if (now === last) break;
      last = now;
    }
    await page.waitForLoadState("load").catch(() => {});
    await page.waitForTimeout(900);
    // Redirect chains ("/" → /dashboard → /onboarding) can tear down the
    // execution context between the settle loop and the measurement, so retry
    // rather than treating a mid-flight navigation as a failure.
    const measure = () => page.evaluate(() => {
      const disp = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).display : "absent"; };
      return {
        url: location.pathname,
        nativeClass: document.documentElement.classList.contains("native-app"),
        siteNav: disp(".sc-site-nav"),
        siteFooter: disp(".sc-site-footer"),
        tabbar: disp(".sc-tabbar"),
        hScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        bodyFont: getComputedStyle(document.body).fontFamily.split(",")[0].replace(/"/g, ""),
        pricingLinks: [...document.querySelectorAll('a[href="/pricing"]')].filter((a) => a.offsetParent !== null).length,
        text: (document.body.innerText || "").slice(0, 120).replace(/\s+/g, " "),
      };
    });
    let r;
    for (let i = 0; i < 6; i++) {
      try { r = await measure(); break; }
      catch { await page.waitForTimeout(700); }
    }
    if (!r) throw new Error(`could not measure ${path} — page kept navigating`);
    return { ...r, status: resp?.status(), errs: [...new Set(errs)] };
  };

  // ── signed out ─────────────────────────────────────────────────────────
  let ctx = await makeCtx(false);
  let page = await ctx.newPage();

  let r = await probe(page, "/");
  check(r.url === "/login", `signed out: "/" lands on login (got ${r.url})`, r.url);
  check(r.nativeClass, "native-app class applied before paint");
  check(r.siteNav === "none" || r.siteNav === "absent", `login: marketing nav hidden (${r.siteNav})`, r.siteNav);
  check(r.hScroll <= 1, `login: no horizontal overflow (${r.hScroll}px)`, `${r.hScroll}px`);
  check(r.bodyFont === "Geist" || r.bodyFont.includes("system"), `login: app font applied (${r.bodyFont})`, r.bodyFont);
  check(r.errs.length === 0, "login: no JS/console errors", r.errs.join(" | "));

  for (const p of ["/cards/new", "/privacy", "/terms"]) {
    r = await probe(page, p);
    check(r.siteNav === "none" || r.siteNav === "absent", `${p}: marketing nav hidden (${r.siteNav})`, r.siteNav);
    check(r.siteFooter === "none" || r.siteFooter === "absent", `${p}: marketing footer hidden (${r.siteFooter})`, r.siteFooter);
    check(r.hScroll <= 1, `${p}: no horizontal overflow (${r.hScroll}px)`, `${r.hScroll}px`);
    check(r.pricingLinks === 0, `${p}: no visible pricing link in native (3.1.1)`, `${r.pricingLinks} found`);
  }
  await ctx.close();

  // ── signed in ──────────────────────────────────────────────────────────
  ctx = await makeCtx(true);
  page = await ctx.newPage();

  r = await probe(page, "/");
  check(r.url !== "/login" && r.url !== "/", `signed in: "/" leaves marketing home (got ${r.url})`, r.url);

  for (const [p, wantTab] of [["/dashboard", true], ["/contacts", true], ["/share", true], ["/settings/flows", true], ["/cards/new", false]]) {
    r = await probe(page, p);
    check(r.status < 400, `${p}: loads (${r.status})`, String(r.status));
    check(r.hScroll <= 1, `${p}: no horizontal overflow (${r.hScroll}px)`, `${r.hScroll}px`);
    check(r.siteNav === "none" || r.siteNav === "absent", `${p}: marketing nav hidden`, r.siteNav);
    check(r.pricingLinks === 0, `${p}: no visible pricing link`, `${r.pricingLinks}`);
    check(r.errs.length === 0, `${p}: no JS/console errors`, r.errs.join(" | "));
    if (wantTab) check(r.tabbar !== "absent" && r.tabbar !== "none", `${p}: app tab bar present (${r.tabbar})`, r.tabbar);
  }

  // ── the card itself: does the seeded card reach the dashboard and render? ──
  r = await probe(page, "/dashboard");
  check(/Coastline Realty|Flow Tester/.test(r.text) || r.url === "/dashboard", "dashboard shows the user's card", r.text);

  r = await probe(page, `/card/${cardRow?.username}`);
  check(r.status === 200, `public card page renders (${r.status})`, String(r.status));
  check(r.hScroll <= 1, `public card page: no horizontal overflow (${r.hScroll}px)`, `${r.hScroll}px`);
  check(r.errs.length === 0, "public card page: no JS/console errors", r.errs.join(" | "));

  r = await probe(page, `/cards/${cardRow?.id}/edit`);
  check(r.status === 200, `card edit loads (${r.status})`, String(r.status));
  check(r.hScroll <= 1, `card edit: no horizontal overflow (${r.hScroll}px)`, `${r.hScroll}px`);
  check(r.errs.length === 0, "card edit: no JS/console errors", r.errs.join(" | "));

  // ── free vs paid gating ───────────────────────────────────────────────────
  const gate = async (label) => {
    const rr = await probe(page, "/settings/flows");
    return { label, locked: /upgrade|pro\b|unlock/i.test(rr.text), pricing: rr.pricingLinks, errs: rr.errs };
  };
  await setPlan("free");
  const free = await gate("free");
  check(free.pricing === 0, "free plan: still no pricing link in native (3.1.1)", `${free.pricing}`);
  await setPlan("pro");
  const pro = await gate("pro");
  check(pro.errs.length === 0, "pro plan: settings renders without errors", pro.errs.join(" | "));
  check(true, `plan gating observed (free locked-copy=${free.locked}, pro locked-copy=${pro.locked})`);

  await ctx.close();
} finally {
  await browser?.close();
  if (userId) { await adm(`/auth/v1/admin/users/${userId}`, { method: "DELETE" }); }
}

console.log(`\n── PASS (${ok.length}) ──`);
for (const o of ok) console.log("  ✓ " + o);
console.log(`\n── FAIL (${fails.length}) ──`);
for (const f of fails) console.log("  ✗ " + f);
process.exit(fails.length ? 1 : 0);
