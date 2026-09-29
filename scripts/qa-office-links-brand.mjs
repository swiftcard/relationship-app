// node scripts/qa-office-links-brand.mjs     env: BASE=<url>  OUT=<dir>  KEEP=1
//
// The Swift Links half of office branding, driven end to end against a real
// build and a real database — the part no unit or render test can reach.
//
// Render tests measure the COMPONENT. This exercises the FEATURE: an admin sets
// a Links brand, saves, reloads, and a real teammate's real Swift Links page
// changes. It asks the questions that only a live round trip answers:
//
//   • does "Applied ✓" actually mean it was written?
//   • does it survive a reload, or only look right until you refresh?
//   • does the teammate see the office's bio, Instagram and pinned links?
//   • can the teammate still add their OWN links on top? (the owner's rule)
//   • can a crafted request strip the office's links back out? (it must not)
//   • does the page hold together at a phone width, and inside the iOS shell?
//
// Seeds its own office, owner and teammate; deletes all of it in a finally.
// Never touches an account it did not create. Exits non-zero on any failure.
import { chromium } from "playwright";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { markInternal } from "./qa-internal.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const BASE = process.env.BASE || "http://localhost:3222";
const OUT = process.env.OUT || "qa-office-links-out";
mkdirSync(OUT, { recursive: true });

// Secrets: the environment first (GitHub Actions), .env.local second (a laptop).
// NEXT_PUBLIC_* also answers to its bare name, which is how the CI secrets are named.
const env = existsSync(`${ROOT}/.env.local`) ? readFileSync(`${ROOT}/.env.local`, "utf8") : "";
const g = (k) => process.env[k] ?? process.env[k.replace(/^NEXT_PUBLIC_/, "")] ?? (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const SB = g("NEXT_PUBLIC_SUPABASE_URL"), SVC = g("SUPABASE_SERVICE_ROLE_KEY");
const adm = (p, i) => fetch(SB + p, { ...i, headers: { apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": "application/json", ...(i?.headers ?? {}) } });

const stamp = Date.now().toString().slice(-8);
const password = `Qa!aA1${stamp}x`;
const admin = { email: `qa-oli-adm-${stamp}@swiftcard-test.invalid`, uname: `qa-oli-adm-${stamp}`, id: null, cardId: null };
const member = { email: `qa-oli-mem-${stamp}@swiftcard-test.invalid`, uname: `qa-oli-mem-${stamp}`, id: null, cardId: null };
let officeId = null, browser;

const failures = [];
const fail = (step, detail) => { failures.push({ step, detail }); console.log(`  ✗ ${step}: ${detail}`); };
const pass = (step, detail = "") => console.log(`  ✓ ${step}${detail ? " — " + detail : ""}`);
const eq = (step, got, want) => (got === want ? pass(step) : fail(step, `expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`));

// What the admin will set. Deliberately distinctive so a stale value cannot
// masquerade as a fresh one.
const BRAND = {
  bio: `Northbeam Group — one team, one page (${stamp})`,
  instagram: `northbeam${stamp}`,
  linkLabel: `Book a viewing ${stamp}`,
  linkUrl: `https://northbeam-${stamp}.example.com/book`,
  sectionLabel: `Listings ${stamp}`,
};
const MEMBER_LINK = { label: `My calendar ${stamp}`, url: `https://cal-${stamp}.example.com/me` };
// What the teammate already had before any office brand existed. The office is
// allowed to take these slots on the page; it is not allowed to delete them.
const MEMBER_OWN = { bio: `Ben's own bio, written before any office brand (${stamp})`, instagram: `benpersonal${stamp}` };

async function seed() {
  for (const who of [admin, member]) {
    const u = await (await adm("/auth/v1/admin/users", {
      method: "POST", body: JSON.stringify({ email: who.email, password, email_confirm: true }),
    })).json();
    if (!u.id) throw new Error(`no user id for ${who.email}: ` + JSON.stringify(u).slice(0, 200));
    who.id = u.id;
    // "enterprise" IS the Office plan (office-admin-guard.ts:61).
    await adm("/rest/v1/profiles", {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({
        id: u.id, username: who.uname, email: who.email, plan: "enterprise",
        name: who === admin ? "Ada Rowe" : "Ben Iyer", customization: { _aiConsent: "accepted", _planChosen: "qa-seeded" },
      }),
    });
  }

  const o = await (await adm("/rest/v1/offices", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ owner_id: admin.id, name: "Northbeam Group", seats: 15 }),
  })).json();
  officeId = o?.[0]?.id;
  if (!officeId) throw new Error("no office: " + JSON.stringify(o).slice(0, 300));

  // profiles.office_id is the SECOND half of membership and it is not optional:
  // subCtx resolves the office from office_members, but getMemberBrandForUser
  // resolves it from profiles.office_id. Seed only the first and the teammate
  // is treated as a sub-user with NO brand — which looks exactly like the brand
  // locks failing. /api/join writes both, so a real member always has both.
  await adm(`/rest/v1/profiles?id=eq.${member.id}`, {
    method: "PATCH", body: JSON.stringify({ office_id: officeId }),
  });

  const mRes = await adm("/rest/v1/office_members", {
    method: "POST", headers: { Prefer: "return=representation" },
    // invite_email, NOT email — office_members has no `email` column, and a
    // POST naming one is rejected outright (PGRST204). That silently left the
    // teammate with no membership, so every brand check below failed for a
    // reason that had nothing to do with branding.
    body: JSON.stringify({ office_id: officeId, user_id: member.id, status: "active", role: "employee", invite_email: member.email }),
  });
  const mBody = await mRes.text();
  if (!mRes.ok) throw new Error(`office_members insert failed (${mRes.status}): ${mBody.slice(0, 300)}`);
  // Read it back: a silently-rejected membership means the teammate is not a
  // sub-user at all, and every brand check below would fail for a reason that
  // has nothing to do with branding.
  const back = await (await adm(`/rest/v1/office_members?user_id=eq.${member.id}&select=office_id,status,role`)).json();
  console.log("  membership:", JSON.stringify(back));

  for (const who of [admin, member]) {
    const c = await (await adm("/rest/v1/cards", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        user_id: who.id, username: who.uname, name: who === admin ? "Ada Rowe" : "Ben Iyer",
        title: who === admin ? "Managing Partner" : "Associate", company: "Northbeam Group",
        email: who.email, phone: "(415) 555-0134", template: "classic-pro",
        // Only office cards are brand targets (propagation filters on this).
        is_office_card: who === member,
        // A bio and a link the TEAMMATE already had, so we can prove the
        // office's values land on top of real prior content rather than on a
        // blank card — and that the teammate's own link is not deleted.
        // Their own handle, so we can prove the company's takes the slot
        // WITHOUT destroying theirs.
        // "" not null — cards.instagram is NOT NULL.
        instagram: who === member ? MEMBER_OWN.instagram : "",
        customization: who === member
          ? { bio: MEMBER_OWN.bio, links: [MEMBER_LINK] }
          : {},
      }),
    })).json();
    who.cardId = c?.[0]?.id;
    if (!who.cardId) throw new Error(`no card for ${who.email}: ` + JSON.stringify(c).slice(0, 300));
  }
}

async function cleanup() {
  if (process.env.KEEP) return console.log("\nKEEP=1 — leaving seeded rows in place");

  // Delete by OWNER as well as by id. Two early runs left an office behind
  // because cleanup knew only the id it had seeded, and then verified nothing —
  // so the residue was invisible until someone went looking. Delete, re-query,
  // retry, and say so out loud if anything survives: a QA harness that quietly
  // litters a production database is worse than one that fails.
  const ids = [admin.id, member.id].filter(Boolean);
  for (let attempt = 1; attempt <= 3; attempt++) {
    for (const uid of ids) {
      const owned = await (await adm(`/rest/v1/offices?owner_id=eq.${uid}&select=id`)).json().catch(() => []);
      for (const o of Array.isArray(owned) ? owned : []) {
        await adm(`/rest/v1/office_members?office_id=eq.${o.id}`, { method: "DELETE" });
        await adm(`/rest/v1/offices?id=eq.${o.id}`, { method: "DELETE" });
      }
    }
    if (officeId) {
      await adm(`/rest/v1/office_members?office_id=eq.${officeId}`, { method: "DELETE" });
      await adm(`/rest/v1/offices?id=eq.${officeId}`, { method: "DELETE" });
    }
    for (const uid of ids) {
      await adm(`/rest/v1/office_members?user_id=eq.${uid}`, { method: "DELETE" });
      await adm(`/rest/v1/cards?user_id=eq.${uid}`, { method: "DELETE" });
      await adm(`/rest/v1/profiles?id=eq.${uid}`, { method: "DELETE" });
      await adm(`/auth/v1/admin/users/${uid}`, { method: "DELETE" });
    }

    // Verify. Anything still standing gets another pass.
    let left = 0;
    for (const uid of ids) {
      const o = await (await adm(`/rest/v1/offices?owner_id=eq.${uid}&select=id`)).json().catch(() => []);
      const pr = await (await adm(`/rest/v1/profiles?id=eq.${uid}&select=id`)).json().catch(() => []);
      const au = await adm(`/auth/v1/admin/users/${uid}`);
      left += (Array.isArray(o) ? o.length : 0) + (Array.isArray(pr) ? pr.length : 0) + (au.status === 200 ? 1 : 0);
    }
    if (!left) { console.log("\ncleaned up seeded office, cards and accounts (verified)"); return; }
    if (attempt === 3) {
      console.log(`\n⚠︎  cleanup left ${left} row(s) behind for ${ids.join(", ")} — remove them by hand`);
      failures.push({ step: "cleanup", detail: `${left} seeded row(s) survived` });
    }
  }
}

/**
 * Click a tab and CONFIRM it switched.
 *
 * The tab bar is a client component: between first paint and hydration the
 * buttons are on screen with no handler attached, so an early click is
 * swallowed silently. A person hits this as "I tapped Links and nothing
 * happened"; a harness hits it as a missing field. Retry until aria-selected
 * actually flips, and report how long it took — a tab that needs many attempts
 * is a real finding, not just a slow test.
 */
async function clickTab(page, label) {
  const sel = `[role="tab"]:has-text("${label}")`;
  let lastErr = "";
  for (let i = 1; i <= 12; i++) {
    try { await page.click(sel, { timeout: 4000 }); }
    catch (e) { lastErr = e.message.split("\n").slice(0, 3).join(" ").slice(0, 220); }
    await page.waitForTimeout(500);
    const on = await page.$eval(sel, (e) => e.getAttribute("aria-selected") === "true").catch(() => false);
    if (on) return i;
  }
  if (lastErr) console.log(`      (click on "${label}" kept failing: ${lastErr})`);
  return 0;
}

/**
 * Navigate and INSIST on arriving. Signing in kicks off a client-side redirect
 * to the office console; a goto issued while that is still in flight simply
 * loses, and the harness then reports the destination page as broken when it
 * was never opened. So: go, settle, check we are actually there, retry.
 */
async function gotoStable(page, path, sel, label) {
  for (let i = 0; i < 3; i++) {
    await page.goto(BASE + path, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1200);
    if (!page.url().includes(path)) continue;          // a redirect won the race
    try {
      await page.waitForSelector(sel, { timeout: 20000 });
      await page.waitForTimeout(800);
      await page.$$eval(sel, (e) => e.length);         // proves the context is alive
      return true;
    } catch { /* fall through to retry */ }
  }
  fail(label, `never reached ${path} with ${sel} (ended at ${page.url()})`);
  return false;
}

/**
 * ONE sign-in per identity, reused for every viewport.
 *
 * Not just for speed: this app caps an account at two devices, and each fresh
 * browser context counts as another one — so signing in per check bounced the
 * third context to /settings/devices, which looks exactly like a broken page.
 */
const sessions = new Map();
async function signInOnce(who) {
  if (sessions.has(who.email)) return sessions.get(who.email);
  const ctx = await markInternal(await browser.newContext({ viewport: { width: 1280, height: 900 } }));
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("sc_admin_tour_completed", "1");
      localStorage.setItem("sc_admin_tour_seen", "1");
      localStorage.setItem("sc_tour_completed", "1");
    } catch { /* private mode */ }
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  for (const [sel, val] of [["#auth-email", who.email], ["#auth-password", password]]) {
    await page.waitForSelector(sel, { timeout: 30000 });
    await page.fill(sel, val);
    await page.waitForTimeout(200);
    if ((await page.inputValue(sel)) !== val) { await page.waitForTimeout(600); await page.fill(sel, val); }
  }
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard|onboarding|welcome|office|settings/, { timeout: 45000 });
  // Let the post-login redirect chain finish before capturing cookies.
  await page.waitForTimeout(3500);
  const state = await ctx.storageState();
  await ctx.close();
  sessions.set(who.email, state);
  return state;
}

/** Sign in once per identity and keep the cookies — see qa-flows on rate limits. */
async function signIn(who, { width = 1280, native = false } = {}) {
  const storageState = await signInOnce(who);
  const ctx = await markInternal(await browser.newContext({ viewport: { width, height: 900 }, storageState }));
  // Skip the guided tours. A BRAND-NEW office owner is auto-enrolled in a
  // 13-step admin tour that navigates the console for them, so every attempt to
  // open Branding was pulled back to /office/admin — which reads as "the page
  // is broken" when it is the product working as designed. These are the exact
  // flags the tour sets when someone finishes or skips it, so the harness is an
  // admin on their second visit, which is who actually uses this page.
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("sc_admin_tour_completed", "1");
      localStorage.setItem("sc_admin_tour_seen", "1");
      localStorage.setItem("sc_tour_completed", "1");
    } catch { /* private mode — nothing to do */ }
  });
  if (native) {
    // The shell injects window.Capacitor before our bundle runs; platform.ts
    // reads it through Capacitor.isNativePlatform(). This is the only way to
    // exercise the in-app branch from a desktop browser.
    await ctx.addInitScript(() => {
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios", platform: "ios", isNative: true, Plugins: {} };
    });
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.split("\n")[0].slice(0, 160)));
  return { ctx, page, errors };
}

// ── 1. The admin sets a Links brand, on a desktop ───────────────────────────
async function adminSetsBrand() {
  const { ctx, page, errors } = await signIn(admin);
  try {
    if (!(await gotoStable(page, "/office/admin/branding", '[role="tab"]', "branding page loads"))) {
      await page.screenshot({ path: `${OUT}/branding-never-loaded.png`, fullPage: true }).catch(() => {});
      return;
    }

    const tabs = await page.$$eval('[role="tab"]', (e) => e.map((x) => x.textContent.trim()));
    eq("branding page offers Card|Links tabs", JSON.stringify(tabs), JSON.stringify(["Card", "Links"]));
    const open = await page.$$eval('[role="tab"][aria-selected="true"]', (e) => e.map((x) => x.textContent.trim()));
    eq("opens on Card", JSON.stringify(open), JSON.stringify(["Card"]));

    // The Card tab must no longer offer the retired links freeze.
    const cardText = await page.innerText("body");
    eq("retired links lock is gone from the Card tab", cardText.includes("Only you can add link buttons"), false);
    eq("Card tab points at the Links tab", /Swift Links page .* is set on the\s+Links\s+tab/.test(cardText.replace(/\s+/g, " ")), true);

    // ── switch to Links ──
    const tries = await clickTab(page, "Links");
    if (!tries) fail("Links tab switches when clicked", "aria-selected never became true after 12 clicks over 6s");
    else pass("Links tab switches when clicked", tries === 1 ? "first click" : `took ${tries} clicks (~${(tries - 1) * 0.5}s of hydration lag)`);
    try {
      await page.waitForSelector("#office-link-bio", { timeout: 20000 });
    } catch (e) {
      await page.screenshot({ path: `${OUT}/links-tab-empty.png`, fullPage: true }).catch(() => {});
      const sel = await page.$$eval('[role="tab"]', (els) => els.map((x) => `${x.textContent.trim()}=${x.getAttribute("aria-selected")}`));
      fail("Links tab opens", `no #office-link-bio. tabs: ${sel.join(",")} · errors: ${errors.join(" | ") || "none"} · body: ${(await page.innerText("body")).slice(0, 300).replace(/\n/g, " | ")}`);
      return;
    }
    await page.waitForTimeout(500);

    const lockSel = 'label:has-text("Keep every Swift Links page matching") input[type="checkbox"]';
    const lockBefore = await page.$eval(lockSel, (e) => e.checked).catch(() => null);
    eq("the Links design lock defaults OFF", lockBefore, false);

    await page.fill("#office-link-bio", BRAND.bio);
    await page.fill("#office-link-ig", BRAND.instagram);

    // Add the company link through the real add form.
    // By id (AddLinkForm idPrefix="office-link-new"): the boxes are labelled
    // "Button text" / "Web address" now, and placeholders are examples.
    await page.waitForSelector("#office-link-new-label", { timeout: 15000 });
    await page.fill("#office-link-new-label", BRAND.linkLabel);
    await page.fill("#office-link-new-url", BRAND.linkUrl);
    await page.click('button:has-text("Add company link")');
    await page.waitForTimeout(600);
    eq("the pinned link is listed after adding", (await page.innerText("body")).includes(BRAND.linkLabel), true);

    // A SECTION HEADER among the company links — the same kind of row a
    // teammate can add under their own. It has no URL, which is exactly why it
    // needs its own identity rather than the URL match the links use.
    await page.click('button:has-text("Add a section header")');
    await page.waitForTimeout(500);
    const secInput = await page.$('input[placeholder*="Section title" i]');
    if (!secInput) fail("section header control", "no Section title input appeared after clicking");
    else {
      await secInput.fill(BRAND.sectionLabel);
      await page.waitForTimeout(300);
      pass("a company section header can be added");
    }

    // Turn the design lock on.
    await page.click('label:has-text("Keep every Swift Links page matching")');
    await page.waitForTimeout(300);

    await page.click('button:has-text("Save & apply to all Swift Links")');
    await page.waitForTimeout(3500);
    const saved = await page.innerText("body");
    eq("save reports success", /Applied|Saved|✓/.test(saved), true);

    // ── the reload test: "Applied ✓" must mean WRITTEN ──
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    try {
      await page.waitForSelector('[role="tab"]', { timeout: 20000 });
      await page.waitForTimeout(900);
    } catch { fail("branding page reloads", `no tabs after reload (at ${page.url()})`); return; }
    if (!(await clickTab(page, "Links"))) { fail("Links tab after reload", "never switched"); return; }
    await page.waitForSelector("#office-link-bio", { timeout: 15000 });
    await page.waitForTimeout(600);
    eq("bio survived a reload", await page.inputValue("#office-link-bio"), BRAND.bio);
    eq("Instagram survived a reload", (await page.inputValue("#office-link-ig")).replace(/^@/, ""), BRAND.instagram);
    eq("the pinned link survived a reload", (await page.innerText("body")).includes(BRAND.linkLabel), true);
    // A header row is an <input>, and innerText never includes input VALUES —
    // read the values, or this checks nothing and always fails.
    const hdrVals = await page.$$eval("input", (els) => els.map((e) => e.value));
    eq("the section header survived a reload", hdrVals.includes(BRAND.sectionLabel), true);
    const lockSel2 = 'label:has-text("Keep every Swift Links page matching") input[type="checkbox"]';
    eq("the lock survived a reload", await page.$eval(lockSel2, (e) => e.checked), true);

    // Prove the SAVE wrote to the office row, independently of the UI.
    const row = await (await adm(`/rest/v1/offices?id=eq.${officeId}&select=brand_link_bio,brand_link_instagram,brand_links,brand_locks`)).json();
    console.log("  office row after save:", JSON.stringify(row?.[0]));

    // The Card half must be untouched by a Links save.
    await clickTab(page, "Card");
    await page.waitForTimeout(600);
    eq("the Card tab still has the company name", (await page.innerText("body")).includes("Northbeam Group"), true);

    if (errors.length) fail("admin branding JS errors", errors.join(" | "));
    else pass("no JS errors on the branding page");
    await page.screenshot({ path: `${OUT}/admin-links-desktop.png`, fullPage: true }).catch(() => {});
  } finally { await ctx.close(); }
}

// ── 2. The same page on a phone, and inside the iOS shell ───────────────────
async function adminPageOnPhoneAndInApp() {
  for (const [name, native] of [["phone web", false], ["iOS shell", true]]) {
    const { ctx, page, errors } = await signIn(admin, { width: 390, native });
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      if (!(await gotoStable(page, "/office/admin/branding", '[role="tab"]', `${name} branding page loads`))) continue;

      for (const tab of ["Card", "Links"]) {
        if (!(await clickTab(page, tab))) { fail(`${name} — ${tab} tab`, "never switched when clicked"); continue; }
        await page.waitForTimeout(900);
        const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (sideways > 1) fail(`${name} — ${tab} tab`, `page scrolls sideways by ${sideways}px at 390`);
        else pass(`${name} — ${tab} tab fits 390px`);
      }

      // Tap targets: the tabs themselves must be reachable with a thumb.
      const tabH = await page.$$eval('[role="tab"]', (e) => e.map((x) => x.getBoundingClientRect().height));
      if (tabH.some((h) => h < 28)) fail(`${name} tab height`, `smallest ${Math.min(...tabH)}px`);
      else pass(`${name} tabs are tappable`, `${Math.min(...tabH)}px`);

      if (native) {
        // App Store 3.1.1 — this feature must not sell inside the shell.
        const t = await page.innerText("body");
        const sells = /\$\d|per month|\/mo\b|upgrade to pro|start.{0,12}free trial|billed|checkout/i.exec(t);
        if (sells) fail("iOS shell selling language", `found "${sells[0]}"`);
        else pass("iOS shell: no pricing or selling language on Branding");
      }

      if (errors.length) fail(`${name} JS errors`, errors.join(" | "));
      await page.screenshot({ path: `${OUT}/admin-links-${native ? "app" : "phone"}.png`, fullPage: true }).catch(() => {});
    } finally { await ctx.close(); }
  }
}

// ── 3. The teammate's side ──────────────────────────────────────────────────
async function memberSeesTheBrand() {
  const { ctx, page, errors } = await signIn(member);
  try {
    // What the database thinks the teammate's card holds, before any UI.
    const before = await (await adm(`/rest/v1/cards?id=eq.${member.cardId}&select=customization,instagram,is_office_card`)).json();
    console.log("  teammate card after the admin's save:", JSON.stringify(before?.[0]).slice(0, 400));

    if (!(await gotoStable(page, `/cards/${member.cardId}/edit`, 'button:has-text("Socials")', "teammate card editor loads"))) return;
    await page.click('button:has-text("Socials")');
    await page.waitForTimeout(1500);

    const bio = await page.$('textarea[readonly]');
    if (!bio) fail("member bio", "the office bio is not read-only for the teammate");
    else {
      eq("teammate sees the office bio", (await bio.inputValue()).trim(), BRAND.bio);
      pass("the office bio is read-only for the teammate");
    }

    const body = await page.innerText("body");
    eq("teammate sees the pinned company link", body.includes(BRAND.linkLabel), true);
    // Not just "the word Company appears somewhere" — the page says "Company
    // logo" and "Company name" in other places, so that would pass on a page
    // with no pinned link at all. Ask the DOM which row the tag sits in.
    const tagged = await page.evaluate((label) => {
      const row = [...document.querySelectorAll("div,li")].find(
        (el) => el.textContent?.includes(label) && el.children.length < 12,
      );
      return !!row && /Company/i.test(row.textContent ?? "");
    }, BRAND.linkLabel);
    eq("the pinned link carries a Company tag of its own", tagged, true);
    const removable = await page.evaluate((label) => {
      const row = [...document.querySelectorAll("div,li")].find(
        (el) => el.textContent?.includes(label) && el.children.length < 12,
      );
      return !!row?.querySelector('button[aria-label*="emove" i], button[title*="emove" i]');
    }, BRAND.linkLabel);
    eq("the teammate gets no remove button on a company link", removable, false);
    eq("teammate still sees their OWN link", body.includes(MEMBER_LINK.label), true);
    const memberVals = await page.$$eval("input", (els) => els.map((e) => e.value));
    eq("teammate sees the company section header", memberVals.includes(BRAND.sectionLabel), true);
    // The closure runs in the PAGE, which cannot see this script's constants —
    // pass the label in rather than referencing BRAND inside it.
    eq("and cannot edit it",
       await page.$$eval("input", (els, label) => els.filter((e) => e.value === label).every((e) => e.readOnly), BRAND.sectionLabel),
       true);
    eq("the locked design is explained, not just missing", /Office admin|managed|set by your/i.test(body), true);

    if (errors.length) fail("member editor JS errors", errors.join(" | "));
    await page.screenshot({ path: `${OUT}/member-socials.png`, fullPage: true }).catch(() => {});

    // The public page is the thing a visitor actually opens.
    await page.goto(`${BASE}/links/${member.uname}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const pub = await page.innerText("body");
    eq("public Swift Links shows the office bio", pub.includes(BRAND.bio), true);
    eq("public Swift Links shows the pinned company link", pub.includes(BRAND.linkLabel), true);
    eq("public Swift Links KEEPS the teammate's own link", pub.includes(MEMBER_LINK.label), true);
    // The header is rendered uppercase by CSS, so compare case-insensitively.
    eq("public Swift Links shows the company section header", pub.toLowerCase().includes(BRAND.sectionLabel.toLowerCase()), true);
    await page.screenshot({ path: `${OUT}/member-public-links.png`, fullPage: true }).catch(() => {});

    // ── 4. A crafted request must not strip the office back out ──
    const res = await page.evaluate(async ({ id, ig }) => {
      const r = await fetch(`/api/cards/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customization: { links: [], bio: "stripped by the teammate" }, instagram: ig }),
      });
      return { status: r.status };
    }, { id: member.cardId, ig: "not-the-office-instagram" });

    const row = await (await adm(`/rest/v1/cards?id=eq.${member.cardId}&select=customization,instagram`)).json();
    const cust = row?.[0]?.customization ?? {};
    const links = Array.isArray(cust.links) ? cust.links : [];
    eq(`rogue PATCH (${res.status}) did not remove the pinned link`, links.some((l) => l.label === BRAND.linkLabel), true);
    eq("rogue PATCH did not rewrite the office bio", cust.bio, BRAND.bio);
    eq("rogue PATCH did not rewrite the office Instagram", String(row?.[0]?.instagram ?? "").replace(/^@/, ""), BRAND.instagram);

    // ── 5. …but the teammate CAN still add their own link (the owner's rule) ──
    const add = await page.evaluate(async ({ id, mine, pinned }) => {
      const r = await fetch(`/api/cards/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customization: { links: [pinned, mine, { label: "Second of mine", url: "https://second.example.com" }] } }),
      });
      return { status: r.status };
    }, { id: member.cardId, mine: MEMBER_LINK, pinned: { label: BRAND.linkLabel, url: BRAND.linkUrl } });

    const row2 = await (await adm(`/rest/v1/cards?id=eq.${member.cardId}&select=customization`)).json();
    const links2 = row2?.[0]?.customization?.links ?? [];
    eq(`teammate add (${add.status}) keeps the company link first`, links2[0]?.label, BRAND.linkLabel);
    eq("teammate's new link was accepted", links2.some((l) => l.label === "Second of mine"), true);
    eq("teammate's original link survived", links2.some((l) => l.label === MEMBER_LINK.label), true);
    eq("the company section header was re-pinned, not lost", links2.some((l) => l.kind === "header" && l.label === BRAND.sectionLabel), true);

    // A member's OWN section header must survive alongside the company's —
    // both have no URL, so a URL-only identity would have merged them.
    const ownHdr = await page.evaluate(async ({ id, pinned, hdr, mine }) => {
      const r = await fetch(`/api/cards/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customization: { links: [hdr, pinned, { label: "My own section", url: "", kind: "header" }, mine] } }),
      });
      return { status: r.status };
    }, { id: member.cardId, pinned: { label: BRAND.linkLabel, url: BRAND.linkUrl }, hdr: { label: BRAND.sectionLabel, url: "", kind: "header" }, mine: MEMBER_LINK });
    const row3 = await (await adm(`/rest/v1/cards?id=eq.${member.cardId}&select=customization`)).json();
    const l3 = row3?.[0]?.customization?.links ?? [];
    eq(`teammate's own section header survived (${ownHdr.status})`, l3.some((l) => l.kind === "header" && l.label === "My own section"), true);
    // Office rows lead, in the order the ADMIN arranged them (the link was added
    // before the header), and the member's follow.
    eq("the company's rows still lead the list", l3[0]?.label, BRAND.linkLabel);
    eq("the company header sits in the admin's order, before the member's rows",
       l3.findIndex((l) => l.label === BRAND.sectionLabel) < l3.findIndex((l) => l.label === "My own section"), true);
    eq("the company header was not duplicated",
       l3.filter((l) => l.kind === "header" && l.label === BRAND.sectionLabel).length, 1);

    // ── 5b. Their own bio and handle are KEPT, not destroyed ──
    const kept = (await (await adm(`/rest/v1/cards?id=eq.${member.cardId}&select=customization`)).json())?.[0]?.customization ?? {};
    eq("their own bio was kept underneath", kept.ownBio, MEMBER_OWN.bio);
    eq("their own Instagram was kept underneath", kept.ownInstagram, MEMBER_OWN.instagram);
  } finally { await ctx.close(); }
}

// ── 7. The admin changes their mind: clearing gives everyone theirs back ─────
// The failure this exists for: an admin types a company bio, presses save, and
// has permanently deleted fifteen bios. Clearing must be a real undo.
async function clearingTheBrandGivesItBack() {
  const { ctx, page, errors } = await signIn(admin);
  try {
    if (!(await gotoStable(page, "/office/admin/branding", '[role="tab"]', "branding reopens"))) return;
    if (!(await clickTab(page, "Links"))) { fail("Links tab reopens", "never switched"); return; }
    await page.waitForSelector("#office-link-bio", { timeout: 20000 });
    await page.fill("#office-link-bio", "");
    await page.fill("#office-link-ig", "");
    await page.click('button:has-text("Save & apply to all Swift Links")');
    await page.waitForTimeout(3500);

    const office = (await (await adm(`/rest/v1/offices?id=eq.${officeId}&select=brand_link_bio,brand_link_instagram`)).json())?.[0] ?? {};
    console.log("  office row after CLEARING:", JSON.stringify(office));
    const row = (await (await adm(`/rest/v1/cards?id=eq.${member.cardId}&select=customization,instagram`)).json())?.[0] ?? {};
    console.log("  teammate card after CLEARING:", JSON.stringify(row).slice(0, 420));
    const cust = row.customization ?? {};
    eq("the teammate's own bio came back", cust.bio, MEMBER_OWN.bio);
    eq("the teammate's own Instagram came back", String(row.instagram ?? ""), MEMBER_OWN.instagram);
    eq("the stash was cleaned up afterwards", cust.ownBio === undefined && cust.ownInstagram === undefined, true);
    eq("the company link is still pinned (it was not cleared)", (cust.links ?? []).some((l) => l.label === BRAND.linkLabel), true);
    if (errors.length) fail("clearing JS errors", errors.join(" | "));
  } finally { await ctx.close(); }
}

// ── 6. The teammate's own screens, on a phone and in the shell ──────────────
// The admin sets this up once; the teammate lives with it. Their editor and
// their public page are the surfaces that get opened on a phone every day.
async function memberScreensOnPhoneAndInApp() {
  for (const [name, native] of [["phone web", false], ["iOS shell", true]]) {
    const { ctx, page, errors } = await signIn(member, { width: 390, native });
    try {
      await page.setViewportSize({ width: 390, height: 844 });

      if (await gotoStable(page, `/cards/${member.cardId}/edit`, 'button:has-text("Socials")', `${name} teammate editor`)) {
        await page.click('button:has-text("Socials")');
        await page.waitForTimeout(1800);
        const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (sideways > 1) fail(`${name} teammate editor`, `scrolls sideways by ${sideways}px`);
        else pass(`${name} teammate editor fits 390px`);
        const t = await page.innerText("body");
        eq(`${name}: teammate still sees the company link`, t.includes(BRAND.linkLabel), true);
        await page.screenshot({ path: `${OUT}/member-editor-${native ? "app" : "phone"}.png`, fullPage: true }).catch(() => {});
      }

      await page.goto(`${BASE}/links/${member.uname}`, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(2000);
      const sideways2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (sideways2 > 1) fail(`${name} public Swift Links`, `scrolls sideways by ${sideways2}px`);
      else pass(`${name} public Swift Links fits 390px`);
      const pub = await page.innerText("body");
      eq(`${name}: public page carries the office bio`, pub.includes(BRAND.bio), true);
      await page.screenshot({ path: `${OUT}/member-links-${native ? "app" : "phone"}.png`, fullPage: true }).catch(() => {});

      if (errors.length) fail(`${name} teammate JS errors`, errors.join(" | "));
      else pass(`${name}: no JS errors on the teammate's screens`);
    } finally { await ctx.close(); }
  }
}

(async () => {
  console.log(`Office Swift Links branding — end to end against ${BASE}\n`);
  try {
    await seed();
    console.log(`seeded office ${officeId} · admin ${admin.uname} · teammate ${member.uname}\n`);
    browser = await chromium.launch();
    await adminSetsBrand();
    await adminPageOnPhoneAndInApp();
    await memberSeesTheBrand();
    await memberScreensOnPhoneAndInApp();
    await clearingTheBrandGivesItBack();
  } catch (e) {
    fail("harness", e.message);
  } finally {
    await browser?.close().catch(() => {});
    await cleanup();
  }
  console.log(`\n${failures.length ? `✗ ${failures.length} failure(s)` : "✓ everything passed"}`);
  process.exit(failures.length ? 1 : 0);
})();
