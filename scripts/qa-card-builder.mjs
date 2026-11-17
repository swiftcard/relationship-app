// node scripts/qa-card-builder.mjs
//   env: BASE=<a local build, default http://localhost:3222>
//        ADMIN_BASE=<where the admin is driven, default BASE>
//        QA_ADMIN_EMAIL=<the throwaway admin's address; must be in that server's ADMIN_EMAILS>
//        OUT=<dir>
//
// Card Builder, used END TO END in a real browser (owner, 2026-11-15: "I'm not
// going to test this by hand"). One throwaway preview goes through everything
// a real one does:
//
//   main page   the three buttons and their counts
//   Add         the Queue box, and "Build one by hand"
//   Warm paths  a small connections file is uploaded and the match shows
//   Approve     pick version A or B, edit a message, approve and publish, and
//               the Messages, Mail and LinkedIn buttons
//   the preview opened in a SEPARATE signed-out browser: 5 seconds and a
//               scroll, then the view is counted, the alert row and the banner
//               appear, and the push is accepted by the push service
//   Call        every outcome button; follow-ups land in "Call and follow up"
//   booking     the preview's button, all the way to a confirmed 15-minute
//               call, which moves the preview to "meeting booked"; then it is
//               canceled
//
// WHO IT RUNS AS. A throwaway account on the reserved .invalid domain. /admin
// only opens for addresses in the server's ADMIN_EMAILS, and this script never
// touches that list: in CI the admin half is driven on a production build
// started beside it with ADMIN_EMAILS set to the throwaway (ADMIN_BASE), while
// the public half (the preview page and the booking) runs against the live
// site (BASE). Both read the same database, so it is one preview throughout.
//
// WHO HEARS ABOUT IT. Nobody. The preview names the throwaway account in
// alert_user_id, so its pushes go there and never to the owner's phone
// (supabase/prospect-previews-qa.sql); the booking is on a .invalid address,
// so no email is sent and nobody is invited (lib/demo/config isTestAddress).
//
// EVERYTHING IT WRITES IS DELETED in `finally`, and the last check is that
// nothing is left.
import { localBase, seededAdmin } from "./lib/qa-local.mjs";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createECDH, createHash, randomBytes, randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { signInByLink } from "./lib/qa-sign-in.mjs";
import { markInternal } from "./qa-internal.mjs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const BASE = localBase(process.env.BASE);
const ADMIN_BASE = localBase(process.env.ADMIN_BASE, BASE);
const OUT = process.env.OUT || "qa-card-builder-out";
mkdirSync(OUT, { recursive: true });
const env = existsSync(`${ROOT}/.env.local`) ? readFileSync(`${ROOT}/.env.local`, "utf8") : "";
const g = (k) => process.env[k] ?? process.env[k.replace(/^NEXT_PUBLIC_/, "")] ?? (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const SB = g("NEXT_PUBLIC_SUPABASE_URL"), SVC = g("SUPABASE_SERVICE_ROLE_KEY");
if (!SB || !SVC) { console.error("missing SUPABASE url / service role key"); process.exit(2); }
const adm = seededAdmin((p, i) => fetch(SB + p, { ...i, headers: { apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": "application/json", ...(i?.headers ?? {}) } }));
const rows = async (p) => { const r = await adm(p); const j = await r.json().catch(() => null); return Array.isArray(j) ? j : []; };
const patch = (p, body) => adm(p, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(body) });
const del = (p) => adm(p, { method: "DELETE", headers: { Prefer: "return=minimal" } });

const stamp = Date.now().toString().slice(-8);
const adminEmail = (process.env.QA_ADMIN_EMAIL || `qa-cb-${stamp}@swiftcard-test.invalid`).toLowerCase();
if (!/@swiftcard-test\.invalid$/.test(adminEmail)) { console.error("QA_ADMIN_EMAIL must be on swiftcard-test.invalid"); process.exit(2); }
const prospectEmail = `qa-cb-prospect-${stamp}@swiftcard-test.invalid`;
const OFFICE = `QA Probe Realty ${stamp}`;
const OWNER = "Quinn Probe";
const PHONE = "(212) 555-0147";
const QUEUE_LINE = `QA Probe Queue ${stamp}, New York`;
const UA_PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const UA_DESK = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const failures = [];
const unverified = [];
const passed = [];
const pass = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); (c ? passed : failures).push(m); return c; };
const skip = (m) => { console.log("SKIP " + m); unverified.push(m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000, every = 500) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) return null;
    await wait(every);
  }
}
/** One part of the run. A crash in it is one failure, and the rest still runs. */
async function part(name, fn) {
  try { await fn(); } catch (e) {
    pass(false, `${name}: ${String(e?.message ?? e).split("\n")[0].slice(0, 220)}`);
    for (const p of pages) await p.screenshot({ path: `${OUT}/fail-${name.replace(/\W+/g, "-")}-${pages.indexOf(p)}.png` }).catch(() => {});
  }
}
const pages = [];
const preview = async () => (await rows(`/rest/v1/prospect_previews?id=eq.${previewId}&select=*`))[0] ?? null;
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const counts = async (page) => {
  await page.goto(`${ADMIN_BASE}/admin/card-builder`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-big-buttons]", { timeout: 20000 });
  return page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-big]")].map((a) => [a.getAttribute("data-big"), Number(a.querySelector("[data-count]")?.textContent)])));
};
/** Press a link that opens another app (sms:, mailto:, a new tab) without leaving the page: the app's own handler still runs. */
const tapWithoutLeaving = async (page, selector) => {
  await page.evaluate(() => {
    if (window.__qaHeld) return;
    window.__qaHeld = true;
    document.addEventListener("click", (e) => { if (e.target instanceof Element && e.target.closest("a[data-one-tap],a[data-send],a[data-linkedin]")) e.preventDefault(); }, true);
  });
  await page.locator(selector).first().click();
};

// ── A real push endpoint, so "accepted by the push service" is a real answer ─
// Mozilla's push service hands any client an endpoint over its WebSocket; a
// push to it is accepted (201) or refused exactly as a browser's would be, and
// arrives on the socket. No browser profile needed.
async function realPushEndpoint() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const b64 = (b) => b.toString("base64url");
  return new Promise((resolve) => {
    const out = { endpoint: null, p256dh: b64(ecdh.getPublicKey()), auth: b64(randomBytes(16)), arrived: 0, close: () => {} };
    let ws;
    const done = setTimeout(() => resolve(out), 12000);
    // No subprotocol: the service doesn't echo one back, and Node then refuses the handshake.
    try { ws = new WebSocket("wss://push.services.mozilla.com/"); } catch { clearTimeout(done); return resolve(out); }
    out.close = () => { try { ws.close(); } catch { /* already closed */ } };
    ws.onopen = () => ws.send(JSON.stringify({ messageType: "hello", use_webpush: true, broadcasts: {} }));
    ws.onerror = () => { clearTimeout(done); resolve(out); };
    ws.onmessage = (m) => {
      let d; try { d = JSON.parse(m.data); } catch { return; }
      if (d.messageType === "hello") ws.send(JSON.stringify({ messageType: "register", channelID: randomUUID() }));
      else if (d.messageType === "register") { if (d.status === 200 && d.pushEndpoint) out.endpoint = d.pushEndpoint; clearTimeout(done); resolve(out); }
      else if (d.messageType === "notification") { out.arrived++; ws.send(JSON.stringify({ messageType: "ack", updates: [{ channelID: d.channelID, version: d.version, code: 100 }] })); }
    };
  });
}

let userId = null, previewId = null, slug = null, browser = null, push = null;
let savedConnections = null, savedUpload;
const viewIds = [];

try {
  // ── the throwaway admin ──────────────────────────────────────────────────
  const u = await (await adm("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email: adminEmail, password: `Qa!aA1${stamp}${randomBytes(6).toString("hex")}`, email_confirm: true }) })).json();
  if (!u.id) throw new Error("could not create the throwaway admin: " + JSON.stringify(u).slice(0, 160));
  userId = u.id;
  await adm("/rest/v1/profiles", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ id: userId, username: `qa-cb-${stamp}`, name: "Sam Tester", email: adminEmail, plan: "free", customization: { _aiConsent: "accepted", _planChosen: "qa-seeded" } }) });

  push = await realPushEndpoint();
  if (push.endpoint) await adm("/rest/v1/push_subscriptions", { method: "POST", body: JSON.stringify({ user_id: userId, endpoint: push.endpoint, p256dh: push.p256dh, auth: push.auth, device_id: `qa-cb-${stamp}` }) });
  else skip("push: no real push endpoint could be registered from here, so acceptance by the push service was not checked");

  browser = await chromium.launch({ args: ["--disable-blink-features=AutomationControlled"] });
  const phone = await markInternal(await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: UA_DESK, permissions: ["clipboard-read", "clipboard-write"] }), BASE);
  const admin = await phone.newPage(); pages.push(admin);
  await signInByLink(admin, { adm, base: ADMIN_BASE, email: adminEmail, next: "/admin/card-builder" });
  await admin.waitForLoadState("domcontentloaded");
  await admin.goto(`${ADMIN_BASE}/admin/card-builder`, { waitUntil: "domcontentloaded" });
  if (!/\/admin\/card-builder/.test(admin.url())) {
    throw new Error(`the throwaway account is not an admin on ${ADMIN_BASE} (landed on ${admin.url().replace(ADMIN_BASE, "")}). ADMIN_EMAILS there must include ${adminEmail}.`);
  }

  // ── main page: three buttons with counts ─────────────────────────────────
  let before = {};
  await part("main page", async () => {
    before = await counts(admin);
    pass(JSON.stringify(Object.keys(before)) === JSON.stringify(["Approve", "Call and follow up", "Add"]), `main page shows the three buttons in order (${Object.keys(before).join(", ")})`);
    pass(Object.values(before).every((n) => Number.isInteger(n) && n >= 0), `each button shows a count (${JSON.stringify(before)})`);
    pass(!(await sideways(admin)), "main page fits a phone (no sideways scroll)");
    const folded = await admin.evaluate(() => [...document.querySelectorAll("details[data-section]")].map((d) => [d.getAttribute("data-section"), d.open]));
    pass(folded.length === 2 && folded.every(([, open]) => !open), "Details and More start folded away");
  });

  // ── Add: the Queue box ────────────────────────────────────────────────────
  await part("queue box", async () => {
    await admin.goto(`${ADMIN_BASE}/admin/card-builder/add`, { waitUntil: "domcontentloaded" });
    await admin.fill("[data-queue-form] textarea[name=lines]", QUEUE_LINE);
    await Promise.all([admin.waitForURL(/done=queued/, { timeout: 20000 }), admin.click("[data-queue-form] button[type=submit]")]);
    pass(await admin.locator("[data-queued]", { hasText: QUEUE_LINE }).count() === 1, "Queue box: a line typed in shows under Waiting to be built");
    pass((await counts(admin)).Add === before.Add + 1, "main page: the Add count went up by one");
    await admin.goto(`${ADMIN_BASE}/admin/card-builder/add`, { waitUntil: "domcontentloaded" });
    await Promise.all([admin.waitForURL(/done=removed/, { timeout: 20000 }), admin.locator("[data-queued]", { hasText: QUEUE_LINE }).locator("button[type=submit]").click()]);
    pass(await admin.locator("[data-queued]", { hasText: QUEUE_LINE }).count() === 0, "Queue box: Remove takes it back out");
    pass((await rows(`/rest/v1/prospect_queue?input=eq.${encodeURIComponent(QUEUE_LINE)}&select=id`)).length === 0, "the queue line is gone from the database");
  });

  // ── Add: build one by hand ────────────────────────────────────────────────
  await part("build one by hand", async () => {
    await admin.goto(`${ADMIN_BASE}/admin/card-builder/add`, { waitUntil: "domcontentloaded" });
    pass(await admin.evaluate(() => !document.querySelector("details[data-by-hand]")?.open), "\"Build one by hand\" starts folded away");
    await admin.click("details[data-by-hand] > summary");
    const form = admin.locator("details[data-by-hand] form").first();
    await form.locator("[name=office_name]").fill(OFFICE);
    await form.locator("[name=owner_name]").fill(OWNER);
    await form.locator("[name=owner_title]").fill("Broker Owner");
    await form.locator("[name=phone]").fill(PHONE);
    await form.locator("[name=email]").fill(prospectEmail);
    const role = form.locator("[name=buyer_role]");
    if (await role.count()) await role.selectOption("broker_owner").catch(() => {});
    await Promise.all([admin.waitForURL(/\/admin\/card-builder(\/edit\/[0-9a-f-]{36})?\?/, { timeout: 30000 }), form.locator("button[type=submit]").first().click()]);
    previewId = (admin.url().match(/edit\/([0-9a-f-]{36})\?done=created/) || [])[1] ?? null;
    if (!previewId) throw new Error(`the form did not open a new draft (${admin.url().replace(ADMIN_BASE, "")})`);
    const p = await preview();
    slug = p.slug;
    pass(p.status === "draft" && p.owner_name === OWNER && p.office_name === OFFICE, "Build one by hand: saved as a draft and opened on its edit screen");
    const closed = await fetch(`${BASE}/p/${slug}`, { headers: { "User-Agent": UA_PHONE }, redirect: "manual" });
    pass(closed.status === 404, `a draft's link does not open for anyone (${closed.status})`);
  });
  if (!previewId) throw new Error("no test preview, so nothing after this can run");

  // What /build-card would have researched and written, put on the draft with
  // the service key (the research itself is Claude Code's job, not the app's).
  const src = (url) => ({ url, uncertain: false, note: "" });
  await patch(`/rest/v1/prospect_previews?id=eq.${previewId}`, {
    alert_user_id: userId,
    buyer_role: "broker_owner", buyer_reason: "Listed as broker of record on the office's own About page.",
    website: "https://example.com", specialty: "Brooklyn brownstones since 1998", current_tool: "paper", license: "Licensed Real Estate Broker",
    social_links: { instagram: "https://www.instagram.com/example" },
    team_members: [{ name: "Sam Rivera", title: "Agent" }, { name: "Lee Park", title: "Agent" }],
    linkedin_url: "https://www.linkedin.com/in/qa-probe-swiftcard",
    specifics: [
      { kind: "cell_numbers", text: "7 of the 9 agents on the About page list their own cell", source_url: "https://example.com/about", dated: "2026-11-10", uncertain: false },
      { kind: "recruiting", text: "The Careers page says they are hiring 3 agents", source_url: "https://example.com/careers", dated: "2026-11-10", uncertain: false },
      { kind: "listing", text: "Has 12 Harbor St listed", source_url: "https://example.com/listings/12-harbor-st", dated: "2026-11-09", uncertain: false },
    ],
    hook_specific: 0, hook_angle: "departures",
    detail: "7 of the 9 agents on your About page list their own cell",
    hook_why: "When one of them leaves, the contacts on that cell leave with them.",
    sources: {
      buyer_role: src("https://example.com/about"), buyer_second: src("https://example.org/license/qa-probe"), owner_title: src("https://example.com/about"),
      specialty: src("https://example.com/"), team_members: src("https://example.com/about"), linkedin_url: src("https://example.com/about"),
    },
    outreach: {
      first_text: "Hi Quinn, Sam from SwiftCard. 7 of the 9 agents on your About page list their own cell. I made you a card for that. Want me to send it?",
      first_text_b: "Hi Quinn, Sam from SwiftCard. Your Careers page says you are hiring 3 agents. I made your office a card for them. Want to see it?",
      link_text: "Quinn, here is the card. Contacts your agents have collected stay on your office list: {link}",
      email_subject: "A card for your agents",
      email_body: "Hi Quinn,\n\n7 of the 9 agents on your About page list their own cell. I made a card for your office that keeps the contacts they collect on one list.\n\nHere it is: {link}\n\nSam",
      call_opener: "Hi Quinn, it's Sam from SwiftCard. I sent you a card I made for your office. 7 of your 9 agents list their own cell, and that is what it is for.",
      voicemail: "Hi Quinn, Sam from SwiftCard. I made a card for your office and texted you the link. Call me back at this number when you have a minute.",
      nudge_no_view: "Quinn, the card I made for your office is still here when you have a minute: {link}",
      nudge_viewed: "Quinn, want me to set the card up for all 9 agents? It takes a few minutes on a call.",
      linkedin_note: "Hi Quinn, I work with real estate offices in Brooklyn and saw you are hiring agents. Would be glad to connect.",
      linkedin_dm: "Thanks for connecting, Quinn. I put together something for your office after seeing your About page. Want me to send it?",
      first_pick: "a",
    },
  });

  // ── Warm paths: a small connections file ──────────────────────────────────
  await part("warm paths", async () => {
    // The upload REPLACES the stored list, so the owner's own rows are kept
    // aside first and put back afterwards, whatever happens in between.
    savedConnections = await rows("/rest/v1/linkedin_connections?select=uploaded_at,first_name,last_name,url,company,position,connected_on,company_key&order=id&limit=30000");
    savedUpload = (await rows("/rest/v1/card_builder_settings?key=eq.linkedin_upload&select=value"))[0]?.value;
    if (savedConnections.length) writeFileSync(`${OUT}/connections-kept-aside.json`, JSON.stringify(savedConnections));
    const csv = `Notes:\n"When exporting your connection data, you may notice that some of the email addresses are missing."\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\nAvery,Fakename,https://www.linkedin.com/in/qa-probe-avery,,${OFFICE},Agent,05 Nov 2026\nJordan,Nomatch,https://www.linkedin.com/in/qa-probe-jordan,,Somewhere Else LLC,Analyst,01 Jan 2025\n`;
    await admin.goto(`${ADMIN_BASE}/admin/card-builder/connections`, { waitUntil: "domcontentloaded" });
    await admin.setInputFiles("[data-upload-form] input[type=file]", { name: "Connections.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await Promise.all([admin.waitForURL(/done=uploaded|error=/, { timeout: 30000 }), admin.click("[data-upload-form] button[type=submit]")]);
    pass(/done=uploaded&n=2/.test(admin.url()), `Warm paths: a 2-row connections file uploads (${admin.url().split("?")[1] ?? ""})`);
    pass(!(await sideways(admin)), "Warm paths screen fits a phone");
    await admin.goto(`${ADMIN_BASE}/admin/card-builder/approve`, { waitUntil: "domcontentloaded" });
    const warm = await admin.locator(`#p-${previewId} [data-warm]`).textContent({ timeout: 10000 }).catch(() => null);
    pass(!!warm && warm.includes("Avery Fakename"), `Warm paths: the connection at the prospect's office shows on their card (${(warm ?? "nothing shown").slice(0, 90)})`);
    pass(!!warm && !warm.includes("Jordan"), "Warm paths: a connection at another company is not shown");
  });
  // Put the list back exactly as it was (see above). Done here, not only in
  // `finally`, so the rest of the run sees the owner's real connections.
  const restoreConnections = async () => {
    if (savedConnections === null) return;
    await del("/rest/v1/linkedin_connections?url=like.*qa-probe-*");
    const left = await rows("/rest/v1/linkedin_connections?select=id&limit=1");
    if (savedConnections.length && !left.length) {
      for (let i = 0; i < savedConnections.length; i += 1000) await adm("/rest/v1/linkedin_connections", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(savedConnections.slice(i, i + 1000)) });
    }
    if (savedUpload !== undefined) await patch("/rest/v1/card_builder_settings?key=eq.linkedin_upload", { value: savedUpload });
    else await del("/rest/v1/card_builder_settings?key=eq.linkedin_upload");
    savedConnections = null;
  };
  await part("warm paths cleanup", async () => {
    const had = savedConnections?.length ?? 0;
    await restoreConnections();
    pass((await rows("/rest/v1/linkedin_connections?url=like.*qa-probe-*&select=id")).length === 0, "Warm paths: the test rows are deleted");
    const now = (await rows("/rest/v1/linkedin_connections?select=id&limit=30000")).length;
    pass(now === had, `Warm paths: the owner's own connections are as they were (${had} before, ${now} after)`);
  });

  // ── Approve: version A or B, edit a message, approve and publish ──────────
  const EDITED_B = "Hi Quinn, Sam from SwiftCard. Your Careers page says you are hiring 3 agents. I made your office a card for them. Should I send it over?";
  await part("approve", async () => {
    pass((await counts(admin)).Approve === before.Approve + 1, "main page: the Approve count went up by one for the new draft");
    await admin.goto(`${ADMIN_BASE}/admin/card-builder/approve`, { waitUntil: "domcontentloaded" });
    const card = admin.locator(`#p-${previewId}`);
    pass(await card.getAttribute("data-approve-card") === "waiting", "Approve: the draft is under Waiting for you");
    pass(await card.locator("[data-versions] input[type=radio]").count() === 2, "Approve: both versions of the first text are there to pick from");
    pass(!(await sideways(admin)), "Approve fits a phone");

    // Edit a message.
    await Promise.all([admin.waitForURL(new RegExp(`/edit/${previewId}`), { timeout: 20000 }), card.locator("[data-edit]").click()]);
    const field = admin.locator("textarea[name=o_first_text_b]");
    await field.fill(EDITED_B);
    const form = admin.locator("form", { has: admin.locator("input[name=action][value=outreach]") });
    await Promise.all([admin.waitForURL(/done=|error=/, { timeout: 20000 }), form.locator("button[type=submit]").first().click()]);
    pass(/done=messages/.test(admin.url()), `Edit: a reworded message saves (${decodeURIComponent(admin.url().split("?")[1] ?? "").slice(0, 160)})`);
    pass((await preview()).outreach?.first_text_b === EDITED_B, "Edit: the new words are what is stored");
    const edits = await rows(`/rest/v1/prospect_message_events?preview_id=eq.${previewId}&kind=eq.edit&select=message,after`);
    pass(edits.some((e) => e.message === "first_text_b" && e.after === EDITED_B), "Edit: the change is kept as a style example for the next drafts");

    // Pick B, approve and publish.
    await admin.goto(`${ADMIN_BASE}/admin/card-builder/approve`, { waitUntil: "domcontentloaded" });
    await card.locator("[data-versions] input[value=b]").check();
    await Promise.all([admin.waitForURL(/done=approved/, { timeout: 30000 }), card.locator("[data-approve]").click()]);
    const p = await preview();
    pass(p.status === "live", "Approve and publish: the preview is published");
    pass(p.outreach?.first_pick === "b", "Approve and publish: version B is the one saved");
    pass(!p.asked_at && !p.sent_at, "Approve and publish: nothing is marked sent by approving");
    const open = await fetch(`${BASE}/p/${slug}`, { headers: { "User-Agent": UA_PHONE } });
    pass(open.status === 200, `the published link opens (${open.status})`);
  });

  // ── The Messages, Mail and LinkedIn buttons ───────────────────────────────
  await part("send buttons", async () => {
    await admin.goto(`${ADMIN_BASE}/admin/card-builder/approve`, { waitUntil: "domcontentloaded" });
    const card = admin.locator(`#p-${previewId}`);
    pass(await card.getAttribute("data-approve-card") === "send", "Approve: the published preview moves to \"send the first text\"");
    const href = async (sel) => decodeURIComponent((await card.locator(sel).first().getAttribute("href")) ?? "");
    const ask = await href('[data-one-tap="ask"]'), text = await href('[data-one-tap="text"]'), mail = await href('[data-one-tap="email"]');
    pass(/^sms:/.test(ask) && ask.includes("2125550147") && ask.includes(EDITED_B), "Messages button: opens a text to their number with the edited version B");
    pass(!ask.includes("/p/"), "Messages button: the first text carries no link");
    pass(/^sms:/.test(text) && text.includes(`/p/${slug}`), "Text the link: opens a text with their preview link in it");
    pass(mail.startsWith(`mailto:${prospectEmail}`) && mail.includes("A card for your agents") && mail.includes(`/p/${slug}`), "Mail button: opens an email to them with the subject, the words and the link");
    const li = card.locator('[data-linkedin="linkedin_note"]');
    pass(await li.getAttribute("href") === "https://www.linkedin.com/in/qa-probe-swiftcard" && await li.getAttribute("target") === "_blank", "LinkedIn button: opens their profile in a new tab");

    await tapWithoutLeaving(admin, `#p-${previewId} [data-linkedin="linkedin_note"]`);
    pass(!!(await until(async () => (await preview()).linkedin_sent_at)), "LinkedIn button: pressing it records the note as sent");
    const clip = await admin.evaluate(() => navigator.clipboard.readText()).catch(() => "");
    pass(clip.startsWith("Hi Quinn, I work with real estate offices"), "LinkedIn button: the connection note is on the clipboard to paste");

    await admin.goto(`${ADMIN_BASE}/admin/card-builder/approve`, { waitUntil: "domcontentloaded" });
    await Promise.all([admin.waitForURL(/done=accepted/, { timeout: 20000 }), admin.locator(`#p-${previewId} [data-accepted]`).click()]);
    pass(!!(await preview()).linkedin_accepted_at, "\"They accepted\": one tap records it");
    await admin.goto(`${ADMIN_BASE}/admin/card-builder/follow-up`, { waitUntil: "domcontentloaded" });
    const dm = admin.locator('[data-follow-up="linkedin_accepted"]', { hasText: OFFICE });
    pass(await dm.count() === 1 && ((await dm.locator("[data-follow-words]").textContent()) ?? "").startsWith("Thanks for connecting, Quinn"), "\"They accepted\": the LinkedIn message shows under Call and follow up with its words");
    pass(!(await sideways(admin)), "Call and follow up fits a phone");

    await admin.goto(`${ADMIN_BASE}/admin/card-builder/approve`, { waitUntil: "domcontentloaded" });
    await tapWithoutLeaving(admin, `#p-${previewId} [data-one-tap="ask"]`);
    pass(!!(await until(async () => (await preview()).asked_at)), "Messages button: pressing it marks the first text sent");
    const sent = await until(async () => (await rows(`/rest/v1/prospect_message_events?preview_id=eq.${previewId}&kind=eq.sent&message=eq.ask&select=variant,after`))[0]);
    pass(sent?.variant === "b" && sent?.after === EDITED_B, "Messages button: what went (version B, as edited) is recorded");

    await admin.goto(`${ADMIN_BASE}/admin/card-builder/send/${previewId}`, { waitUntil: "domcontentloaded" });
    pass(!(await sideways(admin)), "Send screen fits a phone");
    await tapWithoutLeaving(admin, '[data-send="text"]');
    pass(!!(await until(async () => { const p = await preview(); return p.sent_at && p.sent_channel === "text"; })), "Send screen: \"text the link\" marks the link sent by text");
    await tapWithoutLeaving(admin, '[data-send="email"]');
    pass(!!(await until(async () => (await preview()).sent_channel === "email")), "Send screen: the Mail button marks the link sent by email");
  });

  // ── The prospect opens it, signed out, in a separate browser ──────────────
  // THE ONE CONTEXT THAT IS NOT MARKED INTERNAL (scripts/qa-internal.mjs), on
  // purpose: a view from a browser carrying the internal marker is never
  // counted, and counting the view is the thing being tested. It opens the
  // preview page and nothing else. /p is in neither analytics sink, so it adds
  // nothing to the funnel; the booking, which is on a counted page, is made
  // from a marked browser below. Pinned by tests/qa-internal-marker.test.ts.
  const prospectCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: UA_PHONE, isMobile: true, hasTouch: true });
  const prospect = await prospectCtx.newPage(); pages.push(prospect);
  const visitorCtx = await markInternal(await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: UA_PHONE, isMobile: true, hasTouch: true }), BASE);
  const visitor = await visitorCtx.newPage(); pages.push(visitor);
  let counted = false;
  await part("the prospect's view", async () => {
    const t0 = new Date().toISOString();
    const look = async (site) => {
      const res = await prospect.goto(`${site}/p/${slug}`, { waitUntil: "domcontentloaded" });
      await wait(5200);
      await prospect.evaluate(async () => { for (let y = 0; y <= document.body.scrollHeight; y += 240) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } });
      await wait(1500);
      const view = await until(async () => (await rows(`/rest/v1/prospect_preview_views?preview_id=eq.${previewId}&select=id,alerted,first_from_device,device_type,team_strip_scrolled`))[0], 12000);
      return { status: res?.status(), view };
    };
    let { status, view } = await look(BASE);
    pass(status === 200, `signed out, the preview page opens (${status})`);
    pass((await prospect.locator("body").innerText()).includes(OWNER), "the preview shows their name");
    pass(!(await sideways(prospect)), "the preview fits a phone");
    pass((await prospectCtx.cookies()).every((c) => !/^sb-.*auth-token/.test(c.name) && c.name !== "sc_internal"), "this browser is signed out, and carries no marker that it is ours");
    const claim = prospect.locator("[data-claim]");
    pass(((await claim.textContent()) ?? "").includes("15-min setup call") && await claim.getAttribute("href") === `/demo?ref=${slug}`, "the preview's one button offers a 15-minute setup call and leads to the booking for this preview");
    let site = BASE;
    if (!view && ADMIN_BASE !== BASE) {
      // A datacenter's view is refused on purpose (lib/prospect-preview/real-view),
      // and CI is a datacenter: on the live site, nothing counted is the RIGHT
      // answer from here. The build beside it is the same code with no such
      // address in front of it, so the view, the alert and the push are
      // proven there instead.
      pass(true, "the live site refuses to count a view that comes from a datacenter");
      site = ADMIN_BASE;
      ({ view } = await look(site));
    }
    if (!view) { pass(false, "after 5 seconds and a scroll, the view was NOT counted"); return; }
    counted = true; viewIds.push(view.id);
    pass(true, `after 5 seconds and a scroll, the view is counted${site === BASE ? "" : " (on the build beside the live site)"}`);
    pass(view.first_from_device === true && view.device_type === "phone", `the view is recorded as a first visit from a phone (${view.device_type})`);
    pass(view.alerted === true, "the view rang the alert");
    await prospect.reload({ waitUntil: "domcontentloaded" });
    await wait(4500);
    pass((await rows(`/rest/v1/prospect_preview_views?preview_id=eq.${previewId}&select=id`)).length === 1, "reloading the page does not count a second view");

    const note = await until(async () => (await rows(`/rest/v1/admin_notifications?dedupe_key=eq.prospect-view:${view.id}&select=title,href,kind`))[0]);
    pass(note?.title === `${OWNER} is viewing their card` && note?.href === `/admin/card-builder/call/${previewId}`, `the alert row is in the notification center (${note?.title ?? "missing"})`);

    await admin.goto(`${ADMIN_BASE}/admin/card-builder`, { waitUntil: "domcontentloaded" });
    const banner = await admin.locator(".adm-prospect-banner", { hasText: `${OWNER} is viewing their card` }).first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
    pass(banner, "the banner across the admin says they are viewing their card");
    if (banner) pass((await admin.locator(".adm-prospect-banner a.adm-prospect-call").first().getAttribute("href"))?.replace(/\D/g, "").endsWith("2125550147") === true, "the banner's Call button dials their number");

    const logged = await until(async () => (await rows(`/rest/v1/push_log?user_id=eq.${userId}&category=eq.prospect_view&created_at=gte.${t0}&select=outcome,endpoints`))[0]);
    if (!push.endpoint) return;
    pass(logged?.outcome === "sent" && logged.endpoints >= 1, `the view push was accepted by the push service (push log: ${logged ? `${logged.outcome}, ${logged.endpoints} device` : "no row"})`);
    pass(!!(await until(async () => push.arrived >= 1, 15000)), "the view push arrived on the subscribed device");
  });

  // ── Follow-ups and the Call screen ────────────────────────────────────────
  await part("call screen", async () => {
    if (counted) {
      await admin.goto(`${ADMIN_BASE}/admin/card-builder/follow-up`, { waitUntil: "domcontentloaded" });
      const row = admin.locator('[data-follow-up="viewed_not_reached"]', { hasText: OFFICE });
      pass(await row.count() === 1, "someone who looked and hasn't been called lands in Call and follow up");
      pass(await row.locator("[data-follow-call]").count() === 1, "their follow-up has a Call button");
      // Two rows for this one prospect: the view, and the accepted LinkedIn request.
      pass((await counts(admin))["Call and follow up"] === before["Call and follow up"] + 2, "main page: the Call and follow up count went up by the two follow-ups");
    }
    const here = `${ADMIN_BASE}/admin/card-builder/call/${previewId}`;
    await admin.goto(here, { waitUntil: "domcontentloaded" });
    pass((await admin.locator("[data-call]").first().getAttribute("href"))?.replace(/\D/g, "").endsWith("2125550147") === true, "Call screen: the big button dials their number");
    pass(((await admin.locator("[data-opener]").first().textContent().catch(() => "")) ?? "").includes("7 of your 9 agents"), "Call screen: the opener written for them is on the screen");
    pass(!(await sideways(admin)), "Call screen fits a phone");
    const expect = { no_answer: [false, null], voicemail: [false, null], reached: [true, null], meeting_booked: [true, "meeting_booked"], won: [true, "won"], lost: [true, "lost"] };
    for (const [o, [, stage]] of Object.entries(expect)) {
      const form = admin.locator("[data-outcomes] form", { has: admin.locator(`input[name=outcome][value=${o}]`) });
      await Promise.all([admin.waitForURL(/done=logged/, { timeout: 20000 }), form.locator("button[type=submit]").click()]);
      const p = await preview();
      const calledOk = o === "no_answer" || o === "voicemail" ? p.called === false : p.called === true;
      pass(p.call_outcome === o && (p.stage ?? null) === stage && calledOk, `Call screen: "${o.replace("_", " ")}" is logged (stage ${p.stage ?? "open"}, called ${p.called})`);
      if (o === "voicemail" && counted) {
        await admin.goto(`${ADMIN_BASE}/admin/card-builder/follow-up`, { waitUntil: "domcontentloaded" });
        pass(await admin.locator("[data-follow-up]", { hasText: OFFICE }).count() >= 1, "after a voicemail they are still in Call and follow up");
        await admin.goto(here, { waitUntil: "domcontentloaded" });
      }
      if (stage) {
        await admin.goto(`${ADMIN_BASE}/admin/card-builder/follow-up`, { waitUntil: "domcontentloaded" });
        pass(await admin.locator("[data-follow-up]", { hasText: OFFICE }).count() === 0, `after "${o.replace("_", " ")}" they leave Call and follow up`);
        await admin.goto(here, { waitUntil: "domcontentloaded" });
        const reopen = admin.locator("[data-outcomes] form", { has: admin.locator("input[name=action][value=reopen]") });
        await Promise.all([admin.waitForURL(/done=saved/, { timeout: 20000 }), reopen.locator("button[type=submit]").click()]);
        pass(((await preview()).stage ?? null) === null, `Call screen: Reopen puts a "${o.replace("_", " ")}" preview back in play`);
      }
    }
  });

  // ── The preview's button: book a 15-minute call, then cancel it ───────────
  await part("booking", async () => {
    const t0 = new Date().toISOString();
    // Where the preview's button leads (checked above), opened in a browser marked as ours.
    await visitor.goto(`${BASE}/demo?ref=${slug}`, { waitUntil: "domcontentloaded" });
    await visitor.waitForSelector("#demo-details", { timeout: 20000 });
    const opened = Date.now();
    const filled = await until(async () => (await visitor.inputValue("#demo-name")) === OWNER, 20000);
    const got = { name: await visitor.inputValue("#demo-name"), company: await visitor.inputValue("#demo-company"), email: await visitor.inputValue("#demo-email"), phone: await visitor.inputValue("#demo-phone") };
    pass(!!filled && got.company === OFFICE && got.email === prospectEmail && got.phone === PHONE, `the booking form starts filled in from the preview (${JSON.stringify(got)})`);
    pass(((await visitor.locator("h2").first().locator("xpath=..").innerText()) ?? "").includes("15 min"), "the booking says 15 min");
    pass(!(await sideways(visitor)), "the booking page fits a phone");
    const sms = visitor.locator("input[name=smsOptIn]");
    if (await sms.isChecked()) await sms.uncheck();
    await visitor.click('button[form="demo-details"]');
    const times = visitor.locator('[role=group][aria-label="Open times"] button');
    await times.first().waitFor({ timeout: 30000 });
    const labels = await times.allTextContents();
    pass(labels.some((t) => /:15|:45/.test(t)), `times are offered on the quarter hour (${labels.slice(0, 4).join(", ")}…)`);
    // The last quarter-hour of the day shown: the one least likely to be wanted by a real person.
    const quarter = times.filter({ hasText: /:15|:45/ }).last();
    await quarter.click();
    await visitor.locator("button", { hasText: /^Continue · / }).click();
    // Nobody reads a form and picks a time in under four seconds; the booking
    // refuses anything that fast as a script (DEMO_MIN_FILL_MS).
    await wait(Math.max(0, 6000 - (Date.now() - opened)));
    await visitor.locator("button", { hasText: "Confirm demo" }).click();
    const done = await visitor.locator("h3", { hasText: "You're booked!" }).waitFor({ timeout: 40000 }).then(() => true).catch(() => false);
    if (!done) {
      const said = await visitor.locator('[role=alert], [role=status]').allTextContents().catch(() => []);
      throw new Error(`Confirm demo did not reach "You're booked!" (${said.join(" | ").slice(0, 200) || "no message shown"})`);
    }
    pass(true, "Confirm demo reaches \"You're booked!\"");
    const b = await until(async () => (await rows(`/rest/v1/demo_bookings?prospect_preview_id=eq.${previewId}&select=*`))[0]);
    if (!b) throw new Error("no booking row tied to the preview");
    const minutes = (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000;
    pass(b.status === "confirmed" && minutes === 15 && b.source === "preview", `the booking is confirmed, 15 minutes, and tied to the preview (${minutes} min, source ${b.source})`);
    pass(b.name === OWNER && b.company === OFFICE && b.email === prospectEmail, "the booking carries the office name and the decision-maker");
    if (b.calendar_status === "created") pass(!!b.google_event_id && !!b.meet_url, "it is on the Google Calendar with a Meet link");
    else skip(`booking: the Google Calendar event was not made in this run (calendar ${b.calendar_status}), so the calendar and Meet link were not checked`);
    const p = await until(async () => { const x = await preview(); return x.stage === "meeting_booked" ? x : null; });
    pass(!!p && p.demo_booking_id === b.id, "the preview is marked \"meeting booked\"");
    const bell = await until(async () => (await rows(`/rest/v1/admin_notifications?dedupe_key=eq.prospect-booked:${b.id}&select=title,body`))[0]);
    pass(bell?.title === `Meeting booked: ${OWNER}` && /15-min setup call/.test(bell?.body ?? ""), `the notification center has "Meeting booked" (${bell?.title ?? "missing"})`);
    pass((await rows(`/rest/v1/admin_notifications?dedupe_key=eq.demo:new:${b.id}&select=id`)).length === 1, "the Demos bell has it too, like any demo");
    const mail = await until(async () => { const m = await rows(`/rest/v1/demo_messages?booking_id=eq.${b.id}&kind=in.(confirmation,owner_new)&select=kind,sent_at,skipped_reason`); return m.length === 2 && m.every((x) => x.sent_at || x.skipped_reason) ? m : null; }, 30000);
    pass(!!mail && mail.every((m) => !m.sent_at && m.skipped_reason === "test_address"), `no email went out for the test booking (${JSON.stringify(mail ?? "not settled")})`);
    if (push.endpoint) {
      const logged = await until(async () => (await rows(`/rest/v1/push_log?user_id=eq.${userId}&category=eq.prospect_view&created_at=gte.${t0}&select=outcome,endpoints`))[0]);
      pass(logged?.outcome === "sent" && logged.endpoints >= 1, `the "meeting booked" push was accepted by the push service (push log: ${logged ? `${logged.outcome}, ${logged.endpoints} device` : "no row"})`);
    }

    await admin.goto(`${ADMIN_BASE}/admin/demos`, { waitUntil: "domcontentloaded" });
    const row = admin.locator("form", { has: admin.locator(`input[name=action][value=cancel]`) }).and(admin.locator(`form[action$="${b.id}"]`));
    pass(await row.count() === 1, "the booking is on the admin's Demos page");
    if (ADMIN_BASE === BASE) {
      // Cancel it, the way the owner would.
      await row.locator("xpath=ancestor::details[1]/summary").click();
      await Promise.all([admin.waitForURL(/done=canceled/, { timeout: 40000 }), row.locator("button[type=submit]").click()]);
      const after = (await rows(`/rest/v1/demo_bookings?id=eq.${b.id}&select=status,canceled_by`))[0];
      pass(after?.status === "canceled" && after?.canceled_by === "admin", "Cancel demo cancels the test booking");
    } else {
      // The admin here is a build beside the live site, without the live
      // site's Google connection, so IT must not be the one to cancel: the
      // calendar event would be left behind. The live site cancels, through
      // the prospect's own reschedule-or-cancel link. That link's token is
      // only ever stored hashed, so this booking is given one we know.
      const token = randomBytes(32).toString("base64url");
      await patch(`/rest/v1/demo_bookings?id=eq.${b.id}`, { manage_token_hash: createHash("sha256").update(token).digest("hex") });
      const r = await fetch(`${BASE}/api/demo/manage`, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": UA_PHONE }, body: JSON.stringify({ token, action: "cancel", reason: "automated test" }) });
      const after = (await rows(`/rest/v1/demo_bookings?id=eq.${b.id}&select=status,canceled_by`))[0];
      pass(r.ok && after?.status === "canceled" && after?.canceled_by === "prospect", `the cancel link cancels the test booking (${r.status})`);
    }
    const back = await until(async () => { const x = await preview(); return x.stage === null && x.demo_booking_id === null ? x : null; });
    pass(!!back, "canceling it puts the preview back in play");
  });

  // ── The same screens on a computer ────────────────────────────────────────
  await part("desktop width", async () => {
    const state = await phone.storageState();
    const wide = await markInternal(await browser.newContext({ viewport: { width: 1280, height: 800 }, userAgent: UA_DESK, storageState: state }), BASE);
    const d = await wide.newPage(); pages.push(d);
    for (const [name, path, must] of [
      ["main page", "/admin/card-builder", "[data-big-buttons]"],
      ["Add", "/admin/card-builder/add", "[data-queue-form]"],
      ["Approve", "/admin/card-builder/approve", "#ap-wait"],
      ["Call and follow up", "/admin/card-builder/follow-up", "h1"],
      ["Warm paths", "/admin/card-builder/connections", "[data-upload-form]"],
      ["Call screen", `/admin/card-builder/call/${previewId}`, "[data-outcomes]"],
      ["Send screen", `/admin/card-builder/send/${previewId}`, "[data-send]"],
      ["Edit", `/admin/card-builder/edit/${previewId}`, "textarea[name=o_first_text]"],
    ]) {
      const errors = [];
      const onErr = (e) => errors.push(String(e.message ?? e).slice(0, 120));
      d.on("pageerror", onErr);
      const res = await d.goto(`${ADMIN_BASE}${path}`, { waitUntil: "domcontentloaded" });
      const there = await d.locator(must).first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
      await wait(400);
      d.off("pageerror", onErr);
      pass(res?.status() === 200 && there && !(await sideways(d)) && !errors.length, `${name} at computer width: loads, fits, no script errors${errors.length ? ` (${errors[0]})` : ""}`);
    }
    const three = await d.goto(`${ADMIN_BASE}/admin/card-builder`, { waitUntil: "domcontentloaded" }).then(() => d.evaluate(() => { const r = [...document.querySelectorAll("[data-big]")].map((a) => a.getBoundingClientRect()); return r.length === 3 && r.every((x) => Math.abs(x.top - r[0].top) < 2); }));
    pass(three, "main page at computer width: the three buttons sit in one row");
    const v = await markInternal(await browser.newContext({ viewport: { width: 1280, height: 800 }, userAgent: UA_DESK }), BASE);
    const vp = await v.newPage(); pages.push(vp);
    await vp.goto(`${BASE}/p/${slug}`, { waitUntil: "domcontentloaded" });
    pass(!(await sideways(vp)) && await vp.locator("[data-claim]").isVisible(), "the preview at computer width: fits, with its button showing");
    await vp.goto(`${BASE}/demo?ref=${slug}`, { waitUntil: "domcontentloaded" });
    pass(!!(await until(async () => (await vp.inputValue("#demo-name")) === OWNER, 20000)) && !(await sideways(vp)), "the booking page at computer width: fits, and starts filled in");
    await v.close(); await wide.close();
  });

  // ── Delete the preview, the way the owner would ───────────────────────────
  await part("delete", async () => {
    await admin.goto(`${ADMIN_BASE}/admin/card-builder`, { waitUntil: "domcontentloaded" });
    await admin.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
    const form = admin.locator(`form[action$="${previewId}"]`, { has: admin.locator("input[name=action][value=delete]") });
    await Promise.all([admin.waitForURL(/done=deleted/, { timeout: 20000 }), form.locator("button[type=submit]").click()]);
    pass(!(await preview()), "Delete removes the test preview");
    pass((await rows(`/rest/v1/prospect_preview_views?preview_id=eq.${previewId}&select=id`)).length === 0, "and its views with it");
    const gone = await fetch(`${BASE}/p/${slug}`, { headers: { "User-Agent": UA_PHONE }, redirect: "manual" });
    pass(gone.status === 404, `its link no longer opens (${gone.status})`);
  });
} catch (e) {
  pass(false, `stopped early: ${String(e?.message ?? e).split("\n")[0].slice(0, 260)}`);
} finally {
  // ── Leave nothing behind ──────────────────────────────────────────────────
  await browser?.close().catch(() => {});
  push?.close();
  try {
    if (savedConnections !== null) {
      await del("/rest/v1/linkedin_connections?url=like.*qa-probe-*");
      const left = await rows("/rest/v1/linkedin_connections?select=id&limit=1");
      if (savedConnections.length && !left.length) await adm("/rest/v1/linkedin_connections", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(savedConnections) });
    }
    await del(`/rest/v1/prospect_queue?input=like.${encodeURIComponent("QA Probe Queue " + stamp)}*`);
    const bookings = await rows(`/rest/v1/demo_bookings?email=eq.${encodeURIComponent(prospectEmail)}&select=id,status,google_event_id`);
    for (const b of bookings) {
      if (b.status === "confirmed") failures.push(`cleanup: test booking ${b.id} was still confirmed${b.google_event_id ? " (its Google Calendar event may need deleting by hand: " + b.google_event_id + ")" : ""}`);
      for (const k of [`demo:new:${b.id}`, `demo:canceled:${b.id}`, `prospect-booked:${b.id}`]) await del(`/rest/v1/admin_notifications?dedupe_key=eq.${encodeURIComponent(k)}`);
      await del(`/rest/v1/demo_messages?booking_id=eq.${b.id}`);
      await del(`/rest/v1/demo_bookings?id=eq.${b.id}`);
    }
    if (previewId) {
      const views = await rows(`/rest/v1/prospect_preview_views?preview_id=eq.${previewId}&select=id`);
      for (const id of new Set([...viewIds, ...views.map((v) => v.id)])) await del(`/rest/v1/admin_notifications?dedupe_key=eq.${encodeURIComponent(`prospect-view:${id}`)}`);
      await del(`/rest/v1/prospect_message_events?preview_id=eq.${previewId}`);
      await del(`/rest/v1/prospect_preview_views?preview_id=eq.${previewId}`);
      await del(`/rest/v1/prospect_previews?id=eq.${previewId}`);
    }
    await del(`/rest/v1/prospect_previews?office_name=eq.${encodeURIComponent(OFFICE)}`);
    if (userId) {
      for (const t of ["push_subscriptions", "push_log", "notifications"]) await del(`/rest/v1/${t}?user_id=eq.${userId}`);
      await del(`/rest/v1/profiles?id=eq.${userId}`);
      await adm(`/auth/v1/admin/users/${userId}`, { method: "DELETE" });
    }
    // …and prove it.
    const left = {
      previews: (await rows(`/rest/v1/prospect_previews?office_name=like.${encodeURIComponent("QA Probe Realty")}*&select=id`)).length,
      bookings: (await rows(`/rest/v1/demo_bookings?email=like.qa-cb-*&select=id`)).length,
      queue: (await rows(`/rest/v1/prospect_queue?input=like.${encodeURIComponent("QA Probe Queue")}*&select=id`)).length,
      connections: (await rows("/rest/v1/linkedin_connections?url=like.*qa-probe-*&select=id")).length,
      accounts: (await rows(`/rest/v1/profiles?email=like.qa-cb-*&select=id`)).length,
      alerts: (await rows(`/rest/v1/admin_notifications?title=like.*${encodeURIComponent(OWNER)}*&select=id`)).length,
    };
    pass(Object.values(left).every((n) => n === 0), `nothing is left behind (${JSON.stringify(left)})`);
  } catch (e) {
    pass(false, `cleanup: ${String(e?.message ?? e).slice(0, 200)}`);
  }
  writeFileSync(`${OUT}/failures.json`, JSON.stringify(failures, null, 2));
  writeFileSync(`${OUT}/result.json`, JSON.stringify({ base: BASE, adminBase: ADMIN_BASE, passed, failures, unverified, at: new Date().toISOString() }, null, 2));
  console.log(`\n${passed.length} passed, ${failures.length} failed, ${unverified.length} not verified`);
  process.exit(failures.length ? 1 : 0);
}
