// node scripts/qa-android-shell.mjs   env: BASE=<url>  OUT=<dir>  DEVICES=pixel-8,small-360  ONLY=logged-out|free|pro  BUILD=1|2
//
// Every screen of the ANDROID app, the way the Android app shows it.
//
// The Android app is the live site inside a WebView, so the site decides what
// an Android user sees — and until 2026-10-08 nothing ever looked at the site
// AS the Android app. Every shell harness here (native-flows, qa-office-shell,
// verify-splash) pretends to be an iPhone. This one pretends to be the Android
// shell exactly (scripts/lib/android-shell.mjs) and fails on what an Android
// user must never meet:
//
//   · a control under the status bar or the navigation bar, on a screen or in
//     an open sheet (measured, with Android's insets, not iOS's);
//   · Apple wording — "Apple account", "App Store", "iPhone Settings", "Save
//     to Photos" — for things that do not exist on the phone in their hand;
//   · anything that sells: a price, "Get Pro", "Upgrade", a trial. The Android
//     app sells nothing (owner, 2026-10-08; Play payments policy);
//   · JS errors, 4xx/5xx, horizontal overflow;
//   · the back key doing the wrong thing (it is a real key on Android);
//   · a new-tab link opening inside the app instead of in the browser;
//   · the splash never told to hide, the status-bar icons never told the theme.
//
// Signed-in screens need SUPABASE_SERVICE_ROLE_KEY to seed throwaway Free and
// Pro accounts (CI has it; a laptop usually does not, and then only the
// signed-out part runs). Everything seeded is deleted in the finally block.
import { chromium } from "playwright";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { newAndroidContext, nativeCalls, pressBack, ANDROID_DEVICES, ANDROID_AUDIT, NOT_ON_ANDROID, SELLING } from "./lib/android-shell.mjs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1").replace(/\/$/, "");
const BASE = (process.env.BASE || "https://swiftcard.me").replace(/\/$/, "");
const OUT = process.env.OUT || "qa-out/android-shell";
mkdirSync(OUT, { recursive: true });
// Secrets: the environment first (GitHub Actions), .env.local second (a laptop).
const env = existsSync(`${ROOT}/.env.local`) ? readFileSync(`${ROOT}/.env.local`, "utf8") : "";
const g = (k) => process.env[k] ?? process.env[k.replace(/^NEXT_PUBLIC_/, "")] ?? (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const SB = g("NEXT_PUBLIC_SUPABASE_URL"), SVC = g("SUPABASE_SERVICE_ROLE_KEY");
const adm = (p, i) => fetch(SB + p, { ...i, headers: { apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": "application/json", ...(i?.headers ?? {}) } });

const DEVICES = (process.env.DEVICES || "pixel-8,small-360").split(",").map((s) => s.trim()).filter(Boolean);
const ONLY = process.env.ONLY || "";
const BUILD = Number(process.env.BUILD || 1);
const stamp = Date.now().toString().slice(-8);
const password = `Qa!aA1${stamp}x`;
const users = [];
const issues = [];
const note = (screen, kind, detail) => { issues.push({ screen, kind, detail }); console.log(`  ! ${screen}: ${kind} — ${detail}`); };
let browser;

async function makeUser(email, name, uname, plan) {
  const u = await (await adm("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  if (!u.id) throw new Error("no user id: " + JSON.stringify(u).slice(0, 160));
  users.push(u.id);
  await adm("/rest/v1/profiles", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ id: u.id, username: uname, name, email, plan, customization: { _aiConsent: "accepted", _planChosen: "qa-seeded" } }) });
  await adm("/rest/v1/cards", { method: "POST", body: JSON.stringify({
    user_id: u.id, username: uname, name, title: "Senior Client Partner", company: "Northbeam Commercial Real Estate",
    email, phone: "(415) 555-0192", template: "modern-bold",
  }) });
  return u.id;
}

function wire(page, ref) {
  page.on("pageerror", (e) => note(ref.name, "js-error", e.message.split("\n")[0].slice(0, 160)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/Failed to load resource|GSI_LOGGER|FedCM|accounts\.google\.com/i.test(t)) return;
    if (/aborted|AbortError|Failed to fetch/i.test(t) && ref.name === "unknown") return;
    note(ref.name, "console-error", t.split("\n")[0].slice(0, 160));
  });
  page.on("response", (r) => {
    const u = r.url();
    if (!u.startsWith(BASE) || r.status() < 400 || r.status() === 401 || r.status() === 403) return;
    note(ref.name, "http-" + r.status(), `${r.request().method()} ${u.replace(BASE, "")}`);
  });
}

async function audit(page, ref, d, name, { scrollBottom = true } = {}) {
  ref.name = name;
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(700);
  await page.evaluate(() => window.scrollTo(0, 0));
  const args = { TOP: d.top, BOTTOM: d.bottom, notOnAndroid: NOT_ON_ANDROID.map((r) => ({ source: r.source, flags: r.flags })), selling: SELLING.map((r) => ({ source: r.source, flags: r.flags })) };
  let found = await page.evaluate(ANDROID_AUDIT, args);
  await page.screenshot({ path: `${OUT}/${name}-top.png` }).catch(() => {});
  if (scrollBottom) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(450);
    const more = await page.evaluate(ANDROID_AUDIT, args);
    found = found.concat(more.filter((m) => !found.some((f) => f[0] === m[0] && f[1] === m[1])));
    await page.screenshot({ path: `${OUT}/${name}-bottom.png` }).catch(() => {});
  }
  console.log(`  ${name} (${page.url().replace(BASE, "")}): ${found.length ? found.length + " finding(s)" : "clean"}`);
  for (const [kind, detail] of found) note(name, kind, detail);
  return found;
}

async function visit(page, ref, d, name, path, opts) {
  ref.name = name;
  const res = await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => { note(name, "navigation-failed", `${path} — ${e.message.split("\n")[0]}`); return null; });
  if (res && res.status() >= 400) note(name, "page-http-" + res.status(), path);
  await page.waitForTimeout(900);
  return audit(page, ref, d, name, opts);
}

async function dismiss(page) {
  for (const label of ["Allow", "Not now", "Skip tour", "Skip", "Got it", "Maybe later", "Done"]) {
    const b = page.locator(`button:has-text("${label}")`).first();
    if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await page.waitForTimeout(350); }
  }
}

// The status-bar icons must follow the APP's theme, not the phone's: dark
// icons on a light screen, light icons on a dark one.
async function checkStatusBar(page, name) {
  const dark = await page.evaluate(() => document.documentElement.classList.contains("dark") || document.documentElement.dataset.theme === "dark");
  const calls = (await nativeCalls(page, "SystemBars")).filter((c) => c.method === "setStyle");
  const last = calls.at(-1)?.options?.style;
  const want = dark ? "DARK" : "LIGHT";
  if (!last) note(name, "status-bar-style-unset", `the app never set the status-bar style (theme is ${dark ? "dark" : "light"}), so Android uses the PHONE's dark mode`);
  else if (String(last).toUpperCase() !== want) note(name, "status-bar-style-wrong", `set ${last}, theme is ${dark ? "dark" : "light"} (want ${want})`);
}

async function checkSplash(page, name) {
  const hides = (await nativeCalls(page, "SplashScreen")).filter((c) => c.method === "hide");
  if (!hides.length) note(name, "splash-never-hidden", "nothing called SplashScreen.hide() — the launch screen would sit for its 15 s failsafe");
}

async function signedOut(d, devName) {
  const { ctx } = await newAndroidContext(browser, { base: BASE, device: devName, build: BUILD });
  const page = await ctx.newPage();
  const ref = { name: "unknown" };
  wire(page, ref);
  const tag = `${devName}-out`;

  // Cold open: the shell starts at /dashboard; signed out, that must become
  // the app's sign-in screen — never the marketing site.
  await visit(page, ref, d, `${tag}-cold-open`, "/dashboard");
  const landed = new URL(page.url()).pathname;
  if (landed !== "/login") note(`${tag}-cold-open`, "wrong-landing", `signed-out cold open landed on ${landed}, expected /login`);
  await checkSplash(page, `${tag}-cold-open`);
  await checkStatusBar(page, `${tag}-cold-open`);

  // A fresh install has no sc_shell cookie and starts wherever server.url says;
  // "/" must still be the app, not the homepage.
  await visit(page, ref, d, `${tag}-root`, "/");
  if (new URL(page.url()).pathname === "/" ) note(`${tag}-root`, "marketing-in-app", "/ rendered the marketing homepage inside the app");

  await visit(page, ref, d, `${tag}-get-started`, "/cards/new");
  for (const [name, path] of [["pricing", "/pricing"], ["download", "/download"]]) {
    await visit(page, ref, d, `${tag}-${name}`, path, { scrollBottom: false });
    if (new URL(page.url()).pathname === path) note(`${tag}-${name}`, "store-page-in-app", `${path} is reachable inside the app`);
  }
  await ctx.close();
}

async function signedIn(d, devName, plan, { savedTheme = null, phoneDark = false } = {}) {
  const variant = savedTheme ? `-${savedTheme}` : phoneDark ? "-phonedark" : "";
  const tag = `${devName}-${plan}${variant}`;
  const email = `qa-and-${plan}-${stamp}-${users.length}@swiftcard-test.invalid`;
  const uname = `qa-and-${plan}-${stamp}-${users.length}`;
  await makeUser(email, plan === "pro" ? "Priya Raman" : "Sam Cole", uname, plan);
  const { ctx } = await newAndroidContext(browser, { base: BASE, device: devName, build: BUILD, savedTheme, phoneDark });
  const page = await ctx.newPage();
  const ref = { name: "unknown" };
  wire(page, ref);

  ref.name = `${tag}-login`;
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#auth-email", email);
  await page.fill("#auth-password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard|onboarding|welcome/, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(2500);
  if (await page.locator("#auth-email").isVisible().catch(() => false)) { note(`${tag}-login`, "login-failed", `${email} still on ${page.url().replace(BASE, "")}`); await ctx.close(); return; }
  await dismiss(page);

  for (const [name, path] of [["dashboard", "/dashboard"], ["contacts", "/contacts"], ["share", "/share"], ["share-signature", "/share#signature"],
    ["settings", "/settings"], ["settings-flows", "/settings/flows"], ["profile", "/profile"], ["profile-card", "/profile/card"],
    ["upgrade", "/upgrade"], ["welcome", "/welcome"]]) {
    await visit(page, ref, d, `${tag}-${name}`, path);
    await dismiss(page);
  }
  await checkStatusBar(page, `${tag}-settings`);

  // Back key: from the dashboard's root the app must go to the background
  // (minimizeApp), never exit, never navigate to a blank or a sign-in page.
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500); await dismiss(page);
  await page.goto(`${BASE}/contacts`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000); await dismiss(page);
  const before = new URL(page.url()).pathname;
  const got = await pressBack(page);
  await page.waitForTimeout(1500);
  if (!got) note(`${tag}-back`, "back-unhandled", "no backButton listener — Capacitor would only call webView.goBack()");
  const after = new URL(page.url()).pathname;
  if (before === after) note(`${tag}-back`, "back-did-nothing", `back on ${before} stayed on ${after}`);
  if (after === "/login") note(`${tag}-back`, "back-to-login", `back from ${before} landed on /login while signed in`);

  // Back closes an open sheet before it navigates anywhere.
  const bell = page.locator('button[aria-label*="otification" i]').first();
  if (await bell.isVisible().catch(() => false)) {
    await bell.click(); await page.waitForTimeout(900);
    ref.name = `${tag}-bell`;
    await audit(page, ref, d, `${tag}-bell`, { scrollBottom: false });
    const url0 = page.url();
    await pressBack(page); await page.waitForTimeout(900);
    const stillOpen = await page.locator("[role='dialog']:visible, [aria-modal='true']:visible").count();
    if (page.url() !== url0) note(`${tag}-bell`, "back-navigated-from-sheet", `back with the bell open went to ${page.url().replace(BASE, "")}`);
    else if (stillOpen) note(`${tag}-bell`, "back-ignored-by-sheet", "back with the bell open left it open");
  }

  // New-tab links ("View live", "Open Swift Links") must leave for the
  // browser, as they do on iPhone — not load inside the app.
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500); await dismiss(page);
  const live = page.locator('a[target="_blank"]').filter({ hasText: /view live|open swift links|live link/i }).first();
  if (await live.isVisible().catch(() => false)) {
    const href = await live.getAttribute("href");
    const n0 = (await nativeCalls(page, "ExternalPurchase")).length;
    await live.click().catch(() => {});
    await page.waitForTimeout(2500);
    const opened = (await nativeCalls(page, "ExternalPurchase")).slice(n0).filter((c) => c.method === "open");
    if (!opened.length) note(`${tag}-view-live`, "new-tab-stays-in-app", `"${href}" was not handed to the browser`);
    if (new URL(page.url()).pathname !== "/dashboard") note(`${tag}-view-live`, "new-tab-navigated-app", `the app itself went to ${page.url().replace(BASE, "")}`);
  } else note(`${tag}-view-live`, "missing", "no View live link on the dashboard");

  await ctx.close();
}

try {
  browser = await chromium.launch();
  for (const devName of DEVICES) {
    const d = ANDROID_DEVICES[devName];
    if (!d) { note("harness", "unknown-device", devName); continue; }
    if (!ONLY || ONLY === "logged-out") { console.log(`\nSIGNED OUT · ${devName}`); await signedOut(d, devName); }
    if (!SVC) { if (!ONLY || ONLY !== "logged-out") console.log("  (no SUPABASE_SERVICE_ROLE_KEY — signed-in screens skipped)"); continue; }
    for (const plan of ["free", "pro"]) {
      if (ONLY && ONLY !== plan) continue;
      console.log(`\n${plan.toUpperCase()} · ${devName}`);
      await signedIn(d, devName, plan);
    }
  }
  // Theme states on one device: the app's saved dark theme, and the PHONE in
  // dark mode with the app's default light theme.
  if (SVC && (!ONLY || ONLY === "free")) {
    const devName = DEVICES[0];
    console.log(`\nTHEMES · ${devName}`);
    await signedIn(ANDROID_DEVICES[devName], devName, "free", { savedTheme: "dark" });
    await signedIn(ANDROID_DEVICES[devName], devName, "free", { phoneDark: true });
  }
} catch (e) {
  console.error("FAILED:", e.stack?.split("\n").slice(0, 4).join(" | "));
  note("harness", "crashed", e.message.split("\n")[0]);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (users.length) {
    console.log("\ncleaning up…");
    try {
      for (const id of users) {
        const prof = await (await adm(`/rest/v1/profiles?id=eq.${id}&select=username`)).json().catch(() => []);
        const un = prof?.[0]?.username;
        if (un) {
          await adm(`/rest/v1/card_views?username=in.(${un},${un}__links)`, { method: "DELETE" });
          await adm(`/rest/v1/card_events?username=in.(${un},${un}__links)`, { method: "DELETE" });
          await adm(`/rest/v1/leads?card_owner=eq.${un}`, { method: "DELETE" });
        }
        await adm(`/rest/v1/notifications?user_id=eq.${id}`, { method: "DELETE" });
        await adm(`/rest/v1/cards?user_id=eq.${id}`, { method: "DELETE" });
        await adm(`/rest/v1/profiles?id=eq.${id}`, { method: "DELETE" });
        await adm(`/auth/v1/admin/users/${id}`, { method: "DELETE" });
      }
      console.log("  removed", users.length, "user(s)");
    } catch (e) {
      console.error("  CLEANUP FAILED — remove manually:", users, e.message);
    }
  }
  writeFileSync(`${OUT}/issues.json`, JSON.stringify(issues, null, 2));
  const byKind = issues.reduce((m, i) => ((m[i.kind] = (m[i.kind] || 0) + 1), m), {});
  console.log(`\n${issues.length} finding(s) → ${OUT}/issues.json`);
  console.log(Object.entries(byKind).sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${n}× ${k}`).join("\n"));
}
