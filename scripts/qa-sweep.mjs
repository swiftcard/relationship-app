// node scripts/qa-sweep.mjs
//   env: BASE=<url>  OUT=<dir>  ONLY=logged-out|free|pro  WIDTHS=390,1280  KEEP=1
//
// The systematic sweep over the PERSONAL app (scripts/qa-office-shell.mjs already
// owns the Office/iOS-shell surface). It seeds throwaway Free and Pro accounts,
// walks every logged-out and logged-in screen at phone and desktop widths, and
// records what only a real browser can see:
//
//   • uncaught JS errors and console errors
//   • API calls that 4xx/5xx (the "looks fine, silently failed" class)
//   • error/not-found pages reached from a link that promised otherwise
//   • horizontal overflow, elements wider than the screen, covered controls
//   • broken images
//   • dead controls — links to nowhere, buttons with no handler
//
// Everything it creates is deleted in the `finally` block. Read-only against
// pre-existing data: it never touches an account it did not make.
import { chromium } from "playwright";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { markInternal } from "./qa-internal.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const BASE = process.env.BASE || "http://localhost:3111";
const OUT = process.env.OUT || "qa-sweep-out";
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

const issues = [];
const note = (screen, kind, detail) => {
  if (issues.some((i) => i.screen === screen && i.kind === kind && i.detail === detail)) return;
  issues.push({ screen, kind, detail });
  console.log(`  ! ${screen}: ${kind} — ${detail}`);
};

async function makeUser(email, name, uname, plan, withCard) {
  const u = await (await adm("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  if (!u.id) throw new Error("no user id: " + JSON.stringify(u).slice(0, 200));
  users.push(u.id);
  await adm("/rest/v1/profiles", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ id: u.id, username: uname, name, email, plan, customization: { _aiConsent: "accepted", _planChosen: "qa-seeded" } }),
  });
  if (withCard) {
    await adm("/rest/v1/cards", {
      method: "POST",
      body: JSON.stringify({
        user_id: u.id, username: uname, name, title: "Senior Client Partner", company: "Northbeam Group",
        email, phone: "(415) 555-0192", template: "modern-bold",
      }),
    });
  }
  return u.id;
}

// ── the audit, run inside the page ───────────────────────────────────────────
const AUDIT = async () => {
  // × the visual scale: a phone ZOOMS OUT to fit content wider than itself,
  // and then innerWidth grows with it, so an overflow measured against
  // innerWidth "fits" — how the dashboard's Rate us banner pushed the tab bar
  // off-screen unreported (2026-09-29). Scale is 1 on a computer.
  const W = innerWidth * (window.visualViewport?.scale ?? 1), H = innerHeight;
  const out = [];
  const vis = (el) => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
  };
  const desc = (el) =>
    `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}` +
    `${typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : ""} ` +
    `“${(el.innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("alt") || "").trim().slice(0, 40).replace(/\s+/g, " ")}”`;
  const isFixedish = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const p = getComputedStyle(n).position;
      if (p === "fixed" || p === "sticky") return n;
    }
    return null;
  };

  const txt = document.body.innerText || "";
  if (/Application error|Something went wrong|Internal Server Error|This page could not be found/i.test(txt)) {
    out.push(["error-page", txt.slice(0, 140).replace(/\s+/g, " ")]);
  }
  if (document.documentElement.scrollWidth > W + 1) {
    out.push(["horizontal-overflow", `scrollWidth ${document.documentElement.scrollWidth} > ${W}`]);
  }

  // The Next.js dev overlay is injected chrome, not the product.
  const all = [...document.querySelectorAll("body *")]
    .filter((el) => !el.closest("nextjs-portal") && el.tagName !== "NEXTJS-PORTAL")
    .filter(vis);
  // ShareCardCapture and friends park a render at left:-10000 for image capture.
  const offscreenClone = (r) => r.right <= 0 || r.left >= W;
  // Walk EVERY ancestor, not a fixed depth: a decorative glow inside a
  // section that clips is not an overflow, and stopping at six levels reported
  // a wall of them. `clip`/`hidden` on any ancestor means nothing escapes.
  const clippedByAncestor = (el) => {
    for (let n = el.parentElement; n; n = n.parentElement) {
      if (!/^(visible)$/.test(getComputedStyle(n).overflowX)) return true;
    }
    return false;
  };

  let wide = 0;
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (offscreenClone(r)) continue;
    const cs = getComputedStyle(el);
    if (cs.position === "fixed" || cs.pointerEvents === "none") continue; // decorations can't be interacted with
    if ((r.right > W + 1 || r.left < -1) && r.width < W * 2 && !clippedByAncestor(el)) {
      if (++wide <= 8) out.push(["wider-than-screen", `${desc(el)} ${Math.round(r.left)}..${Math.round(r.right)}`]);
    }
  }

  // Broken images: loaded but zero intrinsic size, or never completed.
  for (const img of document.querySelectorAll("img")) {
    if (!vis(img)) continue;
    if (img.complete && img.naturalWidth === 0) out.push(["broken-image", `${img.getAttribute("src")?.slice(0, 90)}`]);
  }

  // Dead controls: an anchor that goes nowhere, a button with nothing bound.
  let dead = 0;
  for (const el of all) {
    if (el.tagName === "A") {
      const href = el.getAttribute("href");
      if (href === null || href === "" || href === "#") {
        // A tab/disclosure implemented as <a role=button> with a handler is fine.
        if (el.getAttribute("role") === "button" || el.onclick) continue;
        if (++dead <= 6) out.push(["dead-link", desc(el)]);
      }
    }
  }

  // Interactive controls physically covered by something else.
  //
  // SCROLL TO IT FIRST, then ask. Until 2026-09-16 this measured wherever the
  // page happened to be sitting, and auditPage runs the whole audit at the top
  // AND at the bottom — so any control that shares the viewport with a sticky
  // action bar at one of those two positions was reported as covered. That is
  // not what a person experiences: they scroll the thing into view and tap it.
  //
  // It produced 15 of the 19 findings in the 2026-09-16 nightly, every one of
  // them a colour swatch in the Design panel "covered by" the Save changes bar.
  // Measured in a real browser with touch emulation, all 20 on-screen swatches
  // were reachable once scrolled to.
  //
  // This does NOT stop it catching the real thing. A control under a full-page
  // overlay, clipped out of its container, or sitting beneath a bar that covers
  // the middle of the screen is still covered after being scrolled to centre —
  // which is the case worth waking somebody for.
  let covered = 0;
  const settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  // An `inert` subtree cannot be clicked, focused or tabbed into — that is the
  // attribute's whole definition — so a link inside one is a picture of a
  // link, not a control. InertPreview wraps every editor preview and the
  // homepage's share-sheet mock this way, on purpose: a demo card's tel: row
  // must not start a phone call. Auditing those as "covered controls" reported
  // the mock's three rows under its dim overlay every night (issue #47).
  const inter = all
    .filter((el) => el.matches("button, a[href], [role='button'], input, select, textarea, [role='switch'], [role='tab']"))
    .filter((el) => !el.closest("[inert]"));
  for (const el of inter) {
    // A collapsed <details> keeps a layout box in Chrome while showing nothing,
    // so its contents measured as real controls sitting wherever they WOULD be —
    // underneath whatever the next section paints there. That is how five colour
    // swatches inside a closed "More options" came back covered every night
    // (2026-09-16: control 71,805 44x44, hit = the Section 3 card at 41,746).
    // The <summary> is the part a person can actually see and tap, so it stays
    // audited; everything behind it does not exist until they open it.
    if (el.closest("details:not([open])") && !el.closest("summary")) continue;
    const r0 = el.getBoundingClientRect();
    if (offscreenClone(r0)) continue;
    // Put it where a thumb would, then re-measure: scrolling moves it.
    el.scrollIntoView({ block: "center", inline: "nearest" });
    await settle();
    const r = el.getBoundingClientRect();
    if (r.bottom <= 0 || r.top >= H || offscreenClone(r)) continue;
    const cx = Math.min(W - 1, Math.max(0, r.left + r.width / 2));
    const cy = Math.min(H - 1, Math.max(0, r.top + r.height / 2));
    const hit = document.elementFromPoint(cx, cy);
    if (!hit || hit === el || el.contains(hit) || hit.contains(el)) continue;
    const fx = isFixedish(el), hitFixed = isFixedish(hit);
    if (hitFixed && !fx) continue;                       // content flowing under a bar is normal
    if (hitFixed) {
      const hr = hitFixed.getBoundingClientRect();
      if (hr.width >= W - 1 && hr.height >= H - 1 && !(hit.innerText || "").trim()) continue; // modal backdrop
    }
    if (hit.closest("[role='dialog'], [aria-modal='true']") && !el.closest("[role='dialog'], [aria-modal='true']")) continue;
    // A control inside a nested scroll area (the "scroll on phone to view" demo)
    // can sit under the sticky site nav at the moment it is measured; a real
    // visitor scrolls the phone, not the page. Only the page-level nav counts.
    if (hit.closest("nav") && (() => { for (let n = el.parentElement, i = 0; n && i < 8; n = n.parentElement, i++) { if (/auto|scroll/.test(getComputedStyle(n).overflowY)) return true; } return false; })()) continue;
    if (hit.tagName === "NEXTJS-PORTAL" || hit.closest("nextjs-portal")) continue; // dev overlay
    // A deliberate whole-block target, not an accident. The homepage hero lays
    // one "Open Alex Morgan's SwiftCard" button across a rendered demo card, so
    // the phone/email/website rows inside it are a PICTURE of a card — not links
    // a visitor is meant to tap individually. Three of them reported covered on
    // m-home and d-home every night.
    //
    // Kept deliberately narrow, because "covered by something interactive" is
    // otherwise exactly the real bug this check exists for: the coverer must be
    // interactive, absolutely positioned, AND fully contain the control. A bar
    // that merely overlaps part of a control still reports.
    const hitRect = hit.getBoundingClientRect();
    if (
      hit.matches("a[href], button, [role='button']") &&
      getComputedStyle(hit).position === "absolute" &&
      hitRect.left <= r.left + 1 && hitRect.right >= r.right - 1 &&
      hitRect.top <= r.top + 1 && hitRect.bottom >= r.bottom - 1
    ) continue;
    if (++covered <= 6) out.push(["covered-control", `${desc(el)} covered by ${desc(hit)}`]);
  }
  return out;
};

// Pages that MUST answer 404. A one-segment path is a card URL
// ([username]/page.tsx), and since 1a43b785 a missing card is a real 404 so
// Google drops it — the sweep counted that correct status as a failure. Here a
// 404 is the pass, and anything else is the finding: a 200 means soft 404s
// (missing cards served as live pages) are back.
const EXPECTED_404 = new Set(["/this-route-does-not-exist"]);
const isExpected404 = (url) => {
  try { return EXPECTED_404.has(new URL(url).pathname); } catch { return false; }
};

function wirePage(page, screenRef) {
  page.on("pageerror", (e) => note(screenRef.name, "js-error", e.message.split("\n")[0].slice(0, 160)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // Chromium logs a console error for every non-2xx resource; the response
    // listener below already reports those with method + status.
    if (/Failed to load resource/i.test(t)) return;
    // Google Identity Services complains on any origin that is not on the
    // OAuth client allowlist (localhost, a CI runner) and when FedCM has no
    // signed-in account. Environment, not product.
    if (/GSI_LOGGER|FedCM|Provider's accounts list is empty|Not signed in with the identity provider|accounts\.google\.com.*Content Security Policy/i.test(t)) return;
    // A fetch cancelled because the page navigated. The sweep walks a dozen
    // screens in a row, so an in-flight request is routinely abandoned; the
    // browser logs it with no page attached, which is why it arrived as
    // screen "unknown". A request that actually FAILED is reported by the
    // response listener below, with its method and status.
    if (/The request has been aborted|The user aborted a request|AbortError|Failed to fetch/i.test(t) && screenRef.name === "unknown") return;
    note(screenRef.name, "console-error", t.split("\n")[0].slice(0, 160));
  });
  page.on("response", (r) => {
    const u = r.url();
    if (!u.startsWith(BASE)) return;
    if (r.status() < 400) return;
    if (r.status() === 401 || r.status() === 403) return;  // gating is a feature; audited explicitly
    // The deliberate not-found page itself (visit() checks its status).
    if (r.status() === 404 && r.request().resourceType() === "document" && isExpected404(u)) return;
    note(screenRef.name, "http-" + r.status(), `${r.request().method()} ${u.replace(BASE, "")}`);
  });
  page.on("requestfailed", (r) => {
    if (!r.url().startsWith(BASE)) return;
    const why = r.failure()?.errorText ?? "";
    // ERR_ABORTED means the BROWSER cancelled the request, never that the
    // server failed one — a production build prefetches every link in view
    // (and follows the redirects they return) and drops the lot the moment you
    // navigate. That produced 616 "failures" in a single pass, enough noise to
    // bury a real finding. A genuine server fault arrives as a 4xx/5xx, which
    // the response handler above reports on its own.
    if (why.includes("ERR_ABORTED")) return;
    note(screenRef.name, "request-failed", `${r.method()} ${r.url().replace(BASE, "")} — ${why}`);
  });
}

async function auditPage(page, screenRef, name, { scrollBottom = true, shot = true } = {}) {
  screenRef.name = name;
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  let found = await page.evaluate(AUDIT);
  if (shot) await page.screenshot({ path: `${OUT}/${name}-top.png` }).catch(() => {});
  if (scrollBottom) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(500);
    const more = await page.evaluate(AUDIT);
    found = found.concat(more.filter((m) => !found.some((f) => f[0] === m[0] && f[1] === m[1])));
    if (shot) await page.screenshot({ path: `${OUT}/${name}-bottom.png` }).catch(() => {});
  }
  console.log(`  ${name}: ${found.length ? found.length + " finding(s)" : "clean"}`);
  for (const [kind, detail] of found) note(name, kind, detail);
  return found;
}

async function visit(page, screenRef, name, path, opts) {
  screenRef.name = name;
  const res = await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => {
    note(name, "navigation-failed", `${path} — ${e.message.split("\n")[0]}`);
    return null;
  });
  if (res && EXPECTED_404.has(path)) {
    if (res.status() !== 404) note(name, "soft-404", `${path} answered ${res.status()}, not 404`);
  } else if (res && res.status() >= 400) note(name, "page-http-" + res.status(), path);
  // Settle before auditing. Back-to-back navigations on production raced the
  // session refresh and audited a login wall where the editor was about to
  // render (2026-09-11); the same run with this pause was clean. A person
  // never navigates twelve screens in twelve seconds.
  await page.waitForTimeout(800);
  return auditPage(page, screenRef, name, opts);
}

async function login(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#auth-email", email);
  await page.fill("#auth-password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard|onboarding|welcome|office/, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(2500);
  // A sign-in that silently fails turns every later screen into a clean-looking
  // login wall (2026-09-11, CI: the Free account never got in and eleven
  // screens "passed"). Say so, loudly, with whatever the form said.
  if (await page.locator("#auth-email").isVisible().catch(() => false)) {
    const msg = await page.locator("[role='alert'], .text-red-600, .text-red-500, .text-red-400").first().innerText().catch(() => "");
    note("login", "login-failed", `${email} still on ${page.url().replace(BASE, "")} — ${msg.slice(0, 120) || "no message shown"}`);
    await page.screenshot({ path: `${OUT}/login-failed-${email.split("@")[0]}.png` }).catch(() => {});
  }
}

async function dismissOverlays(page) {
  for (const label of ["Allow", "Not now", "Skip tour", "Skip", "Got it", "Maybe later", "Done", "Close"]) {
    const b = page.locator(`button:has-text("${label}")`).first();
    if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await page.waitForTimeout(350); }
  }
}

const WIDTHS = (process.env.WIDTHS || "390,1280").split(",").map((n) => parseInt(n, 10));
const ONLY = process.env.ONLY || "";

async function newPage(width) {
  const mobile = width < 700;
  const ctx = await markInternal(await browser.newContext({
    viewport: { width, height: mobile ? 844 : 900 },
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: mobile,
    userAgent: mobile
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
      : undefined,
  }));
  const page = await ctx.newPage();
  const screenRef = { name: "unknown" };
  wirePage(page, screenRef);
  return { ctx, page, screenRef };
}

// Public/marketing surface — no account, no writes.
const LOGGED_OUT = [
  ["home", "/"], ["pricing", "/pricing"], ["templates", "/templates"], ["compare", "/compare"],
  ["contact", "/contact"], ["company", "/company"], ["blog", "/blog"], ["testimonials", "/testimonials"],
  ["grow", "/grow"], ["login", "/login"], ["privacy", "/privacy"], ["terms", "/terms"],
  ["sms-consent", "/sms-consent"], ["preview", "/preview"], ["cards-new-guest", "/cards/new"],
  ["seo-view-tracking", "/business-card-view-tracking"], ["seo-link-in-bio", "/link-in-bio-with-analytics"],
  ["product-cards", "/products/digital-cards"], ["for-realtors", "/for/real-estate-agents"],
  ["not-found", "/this-route-does-not-exist"],
];

// Signed-in surface. Every one is a read; nothing here submits a form.
// ── The card editor ─────────────────────────────────────────────────────────
//
// Everything above is a fixed path. The editor is not — it needs a card id —
// and that is exactly why it was the one screen this sweep never saw, while
// being the screen most of the design work lands on: templates, colours,
// finishes, panel photo/video, the Swift Links look panel, and the Pro-required
// dialog all live behind these four tabs. A phone check that skips it is
// checking the easy half.
//
// Each tab is audited separately because they share almost no markup; a control
// covered on "Social design" says nothing about "Card info".
const EDITOR_TABS = ["Card info", "Card design", "Socials", "Social design"];

async function cardIdFor(userId) {
  const rows = await (await adm(`/rest/v1/cards?user_id=eq.${userId}&select=id&limit=1`)).json().catch(() => []);
  return rows?.[0]?.id ?? null;
}

async function auditEditor(page, screenRef, prefix, userId) {
  const id = await cardIdFor(userId);
  if (!id) { note(prefix + "-edit", "harness", "no card id for seeded user"); return; }
  await visit(page, screenRef, `${prefix}-edit-content`, `/cards/${id}/edit`);
  await dismissOverlays(page);
  for (const label of EDITOR_TABS.slice(1)) {
    const btn = page.locator(`button:has-text("${label}")`).first();
    // WAIT for the tab rather than asking whether it is visible this instant.
    // The editor is a heavy client page — on a Pro account it also mounts the
    // custom designer — and an immediate isVisible() reported all four tabs
    // "missing" on a page where they were simply still arriving. A QA sweep
    // that cries wolf is worse than one that runs a second longer.
    if (!(await btn.waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false))) {
      note(`${prefix}-edit`, "missing-control", `tab "${label}" not visible`);
      continue;
    }
    await btn.click().catch(() => {});
    await page.waitForTimeout(900);
    const slug = label.toLowerCase().replace(/\s+/g, "-");
    await auditPage(page, screenRef, `${prefix}-edit-${slug}`);
  }
}

const LOGGED_IN = [
  ["dashboard", "/dashboard"], ["contacts", "/contacts"], ["share", "/share"],
  ["settings", "/settings/flows"], ["profile", "/profile"], ["profile-card", "/profile/card"],
  ["upgrade", "/upgrade"], ["cards-new", "/cards/new"], ["welcome", "/welcome"],
  ["email-prefs", "/email/preferences"],
  // The Links page shows one side at a time; this is its Swift Signature side.
  // Last on purpose: straight after /share it would be a same-page hash change,
  // not a load.
  ["share-signature", "/share#signature"],
];

try {
  browser = await chromium.launch();

  for (const width of WIDTHS) {
    const tag = width < 700 ? "m" : "d";

    if (!ONLY || ONLY === "logged-out") {
      console.log(`\nLOGGED OUT @ ${width}px`);
      const { ctx, page, screenRef } = await newPage(width);
      for (const [name, path] of LOGGED_OUT) await visit(page, screenRef, `${tag}-${name}`, path);

      // Back/forward must not strand the visitor on a blank or errored frame.
      screenRef.name = `${tag}-history`;
      await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForTimeout(800);
      await auditPage(page, screenRef, `${tag}-history-back`, { scrollBottom: false });
      // Named before the navigation, so what the forward load does is filed
      // under history-forward, not the screen before it.
      screenRef.name = `${tag}-history-forward`;
      await page.goForward({ waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForTimeout(800);
      await auditPage(page, screenRef, `${tag}-history-forward`, { scrollBottom: false });
      await ctx.close();
    }

    for (const plan of ["free", "pro"]) {
      if (ONLY && ONLY !== plan) continue;
      console.log(`\n${plan.toUpperCase()} @ ${width}px`);
      const email = `qa-${plan}-${tag}-${stamp}@swiftcard-test.invalid`;
      const uname = `qa-${plan}-${tag}-${stamp}`;
      const userId = await makeUser(email, plan === "pro" ? "Priya Raman" : "Sam Cole", uname, plan, true);
      const { ctx, page, screenRef } = await newPage(width);
      await login(page, email);
      await dismissOverlays(page);
      for (const [name, path] of LOGGED_IN) {
        await visit(page, screenRef, `${tag}-${plan}-${name}`, path);
        await dismissOverlays(page);
      }
      await auditEditor(page, screenRef, `${tag}-${plan}`, userId);
      // Reload persistence: the dashboard must come back the same, not empty.
      await visit(page, screenRef, `${tag}-${plan}-dashboard-reload`, "/dashboard", { scrollBottom: false });
      await ctx.close();
    }
  }
} catch (e) {
  console.error("FAILED:", e.stack?.split("\n").slice(0, 4).join(" | "));
  note("harness", "crashed", e.message.split("\n")[0]);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (process.env.KEEP) {
    console.log("\nKEEP=1 — leaving", users.length, "seeded user(s):", users.join(", "));
  } else {
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
