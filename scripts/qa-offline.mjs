// node scripts/qa-offline.mjs   env: BASE=<url> (default https://swiftcard.me)  OUT=<dir>
//                                     QA_OFFLINE_CARD=<slug> (default demo-sales)
//                                     QA_OFFLINE_NAME=<name on it> (default Alex Morgan)
//
// "If someone scans their card even offline, it will still load on their
// phone … at a conference there might not be good service." (owner, 2026-10-06)
//
// Real Chromium against the real site: open a card with signal, as a person
// would (public/sw.js saves it once someone has looked), then take the
// network away entirely and check what a phone with no signal gets:
//   1. the card itself, served from the phone, name and Save Contact on it;
//   2. the card's contact file, the one Save Contact hands a phone;
//   3. a page this phone never opened → the "You're offline" screen, which
//      lists the saved card.
// Runs nightly and after every deploy (.github/workflows/nightly-qa.yml).
//
// Read-only: every write the page would make (the view, link taps, the
// signup nudge's analytics) is answered here and never reaches production,
// and Vercel/PostHog beacons are dropped. Writes ${OUT}/failures.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { markInternal } from "./qa-internal.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = (process.env.BASE || "https://swiftcard.me").replace(/\/$/, "");
const OUT = process.env.OUT || "qa-offline-out";
const CARD = (process.env.QA_OFFLINE_CARD || "demo-sales").toLowerCase();
const NAME = process.env.QA_OFFLINE_NAME || "Alex Morgan";
mkdirSync(OUT, { recursive: true });

const failures = [];
const fail = (m) => { failures.push(m); console.error(`✗ ${m}`); };
const ok = (m) => console.log(`✓ ${m}`);

const browser = await chromium.launch();
try {
  const ctx = await markInternal(await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }), BASE);
  // The worker saves a card only once a PERSON has looked (the same gate as
  // the view count), and that gate refuses automation.
  await ctx.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false, configurable: true });
  });
  // Nothing this check does may write to production.
  await ctx.route(/\/api\/(card-events|leads|analytics\/event|account-exists)/, (r) =>
    r.request().method() === "GET" ? r.continue() : r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await ctx.route(/\/_vercel\/|posthog\.com/, (r) => r.fulfill({ status: 204, body: "" }));

  const page = await ctx.newPage();
  const first = await page.goto(`${BASE}/${CARD}`, { waitUntil: "load" });
  if (!first || first.status() !== 200) throw new Error(`/${CARD} answered ${first?.status()} with signal`);
  ok(`/${CARD} opened with signal`);

  let saved = false;
  for (let i = 0; i < 120 && !saved; i++) {
    saved = await page.evaluate(async (slug) => {
      if (!navigator.serviceWorker?.controller) return false;
      const c = await caches.open("sc-cards-v1");
      return !!(await c.match(`/${slug}`)) && !!(await c.match(`/api/card/${slug}/vcard`));
    }, CARD).catch(() => false);
    if (!saved) await page.waitForTimeout(250);
  }
  if (!saved) throw new Error("the card was never saved on the phone (no service worker, or the save never ran)");
  ok("saved on the phone: page and contact file");

  // No signal. setOffline flips navigator.onLine; the route makes sure even
  // the worker's own requests fail, like a phone with no reception.
  await ctx.setOffline(true);
  await ctx.route("**/*", (r) => r.abort("internetdisconnected"));

  const again = await page.reload({ waitUntil: "load" }).catch((e) => fail(`reload with no signal threw: ${e.message}`));
  const body = (await page.textContent("body").catch(() => "")) || "";
  if (!again?.fromServiceWorker()) fail("with no signal the card did not come from the phone");
  if (!body.includes(NAME)) fail(`with no signal the card does not show "${NAME}"`);
  else ok(`with no signal the card opens and shows "${NAME}"`);
  if (!body.includes("Save Contact")) fail('with no signal the card has no "Save Contact"');

  const vcard = await page.evaluate(async (slug) => {
    try {
      const r = await fetch(`/api/card/${slug}/vcard`);
      return { type: r.headers.get("Content-Type") || "", text: await r.text() };
    } catch (e) { return { type: "", text: `threw: ${e.message}` }; }
  }, CARD);
  if (!vcard.type.includes("text/vcard") || !vcard.text.startsWith("BEGIN:VCARD") || !vcard.text.includes(`FN:${NAME}`)) {
    fail(`with no signal the contact file is wrong: ${vcard.type} ${vcard.text.slice(0, 80)}`);
  } else ok("with no signal Save Contact's file still arrives");

  await page.goto(`${BASE}/__qa-offline-never-opened`).catch(() => {});
  const offline = (await page.textContent("body").catch(() => "")) || "";
  if (!offline.includes("You're offline")) fail('a page never opened here does not show "You\'re offline"');
  else ok("a page never opened here shows the no-signal screen");
  if (!offline.includes(NAME)) fail("the no-signal screen does not list the saved card");

  await ctx.close();
} catch (e) {
  fail(e.message);
} finally {
  await browser.close();
}

writeFileSync(`${OUT}/failures.json`, JSON.stringify(failures, null, 2));
console.log(failures.length ? `\n${failures.length} problem(s)` : "\nall good");
process.exit(failures.length ? 1 : 0);
