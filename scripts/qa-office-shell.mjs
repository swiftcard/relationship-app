// node scripts/qa-office-shell.mjs      env: ONLY=admin|member|member2  OUT=<dir>  BASE=<url>
// QA pass over the Office admin + member experience in the iPhone shell.
// Seeds a throwaway office (owner with card, one active member with card, one
// pending invite), drives both roles through every screen as the iOS shell
// with the notch/home-indicator insets emulated via CDP, and audits each
// screen: horizontal overflow, elements wider than the screen, interactive
// controls under the status bar or home indicator, controls covered by other
// elements, error pages, and content that ends underneath the tab bar.
// Deletes everything it created.
import { chromium } from "playwright";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { markInternal } from "./qa-internal.mjs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const BASE = process.env.BASE || "https://swiftcard.me";
const OUT = process.env.OUT || "qa-out";
mkdirSync(OUT, { recursive: true });
// Secrets: the environment first (GitHub Actions), .env.local second (a laptop).
// NEXT_PUBLIC_* also answers to its bare name, which is how the CI secrets are named.
const env = existsSync(`${ROOT}/.env.local`) ? readFileSync(`${ROOT}/.env.local`, "utf8") : "";
const g = (k) => process.env[k] ?? process.env[k.replace(/^NEXT_PUBLIC_/, "")] ?? (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const SB = g("NEXT_PUBLIC_SUPABASE_URL"), SVC = g("SUPABASE_SERVICE_ROLE_KEY");
const adm = (p, i) => fetch(SB + p, { ...i, headers: { apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": "application/json", ...(i?.headers ?? {}) } });

const stamp = Date.now().toString().slice(-8);
const password = `Qa!aA1${stamp}x`;
const users = [];
let officeId = null, browser;
const VW = 440, VH = 956, TOP = 59, BOTTOM = 34;
const issues = [];  // { screen, kind, detail }
const note = (screen, kind, detail) => { issues.push({ screen, kind, detail }); console.log(`  ! ${screen}: ${kind} — ${detail}`); };

async function makeUser(email, name, uname, plan, withCard) {
  const u = await (await adm("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  if (!u.id) throw new Error("no user id: " + JSON.stringify(u).slice(0, 160));
  users.push(u.id);
  if (plan) {
    await adm("/rest/v1/profiles", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ id: u.id, username: uname, name, email, plan, customization: { _aiConsent: "accepted", _planChosen: "qa-seeded" } }) });
  }
  if (withCard) {
    await adm("/rest/v1/cards", { method: "POST", body: JSON.stringify({
      user_id: u.id, username: uname, name, title: "Senior Client Partner, Enterprise Accounts",
      company: "Northbeam Commercial Real Estate Group", email, phone: "(415) 555-0192", template: "modern-bold",
      is_office_card: true,
    }) });
  }
  return u.id;
}

const SHELL_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

async function newShellPage() {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: SHELL_UA });
  // This run creates offices, members and cards against production every
  // night; without the marker they read as customers on /admin/analytics.
  await markInternal(ctx, BASE);
  await ctx.addInitScript(() => {
    window.webkit = { messageHandlers: { bridge: { postMessage() {} } } };
    window.Capacitor = { isNativePlatform: () => true, isNative: true, platform: "ios", getPlatform: () => "ios", isPluginAvailable: () => false, Plugins: {} };
  });
  // Visual markers only (insets come from CDP): status bar + home indicator.
  await ctx.addInitScript(() => {
    const css = `html::before{content:"";position:fixed;top:0;left:0;right:0;height:env(safe-area-inset-top);z-index:2147483647;pointer-events:none;background:repeating-linear-gradient(45deg,rgba(255,0,0,.30) 0 8px,rgba(255,0,0,.10) 8px 16px);}
      html::after{content:"";position:fixed;bottom:0;left:0;right:0;height:env(safe-area-inset-bottom);z-index:2147483647;pointer-events:none;background:repeating-linear-gradient(45deg,rgba(255,0,0,.30) 0 8px,rgba(255,0,0,.10) 8px 16px);}`;
    const add = () => { const el = document.createElement("style"); el.textContent = css; document.head.appendChild(el); };
    if (document.head) add(); else document.addEventListener("DOMContentLoaded", add);
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: TOP, bottom: BOTTOM, left: 0, right: 0 } })
    .catch((e) => console.log("  ! safe-area emulation unavailable:", e.message.split("\n")[0]));
  page.on("pageerror", (e) => note(page.url().replace(BASE, ""), "js-error", e.message.split("\n")[0]));
  return { ctx, page };
}

async function login(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', email); await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Sign in →")');
  await page.waitForURL(/dashboard|onboarding|welcome|join|office/, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(3500);
}

async function dismissOverlays(page, { keepTour = false } = {}) {
  const labels = keepTour ? ["Allow", "Continue on the web", "Not now"] : ["Allow", "Continue on the web", "Not now", "Skip", "Skip tour", "Got it", "Maybe later", "Done"];
  for (const label of labels) {
    const b = page.locator(`button:has-text("${label}")`).first();
    if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await page.waitForTimeout(400); }
  }
}

// The audit. Runs in the page; returns findings for the CURRENT scroll state.
const AUDIT = async ({ TOP, BOTTOM }) => {
  const settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const W = innerWidth, H = innerHeight;
  const out = [];
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0"; };
  const desc = (el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : ""} “${(el.innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").trim().slice(0, 40).replace(/\s+/g, " ")}”`;
  const isFixedish = (el) => { for (let n = el; n && n !== document.body; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === "fixed" || p === "sticky") return n; } return null; };
  const txt = document.body.innerText || "";
  if (/Application error|Something went wrong|Internal Server Error|This page could not be found/i.test(txt)) out.push(["error-page", txt.slice(0, 120)]);
  if (document.documentElement.scrollWidth > W + 1) out.push(["horizontal-overflow", `scrollWidth ${document.documentElement.scrollWidth} > ${W}`]);
  const all = [...document.querySelectorAll("body *")].filter(vis);
  const offscreenClone = (r) => r.right <= 0 || r.left >= W; // e.g. ShareCardCapture renders the card at left:-10000 for image capture
  const scrollsInside = (el) => { for (let n = el.parentElement, i = 0; n && i < 6; n = n.parentElement, i++) { if (/auto|scroll|hidden/.test(getComputedStyle(n).overflowX)) return true; } return false; };
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (offscreenClone(r)) continue;
    if ((r.right > W + 1 || r.left < -1) && r.width < W * 2 && getComputedStyle(el).position !== "fixed" && !scrollsInside(el)) {
      out.push(["wider-than-screen", `${desc(el)} ${Math.round(r.left)}..${Math.round(r.right)}`]); if (out.length > 12) break;
    }
  }
  const atTop = scrollY < 2;
  const inter = all.filter((el) => el.matches("button, a[href], [role='button'], input, select, textarea, [role='switch'], [role='tab']"));
  let covered = 0;
  for (const el of inter) {
    const r = el.getBoundingClientRect();
    if (r.bottom <= 0 || r.top >= H || offscreenClone(r)) continue;
    const fx = isFixedish(el);
    // Under the clock: interactive content drawn in the status-bar strip at
    // rest, or a fixed/sticky control there at any scroll position.
    if (r.top < TOP - 1 && r.height > 8 && (atTop || fx)) out.push(["under-status-bar", `${desc(el)} top=${Math.round(r.top)}`]);
    // Inside a fixed bottom bar but drawn into the home-indicator strip.
    if (fx) { const fr = fx.getBoundingClientRect(); if (fr.bottom >= H - 1 && r.bottom > H - BOTTOM + 2) out.push(["under-home-indicator", `${desc(el)} bottom=${Math.round(r.bottom)}`]); }
    // A collapsed <details> keeps a layout box in Chrome while showing nothing,
    // so its contents measured as real controls sitting wherever they WOULD be —
    // underneath whatever the next section paints there. That is how five colour
    // swatches inside a closed "More options" came back covered every night
    // (2026-09-16: control 71,805 44x44, hit = the Section 3 card at 41,746).
    // The <summary> is the part a person can actually see and tap, so it stays
    // audited; everything behind it does not exist until they open it.
    if (el.closest("details:not([open])") && !el.closest("summary")) continue;
    // Covered: the element at its centre is neither it nor its descendant/ancestor.
    //
    // SCROLL TO IT FIRST (2026-09-16). Those coordinates are CLAMPED to the
    // viewport, so a control straddling the bottom edge had its centre pinned
    // to the last visible pixel row — and the hit-test then reported whatever
    // happened to be sitting there. That is how five colour swatches in the
    // Design panel came back "covered by" the Section 3 card every night, when
    // the two are ordinary siblings in normal flow and cannot overlap at all.
    //
    // Scrolling it to centre uses the control's real middle, which is the point
    // a thumb aims at. A control genuinely under a bar or an overlay is still
    // covered afterwards.
    el.scrollIntoView({ block: "center", inline: "nearest" });
    await settle();
    const r2 = el.getBoundingClientRect();
    const cx = Math.min(W - 1, Math.max(0, r2.left + r2.width / 2)), cy = Math.min(H - 1, Math.max(0, r2.top + r2.height / 2));
    if (cy < TOP || cy > H - BOTTOM) continue;
    const hit = document.elementFromPoint(cx, cy);
    if (!hit || hit === el || el.contains(hit) || hit.contains(el)) continue;
    // A picture of a card (template picker thumbnails, previews) is inert:
    // its links cannot be reached by tap or keyboard, so "covered" is moot.
    if (el.closest("[inert]")) continue;
    const hitFixed = isFixedish(hit);
    if (hitFixed && !fx) continue; // content flowing under a bar / the help bubble is normal
    if (hitFixed) { const hr = hitFixed.getBoundingClientRect(); if (hr.width >= W - 1 && hr.height >= H - 1 && !(hit.innerText || "").trim()) continue; } // a modal backdrop over the chrome
    if (hit.closest("[role='dialog'], [aria-modal='true']") && !el.closest("[role='dialog'], [aria-modal='true']")) continue; // behind an open dialog
    // Two items of the SAME tab bar cannot hide each other from a user: they
    // are siblings in one flex row, and a row that genuinely overflowed is
    // caught by wider-than-screen above. With five tabs the centre hit-test
    // lands on the neighbour and reported "Links covered by Settings" every
    // night, on a bar the screenshots show rendering perfectly (2026-09-11).
    if (el.closest(".sc-tabbar") && hit.closest(".sc-tabbar") === el.closest(".sc-tabbar")) continue;
    covered++; if (covered <= 6) out.push(["covered-control", `${desc(el)} covered by ${desc(hit)} — control ${Math.round(r2.left)},${Math.round(r2.top)} ${Math.round(r2.width)}x${Math.round(r2.height)} · point ${Math.round(cx)},${Math.round(cy)} · hit ${Math.round(hit.getBoundingClientRect().left)},${Math.round(hit.getBoundingClientRect().top)} ${Math.round(hit.getBoundingClientRect().width)}x${Math.round(hit.getBoundingClientRect().height)} · openAncestor=${!!el.closest("details[open]")} inDetails=${!!el.closest("details")}`]);
  }
  // At the end of the scroll, nothing should be hidden beneath the tab bar.
  const atBottom = Math.ceil(scrollY + H) >= document.documentElement.scrollHeight - 2;
  const bar = document.querySelector(".sc-tabbar");
  if (atBottom && bar && vis(bar)) {
    const bt = bar.getBoundingClientRect().top;
    const low = all.filter((el) => !isFixedish(el) && !el.closest(".sc-tabbar") && el.children.length === 0 && (el.innerText || "").trim()).reduce((m, el) => Math.max(m, el.getBoundingClientRect().bottom), 0);
    if (low > bt + 2) out.push(["ends-under-tab-bar", `lowest text bottom=${Math.round(low)} > tab bar top=${Math.round(bt)}`]);
  }
  return out;
};

async function audit(page, screen, { scrollBottom = true } = {}) {
  await page.waitForTimeout(700);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  let found = await page.evaluate(AUDIT, { TOP, BOTTOM });
  await page.screenshot({ path: `${OUT}/${screen}-top.png` });
  if (scrollBottom) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(400);
    const more = await page.evaluate(AUDIT, { TOP, BOTTOM });
    await page.screenshot({ path: `${OUT}/${screen}-bottom.png` });
    found = found.concat(more.filter((m) => !found.some((f) => f[0] === m[0] && f[1] === m[1])));
  }
  const url = page.url().replace(BASE, "");
  console.log(`audited ${screen} (${url}): ${found.length ? found.length + " finding(s)" : "clean"}`);
  for (const [kind, detail] of found) note(screen, kind, detail);
  return found;
}

async function tapTab(page, label, expectPath) {
  const t = page.locator(`.sc-tabbar a:has-text("${label}")`).first();
  if (!(await t.isVisible().catch(() => false))) { note(`tab-${label}`, "missing", `no "${label}" in the tab bar at ${page.url().replace(BASE, "")}`); return false; }
  await t.click().catch((e) => note(`tab-${label}`, "click-failed", e.message.split("\n")[0]));
  await page.waitForTimeout(2500);
  const url = page.url().replace(BASE, "");
  if (expectPath && !url.startsWith(expectPath)) note(`tab-${label}`, "wrong-destination", `landed on ${url}, expected ${expectPath}`);
  return true;
}

try {
  console.log("seeding…");
  const ownerEmail = `qa-owner-${stamp}@swiftcard-test.invalid`;
  const m1Email = `qa-m1-${stamp}@swiftcard-test.invalid`;
  const m2Email = `qa-m2-${stamp}@swiftcard-test.invalid`;
  const ownerId = await makeUser(ownerEmail, "Alex Rivera", `qa-owner-${stamp}`, "enterprise", true);
  const office = await (await adm("/rest/v1/offices", { method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ name: "Northbeam Commercial", owner_id: ownerId, seats: 3 }) })).json();
  officeId = office?.[0]?.id; if (!officeId) throw new Error("no office: " + JSON.stringify(office).slice(0, 200));
  await adm("/rest/v1/office_members", { method: "POST", body: JSON.stringify({ office_id: officeId, user_id: ownerId, role: "owner", status: "active", joined_at: new Date().toISOString() }) });
  const m1 = await makeUser(m1Email, "Priyanka Balasubramanian", `qa-m1-${stamp}`, "enterprise", true);
  await adm("/rest/v1/office_members", { method: "POST", body: JSON.stringify({ office_id: officeId, user_id: m1, role: "employee", status: "active", joined_at: new Date().toISOString(), invite_email: m1Email }) });
  const token = randomBytes(16).toString("hex");
  await adm("/rest/v1/office_members", { method: "POST", body: JSON.stringify({ office_id: officeId, invite_email: m2Email, invite_token: token, status: "pending", expires_at: new Date(Date.now() + 7 * 864e5).toISOString() }) });
  await makeUser(m2Email, "Jordan Okafor", `qa-m2-${stamp}`, null, false); // auth only: the app-first joiner
  console.log("seeded office", officeId);

  browser = await chromium.launch();

  const ONLY = process.env.ONLY || "";
  // ── ADMIN ────────────────────────────────────────────────────────────────
  if (!ONLY || ONLY === "admin") {
  console.log("\nADMIN");
    const { ctx, page } = await newShellPage();
    await login(page, ownerEmail);
    await dismissOverlays(page);
    await audit(page, "admin-dashboard");
    await tapTab(page, "Admin", "/office/admin");
    await dismissOverlays(page);
    await audit(page, "admin-team");
    // Add team member dialog
    const add = page.locator('button:has-text("Add team member")').first();
    if (await add.isVisible().catch(() => false)) {
      await add.click(); await page.waitForTimeout(1200);
      const dlg = page.locator('[role="dialog"]').first();
      if (await dlg.isVisible().catch(() => false)) {
        // The dialog element is the fixed inset-0 wrapper (backdrop + sheet); its box
        // IS the viewport. Measure the sheet inside it, which is what can go off-screen.
        const sheet = dlg.locator(":scope > :not(button)").last();
        const bb = (await sheet.boundingBox().catch(() => null)) ?? (await dlg.boundingBox());
        // A bottom sheet runs to the screen edge by design (its safe-area padding is
        // inside it); what must stay clear of the home indicator is its CONTROLS.
        const lowCtl = await sheet.evaluate((s) => Math.max(0, ...[...s.querySelectorAll("button, a[href], input, select, textarea")].map((c) => c.getBoundingClientRect().bottom))).catch(() => 0);
        if (bb && (bb.y < TOP || lowCtl > VH - BOTTOM + 2 || bb.x < 0 || bb.x + bb.width > VW + 1)) note("admin-invite-dialog", "dialog-off-screen", JSON.stringify({ ...bb, lowestControlBottom: Math.round(lowCtl) }));
        await audit(page, "admin-invite-dialog", { scrollBottom: false });
      } else note("admin-invite-dialog", "no-dialog", "Add team member opened nothing with role=dialog");
      await page.keyboard.press("Escape"); await page.waitForTimeout(500);
      if (await page.locator('[role="dialog"]').first().isVisible().catch(() => false)) {
        const x = page.locator('[role="dialog"] button[aria-label*="lose" i], [role="dialog"] button:has-text("Cancel"), [role="dialog"] button:has-text("×")').first();
        if (await x.isVisible().catch(() => false)) await x.click().catch(() => {}); else note("admin-invite-dialog", "cannot-close", "Escape and no close button");
        await page.waitForTimeout(400);
      }
    } else note("admin-team", "missing-button", "Add team member");
    // Member drawer
    const manage = page.locator('button:has-text("Manage")').first();
    if (await manage.isVisible().catch(() => false)) {
      await manage.click(); await page.waitForTimeout(1500);
      await audit(page, "admin-member-drawer", { scrollBottom: false });
      const close = page.locator('[role="dialog"] button[aria-label*="lose" i], button[aria-label="Close"]').first();
      if (await close.isVisible().catch(() => false)) { const b = await close.boundingBox(); if (b && b.y < TOP) note("admin-member-drawer", "close-under-status-bar", JSON.stringify(b)); await close.click().catch(() => {}); }
      else await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
    } else note("admin-team", "missing-button", "Manage");
    for (const [label, path, shot] of [["Analytics", "/office/admin/analytics", "admin-analytics"], ["Contacts", "/office/admin/leads", "admin-leads"], ["Branding", "/office/admin/branding", "admin-branding"], ["Team", "/office/admin", "admin-team-again"]]) {
      const l = page.locator(`header nav a:has-text("${label}")`).first();
      if (!(await l.isVisible().catch(() => false))) { note(shot, "missing-nav", label); continue; }
      const b = await l.boundingBox(); if (b && b.y < TOP) note(shot, "nav-under-status-bar", `${label} y=${Math.round(b.y)}`);
      await l.click(); await page.waitForTimeout(2500); await dismissOverlays(page);
      if (!page.url().includes(path)) note(shot, "wrong-destination", page.url().replace(BASE, ""));
      if (label !== "Team") await audit(page, shot);
    }
    // Scrolled header: is it still below the clock?
    await page.evaluate(() => window.scrollTo(0, 400)); await page.waitForTimeout(300);
    const hb = await page.locator("header.sc-office-header").first().boundingBox().catch(() => null);
    const bellB = await page.locator("header.sc-office-header button").first().boundingBox().catch(() => null);
    console.log("  sticky header at scroll 400:", JSON.stringify(hb), "first header button:", JSON.stringify(bellB));
    if (bellB && bellB.y < TOP) note("admin-header-scrolled", "under-status-bar", `header button y=${Math.round(bellB.y)}`);
    await page.screenshot({ path: `${OUT}/admin-header-scrolled.png` });
    // Bell
    const bell = page.locator('header button[aria-label*="otification" i]').first();
    if (await bell.isVisible().catch(() => false)) {
      await bell.click(); await page.waitForTimeout(1000); await audit(page, "admin-bell", { scrollBottom: false });
      await page.keyboard.press("Escape"); await page.waitForTimeout(400);
      const backdrop = page.locator("div.fixed.inset-0").first();
      if (await backdrop.isVisible().catch(() => false)) { await backdrop.click({ position: { x: 10, y: 500 }, timeout: 5000 }).catch(() => {}); await page.waitForTimeout(400); }
      if (await page.locator("div.fixed.inset-0").first().isVisible().catch(() => false)) { const cb = page.locator('button[aria-label*="lose" i]').last(); if (await cb.isVisible().catch(() => false)) await cb.click({ timeout: 5000 }).catch(() => {}); }
      await page.waitForTimeout(300);
    }
    // My dashboard link + tabs
    const my = page.locator('header a:has-text("My dashboard")').first();
    if (await my.isVisible().catch(() => false)) { await my.click({ timeout: 8000 }).catch((e) => note("admin-my-dashboard", "click-failed", e.message.split("\n")[0])); await page.waitForTimeout(2500); if (!page.url().includes("/dashboard")) note("admin-my-dashboard", "wrong-destination", page.url().replace(BASE, "")); }
    else { await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" }).catch(() => {}); await page.waitForTimeout(2000); }
    await tapTab(page, "Contacts", "/contacts"); await audit(page, "admin-contacts");
    await tapTab(page, "Links", "/share"); await audit(page, "admin-links");
    await tapTab(page, "Settings", "/settings"); await audit(page, "admin-settings");
    await tapTab(page, "Home", "/dashboard");
    await ctx.close();
  }

  // ── MEMBER (already active, has a card) ───────────────────────────────────
  if (!ONLY || ONLY === "member") {
  console.log("\nMEMBER (active)");
    const { ctx, page } = await newShellPage();
    await login(page, m1Email);
    await dismissOverlays(page);
    await audit(page, "member-dashboard");
    const adminTab = await page.locator('.sc-tabbar a:has-text("Admin")').count();
    if (adminTab) note("member-dashboard", "admin-tab-visible", "an employee sees the Admin tab");
    await tapTab(page, "Contacts", "/contacts"); await audit(page, "member-contacts");
    await tapTab(page, "Links", "/share"); await audit(page, "member-links");
    await tapTab(page, "Settings", "/settings"); await audit(page, "member-settings");
    await ctx.close();
  }

  // ── INVITED MEMBER (app-first: signs in before tapping the link) ─────────
  if (!ONLY || ONLY === "member2") {
  console.log("\nINVITED MEMBER (app-first)");
    const { ctx, page } = await newShellPage();
    await login(page, m2Email);
    await dismissOverlays(page);
    const landed = page.url().replace(BASE, "");
    console.log("  landed on", landed);
    if (!landed.startsWith("/join/")) note("join-landing", "wrong-destination", landed);
    await audit(page, "join-page");
    // The AI-consent sheet can mount a beat after the first dismissal pass and
    // cover the button; clear it again right before tapping.
    await page.waitForTimeout(1500); await dismissOverlays(page, { keepTour: true });
    const accept = page.locator('button:has-text("Accept invitation")').first();
    if (await accept.isVisible().catch(() => false)) {
      await accept.click({ timeout: 10000 }).catch(async () => { await dismissOverlays(page, { keepTour: true }); await accept.click({ timeout: 10000 }); }); await page.waitForURL(/cards\/new/, { timeout: 30000 }).catch(() => note("join-accept", "no-redirect", page.url()));
      await page.waitForTimeout(3000); await dismissOverlays(page);
      await audit(page, "wizard-1-info");
      await page.fill('input[placeholder="John Smith"]', "Jordan Okafor").catch((e) => note("wizard-1-info", "fill-failed", "name: " + e.message.split("\n")[0]));
      await page.fill('input[placeholder="Sales Director"]', "Associate Broker").catch(() => {});
      const phones = page.locator('input[placeholder="+1 (555) 000-0000"]');
      if (await phones.count()) await phones.first().fill("(503) 555-0177").catch(() => {});
      await page.fill('input[placeholder="john@company.com"]', m2Email).catch(() => {});
      const managed = await page.locator("text=Managed by your organization").count();
      console.log("  org-managed fields shown:", managed);
      for (const [label, shot] of [["Next: Card design →", "wizard-2-design"], ["Next: Socials →", "wizard-3-socials"], ["Next: Social design →", "wizard-4-social-design"]]) {
        const b = page.locator(`button:has-text("${label}")`).first();
        if (!(await b.isVisible().catch(() => false))) { note(shot, "missing-button", label); break; }
        if (await b.isDisabled().catch(() => false)) { note(shot, "button-disabled", label); break; }
        // Socials: the Swift Links bio is required unless the office set one
        // (then the box is read-only).
        if (label === "Next: Social design →") {
          const bio = page.locator("#wizard-bio");
          if (await bio.isEditable().catch(() => false)) await bio.fill("Associate broker helping Portland families buy their first home.").catch(() => {});
        }
        await b.click(); await page.waitForTimeout(1800); await dismissOverlays(page);
        await audit(page, shot);
      }
      const create = page.locator('button:has-text("Create card →")').first();
      if (await create.isVisible().catch(() => false)) {
        await create.click(); await page.waitForTimeout(5000); await dismissOverlays(page);
        const live = await page.locator("text=Your card is live!").count();
        if (!live) note("wizard-5-live", "not-live", "no 'Your card is live!' after Create card; url " + page.url().replace(BASE, ""));
        await audit(page, "wizard-5-live");
        const push = await page.locator("text=/notification/i").count();
        console.log("  push switch present on live screen:", push > 0);
        // The live screen's button was renamed "Go to my dashboard →"; the old
        // label made this whole member-tour check skip itself every night.
        const cont = page.locator('button:has-text("Go to my dashboard"), button:has-text("Continue to dashboard")').first();
        if (await cont.isVisible().catch(() => false)) {
          await cont.click(); await page.waitForTimeout(4000);
          const u = page.url().replace(BASE, "");
          if (!u.includes("tour=1")) note("member-tour", "no-tour-flag", "dashboard url " + u);
          await dismissOverlays(page, { keepTour: true }); // the first run skipped the tour itself here, then reported it missing
          await page.waitForTimeout(2500);
          const tourOn = await page.locator('text=Skip tour').count();
          const banner = await page.locator('text=Take a quick tour').count();
          console.log("  tour running:", tourOn > 0, "banner:", banner > 0);
          if (!tourOn && !banner) note("member-tour", "no-tour", "neither the tour nor its banner appeared after the first card");
          await page.screenshot({ path: `${OUT}/member-tour-running.png` });
          await audit(page, "member-new-dashboard", { scrollBottom: false });
          const skip = page.locator('button:has-text("Skip tour")').first();
          if (await skip.isVisible().catch(() => false)) { await skip.click(); await page.waitForTimeout(800); }
          await audit(page, "member-new-dashboard-after-tour");
        } else note("wizard-5-live", "missing-button", "Go to my dashboard");
      } else note("wizard-4-social-design", "missing-button", "Create card →");
    } else note("join-page", "missing-button", "Accept invitation →");
    await ctx.close();
  }
} catch (e) {
  console.error("FAILED:", e.stack?.split("\n").slice(0, 3).join(" | "));
} finally {
  if (browser) await browser.close().catch(() => {});
  console.log("\ncleaning up…");
  try {
    if (officeId) {
      // profiles.office_id references the office with NO cascade, and the
      // members' profiles still point at it here — so the office DELETE was
      // refused (unchecked), every night: 246 "Northbeam Commercial" offices
      // with no owner had piled up by 2026-10-02. Unlink first, then delete,
      // and say so if it still survives.
      await adm(`/rest/v1/profiles?office_id=eq.${officeId}`, { method: "PATCH", body: JSON.stringify({ office_id: null }) });
      await adm(`/rest/v1/office_members?office_id=eq.${officeId}`, { method: "DELETE" });
      const del = await adm(`/rest/v1/offices?id=eq.${officeId}`, { method: "DELETE" });
      if (!del.ok) console.error(`  OFFICE NOT DELETED (${del.status}) — remove manually: ${officeId}`);
    }
    for (const id of users) {
      const prof = await (await adm(`/rest/v1/profiles?id=eq.${id}&select=username`)).json().catch(() => []);
      const un = prof?.[0]?.username;
      if (un) { await adm(`/rest/v1/card_views?username=in.(${un},${un}__links)`, { method: "DELETE" }); await adm(`/rest/v1/leads?card_owner=eq.${un}`, { method: "DELETE" }); }
      await adm(`/rest/v1/notifications?user_id=eq.${id}`, { method: "DELETE" });
      await adm(`/rest/v1/cards?user_id=eq.${id}`, { method: "DELETE" });
      await adm(`/rest/v1/profiles?id=eq.${id}`, { method: "DELETE" });
      await adm(`/auth/v1/admin/users/${id}`, { method: "DELETE" });
    }
    console.log("  removed", users.length, "users and the office");
  } catch (e) { console.error("  CLEANUP FAILED — remove manually:", users, officeId, e.message); }
  writeFileSync(`${OUT}/issues.json`, JSON.stringify(issues, null, 2));
  console.log(`\n${issues.length} finding(s) written to ${OUT}/issues.json`);
}
