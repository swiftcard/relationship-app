// node scripts/qa-flows.mjs      env: BASE=<url>  OUT=<dir>  ONLY=<flow name>  KEEP=1
//
// The interaction half of the QA sweep. scripts/qa-sweep.mjs LOADS every screen
// and looks for what is visibly wrong; this one USES the app and looks for what
// is wrong only once you touch it:
//
//   • a form that says "Saved ✓" and did not save
//   • a value that does not survive a reload
//   • a double-tapped Save that writes twice
//   • a required field that submits empty
//   • a wrong password that leaves the button spinning forever
//   • back/forward landing on an error or a stale screen
//
// Seeds its own Pro account, drives it, deletes it. Never touches an account it
// did not create. Exits non-zero when a flow fails, so CI can gate on it.
import { chromium } from "playwright";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { markInternal } from "./qa-internal.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const BASE = process.env.BASE || "http://localhost:3111";
const OUT = process.env.OUT || "qa-flows-out";
mkdirSync(OUT, { recursive: true });

// Secrets: the environment first (GitHub Actions), .env.local second (a laptop).
// NEXT_PUBLIC_* also answers to its bare name, which is how the CI secrets are named.
const env = existsSync(`${ROOT}/.env.local`) ? readFileSync(`${ROOT}/.env.local`, "utf8") : "";
const g = (k) => process.env[k] ?? process.env[k.replace(/^NEXT_PUBLIC_/, "")] ?? (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const SB = g("NEXT_PUBLIC_SUPABASE_URL"), SVC = g("SUPABASE_SERVICE_ROLE_KEY");
const adm = (p, i) => fetch(SB + p, { ...i, headers: { apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": "application/json", ...(i?.headers ?? {}) } });

const stamp = Date.now().toString().slice(-8);
const password = `Qa!aA1${stamp}x`;
const email = `qa-flows-${stamp}@swiftcard-test.invalid`;
const uname = `qa-flows-${stamp}`;
let userId = null, cardId = null, browser;
/** Accounts a flow seeded for itself; torn down alongside the main one. */
const extraUsers = [];

const failures = [];
const fail = (flow, detail) => { failures.push({ flow, detail }); console.log(`  ✗ ${flow}: ${detail}`); };
const pass = (flow, detail = "") => console.log(`  ✓ ${flow}${detail ? " — " + detail : ""}`);

async function seed() {
  const u = await (await adm("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  if (!u.id) throw new Error("no user id: " + JSON.stringify(u).slice(0, 200));
  userId = u.id;
  await adm("/rest/v1/profiles", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ id: u.id, username: uname, name: "Dana Ellis", email, plan: "pro", customization: { _aiConsent: "accepted", _planChosen: "qa-seeded" } }),
  });
  const c = await (await adm("/rest/v1/cards", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: u.id, username: uname, name: "Dana Ellis", title: "Principal Broker",
      company: "Northbeam Group", email, phone: "(415) 555-0192", template: "modern-bold",
      // The Swift Links bio is required — the editor won't save a card
      // without one, so a real card always has it.
      customization: { bio: "Principal broker helping Bay Area families buy and sell with confidence." },
    }),
  })).json();
  cardId = c?.[0]?.id;
  if (!cardId) throw new Error("no card: " + JSON.stringify(c).slice(0, 200));
}

// Signed-in browser state, captured ONCE. Signing in per flow tripped
// Supabase's per-IP auth rate limit around the third flow and every later one
// timed out on the redirect — a harness artifact that looked exactly like a
// broken login. One sign-in, reused, is also what a real session looks like.
let storageState = null;

async function newPage({ signedIn = true } = {}) {
  const ctx = await markInternal(await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ...(signedIn && storageState ? { storageState } : {}),
  }));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => fail("js-error", `${page.url().replace(BASE, "")} — ${e.message.split("\n")[0].slice(0, 140)}`));
  return { ctx, page };
}

/**
 * Put a value in a field and make sure REACT has it, not just the DOM.
 *
 * page.fill() sets .value and fires one input event. Land that event in the
 * window before React has hydrated and the controlled component never sees it:
 * the box shows the text, the state behind it is still "", and the submit goes
 * out empty — which is how a run of this harness once made a perfectly good
 * sign-in form answer "missing email or phone". A human typing keystroke by
 * keystroke never hits it (verified); only an instant programmatic fill does.
 * So: settle first, then fill, then read it back and retry once.
 */
async function typeInto(page, selector, value) {
  await page.waitForSelector(selector, { timeout: 30000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.fill(selector, value);
  await page.waitForTimeout(250);
  if ((await page.inputValue(selector)) !== value) {
    await page.waitForTimeout(600);
    await page.fill(selector, value);
  }
}

async function signInOnce() {
  const ctx = await markInternal(await browser.newContext({ viewport: { width: 1280, height: 900 } }));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await typeInto(page, "#auth-email", email);
  await typeInto(page, "#auth-password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard|onboarding|welcome/, { timeout: 45000 });
  await page.waitForTimeout(2500);
  storageState = await ctx.storageState();
  await ctx.close();
}

/** With the session already in the context, "login" is just landing on a page. */
async function login(page) {
  if (!/\/(dashboard|contacts|share|settings|profile|cards)/.test(page.url())) {
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  }
  await page.waitForTimeout(1200);
  if (/\/login/.test(page.url())) throw new Error("session did not carry into the context");
}

async function dismissOverlays(page) {
  for (const label of ["Allow", "Not now", "Skip tour", "Skip", "Got it", "Maybe later", "Done"]) {
    const b = page.locator(`button:has-text("${label}")`).first();
    if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await page.waitForTimeout(300); }
  }
}

/** Count writes the page makes to our own API while `fn` runs. */
async function countWrites(page, match, fn) {
  const seen = [];
  const on = (r) => {
    const m = r.method();
    if (m === "GET" || m === "HEAD" || m === "OPTIONS") return;
    const u = r.url().replace(BASE, "");
    if (u.startsWith(match)) seen.push(`${m} ${u}`);
  };
  page.on("request", on);
  try { await fn(); } finally { page.off("request", on); }
  return seen;
}

const FLOWS = {};

// ── A. Card edit: it saves, it saves ONCE, and it survives a reload ──────────
FLOWS["card-edit-persistence"] = async () => {
  const { ctx, page } = await newPage();
  try {
    await login(page);
    await dismissOverlays(page);
    await page.goto(`${BASE}/cards/${cardId}/edit`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('input[placeholder="John Smith"]', { timeout: 30000 });

    const marker = `Edited ${stamp}`;
    await page.fill('input[placeholder="John Smith"]', marker);
    await page.fill('input[placeholder="Sales Director"]', `Title ${stamp}`);
    await page.fill('input[placeholder="Acme Corp"]', `Company ${stamp}`);

    // Double-tap Save. Exactly one write must reach the API.
    const save = page.locator('button:has-text("Save changes")').first();
    const writes = await countWrites(page, "/api/cards", async () => {
      await save.click();
      await save.click({ force: true, timeout: 2000 }).catch(() => {}); // disabled after the first — that IS the guard
      await page.waitForTimeout(3000);
    });
    const patches = writes.filter((w) => w.includes(`/api/cards/${cardId}`));
    if (patches.length === 0) fail("card-edit-persistence", "Save sent no request to /api/cards");
    else if (patches.length > 1) fail("card-edit-persistence", `double-tap wrote ${patches.length}×: ${patches.join(", ")}`);
    else pass("card-edit double-submit guard", "1 write");

    await page.waitForURL(/\/dashboard/, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);

    // Reload the editor from scratch: the values must be the ones we typed.
    await page.goto(`${BASE}/cards/${cardId}/edit`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('input[placeholder="John Smith"]', { timeout: 30000 });
    await page.waitForTimeout(1200);
    const back = await page.inputValue('input[placeholder="John Smith"]');
    if (back !== marker) fail("card-edit-persistence", `after reload name is "${back}", expected "${marker}"`);
    else pass("card-edit persistence", "name survived a reload");

    // And the server agrees — not just the client cache.
    const row = await (await adm(`/rest/v1/cards?id=eq.${cardId}&select=name,title,company`)).json();
    if (row?.[0]?.name !== marker) fail("card-edit-persistence", `DB name is "${row?.[0]?.name}", expected "${marker}"`);
    else pass("card-edit persistence", "DB row matches");
    await page.screenshot({ path: `${OUT}/card-edit-after-reload.png` }).catch(() => {});
  } finally { await ctx.close(); }
};

// ── B. Required field: an empty name must not save silently ─────────────────
FLOWS["card-edit-validation"] = async () => {
  const { ctx, page } = await newPage();
  try {
    await login(page);
    await dismissOverlays(page);
    await page.goto(`${BASE}/cards/${cardId}/edit`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('input[placeholder="John Smith"]', { timeout: 30000 });
    const before = await page.inputValue('input[placeholder="John Smith"]');

    await page.fill('input[placeholder="John Smith"]', "");
    await page.locator('button:has-text("Save changes")').first().click();
    await page.waitForTimeout(3000);

    const row = await (await adm(`/rest/v1/cards?id=eq.${cardId}&select=name`)).json();
    const nameNow = row?.[0]?.name ?? "";
    if (!nameNow.trim()) fail("card-edit-validation", "a blank required Full name was saved — the card now has no name");
    else pass("card-edit validation", `blank name rejected (still "${nameNow}")`);
    if (nameNow !== before) {
      // Not necessarily a bug (a server-side default is legitimate) — but say so.
      console.log(`    note: name changed from "${before}" to "${nameNow}" on the blank save`);
    }
    await page.screenshot({ path: `${OUT}/card-edit-blank-name.png` }).catch(() => {});
  } finally { await ctx.close(); }
};

// ── C. Profile form: Saved ✓ has to mean saved ───────────────────────────────
// ── B2. Required Swift Links bio: a blank bio must not save ─────────────────
// Save with it empty sends nothing, opens the Socials tab and puts the cursor
// in the box; typing one and saving again goes through.
FLOWS["card-edit-bio-required"] = async () => {
  const { ctx, page } = await newPage();
  try {
    await login(page);
    await dismissOverlays(page);
    await page.goto(`${BASE}/cards/${cardId}/edit`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('input[placeholder="John Smith"]', { timeout: 30000 });
    await page.waitForTimeout(1200);
    await page.locator('button:has-text("Socials")').first().click();
    await page.waitForSelector("#card-bio", { timeout: 10000 });
    await page.fill("#card-bio", "");
    await page.locator('button:has-text("Card info")').first().click();
    await page.waitForTimeout(600);

    const save = page.locator('button:has-text("Save changes")').first();
    const writes = await countWrites(page, "/api/cards", async () => { await save.click(); await page.waitForTimeout(2000); });
    if (writes.length) fail("card-edit-bio-required", `a blank bio was sent: ${writes.join(", ")}`);
    else pass("card-edit bio required", "blank bio not sent");
    const onSocials = await page.locator("#card-bio").isVisible().catch(() => false);
    const focused = await page.evaluate(() => document.activeElement?.id === "card-bio");
    if (!onSocials || !focused) fail("card-edit-bio-required", `Save did not take them to the bio (visible=${onSocials}, focused=${focused})`);
    else pass("card-edit bio required", "Save opened Socials with the bio focused");
    await page.screenshot({ path: `${OUT}/card-edit-bio-required.png` }).catch(() => {});

    const bio = `Bio ${stamp}`;
    await page.fill("#card-bio", bio);
    await save.click();
    await page.waitForURL(/\/dashboard/, { timeout: 20000 }).catch(() => {});
    const row = await (await adm(`/rest/v1/cards?id=eq.${cardId}&select=customization`)).json();
    if (row?.[0]?.customization?.bio !== bio) fail("card-edit-bio-required", `after filling it the DB bio is "${row?.[0]?.customization?.bio}"`);
    else pass("card-edit bio required", "a written bio saves");
  } finally { await ctx.close(); }
};

FLOWS["profile-persistence"] = async () => {
  const { ctx, page } = await newPage();
  try {
    await login(page);
    await dismissOverlays(page);
    await page.goto(`${BASE}/profile`, { waitUntil: "domcontentloaded" });
    const bio = page.locator('textarea[placeholder^="A short bio"]').first();
    if (!(await bio.isVisible().catch(() => false))) { console.log("  – profile bio field not present, skipping"); return; }
    const marker = `Bio marker ${stamp}`;
    await bio.fill(marker);
    const submit = page.locator('button[type="submit"]:has-text("Save Changes")').first();
    // Wait for the save to ANSWER, not a fixed 3.5s: a cold production function
    // took longer than that in CI (2026-09-11) and the reload below cancelled
    // the in-flight PATCH, which read as "data loss". A slow save is reported
    // as a slow save.
    let sentMarker = null, saveStatus = 0;
    const saved = page.waitForResponse((r) => r.url().includes("/api/profile") && r.request().method() === "PATCH", { timeout: 15000 }).catch(() => null);
    const t0 = Date.now();
    const writes = await countWrites(page, "/api/profile", async () => {
      await submit.click();
      await submit.click({ force: true, timeout: 2000 }).catch(() => {});
      const res = await saved;
      const ms = Date.now() - t0;
      sentMarker = !!res && (res.request().postData() || "").includes(marker);
      saveStatus = res ? res.status() : 0;
      if (!res) fail("profile-persistence", "the save never answered within 15s");
      else if (ms > 4000) fail("profile-save-speed", `save took ${ms}ms (budget 4000)`);
      else pass("profile save speed", `${ms}ms`);
      await page.waitForTimeout(800);
    });
    if (writes.length > 1) fail("profile-persistence", `double-tap wrote ${writes.length}×`);
    else pass("profile double-submit guard", `${writes.length} write`);

    const label = (await submit.innerText().catch(() => "")).trim();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);
    const back = await page.locator('textarea[placeholder^="A short bio"]').first().inputValue().catch(() => "");
    if (back !== marker) {
      const row = await (await adm(`/rest/v1/profiles?id=eq.${userId}&select=customization`)).json().catch(() => null);
      const inDb = JSON.stringify(row?.[0]?.customization ?? {}).includes(marker);
      fail("profile-persistence", `button said "${label}" but after reload the bio is "${back.slice(0, 40)}", expected "${marker}" — PATCH ${saveStatus}, marker sent=${sentMarker}, in DB=${inDb}`);
    }
    else pass("profile persistence", "bio survived a reload");
    await page.screenshot({ path: `${OUT}/profile-after-reload.png` }).catch(() => {});
  } finally { await ctx.close(); }
};

// ── D. Flow settings: same contract ─────────────────────────────────────────
FLOWS["flow-settings-persistence"] = async () => {
  const { ctx, page } = await newPage();
  try {
    await login(page);
    await dismissOverlays(page);
    // The automation note lives on /profile (SettingsShell on /settings/flows
    // renders one section at a time and does not include this form).
    await page.goto(`${BASE}/profile`, { waitUntil: "domcontentloaded" });
    const cta = page.locator('textarea[placeholder^="e.g. Book a call"]').first();
    if (!(await cta.isVisible().catch(() => false))) { console.log("  – flow CTA field not present, skipping"); return; }
    const marker = `Book me ${stamp}`;
    await cta.fill(marker);
    const submit = page.locator('button:has-text("Save Settings")').first();
    await submit.click();
    await page.waitForTimeout(3000);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);
    const back = await page.locator('textarea[placeholder^="e.g. Book a call"]').first().inputValue().catch(() => "");
    if (back !== marker) fail("flow-settings-persistence", `after reload the CTA is "${back.slice(0, 40)}", expected "${marker}"`);
    else pass("flow-settings persistence", "CTA survived a reload");
  } finally { await ctx.close(); }
};

// ── E. Add contact: it lands in the list AND in the database ────────────────
FLOWS["add-contact"] = async () => {
  const { ctx, page } = await newPage();
  try {
    await login(page);
    await dismissOverlays(page);
    await page.goto(`${BASE}/contacts`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const opener = page.locator('button:has-text("Add contact")').first();
    if (!(await opener.isVisible().catch(() => false))) { console.log("  – Add contact button not visible, skipping"); return; }
    await opener.click();
    await page.waitForTimeout(900);
    // Find the fields by what they ARE (the modal's form, its first text input,
    // its email input), not by placeholder copy. The email placeholder was
    // reworded "sarah@example.com" → "sarah@acme.com" on 2026-09-24 and this
    // flow timed out every night afterwards while the product worked fine.
    const form = page.locator('form:has(button[type="submit"]:has-text("Add contact"))').first();
    const nameField = form.locator('input:not([type]), input[type="text"]').first();
    if (!(await nameField.isVisible().catch(() => false))) { fail("add-contact", "the Add contact modal did not open"); return; }

    const who = `QA Contact ${stamp}`;
    await nameField.fill(who);
    await form.locator('input[type="email"]').first().fill(`contact-${stamp}@swiftcard-test.invalid`);
    const submit = form.locator('button[type="submit"]:has-text("Add contact")').first();
    const writes = await countWrites(page, "/api/", async () => {
      await submit.click();
      await submit.click({ force: true, timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(3500);
    });
    const leadWrites = writes.filter((w) => /\/api\/(leads|contacts)/.test(w));
    if (leadWrites.length > 1) fail("add-contact", `double-tap wrote ${leadWrites.length}×: ${leadWrites.join(", ")}`);
    else pass("add-contact double-submit guard", `${leadWrites.length} write`);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const shown = await page.locator(`text=${who}`).count();
    const rows = await (await adm(`/rest/v1/leads?card_owner=eq.${uname}&select=id,name`)).json();
    const inDb = Array.isArray(rows) && rows.some((r) => r.name === who);
    if (!inDb) fail("add-contact", "the contact was not written to the database");
    else if (!shown) fail("add-contact", "the contact is in the database but does not appear in the list after a reload");
    else pass("add-contact", "saved and listed");
    await page.screenshot({ path: `${OUT}/contacts-after-add.png` }).catch(() => {});
  } finally { await ctx.close(); }
};

// ── F. A wrong password must say so, not spin forever ───────────────────────
FLOWS["login-failure"] = async () => {
  const { ctx, page } = await newPage({ signedIn: false });
  try {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await typeInto(page, "#auth-email", email);
    await typeInto(page, "#auth-password", "definitely-not-the-password");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(6000);
    const label = (await page.locator('button[type="submit"]').first().innerText().catch(() => "")).trim();
    const body = await page.locator("body").innerText();
    // Supabase rate-limits sign-ins per IP. A run that trips it gets a real,
    // correct error message that simply is not the wrong-password one — which
    // is not a product failure, so say so instead of crying wolf.
    if (/missing email or phone/i.test(body)) {
      fail("login-failure", "the sign-in went out with an EMPTY email — the typed value never reached React state");
      return;
    }
    if (/rate limit|too many requests/i.test(body)) {
      console.log("  – sign-in rate limited by the auth provider, cannot assert the rejection copy");
      return;
    }
    const stuck = label === "…" || /Signing/i.test(label);
    const said = /invalid|incorrect|wrong|could ?n.t|couldn.t|not match|try again/i.test(body);
    if (stuck) fail("login-failure", `submit button still reads "${label}" 6s after a rejected sign-in`);
    else if (!said) fail("login-failure", `a rejected sign-in showed no error message (button: "${label}"; page said: ${JSON.stringify(body.replace(/\s+/g, " ").slice(0, 240))})`);
    else pass("login-failure", "rejected with a message, button reset");
    if (page.url().includes("/dashboard")) fail("login-failure", "a WRONG password reached the dashboard");
    await page.screenshot({ path: `${OUT}/login-wrong-password.png` }).catch(() => {});
  } finally { await ctx.close(); }
};

// ── G. Browser back/forward must not strand you ─────────────────────────────
FLOWS["history"] = async () => {
  const { ctx, page } = await newPage();
  try {
    await login(page);
    await dismissOverlays(page);
    for (const p of ["/contacts", "/share", "/settings/flows"]) {
      await page.goto(BASE + p, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(900);
    }
    for (const step of ["goBack", "goBack", "goForward"]) {
      await page[step]({ waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForTimeout(1400);
      const body = await page.locator("body").innerText();
      if (/Application error|Something went wrong|This page could not be found/i.test(body)) {
        fail("history", `${step} landed on an error page at ${page.url().replace(BASE, "")}`);
      }
      if (body.trim().length < 40) fail("history", `${step} landed on a blank page at ${page.url().replace(BASE, "")}`);
    }
    pass("history", "back/forward stayed on real pages");
  } finally { await ctx.close(); }
};

// ── H. Signed out means signed out ──────────────────────────────────────────
FLOWS["sign-out"] = async () => {
  // Reuses the shared session rather than signing in again — a second real
  // sign-in is what tripped the provider's rate limit. Signing out only kills
  // this context's copy of the cookies, so the shared state stays usable; it
  // runs last regardless.
  const { ctx, page } = await newPage();
  try {
    await login(page);
    await dismissOverlays(page);
    await page.goto(`${BASE}/settings/flows`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    let out = page.locator('button:has-text("Sign out"), a:has-text("Sign out")').first();
    if (!(await out.isVisible().catch(() => false))) {
      // SettingsShell shows one section at a time; Sign out lives under Security.
      const sec = page.locator('button:has-text("Security"), a:has-text("Security")').first();
      if (await sec.isVisible().catch(() => false)) { await sec.click().catch(() => {}); await page.waitForTimeout(1200); }
      out = page.locator('button:has-text("Sign out"), a:has-text("Sign out")').first();
    }
    if (!(await out.isVisible().catch(() => false))) { fail("sign-out", "no Sign out control anywhere on /settings/flows"); return; }
    await out.click();
    // Sign out is CONFIRMED, never immediate (owner call 2026-09-09): the first
    // control opens a "Sign out of SwiftCard?" card and the red button in it is
    // what actually signs out. Clicking only the trigger left the session
    // fully alive, and this flow then reported the login wall as broken when
    // nothing had been asked to sign out at all.
    const confirm = page.locator('[role="dialog"] button:has-text("Sign out")').first();
    if (await confirm.isVisible({ timeout: 3000 }).catch(() => false)) await confirm.click();
    else { fail("sign-out", "the confirm card did not appear after tapping Sign out"); return; }
    await page.waitForTimeout(4000);
    // Going back must NOT reveal the signed-in dashboard.
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    if (!/\/login/.test(page.url())) fail("sign-out", `after signing out, /dashboard served ${page.url().replace(BASE, "")} instead of the login wall`);
    else pass("sign-out", "the login wall holds after signing out");
  } finally { await ctx.close(); }
};

// ── I. A brand-new account with nothing in it ───────────────────────────────
// The most common first experience there is, and the one with the least data
// to render — so the one where an empty state is most likely to be a crash, a
// blank panel, or a control that does nothing.
FLOWS["empty-account"] = async () => {
  const e2 = `qa-empty-${stamp}@swiftcard-test.invalid`;
  const u2 = `qa-empty-${stamp}`;
  const created = await (await adm("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email: e2, password, email_confirm: true }) })).json();
  if (!created.id) { fail("empty-account", "could not seed the empty account"); return; }
  extraUsers.push({ id: created.id, uname: u2 });
  await adm("/rest/v1/profiles", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ id: created.id, username: u2, name: "New Person", email: e2, plan: "free", customization: { _aiConsent: "accepted", _planChosen: "qa-seeded" } }),
  });
  // No card, no contacts, no views — deliberately.
  const ctx = await markInternal(await browser.newContext({ viewport: { width: 1280, height: 900 } }));
  const page = await ctx.newPage();
  page.on("pageerror", (err) => fail("empty-account", `js-error on ${page.url().replace(BASE, "")} — ${err.message.split("\n")[0].slice(0, 140)}`));
  try {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await typeInto(page, "#auth-email", e2);
    await typeInto(page, "#auth-password", password);
    await page.click('button[type="submit"]');
    await page.waitForURL(/dashboard|onboarding|welcome/, { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await dismissOverlays(page);
    for (const path of ["/dashboard", "/contacts", "/share"]) {
      await page.goto(BASE + path, { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForTimeout(1800);
      const body = await page.locator("body").innerText();
      if (/Application error|Something went wrong|This page could not be found/i.test(body)) {
        fail("empty-account", `${path} shows an error page with no data`);
      } else if (body.trim().length < 60) {
        fail("empty-account", `${path} rendered an all but blank page (${body.trim().length} chars) with no data`);
      }
      // An empty screen still has to offer the next step.
      const actions = await page.locator("button:visible, a[href]:visible").count();
      if (actions < 3) fail("empty-account", `${path} offers only ${actions} control(s) — a dead end for a new account`);
      await page.screenshot({ path: `${OUT}/empty${path.replace(/\//g, "-")}.png` }).catch(() => {});
    }
    pass("empty-account", "dashboard, contacts and links all render with nothing in the account");
  } finally { await ctx.close(); }
};

// ── J. Mobile tab bar: every tab goes where it says ─────────────────────────
FLOWS["mobile-tabs"] = async () => {
  const ctx = await markInternal(await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    ...(storageState ? { storageState } : {}),
  }));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => fail("mobile-tabs", `js-error — ${e.message.split("\n")[0].slice(0, 140)}`));
  try {
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await dismissOverlays(page);
    const bar = page.locator(".sc-tabbar").first();
    if (!(await bar.isVisible().catch(() => false))) { fail("mobile-tabs", "no tab bar on /dashboard at 390px"); return; }
    // A page wider than the phone moves the fixed tab bar away from where a
    // tap lands (the layout viewport grows past the visual one), so the tab is
    // "not covered" yet never takes the tap. Name what sticks out instead of
    // reporting a bare click timeout.
    // Measured against the PHONE's 390px, not innerWidth: a mobile browser
    // zooms out to fit wider content, and then innerWidth grows with it and
    // the page "fits" (how the Rate us banner hid this, 2026-09-29).
    const wide = await page.evaluate(() => {
      const vw = 390, sw = document.documentElement.scrollWidth;
      if (sw <= vw + 1 && (window.visualViewport?.scale ?? 1) > 0.99) return null;
      const out = [];
      for (const el of document.querySelectorAll("body *")) {
        const cs = getComputedStyle(el);
        if (cs.position === "fixed" || cs.display === "none") continue;
        const r = el.getBoundingClientRect();
        if (r.width && r.right > vw + 1) out.push({ r: Math.round(r.right), w: Math.round(r.width), el: `${el.tagName.toLowerCase()}.${(el.getAttribute("class") || "").trim().split(/\s+/).slice(0, 4).join(".")} “${(el.textContent || "").trim().slice(0, 30)}”` });
      }
      out.sort((a, b) => a.w - b.w);
      return { vw, sw, offenders: out.slice(0, 4) };
    }).catch(() => null);
    if (wide) fail("mobile-tabs", `/dashboard is ${wide.sw}px wide on a ${wide.vw}px phone — ${wide.offenders.map((o) => `${o.el} (right ${o.r}, w ${o.w})`).join(" · ") || "no offender found"}`);
    await page.screenshot({ path: `${OUT}/mobile-tabs-before.png` }).catch(() => {});
    for (const [label, expect] of [["Contacts", "/contacts"], ["Links", "/share"], ["Settings", "/settings"], ["Home", "/dashboard"]]) {
      const tab = page.locator(`.sc-tabbar a:has-text("${label}")`).first();
      if (!(await tab.isVisible().catch(() => false))) { fail("mobile-tabs", `no "${label}" tab in the bar`); continue; }
      // Next.js's dev indicator is a fixed widget in the bottom-left corner —
      // exactly on top of the Home tab — so in `next dev` the leftmost tab is
      // unclickable for reasons that have nothing to do with the product. It
      // does not exist in a production build. Report what is really in the way
      // rather than blaming the tab.
      const blocker = await tab.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!hit || hit === el || el.contains(hit)) return null;
        return hit.closest("nextjs-portal") || hit.tagName === "NEXTJS-PORTAL"
          ? "dev-overlay"
          : `${hit.tagName.toLowerCase()}${typeof hit.className === "string" && hit.className.trim() ? "." + hit.className.trim().split(/\s+/).slice(0, 2).join(".") : ""}`;
      }).catch(() => null);
      if (blocker === "dev-overlay") {
        console.log(`  – "${label}" sits under the Next.js dev indicator; not a product defect, skipping (run against a production build to cover it)`);
        continue;
      }
      if (blocker) { fail("mobile-tabs", `"${label}" is covered by ${blocker}`); continue; }
      // Playwright's call log names WHY a click never happened (not stable,
      // outside the viewport, another element receives the tap…) — keep it.
      await tab.click().catch((e) => fail("mobile-tabs", `"${label}" would not click — ${e.message.split("\n").filter((l) => l.trim()).slice(0, 1).concat(e.message.split("\n").filter((l) => /waiting|retrying|intercepts|not stable|outside|scroll/i.test(l)).slice(-3)).join(" | ").slice(0, 400)}`));
      await page.waitForTimeout(2200);
      const url = page.url().replace(BASE, "");
      if (!url.startsWith(expect)) fail("mobile-tabs", `"${label}" landed on ${url}, expected ${expect}`);
      const body = await page.locator("body").innerText();
      if (/Application error|Something went wrong/i.test(body)) fail("mobile-tabs", `"${label}" landed on an error page`);
    }
    // The bar must not sit on top of the page's own content at the very bottom.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(700);
    const clash = await page.evaluate(() => {
      const bar = document.querySelector(".sc-tabbar");
      if (!bar) return null;
      const top = bar.getBoundingClientRect().top;
      let lowest = 0, worst = "";
      for (const el of document.querySelectorAll("body *")) {
        if (el.closest(".sc-tabbar") || el.children.length || !(el.textContent || "").trim()) continue;
        const cs = getComputedStyle(el);
        if (cs.position === "fixed" || cs.position === "sticky" || cs.visibility === "hidden" || cs.display === "none") continue;
        const r = el.getBoundingClientRect();
        if (r.height === 0 || r.width === 0) continue;
        if (r.bottom > lowest) { lowest = r.bottom; worst = (el.textContent || "").trim().slice(0, 40); }
      }
      return lowest > top + 2 ? { lowest: Math.round(lowest), top: Math.round(top), worst } : null;
    });
    if (clash) fail("mobile-tabs", `content ends under the tab bar: "${clash.worst}" bottom=${clash.lowest} > bar top=${clash.top}`);
    await page.screenshot({ path: `${OUT}/mobile-tabs-bottom.png` }).catch(() => {});
    pass("mobile-tabs", "every tab navigates and nothing hides under the bar");
  } finally { await ctx.close(); }
};

// ── L. The Links page switch: Swift Links | Swift Signature ─────────────────
// The page opens on Swift Links with the person's real page in a mini phone,
// the link copies, Open goes to their page, Edit opens the editor on Socials,
// and the switch flips to Swift Signature, keeps it in the URL and through a
// reload (owner, 2026-10-07: "make sure those two toggles are working perfectly").
FLOWS["links-page-switch"] = async () => {
  const { ctx, page } = await newPage();
  try {
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(BASE).origin });
    await login(page);
    await dismissOverlays(page);
    await page.goto(`${BASE}/share`, { waitUntil: "domcontentloaded" });
    const linksTab = page.locator('[role="tab"]', { hasText: "Swift Links" }).first();
    const sigTab = page.locator('[role="tab"]', { hasText: "Swift Signature" }).first();
    if (!(await linksTab.waitFor({ state: "visible", timeout: 20000 }).then(() => true, () => false))) {
      fail("links-page-switch", "/share shows no Swift Links | Swift Signature switch");
      return;
    }
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await dismissOverlays(page);
    if ((await linksTab.getAttribute("aria-selected")) !== "true") fail("links-page-switch", "the page did not open on Swift Links");
    const side = '[role="tabpanel"]:not([hidden])';
    // The mini phone is the real page: the card's name and bio are in it.
    const mini = await page.locator(side).innerText().catch(() => "");
    if (!mini.includes("Dana Ellis") || !mini.includes("Principal broker helping")) {
      fail("links-page-switch", "the Swift Links side's mini phone does not show the card's own page (name + bio)");
    }
    // The link copies, exactly.
    const copyLink = page.locator(`${side} button`, { hasText: /^Copy$/ }).first();
    await copyLink.click();
    await page.waitForTimeout(500);
    const copied = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => `read failed: ${e.message}`);
    if (copied !== `https://swiftcard.me/links/${uname}`) fail("links-page-switch", `the link's Copy put ${JSON.stringify(copied)} on the clipboard`);
    // Open goes to their own Swift Links page (through /api/self-view, which
    // carries the target encoded, so the owner's own open never counts).
    const openHref = await page.locator(`${side} a`, { hasText: "Open Swift Links" }).first().getAttribute("href").catch(() => null);
    if (!openHref || !decodeURIComponent(openHref).includes(`/links/${uname}`)) fail("links-page-switch", `"Open Swift Links →" points at ${JSON.stringify(openHref)}`);
    // The switch: flips, says so in the URL, and survives a reload.
    await sigTab.click();
    await page.waitForTimeout(400);
    const flipped = (await sigTab.getAttribute("aria-selected")) === "true"
      && await page.locator(`${side} button`, { hasText: /Copy signature|Copied|Generating|Copying/ }).first().isVisible().catch(() => false);
    if (!flipped) fail("links-page-switch", "tapping Swift Signature did not show the signature side");
    if (!page.url().endsWith("#signature")) fail("links-page-switch", `the URL did not keep the side (at ${page.url().replace(BASE, "")})`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await sigTab.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1200);
    if ((await sigTab.getAttribute("aria-selected").catch(() => null)) !== "true") fail("links-page-switch", "a reload went back to Swift Links instead of staying on Swift Signature");
    // Back to Swift Links, then Edit my links → the editor, on Socials.
    await linksTab.click();
    await page.waitForTimeout(300);
    await page.locator(`${side} a`, { hasText: "Edit my links" }).first().click();
    await page.waitForURL(/\/cards\/[^/]+\/edit\?tab=sharing/, { timeout: 30000 }).catch(() => {});
    const socials = page.locator("button", { hasText: /^Socials$/ }).first();
    await socials.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
    const onSocials = /bg-blue-600/.test((await socials.getAttribute("class").catch(() => "")) || "");
    if (!page.url().includes(`/cards/${cardId}/edit`)) fail("links-page-switch", `"Edit my links" went to ${page.url().replace(BASE, "")}`);
    else if (!onSocials) fail("links-page-switch", "\"Edit my links\" opened the editor but not on its Socials tab");
    if (!failures.some((f) => f.flow === "links-page-switch")) pass("links-page-switch", "opens on Swift Links (real page in the phone), Copy/Open/Edit right, switch flips + keeps the side");
  } finally { await ctx.close(); }
};

// ── M. Swift Signature: Copy is ready, and one tap copies ───────────────────
// The Links page's Swift Signature side once sat on "Generating your card…"
// with Copy greyed out for good (2026-10-07: its preview was lazy-loaded while
// hidden until loaded, so it never loaded). Unit and render tests pin the
// pieces; this opens the real page as its owner, taps Copy ONCE, and reads
// back what actually landed on the clipboard.
FLOWS["signature-copy"] = async () => {
  const { ctx, page } = await newPage();
  try {
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(BASE).origin });
    await login(page);
    await dismissOverlays(page);
    const t0 = Date.now();
    await page.goto(`${BASE}/share#signature`, { waitUntil: "domcontentloaded" });
    const side = '[role="tabpanel"]:not([hidden])';
    const btn = page.locator(`${side} button`, { hasText: "Copy signature" }).first();
    if (!(await btn.waitFor({ state: "visible", timeout: 20000 }).then(() => true, () => false))) {
      fail("signature-copy", "/share#signature never showed a Copy signature button");
      return;
    }
    let enabled = false;
    for (let i = 0; i < 25 && !(enabled = await btn.isEnabled().catch(() => false)); i++) await page.waitForTimeout(200);
    if (!enabled) { fail("signature-copy", "Copy signature is greyed out — the button must be ready as soon as the side shows"); return; }
    const readyMs = Date.now() - t0;
    await dismissOverlays(page);
    await btn.click();
    const after = page.locator(`${side} button`, { hasText: /Copied ✓|Couldn.t copy/ }).first();
    await after.waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
    const label = (await after.innerText().catch(() => "")).trim();
    if (!label.startsWith("Copied ✓")) {
      fail("signature-copy", `one tap did not copy — the button says ${JSON.stringify(label || (await btn.innerText().catch(() => "")))}`);
      return;
    }
    const html = await page.evaluate(async () => {
      for (const it of await navigator.clipboard.read()) if (it.types.includes("text/html")) return (await it.getType("text/html")).text();
      return "";
    }).catch((e) => `read failed: ${e.message}`);
    if (!html.includes(`card-signatures/${uname}.png`)) fail("signature-copy", `the copied signature has no card image for /${uname}: ${JSON.stringify(html.slice(0, 160))}`);
    else if (!html.includes(`/${uname}?source=email_signature`)) fail("signature-copy", "the copied signature does not link to the card");
    else pass("signature-copy", `Copy ready in ${readyMs}ms; one tap copied the card image + link`);
    // The preview shows the card it copied.
    const shows = await page.waitForFunction((sel) => {
      const img = document.querySelector(`${sel} img[alt="Your card"]`);
      return !!img && img.complete && img.naturalWidth > 0;
    }, side, { timeout: 15000 }).then(() => true, () => false);
    if (!shows) fail("signature-copy", "the signature preview never appeared (stuck on \"Generating your card…\")");
    await page.screenshot({ path: `${OUT}/signature-copy.png` }).catch(() => {});
  } finally { await ctx.close(); }
};

// ── K. Create account through the form itself ───────────────────────────────
// Every other flow seeds its account through the admin API. This one is the
// screen a real person meets: the typo hint, the second password box, and a
// mismatch that must stay on /login — then a real signup that must land in
// the app. The typo check uses a throwaway address on a misspelled domain and
// never submits it; the account that IS created is on the QA mailbox domain.
FLOWS["signup-ui"] = async () => {
  const { ctx, page } = await newPage({ signedIn: false });
  const e2 = `qa-signup-${stamp}@swiftcard-test.invalid`;
  try {
    await page.goto(`${BASE}/login?mode=signup&next=${encodeURIComponent("/dashboard")}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#auth-confirm-password", { timeout: 15000 }).catch(() => {});
    if (!(await page.locator("#auth-confirm-password").count())) { fail("signup-ui", "Create account has no Confirm password box"); return; }

    // 1. A misspelled common domain is caught before anything is sent.
    await typeInto(page, "#auth-email", `qa-typo-${stamp}@gmial.com`);
    await typeInto(page, "#auth-password", password);
    await typeInto(page, "#auth-confirm-password", password);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1500);
    const hint = await page.locator("#auth-email-hint").innerText().catch(() => "");
    if (!/did you mean/i.test(hint) || !hint.includes(`qa-typo-${stamp}@gmail.com`)) fail("signup-ui", `no "Did you mean …@gmail.com" hint for gmial.com (got: ${JSON.stringify(hint)})`);
    if (!page.url().includes("/login")) { fail("signup-ui", "a typo'd address was submitted straight through"); return; }

    // 2. Two different passwords must not create an account.
    await page.fill("#auth-email", "");
    await typeInto(page, "#auth-email", e2);
    await page.fill("#auth-confirm-password", "");
    await typeInto(page, "#auth-confirm-password", password + "z");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1500);
    const mismatch = await page.locator("#auth-confirm-password-error").innerText().catch(() => "");
    if (!/don.t match/i.test(mismatch)) fail("signup-ui", `mismatched passwords showed no "Passwords don't match." (got: ${JSON.stringify(mismatch)})`);
    if (!page.url().includes("/login")) { fail("signup-ui", "mismatched passwords still created an account"); return; }

    // 3. The real thing.
    await page.fill("#auth-confirm-password", "");
    await typeInto(page, "#auth-confirm-password", password);
    await page.click('button[type="submit"]');
    // The PATH, not the URL: `next=%2Fdashboard` would match a regex on the
    // whole address while still sitting on /login.
    // A brand-new account builds its card FIRST (owner, 2026-10-02): onboarding
    // sends it to the first-card builder, never to an empty "Create Card"
    // dashboard — and ?next=/dashboard counts as no destination. Landing on
    // /dashboard here is the fresh-install bug coming back.
    await page.waitForURL((u) => /^\/(cards\/new|dashboard|welcome)/.test(u.pathname), { timeout: 45000 }).catch(() => {});
    const landed = new URL(page.url()).pathname;
    // Find the account so the finally block removes it whatever happened next.
    const found = await (await adm(`/auth/v1/admin/users?page=1&per_page=50`)).json().catch(() => null);
    const created = found?.users?.find((u) => u.email === e2);
    if (created?.id) extraUsers.push({ id: created.id, uname: `qa-signup-${stamp}` });
    if (landed === "/dashboard" || landed === "/welcome") fail("signup-ui", `a brand-new account landed on ${landed} instead of the card builder — it must build its card first`);
    else if (landed !== "/cards/new") fail("signup-ui", `a valid signup did not reach the card builder (at ${landed}; page said: ${JSON.stringify((await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 200))})`);
    else if (!created?.id) fail("signup-ui", `landed on ${landed} but no auth user exists for ${e2}`);
    else pass("signup-ui", `typo caught, mismatch caught, account created → ${landed} (builds its card first)`);
    await page.screenshot({ path: `${OUT}/signup-ui.png` }).catch(() => {});
  } finally { await ctx.close(); }
};

const ONLY = process.env.ONLY || "";
try {
  console.log("seeding…");
  await seed();
  console.log(`seeded ${uname} (${userId})`);
  browser = await chromium.launch();
  await signInOnce();
  // sign-out revokes the refresh token server-side, which kills the shared
  // storageState for every context — so it runs after everything that needs it.
  const order = Object.keys(FLOWS).sort((a, b) => (a === "sign-out") - (b === "sign-out"));
  for (const name of order) {
    const fn = FLOWS[name];
    if (ONLY && ONLY !== name) continue;
    console.log(`\n▸ ${name}`);
    try { await fn(); } catch (e) { fail(name, "threw — " + e.message.split("\n")[0].slice(0, 160)); }
  }
} catch (e) {
  console.error("FAILED:", e.stack?.split("\n").slice(0, 4).join(" | "));
  fail("harness", e.message.split("\n")[0]);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (process.env.KEEP) {
    console.log("\nKEEP=1 — leaving", userId);
  } else if (userId) {
    try {
      for (const x of extraUsers) {
        await adm(`/rest/v1/leads?card_owner=eq.${x.uname}`, { method: "DELETE" });
        await adm(`/rest/v1/notifications?user_id=eq.${x.id}`, { method: "DELETE" });
        await adm(`/rest/v1/cards?user_id=eq.${x.id}`, { method: "DELETE" });
        await adm(`/rest/v1/profiles?id=eq.${x.id}`, { method: "DELETE" });
        await adm(`/auth/v1/admin/users/${x.id}`, { method: "DELETE" });
      }
      await adm(`/rest/v1/card_views?username=in.(${uname},${uname}__links)`, { method: "DELETE" });
      await adm(`/rest/v1/card_events?username=in.(${uname},${uname}__links)`, { method: "DELETE" });
      await adm(`/rest/v1/leads?card_owner=eq.${uname}`, { method: "DELETE" });
      // The signature image signature-copy generated for the throwaway card.
      await adm(`/storage/v1/object/card-signatures/${uname}.png`, { method: "DELETE" }).catch(() => {});
      await adm(`/rest/v1/notifications?user_id=eq.${userId}`, { method: "DELETE" });
      await adm(`/rest/v1/cards?user_id=eq.${userId}`, { method: "DELETE" });
      await adm(`/rest/v1/profiles?id=eq.${userId}`, { method: "DELETE" });
      await adm(`/auth/v1/admin/users/${userId}`, { method: "DELETE" });
      console.log("\ncleaned up", userId);
    } catch (e) { console.error("  CLEANUP FAILED — remove manually:", userId, e.message); }
  }
  writeFileSync(`${OUT}/failures.json`, JSON.stringify(failures, null, 2));
  console.log(`\n${failures.length} failure(s)${failures.length ? " → " + OUT + "/failures.json" : ""}`);
  process.exit(failures.length ? 1 : 0);
}
