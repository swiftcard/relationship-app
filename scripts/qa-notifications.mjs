// node scripts/qa-notifications.mjs      env: BASE=<url> (default https://swiftcard.me)  OUT=<dir>
//
// WHO GETS WHICH NOTIFICATION, end to end against production, for every plan
// and account type — run every night and after every deploy
// (.github/workflows/nightly-qa.yml). Owner, 2026-10-02: "make sure, for each
// plan and each account type, all the correct notifications are showing and
// that there are no mistakes."
//
// Seeds six throwaway accounts — Free, Pro, an Office owner with an admin and
// an employee, and a former Office owner (lapsed to Free) whose team still has
// an employee — then submits a real contact through /api/leads on each
// person's card and checks three things:
//
//   1. THE BELL (as each person, signed in, through GET /api/notifications —
//      the exact list the app shows): the card's owner gets "New contact", and
//      the row carries the contact so tapping it opens them. Nobody else gets
//      that row — an admin never gets a teammate's contacts in their own bell.
//   2. THE TEAM INBOX (GET /api/office/notifications): a live team's owner and
//      admin see "First lead for …"; the employee is refused; the lapsed owner
//      is refused and their team gets no row at all.
//   3. THE PHONE (push_log, which records every push DECISION whether or not a
//      phone is registered): a "new_lead" decision for each card owner, a
//      "team_alert" for the live team's owner and admin — and none for the
//      employee the news is about, nor for the lapsed owner.
//
// Contacts are used rather than card views on purpose: from GitHub's
// datacenter every VIEW is refused by design (lib/record-view, see
// qa-prod-probe), so a view could never prove a notification here. Lead capture
// takes no such exemption.
//
// Everything written belongs to the throwaway accounts and is deleted in
// `finally` — profiles unlinked from their office FIRST, because
// profiles.office_id has no cascade and an office still referenced cannot be
// deleted (246 offices leaked that way before 2026-10-02).
import { chromium } from "playwright";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { markInternal } from "./qa-internal.mjs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1").replace(/\/$/, "");
const BASE = process.env.BASE || "https://swiftcard.me";
const OUT = process.env.OUT || "qa-notifications-out";
mkdirSync(OUT, { recursive: true });
const env = existsSync(`${ROOT}/.env.local`) ? readFileSync(`${ROOT}/.env.local`, "utf8") : "";
const g = (k) => process.env[k] ?? process.env[k.replace(/^NEXT_PUBLIC_/, "")] ?? (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const SB = g("NEXT_PUBLIC_SUPABASE_URL"), SVC = g("SUPABASE_SERVICE_ROLE_KEY");
if (!SB || !SVC) { console.error("missing SUPABASE url / service role key"); process.exit(2); }
const adm = (p, i) => fetch(SB + p, { ...i, headers: { apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": "application/json", ...(i?.headers ?? {}) } });
const json = async (p) => { const r = await adm(p); const j = await r.json().catch(() => null); return Array.isArray(j) ? j : []; };

const UA_HUMAN = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const stamp = Date.now().toString().slice(-8);
const password = `Qa!aA1${stamp}x`;
const failures = [];
const pass = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failures.push(m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const users = [];   // { id, uname }
const offices = []; // ids
let browser;

async function makeUser(tag, name, plan) {
  const email = `qa-notif-${tag}-${stamp}@swiftcard-test.invalid`;
  const uname = `qa-notif-${tag}-${stamp}`;
  const u = await (await adm("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  if (!u.id) throw new Error(`seed ${tag} failed: ${JSON.stringify(u).slice(0, 160)}`);
  users.push({ id: u.id, uname });
  await adm("/rest/v1/profiles", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ id: u.id, username: uname, name, email, plan, customization: { _aiConsent: "accepted", _planChosen: "qa-seeded" } }) });
  await adm("/rest/v1/cards", { method: "POST", body: JSON.stringify({ user_id: u.id, username: uname, name, title: "QA", company: "Notify Co", email, template: "classic-pro" }) });
  return { id: u.id, email, uname, name };
}

async function makeOffice(owner, name) {
  const o = await (await adm("/rest/v1/offices", { method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ name, owner_id: owner.id, seats: 3 }) })).json();
  const id = o?.[0]?.id; if (!id) throw new Error("no office: " + JSON.stringify(o).slice(0, 200));
  offices.push(id);
  await adm("/rest/v1/office_members", { method: "POST", body: JSON.stringify({ office_id: id, user_id: owner.id, role: "owner", status: "active", joined_at: new Date().toISOString() }) });
  return id;
}

async function addMember(officeId, person, role) {
  await adm("/rest/v1/office_members", { method: "POST", body: JSON.stringify({ office_id: officeId, user_id: person.id, role, status: "active", joined_at: new Date().toISOString(), invite_email: person.email }) });
  await adm(`/rest/v1/profiles?id=eq.${person.id}`, { method: "PATCH", body: JSON.stringify({ office_id: officeId }) });
}

/** A visitor hands over their details on this person's card. */
async function submitLead(person, n) {
  return fetch(`${BASE}/api/leads`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA_HUMAN },
    body: JSON.stringify({ name: `Dana Notify${n}`, phone: `(415) 555-01${String(n).padStart(2, "0")}`, email: `dana${n}-${stamp}@example.com`, card_owner: person.uname, visitor_id: `qa-notif-visitor-${stamp}-${n}` }),
    signal: AbortSignal.timeout(20000),
  });
}

async function typeInto(page, selector, value) {
  await page.waitForSelector(selector, { timeout: 30000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.fill(selector, value);
  await page.waitForTimeout(250);
  if ((await page.inputValue(selector)) !== value) { await page.waitForTimeout(600); await page.fill(selector, value); }
}

/** Signed in as this person: what the two notification APIs hand them. */
async function readAs(person) {
  const ctx = await markInternal(await browser.newContext({ viewport: { width: 1280, height: 900 } }), BASE);
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await typeInto(page, "#auth-email", person.email);
    await typeInto(page, "#auth-password", password);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45000 }).catch(() => {});
    const bellRes = await page.request.get(`${BASE}/api/notifications`);
    const teamRes = await page.request.get(`${BASE}/api/office/notifications`);
    return {
      signedIn: bellRes.status() === 200,
      bell: bellRes.status() === 200 ? await bellRes.json().catch(() => []) : [],
      teamStatus: teamRes.status(),
      team: teamRes.status() === 200 ? await teamRes.json().catch(() => []) : [],
    };
  } finally { await ctx.close(); }
}

/** after() work finishes a few seconds after /api/leads answers: poll the DB. */
async function waitFor(fn, ms = 25000) {
  const until = Date.now() + ms;
  let v = await fn();
  while (!v && Date.now() < until) { await wait(1500); v = await fn(); }
  return v;
}

try {
  console.log("seeding…");
  const free = await makeUser("free", "Fay Free", "free");
  const pro = await makeUser("pro", "Pat Pro", "pro");
  const owner = await makeUser("owner", "Olive Owner", "enterprise");
  const admin = await makeUser("admin", "Ada Admin", "enterprise");
  const emp = await makeUser("emp", "Eli Employee", "enterprise");
  const lapsed = await makeUser("lapsed", "Lou Lapsed", "free");
  const lapsedEmp = await makeUser("lapsedemp", "Lee Leftover", "enterprise");
  const liveOffice = await makeOffice(owner, "Notify Live Team");
  await addMember(liveOffice, admin, "admin");
  await addMember(liveOffice, emp, "employee");
  const lapsedOffice = await makeOffice(lapsed, "Notify Lapsed Team");
  await addMember(lapsedOffice, lapsedEmp, "employee");

  // ── the events ─────────────────────────────────────────────────────────────
  const targets = [free, pro, emp, lapsedEmp];
  for (const [i, p] of targets.entries()) {
    const r = await submitLead(p, i + 1);
    pass(r.status < 300, `a contact can be submitted on the ${p.uname} card (${r.status})`);
  }

  // ── 1+3 in the database: rows and push decisions ───────────────────────────
  for (const p of targets) {
    const row = await waitFor(async () => (await json(`/rest/v1/notifications?user_id=eq.${p.id}&type=eq.new_lead&select=id,lead_id`))[0]);
    pass(!!row, `${p.name}: a "New contact" row was written`);
    pass(!!row?.lead_id, `${p.name}: the row knows which contact it is (opens that contact)`);
    const decided = await waitFor(async () => (await json(`/rest/v1/push_log?user_id=eq.${p.id}&category=eq.new_lead&select=id`))[0]);
    pass(!!decided, `${p.name}: a phone notification was decided for the contact`);
  }
  for (const p of [owner, admin, lapsed]) {
    const leaked = await json(`/rest/v1/notifications?user_id=eq.${p.id}&type=eq.new_lead&select=id`);
    pass(leaked.length === 0, `${p.name}: no teammate's contact lands in their own bell (got ${leaked.length})`);
  }

  const firstLead = await waitFor(async () => (await json(`/rest/v1/office_notifications?office_id=eq.${liveOffice}&type=eq.member_first_lead&select=id`))[0]);
  pass(!!firstLead, `live team: "First lead for Eli" reached the team inbox`);
  for (const p of [owner, admin]) {
    const t = await waitFor(async () => (await json(`/rest/v1/push_log?user_id=eq.${p.id}&category=eq.team_alert&select=id`))[0]);
    pass(!!t, `live team: ${p.name} was sent the team alert`);
  }
  await wait(3000); // give anything that should NOT happen time to happen
  const empTeam = await json(`/rest/v1/push_log?user_id=eq.${emp.id}&category=eq.team_alert&select=id`);
  pass(empTeam.length === 0, `live team: the employee the news is about gets no team alert (got ${empTeam.length})`);
  const lapsedRows = await json(`/rest/v1/office_notifications?office_id=eq.${lapsedOffice}&select=id,type`);
  pass(lapsedRows.length === 0, `lapsed team: no team inbox rows (got ${lapsedRows.length}: ${JSON.stringify(lapsedRows).slice(0, 80)})`);
  const lapsedPush = await json(`/rest/v1/push_log?user_id=eq.${lapsed.id}&category=eq.team_alert&select=id`);
  pass(lapsedPush.length === 0, `lapsed team: the former owner gets no team alert (got ${lapsedPush.length})`);

  // ── 1+2 as each person sees it ─────────────────────────────────────────────
  browser = await chromium.launch();
  for (const p of [free, pro, emp]) {
    const r = await readAs(p);
    pass(r.signedIn, `${p.name}: can read their bell`);
    const lead = r.bell.find((n) => n.type === "new_lead");
    pass(!!lead, `${p.name}: "New contact" shows in their bell`);
    // The contact is under the Free cap (first of the month), so even Free
    // sees the name — and therefore keeps the link to the contact.
    pass(!!lead?.lead_id, `${p.name}: tapping it opens that contact (lead_id present)`);
  }
  {
    const r = await readAs(owner);
    pass(r.teamStatus === 200, `Office owner: can open the team inbox (${r.teamStatus})`);
    pass(r.team.some((n) => n.type === "member_first_lead"), `Office owner: sees "First lead for Eli" in the team inbox`);
    pass(!r.bell.some((n) => n.type === "new_lead"), `Office owner: the teammate's contact is not in their own bell`);
  }
  {
    const r = await readAs(admin);
    pass(r.teamStatus === 200, `Office admin: can open the team inbox (${r.teamStatus})`);
    pass(r.team.some((n) => n.type === "member_first_lead"), `Office admin: sees "First lead for Eli" in the team inbox`);
  }
  {
    const r = await readAs(emp);
    pass(r.teamStatus === 403, `Office employee: the team inbox is refused (${r.teamStatus})`);
  }
  {
    const r = await readAs(lapsed);
    pass(r.teamStatus === 403, `former Office owner: the team inbox is refused (${r.teamStatus})`);
  }
} catch (e) {
  console.log("ERROR", e.message); failures.push("qa-notifications threw: " + e.message);
} finally {
  if (browser) await browser.close().catch(() => {});
  console.log("\ncleaning up…");
  try {
    for (const officeId of offices) {
      await adm(`/rest/v1/profiles?office_id=eq.${officeId}`, { method: "PATCH", body: JSON.stringify({ office_id: null }) });
      await adm(`/rest/v1/office_notifications?office_id=eq.${officeId}`, { method: "DELETE" });
      await adm(`/rest/v1/office_members?office_id=eq.${officeId}`, { method: "DELETE" });
      const del = await adm(`/rest/v1/offices?id=eq.${officeId}`, { method: "DELETE" });
      if (!del.ok) console.error(`  OFFICE NOT DELETED (${del.status}) — remove manually: ${officeId}`);
    }
    for (const { id, uname } of users) {
      for (const p of [
        `/rest/v1/push_log?user_id=eq.${id}`, `/rest/v1/notifications?user_id=eq.${id}`,
        `/rest/v1/leads?card_owner=eq.${uname}`, `/rest/v1/card_views?username=in.(${uname},${uname}__links)`,
        `/rest/v1/cards?user_id=eq.${id}`, `/rest/v1/profiles?id=eq.${id}`,
      ]) await adm(p, { method: "DELETE" }).catch(() => {});
      await adm(`/auth/v1/admin/users/${id}`, { method: "DELETE" }).catch(() => {});
    }
    console.log(`  removed ${users.length} users and ${offices.length} offices`);
  } catch (e) { console.error("  CLEANUP FAILED — remove manually:", users.map((u) => u.id), offices, e.message); }
  writeFileSync(`${OUT}/failures.json`, JSON.stringify(failures, null, 2));
  console.log(failures.length ? `\n${failures.length} FAILURES` : "\nALL PASS");
  process.exit(failures.length ? 1 : 0);
}
