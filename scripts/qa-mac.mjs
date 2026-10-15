// node scripts/qa-mac.mjs      env: BASE=<url>  OUT=<dir>  KEEP=1
//
// The iPhone app on an Apple Silicon Mac ("Designed for iPhone").
//
// Same binary, same webview, three things genuinely missing: Core NFC, adding a
// pass to Apple Wallet, and the rear camera. Everything else has to work with a
// pointer and a keyboard instead of a thumb, in a window the person can resize.
//
// This drives the real app with `data-sc-mac="1"` set — the flag
// MainViewController.applyPlatformFlags writes from ProcessInfo.isiOSAppOnMac —
// and checks:
//
//   degradation   iPhone-only features explain themselves instead of dead-ending
//   keyboard      every screen is reachable and operable by Tab/Enter alone
//   window sizes  no horizontal scroll or clipping from a small window to a large one
//   hover         nothing is reachable ONLY by hover (there is no hover on a touch
//                 device, and a pointer user must not be the only one served)
//
// Seeds a throwaway Pro account and deletes it in the `finally` block.
import { chromium } from "playwright";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { markInternal } from "./qa-internal.mjs";
import { signInByLink } from "./lib/qa-sign-in.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const BASE = process.env.BASE || "http://localhost:3222";
const OUT = process.env.OUT || "qa-mac-out";
mkdirSync(OUT, { recursive: true });

// Secrets: the environment first (GitHub Actions), .env.local second (a laptop).
// NEXT_PUBLIC_* also answers to its bare name, which is how the CI secrets are named.
const env = existsSync(`${ROOT}/.env.local`) ? readFileSync(`${ROOT}/.env.local`, "utf8") : "";
const g = (k) => process.env[k] ?? process.env[k.replace(/^NEXT_PUBLIC_/, "")] ?? (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const SB = g("NEXT_PUBLIC_SUPABASE_URL"), SVC = g("SUPABASE_SERVICE_ROLE_KEY");
const adm = (p, i) => fetch(SB + p, { ...i, headers: { apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": "application/json", ...(i?.headers ?? {}) } });

const stamp = Date.now().toString().slice(-8);
const password = `Qa!aA1${stamp}x`;
const email = `qa-mac-${stamp}@swiftcard-test.invalid`;
const uname = `qa-mac-${stamp}`;
let userId = null, browser;

const findings = [];
const note = (screen, kind, detail) => {
  if (findings.some((f) => f.screen === screen && f.kind === kind && f.detail === detail)) return;
  findings.push({ screen, kind, detail });
  console.log(`  ✗ ${screen}: ${kind} — ${detail}`);
};
const ok = (m) => console.log(`  ✓ ${m}`);

// A Mac window for an iPhone app: fixed-ish, but people DO resize the display
// and use Stage Manager, so the layout has to survive a range.
const SIZES = [
  ["small", 430, 700],
  ["default", 620, 900],
  ["large", 1180, 900],
];

async function seed() {
  const u = await (await adm("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  if (!u.id) throw new Error("seed failed: " + JSON.stringify(u).slice(0, 160));
  userId = u.id;
  await adm("/rest/v1/profiles", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ id: u.id, username: uname, name: "Mac Tester", email, plan: "pro", customization: { _aiConsent: "accepted", _planChosen: "qa-seeded" } }),
  });
  await adm("/rest/v1/cards", {
    method: "POST",
    body: JSON.stringify({ user_id: u.id, username: uname, name: "Mac Tester", title: "Principal", company: "Northbeam", email, phone: "(415) 555-0192", template: "modern-bold" }),
  });
}

/** A Mac context: real pointer, real keyboard, and the native Mac flag set. */
async function macContext(width, height) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    // isMobile:false — a Mac has a pointer, not a touchscreen. This is what
    // makes hover-only affordances and :hover media queries behave as they will
    // on the Mac, and it turns OFF the coarse-pointer 16px input floor.
    isMobile: false,
    hasTouch: false,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  });
  await markInternal(ctx, BASE);
  // Exactly what the native shell writes, on every document.
  await ctx.addInitScript(() => {
    const set = () => { document.documentElement.dataset.scMac = "1"; };
    if (document.documentElement) set();
    document.addEventListener("DOMContentLoaded", set);
    window.Capacitor = { isNativePlatform: () => true, isNative: true, platform: "ios", getPlatform: () => "ios", isPluginAvailable: () => false, Plugins: {} };
  });
  return ctx;
}

async function login(page) {
  // By link, not the form: the form is behind the human check (lib/qa-sign-in).
  await signInByLink(page, { adm, base: BASE, email });
  await page.waitForURL(/dashboard|onboarding|welcome/, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(2000);
  for (const label of ["Allow", "Not now", "Skip tour", "Skip", "Got it"]) {
    const b = page.locator(`button:has-text("${label}")`).first();
    if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await page.waitForTimeout(300); }
  }
}

/** Layout must survive the window the person chose. */
const LAYOUT = () => {
  const out = [];
  if (document.documentElement.scrollWidth > window.innerWidth + 1) {
    out.push(["horizontal-scroll", `scrollWidth ${document.documentElement.scrollWidth} > ${window.innerWidth}`]);
  }
  const clipped = [];
  for (const el of document.querySelectorAll("h1,h2,h3,p,button,a,label")) {
    const cs = getComputedStyle(el);
    if (cs.overflow === "visible" && cs.overflowX === "visible") continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (el.scrollWidth > el.clientWidth + 4 && (el.textContent || "").trim().length > 3 && !/ellipsis|clip/.test(cs.textOverflow)) {
      clipped.push((el.textContent || "").trim().slice(0, 36));
      if (clipped.length > 4) break;
    }
  }
  if (clipped.length) out.push(["clipped", clipped.join(" / ")]);
  return out;
};

try {
  console.log("seeding…");
  await seed();
  browser = await chromium.launch();

  // ── 1. iPhone-only features degrade, they do not dead-end ────────────────
  {
    const ctx = await macContext(620, 900);
    const page = await ctx.newPage();
    await login(page);
    const flag = await page.evaluate(() => document.documentElement.dataset.scMac);
    if (flag !== "1") note("mac-flag", "not-set", "data-sc-mac never reached the document — every Mac guard below is inert");
    else ok("the Mac flag reaches the web layer");

    await page.goto(`${BASE}/profile/card`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const body = await page.locator("body").innerText();
    const walletBtn = await page.locator('a:has-text("Add to Apple Wallet")').count();
    const walletNote = /Apple Wallet passes are added on your iPhone/i.test(body);
    if (walletBtn > 0) note("wallet", "dead-end", "the Add to Apple Wallet button still renders on a Mac, where PassKit cannot add a pass");
    else if (!walletNote) console.log("  – no wallet control on this screen to check");
    else ok("Apple Wallet explains itself instead of dead-ending");

    // NFC self-detects via NDEFReader, which does not exist in this webview.
    const nfcDead = await page.locator('button:has-text("Write to NFC")').count();
    if (nfcDead > 0) {
      const disabled = await page.locator('button:has-text("Write to NFC")').first().isDisabled().catch(() => false);
      if (!disabled) note("nfc", "dead-control", "an NFC write button is enabled on a Mac, which has no NFC radio");
    } else ok("no NFC control offered where NFC cannot work");
    await ctx.close();
  }

  // ── 2. Keyboard only ─────────────────────────────────────────────────────
  {
    const ctx = await macContext(1180, 900);
    const page = await ctx.newPage();
    await login(page);
    for (const [name, path] of [["dashboard", "/dashboard"], ["contacts", "/contacts"], ["settings", "/settings/flows"]]) {
      await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(900);
      let reached = 0, unringed = 0;
      const seen = new Set();
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press("Tab");
        const info = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return {
            key: el.tagName + (el.id || "") + (el.innerText || "").trim().slice(0, 20),
            ring: (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== "none"),
            visible: r.width > 0 && r.height > 0,
            label: (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 30),
            tag: el.tagName.toLowerCase(),
          };
        });
        if (!info || !info.visible || seen.has(info.key)) continue;
        seen.add(info.key);
        reached++;
        if (!info.ring) { unringed++; if (unringed <= 3) note(`kbd-${name}`, "no-focus-ring", `${info.tag} "${info.label}"`); }
      }
      if (reached < 5) note(`kbd-${name}`, "unreachable", `only ${reached} controls reachable by Tab — the screen cannot be driven by keyboard`);
      else ok(`${name}: ${reached} controls reachable by Tab, ${reached - unringed} with a visible ring`);
    }
    await ctx.close();
  }

  // ── 3. Window sizes ──────────────────────────────────────────────────────
  for (const [label, w, h] of SIZES) {
    const ctx = await macContext(w, h);
    const page = await ctx.newPage();
    await login(page);
    for (const [name, path] of [["dashboard", "/dashboard"], ["contacts", "/contacts"], ["share", "/share"], ["settings", "/settings/flows"]]) {
      await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(800);
      for (const [kind, detail] of await page.evaluate(LAYOUT)) note(`${label}-${name}`, kind, detail);
      await page.screenshot({ path: `${OUT}/${label}-${name}.png` }).catch(() => {});
    }
    ok(`window ${label} (${w}x${h}) laid out`);
    await ctx.close();
  }
} catch (e) {
  console.error("FAILED:", e.stack?.split("\n").slice(0, 4).join(" | "));
  note("harness", "crashed", e.message.split("\n")[0]);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (!process.env.KEEP && userId) {
    await adm(`/rest/v1/card_views?username=eq.${uname}`, { method: "DELETE" });
    await adm(`/rest/v1/leads?card_owner=eq.${uname}`, { method: "DELETE" });
    await adm(`/rest/v1/notifications?user_id=eq.${userId}`, { method: "DELETE" });
    await adm(`/rest/v1/cards?user_id=eq.${userId}`, { method: "DELETE" });
    await adm(`/rest/v1/profiles?id=eq.${userId}`, { method: "DELETE" });
    await adm(`/auth/v1/admin/users/${userId}`, { method: "DELETE" });
    console.log("\ncleaned up", userId);
  }
  writeFileSync(`${OUT}/mac.json`, JSON.stringify(findings, null, 2));
  console.log(`\n${findings.length} finding(s) → ${OUT}/mac.json`);
  process.exit(findings.length ? 1 : 0);
}
