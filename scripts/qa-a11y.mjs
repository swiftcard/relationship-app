// node scripts/qa-a11y.mjs
//   env: BASE=<url>  OUT=<dir>  ONLY=logged-out|pro  WIDTHS=390,1280  KEEP=1
//
// The accessibility audit behind Apple's Accessibility Nutrition Labels.
//
// SwiftCard's iOS app is a WKWebView on https://swiftcard.me (capacitor.config
// server.url), so VoiceOver, Voice Control, Larger Text, Dark Interface,
// Reduced Motion, Sufficient Contrast and Differentiate Without Color are all
// decided by the WEB layer. This measures them in a real browser rather than
// asserting them — Apple requires the labels to be accurate, and an unverified
// claim is worse than no claim.
//
// Per screen it runs axe-core (WCAG 2.0/2.1 A + AA) and then six checks axe
// does not cover, each mapped to the label it supports:
//
//   larger-text   scale the root font 200% (≈ AX5) → does text actually grow,
//                 and does anything clip or overflow sideways when it does?
//   reduced-motion  under prefers-reduced-motion, is anything still animating?
//   dark           does the dark theme actually paint dark, with live text?
//   voice-control   every control's accessible name must contain its visible
//                 label, or "tap <label>" fails
//   focus-visible   every focusable control must show a focus indicator
//   colour-only     links in prose must not be distinguished by colour alone
//
// Seeds a throwaway Pro account and deletes it in the `finally` block.
import { chromium } from "playwright";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { markInternal } from "./qa-internal.mjs";

const require_ = createRequire(import.meta.url);
const AXE_SRC = readFileSync(require_.resolve("axe-core/axe.min.js"), "utf8");

const ROOT = new URL("..", import.meta.url).pathname;
const BASE = process.env.BASE || "http://localhost:3222";
const OUT = process.env.OUT || "qa-a11y-out";
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
let browser;

const findings = [];
const note = (screen, kind, detail, impact = "serious") => {
  if (findings.some((f) => f.screen === screen && f.kind === kind && f.detail === detail)) return;
  findings.push({ screen, kind, detail, impact });
};

let seedN = 0;
async function seedPro() {
  const tag = `${stamp}${seedN++ ? "b" : ""}`;
  const email = `qa-a11y-${tag}@swiftcard-test.invalid`;
  const uname = `qa-a11y-${tag}`;
  const u = await (await adm("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  if (!u.id) throw new Error("seed failed: " + JSON.stringify(u).slice(0, 160));
  users.push({ id: u.id, uname });
  await adm("/rest/v1/profiles", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ id: u.id, username: uname, name: "Ada Lovelace", email, plan: "pro", customization: { _aiConsent: "accepted", _planChosen: "qa-seeded" } }),
  });
  await adm("/rest/v1/cards", {
    method: "POST",
    body: JSON.stringify({ user_id: u.id, username: uname, name: "Ada Lovelace", title: "Principal Engineer", company: "Analytical Engines", email, phone: "(415) 555-0192", template: "modern-bold" }),
  });
  return { email, uname };
}

// ── axe ──────────────────────────────────────────────────────────────────────
async function runAxe(page, screen) {
  await page.evaluate(AXE_SRC);
  const res = await page.evaluate(async () => {
    // @ts-expect-error — axe is injected into the page above
    return await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      resultTypes: ["violations"],
    });
  });
  for (const v of res.violations) {
    const where = v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ");
    note(screen, `axe:${v.id}`, `${v.help} — ${where}`, v.impact ?? "serious");
  }
  return res.violations.length;
}

// ── the six checks axe does not do ──────────────────────────────────────────

/** Larger Text: text must actually grow, and nothing may clip when it does. */
const LARGER_TEXT = () => {
  const out = [];
  const sample = [...document.querySelectorAll("h1,h2,h3,p,button,a,label,span")]
    .filter((el) => (el.textContent || "").trim().length > 3)
    .slice(0, 60);
  const before = sample.map((el) => parseFloat(getComputedStyle(el).fontSize));
  const root = document.documentElement;
  const prior = root.style.fontSize;
  root.style.fontSize = "32px"; // 200% of the 16px default
  void root.offsetHeight;
  const after = sample.map((el) => parseFloat(getComputedStyle(el).fontSize));
  let grew = 0;
  for (let i = 0; i < sample.length; i++) if (after[i] > before[i] + 0.5) grew++;
  const ratio = sample.length ? grew / sample.length : 1;
  // Anything clipped by its own box once the text is bigger.
  // Clipping that LOSES text, not truncation that signals itself.
  //
  // A URL with `truncate` (overflow:hidden + text-overflow:ellipsis) is a
  // deliberate, accessible pattern: the full string stays in the DOM for
  // VoiceOver and the ellipsis tells a sighted reader there is more. Counting
  // those as Larger Text failures put 5 false positives in the report. What is
  // a real failure is VERTICAL clipping — a fixed-height box that simply eats
  // the extra lines when the type grows, with nothing to show for it.
  const clipped = [];
  for (const el of sample) {
    const cs = getComputedStyle(el);
    if (cs.overflowY === "visible") continue;
    if (el.scrollHeight > el.clientHeight + 2) {
      clipped.push((el.textContent || "").trim().slice(0, 40));
      if (clipped.length > 5) break;
    }
  }
  const overflow = document.documentElement.scrollWidth > window.innerWidth + 1;
  root.style.fontSize = prior;
  return { ratio, grew, total: sample.length, clipped, overflow, out };
};

/** Reduced Motion: nothing should still be animating. */
const REDUCED_MOTION = () => {
  const still = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    const dur = (s) => s.split(",").map((v) => parseFloat(v) || 0).reduce((a, b) => Math.max(a, b), 0);
    // MOVEMENT is what reduced motion is about. Colour and opacity transitions
    // are not vestibular triggers and globals.css deliberately keeps them —
    // flagging them made 72 "failures" out of the policy working as designed.
    // What must not survive: running animations, and transitions that move
    // something (transform/translate/scale/rotate, or a blanket `all`).
    const anim = dur(cs.animationDuration) > 0.05 && cs.animationName !== "none" && cs.animationIterationCount !== "0";
    const trans = dur(cs.transitionDuration) > 0.05 && /\btransform\b|\btranslate\b|\bscale\b|\brotate\b|\ball\b/.test(cs.transitionProperty);
    if (!anim && !trans) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    still.push(`${el.tagName.toLowerCase()}${typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/)[0] : ""}` +
      ` ${anim ? "animation:" + cs.animationName : "transition:" + cs.transitionProperty}`);
    if (still.length > 8) break;
  }
  return still;
};

/** Dark Interface: the page must actually be dark, with readable text. */
const DARK = () => {
  const bg = getComputedStyle(document.body).backgroundColor;
  const lum = (c) => {
    const m = c.match(/\d+(\.\d+)?/g);
    if (!m) return null;
    const [r, gg, b] = m.slice(0, 3).map(Number);
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(gg) + 0.0722 * f(b);
  };
  const L = lum(bg);
  const theme = document.documentElement.getAttribute("data-sc-theme");
  return { bg, luminance: L, theme, isDark: L !== null && L < 0.2 };
};

/** Voice Control: "tap <visible label>" must match the accessible name. */
const VOICE_CONTROL = () => {
  const bad = [];
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  for (const el of document.querySelectorAll("button, a[href], [role='button'], [role='switch'], [role='tab']")) {
    if (!vis(el)) continue;
    // Only text that assistive tech can actually see: a decorative preview
    // marked inert/aria-hidden is not part of the control's visible label, and
    // counting it made every named button look mismatched.
    const clone = el.cloneNode(true);
    for (const h of clone.querySelectorAll("[aria-hidden='true'], [inert]")) h.remove();
    const visible = (clone.innerText || clone.textContent || "").trim().replace(/\s+/g, " ");
    if (!visible) continue; // icon-only: axe covers whether it has a name at all
    const label = el.getAttribute("aria-label");
    if (!label) continue;   // no aria-label → the visible text IS the name. Fine.
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
    if (!norm(label).includes(norm(visible)) && !norm(visible).includes(norm(label))) {
      bad.push(`visible "${visible.slice(0, 30)}" but aria-label "${label.slice(0, 30)}"`);
      if (bad.length > 6) break;
    }
  }
  return bad;
};

/**
 * Every focusable control must show a focus indicator — measured with real Tab
 * presses, not el.focus().
 *
 * :focus-visible deliberately does NOT match when a button is focused
 * programmatically: the browser only counts it as "visible" focus after a
 * keyboard interaction. The first version of this check called el.focus() and
 * so reported the app's global focus ring as missing on every button. Tab is
 * what a keyboard user does, so Tab is what we measure.
 */
async function tabFocusFailures(page, steps = 30) {
  const bad = [];
  await page.evaluate(() => { (document.activeElement instanceof HTMLElement) && document.activeElement.blur(); });
  const seen = new Set();
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      let ring =
        (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) ||
        (cs.boxShadow && cs.boxShadow !== "none");
      // A ring drawn on the control's CONTAINER via :focus-within is a real,
      // visible focus indicator (WCAG 2.4.7 asks for a visible indicator, not
      // for it to be painted on the element itself). The homepage claim pill
      // does this on purpose: the input has no outline, the whole pill lights
      // up. Compare the ancestor's shadow with focus present vs. removed, so a
      // container that merely has a RESTING shadow does not count.
      if (!ring) {
        let anc = el.parentElement;
        for (let depth = 0; anc && depth < 3 && !ring; depth++, anc = anc.parentElement) {
          if (!anc.matches(":focus-within")) continue;
          const focused = getComputedStyle(anc).boxShadow + "|" + getComputedStyle(anc).outlineStyle + getComputedStyle(anc).outlineWidth;
          el.blur();
          const blurred = getComputedStyle(anc).boxShadow + "|" + getComputedStyle(anc).outlineStyle + getComputedStyle(anc).outlineWidth;
          el.focus({ preventScroll: true });
          if (focused !== blurred) ring = true;
        }
      }
      return {
        key: el.tagName + "|" + (el.id || "") + "|" + (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 24),
        tag: el.tagName.toLowerCase(),
        isFrame: el.tagName === "IFRAME",
        label: (el.innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").trim().slice(0, 34),
        ring,
        offscreen: r.width === 0 || r.height === 0,
      };
    });
    if (!info || info.offscreen || info.isFrame) continue;
    if (seen.has(info.key)) continue;
    seen.add(info.key);
    if (!info.ring) bad.push(`${info.tag} "${info.label}"`);
    if (bad.length > 6) break;
  }
  return bad;
}

/**
 * A link inside PROSE must not be distinguished by colour alone (WCAG 1.4.1).
 *
 * "Prose" is the whole point of the rule and the whole difficulty of the check.
 * A footer column of link-only <li>s is not a block of text — there is no
 * surrounding copy for the link to be confused with — and the first version of
 * this check flagged 49 of them, every one a false positive. So: skip anything
 * inside nav/footer, and require real non-link text in the same parent.
 */
const COLOUR_ONLY_LINKS = () => {
  const bad = [];
  for (const a of document.querySelectorAll("p a[href], li a[href]")) {
    const r = a.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (a.closest("nav, footer, [role='navigation']")) continue;
    const par = a.parentElement;
    if (!par) continue;
    const parentText = (par.innerText || "").trim();
    const linkText = [...par.querySelectorAll("a")].map((x) => (x.innerText || "").trim()).join("");
    if (parentText.length - linkText.length < 20) continue; // not embedded in prose
    const cs = getComputedStyle(a);
    const parent = getComputedStyle(par);
    const underlined = /underline/.test(cs.textDecorationLine);
    const bolder = parseInt(cs.fontWeight, 10) >= parseInt(parent.fontWeight, 10) + 100;
    const bordered = parseFloat(cs.borderBottomWidth) > 0;
    if (!underlined && !bolder && !bordered && cs.color !== parent.color) {
      bad.push(`"${(a.innerText || "").trim().slice(0, 34)}"`);
      if (bad.length > 6) break;
    }
  }
  return bad;
};

async function auditScreen(page, screen, path, { reducedMotion = false } = {}) {
  const res = await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => null);
  if (!res) { note(screen, "navigation", `could not load ${path}`, "critical"); return; }
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(700);

  const axeCount = await runAxe(page, screen);

  const lt = await page.evaluate(LARGER_TEXT);
  if (lt.ratio < 0.8) note(screen, "larger-text", `only ${lt.grew}/${lt.total} text nodes grew when the root font doubled — the rest are pinned in px`, "serious");
  if (lt.clipped.length) note(screen, "larger-text-clipped", `clipped at 200%: ${lt.clipped.join(" / ")}`, "serious");
  if (lt.overflow) note(screen, "larger-text-overflow", "the page scrolls sideways at 200% text", "serious");

  const vc = await page.evaluate(VOICE_CONTROL);
  for (const b of vc) note(screen, "voice-control", b, "serious");

  const fv = await tabFocusFailures(page);
  for (const b of fv) note(screen, "focus-visible", `no focus indicator: ${b}`, "serious");

  const co = await page.evaluate(COLOUR_ONLY_LINKS);
  for (const b of co) note(screen, "colour-only-link", `link distinguished by colour alone: ${b}`, "serious");

  if (reducedMotion) {
    const rm = await page.evaluate(REDUCED_MOTION);
    for (const b of rm) note(screen, "reduced-motion", `still animating under reduce: ${b}`, "moderate");
  }

  console.log(`  ${screen}: axe ${axeCount}, larger-text ${Math.round(lt.ratio * 100)}% scaled${lt.clipped.length ? ", CLIPPED" : ""}${vc.length ? `, voice ${vc.length}` : ""}${fv.length ? `, focus ${fv.length}` : ""}`);
}

const PUBLIC = [
  ["home", "/"], ["pricing", "/pricing"], ["login", "/login"], ["templates", "/templates"],
  ["contact", "/contact"], ["preview", "/preview"], ["cards-new", "/cards/new"], ["terms", "/terms"],
];
// The screens the iOS APP actually shows. capacitor.config points the shell at
// /dashboard and the marketing site is deliberately kept out of it, so these —
// not the marketing pages — are what an Accessibility Nutrition Label describes.
// ONLY=app audits exactly this set.
const PRIVATE = [
  ["dashboard", "/dashboard"], ["contacts", "/contacts"], ["share", "/share"],
  ["settings", "/settings/flows"], ["profile", "/profile"], ["upgrade", "/upgrade"],
  ["cards-new", "/cards/new"], ["profile-card", "/profile/card"],
  // The Links page shows one side at a time; this is its Swift Signature side.
  ["share-signature", "/share#signature"],
];

const WIDTHS = (process.env.WIDTHS || "390,1280").split(",").map(Number);
const ONLY = process.env.ONLY || "";

async function context(width, extra = {}) {
  const mobile = width < 700;
  return markInternal(await browser.newContext({
    viewport: { width, height: mobile ? 844 : 900 },
    isMobile: mobile, hasTouch: mobile,
    userAgent: mobile ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" : undefined,
    ...extra,
  }));
}

try {
  browser = await chromium.launch();
  for (const width of WIDTHS) {
    const tag = width < 700 ? "m" : "d";

    if ((!ONLY || ONLY === "logged-out") && ONLY !== "app") {
      console.log(`\nPUBLIC @ ${width}px`);
      const ctx = await context(width);
      const page = await ctx.newPage();
      for (const [name, path] of PUBLIC) await auditScreen(page, `${tag}-${name}`, path);
      await ctx.close();

      console.log(`\nPUBLIC @ ${width}px — reduced motion + dark`);
      const ctx2 = await context(width, { reducedMotion: "reduce", colorScheme: "dark" });
      const page2 = await ctx2.newPage();
      for (const [name, path] of PUBLIC.slice(0, 4)) {
        await auditScreen(page2, `${tag}-rm-${name}`, path, { reducedMotion: true });
        const dark = await page2.evaluate(DARK);
        if (!dark.isDark) note(`${tag}-rm-${name}`, "dark-interface", `body stays light under prefers-color-scheme: dark (bg ${dark.bg}, theme ${dark.theme})`, "serious");
      }
      await ctx2.close();
    }

    if (!ONLY || ONLY === "pro" || ONLY === "app") {
      console.log(`\nSIGNED IN @ ${width}px`);
      const { email } = await seedPro();
      const ctx = await context(width);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(600);
      await page.fill("#auth-email", email);
      await page.fill("#auth-password", password);
      await page.click('button[type="submit"]');
      await page.waitForURL(/dashboard|onboarding|welcome/, { timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(2000);
      for (const label of ["Allow", "Not now", "Skip tour", "Skip", "Got it"]) {
        const b = page.locator(`button:has-text("${label}")`).first();
        if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await page.waitForTimeout(300); }
      }
      for (const [name, path] of PRIVATE) await auditScreen(page, `${tag}-pro-${name}`, path);
      await ctx.close();
    }
  }
} catch (e) {
  console.error("FAILED:", e.stack?.split("\n").slice(0, 4).join(" | "));
  note("harness", "crashed", e.message.split("\n")[0], "critical");
} finally {
  if (browser) await browser.close().catch(() => {});
  if (!process.env.KEEP) {
    for (const u of users) {
      await adm(`/rest/v1/card_views?username=eq.${u.uname}`, { method: "DELETE" });
      await adm(`/rest/v1/leads?card_owner=eq.${u.uname}`, { method: "DELETE" });
      await adm(`/rest/v1/notifications?user_id=eq.${u.id}`, { method: "DELETE" });
      await adm(`/rest/v1/cards?user_id=eq.${u.id}`, { method: "DELETE" });
      await adm(`/rest/v1/profiles?id=eq.${u.id}`, { method: "DELETE" });
      await adm(`/auth/v1/admin/users/${u.id}`, { method: "DELETE" });
    }
    if (users.length) console.log("\ncleaned up", users.length, "user(s)");
  }
  writeFileSync(`${OUT}/a11y.json`, JSON.stringify(findings, null, 2));
  const byKind = findings.reduce((m, f) => ((m[f.kind] = (m[f.kind] || 0) + 1), m), {});
  console.log(`\n${findings.length} finding(s) → ${OUT}/a11y.json`);
  console.log(Object.entries(byKind).sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${String(n).padStart(3)} ${k}`).join("\n"));
}
