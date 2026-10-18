// node scripts/qa-prod-probe.mjs      env: BASE=<url> (default https://swiftcard.me)  OUT=<dir>
//
// The two pipelines the owner has had fixed more than once, exercised END TO
// END against production, with a throwaway account, every night and after
// every deploy (.github/workflows/nightly-qa.yml):
//
//   1. ANALYTICS  — a view recorded through the real endpoint lands as exactly
//      ONE card_views row, a reload inside the visit window adds none, and the
//      owner's dashboard shows it.
//   2. NOTIFICATIONS — a visit through the real card-events endpoint raises
//      exactly ONE notification carrying a visit_key; the same visitor coming
//      back inside the window raises none (the 2026-09 "double notification"
//      bug, pinned live).
//
// Plus the plumbing both depend on: bot traffic is still refused, and the
// endpoints answer fast. Everything it writes belongs to the throwaway
// account, which is deleted in `finally`.
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const BASE = process.env.BASE || "https://swiftcard.me";
const OUT = process.env.OUT || "qa-prod-probe-out";
mkdirSync(OUT, { recursive: true });
const env = existsSync(`${ROOT}/.env.local`) ? readFileSync(`${ROOT}/.env.local`, "utf8") : "";
const g = (k) => process.env[k] ?? process.env[k.replace(/^NEXT_PUBLIC_/, "")] ?? (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const SB = g("NEXT_PUBLIC_SUPABASE_URL"), SVC = g("SUPABASE_SERVICE_ROLE_KEY");
if (!SB || !SVC) { console.error("missing SUPABASE url / service role key"); process.exit(2); }
const adm = (p, i) => fetch(SB + p, { ...i, headers: { apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": "application/json", ...(i?.headers ?? {}) } });

const UA_HUMAN = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const UA_BOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const stamp = Date.now().toString().slice(-8);
const failures = [];
const pass = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failures.push(m); };
const post = (path, body, ua = UA_HUMAN) => fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": ua }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
const timed = async (fn) => { const t0 = Date.now(); const r = await fn(); return [r, Date.now() - t0]; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let userId = null; const uname = `qa-probe-${stamp}`;
// The notification half runs on its OWN throwaway owner, and that is not
// incidental — both cheaper options are silently unmeasurable:
//   · same card  — a view and a card-event on one card inside the visit window
//     are ONE visit by design, so the notification is correctly deduped away
//     and the check can only ever read 0 (ingest log: reason "deduped").
//   · second card, same owner — a Free plan serves ONE card, so card #2 comes
//     back plan-deactivated and every view against it is refused before it can
//     notify (ingest log: reason "inactive").
// A separate owner with one active card is the only shape that asks the real
// question: does a first genuine visit raise exactly one notification?
let userIdN = null; const unameN = `qa-probe-${stamp}-n`;
try {
  // ── seed one throwaway owner with one card ───────────────────────────────
  const email = `qa-probe-${stamp}@swiftcard-test.invalid`;
  const u = await (await adm("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password: `Qa!aA1${stamp}x`, email_confirm: true }) })).json();
  if (!u.id) throw new Error("seed user failed: " + JSON.stringify(u).slice(0, 160));
  userId = u.id;
  await adm("/rest/v1/profiles", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ id: userId, username: uname, name: "Probe Owner", email, plan: "free", customization: { _aiConsent: "accepted", _planChosen: "qa-seeded" } }) });
  await adm("/rest/v1/cards", { method: "POST", body: JSON.stringify({ user_id: userId, username: uname, name: "Probe Owner", title: "QA", company: "Probe Co", email, template: "classic-pro" }) });
  const emailN = `qa-probe-${stamp}-n@swiftcard-test.invalid`;
  const uN = await (await adm("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email: emailN, password: `Qa!aA1${stamp}n`, email_confirm: true }) })).json();
  if (!uN.id) throw new Error("seed notify user failed: " + JSON.stringify(uN).slice(0, 160));
  userIdN = uN.id;
  await adm("/rest/v1/profiles", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ id: userIdN, username: unameN, name: "Probe Notify", email: emailN, plan: "free", customization: { _aiConsent: "accepted", _planChosen: "qa-seeded" } }) });
  await adm("/rest/v1/cards", { method: "POST", body: JSON.stringify({ user_id: userIdN, username: unameN, name: "Probe Notify", title: "QA", company: "Probe Co", email: emailN, template: "classic-pro" }) });
  // The public page must exist before anything can be recorded against it.
  const page = await fetch(`${BASE}/${uname}`, { headers: { "User-Agent": UA_HUMAN }, signal: AbortSignal.timeout(20000) });
  pass(page.status === 200, `throwaway card page renders (${page.status})`);

  // ── 1. analytics: one view, deduped on reload, visible on the dashboard ──
  //
  // Through the ONE endpoint that records views. Until 2026-09-23 this half
  // posted to /api/views/<slug>, which had been retired on 2026-09-18 to a
  // 200-that-writes-nothing (and logs `retired_endpoint`) — so for five nights
  // it asserted "exactly ONE card_views row" against a route that could not
  // produce one, and left 150 retired_endpoint rows in the ingest log as the
  // only sign. The analytics contract is /api/card-events → lib/record-view.ts.
  const visitor = `qa-probe-visitor-${stamp}`;
  const view = { card_owner_username: uname, event_type: "viewed_card", visitor_id: visitor, source: "direct_link" };
  const [v1, v1ms] = await timed(() => post("/api/card-events", view));
  const [v2] = await timed(() => post("/api/card-events", view));
  pass(v1.status < 300 && v2.status < 300, `view endpoint accepts a human visitor (${v1.status}, ${v2.status})`);
  // Beacons are fire-and-forget from the card page (nothing a visitor waits on),
  // and each spends ~2-5s in serial database round-trips (measured 2026-09-11:
  // card-events 4-5.4s). The budget is set to catch a REGRESSION from that
  // baseline, not to flap on it. The measured number is printed every night so
  // a trend is visible in the run log.
  pass(v1ms < 8000, `view endpoint answers within budget (${v1ms}ms, budget 8000)`);
  await wait(1500);

  // ── WHERE IS THIS RUNNING? (2026-09-16) ──────────────────────────────────
  // Since 2026-09-14 cloud/hosting egress is never counted — record-view.ts:
  // `if (geo.isHosting) return { outcome: "hosting" }` — and GitHub Actions IS
  // a datacenter. So from CI the honest answer to "did that view count?" is NO,
  // and asserting the happy path there can only ever fail. It did, every night
  // from 2026-09-14 on, while production was perfectly healthy. A guard that
  // cries wolf nightly is a guard nobody reads.
  //
  // So the probe asks the ingest log where it stands and checks the contract
  // that actually applies. Neither mode is the lesser one: from a datacenter
  // this becomes a live regression test for the exclusion itself, which is the
  // thing that keeps view counts honest. Do not "fix" this by giving the probe
  // a bypass header — that is the hole the exclusion exists to close.
  // The endpoint says so itself: /api/card-events answers `{ ok, hosting: true }`
  // when record-view refuses datacenter egress (the `decided()` helper puts the
  // outcome on the response). The first attempt at this read
  // analytics_ingest_log for a "hosting" decision — but recordView returns
  // BEFORE anything is logged, so a refused view leaves no row at all, and the
  // probe read that absence as "residential" and failed the full pipeline from
  // CI anyway. Absence of evidence was the bug; the flag is the evidence.
  const v1Body = await v1.json().catch(() => ({}));
  const hosting = v1Body.hosting === true;
  const expectViews = hosting ? 0 : 1;
  console.log(hosting
    ? "MODE datacenter — hosting egress, so the refusal contract is what gets checked"
    : "MODE residential — the full pipeline gets checked");

  const views = await (await adm(`/rest/v1/card_views?username=eq.${uname}&select=id,visitor_id,source`)).json();
  pass(Array.isArray(views) && views.length === expectViews,
    hosting
      ? `a datacenter's view is refused, so NO card_views row (got ${Array.isArray(views) ? views.length : JSON.stringify(views).slice(0, 80)})`
      : `exactly ONE card_views row after view + reload (got ${Array.isArray(views) ? views.length : JSON.stringify(views).slice(0, 80)})`);
  if (hosting) {
    // Positive evidence, not an absence: the endpoint named the reason, and
    // nothing was counted. A silently broken endpoint records nothing either,
    // which is exactly why the flag has to carry the verdict.
    pass(v1Body.ok === true, `the refusal is a clean 200, not an error (${JSON.stringify(v1Body)})`);
  }
  const bot = await post("/api/card-events", { ...view, visitor_id: `bot-${stamp}` }, UA_BOT);
  await wait(800);
  const viewsAfterBot = await (await adm(`/rest/v1/card_views?username=eq.${uname}&select=id`)).json();
  pass(viewsAfterBot.length === expectViews, `a crawler's view is refused (${bot.status}, rows still ${viewsAfterBot.length})`);

  // ── 2. notifications: one per visitor per visit, never two ───────────────
  // A fresh visitor: the analytics visitor above already opened a visit, so an
  // event from it is a legitimate "same visit" dedupe, not a notification.
  const ev = { card_owner_username: unameN, event_type: "viewed_card", visitor_id: `${visitor}-n` };
  const [e1, e1ms] = await timed(() => post("/api/card-events", ev));
  const [e2] = await timed(() => post("/api/card-events", ev));
  pass(e1.status < 300 && e2.status < 300, `card-events endpoint accepts a human visit (${e1.status}, ${e2.status})`);
  pass(e1ms < 8000, `card-events answers within budget (${e1ms}ms, budget 8000)`);
  await wait(2500);
  const notes = await (await adm(`/rest/v1/notifications?user_id=eq.${userIdN}&select=id,type,visit_key`)).json();
  const n = Array.isArray(notes) ? notes.length : -1;
  if (hosting) {
    // A view that was never counted must never have rung anybody's phone.
    pass(n === 0, `a datacenter's visit raises NO notification (got ${n})`);
  } else {
    pass(n === 1, `exactly ONE notification for the visit (got ${n}: ${JSON.stringify(notes).slice(0, 120)})`);
    pass(n === 1 && !!notes[0].visit_key, `the notification carries a visit_key (dedupe index in force)`);
  }

  // ── 3. the pipeline's own health endpoint ────────────────────────────────
  const [h, hms] = await timed(() => fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(20000) }));
  const hj = await h.json().catch(() => ({}));
  pass(h.status === 200 && hj.ok === true, `/api/health ok (db=${hj.db}, dbMs=${hj.dbMs}, ${hms}ms)`);
  pass(Number(hj.dbMs) < 1200, `database answers within budget (dbMs=${hj.dbMs})`);

  // ── 4. no free Pro outlives its end date (2026-09-16) ────────────────────
  // A free-Pro grant (referral or delete-flow days) is Pro with an expiry and
  // no subscription; the daily /api/reminders cron moves it back to Free. If
  // that job dies, every grant quietly becomes permanent Pro and nothing else
  // would ever notice. The cron runs once a day, so anything more than 26 hours
  // past its expiry means it did not run. Apple-billed rows are excluded — the
  // Apple grant clears the expiry, and a stale one there is not access leaking.
  const staleBefore = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
  const stale = await (await adm(
    `/rest/v1/profiles?plan=in.(pro,enterprise)&stripe_subscription_id=is.null&plan_expires_at=lt.${encodeURIComponent(staleBefore)}` +
    `&or=(customization->>_planSource.is.null,customization->>_planSource.neq.apple)&select=id&limit=20`,
  )).json();
  pass(Array.isArray(stale) && stale.length === 0,
    `no free-Pro grant is still Pro past its end date (got ${Array.isArray(stale) ? stale.length : JSON.stringify(stale).slice(0, 80)})`);
} catch (e) {
  console.log("ERROR", e.message); failures.push("probe threw: " + e.message);
} finally {
  for (const [uid, un] of [[userId, uname], [userIdN, unameN]]) {
    if (!uid) continue;
    for (const p of [`/rest/v1/notifications?user_id=eq.${uid}`, `/rest/v1/card_events?card_owner_username=eq.${un}`, `/rest/v1/card_views?username=in.(${un},${un}__links)`, `/rest/v1/leads?card_owner=eq.${un}`, `/rest/v1/cards?user_id=eq.${uid}`, `/rest/v1/profiles?id=eq.${uid}`]) {
      await adm(p, { method: "DELETE" }).catch(() => {});
    }
    await adm(`/auth/v1/admin/users/${uid}`, { method: "DELETE" }).catch(() => {});
  }
  writeFileSync(`${OUT}/failures.json`, JSON.stringify(failures, null, 2));
  console.log(failures.length ? `\n${failures.length} FAILURES` : "\nALL PASS");
  process.exit(failures.length ? 1 : 0);
}
