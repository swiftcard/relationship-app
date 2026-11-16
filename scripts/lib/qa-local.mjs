// ── QA runs on this machine, never on the live site ─────────────────────────
//
// In November 2026 Vercel switched swiftcard.me off for going over its limits.
// The traffic was ours: the nightly QA workflow also ran after EVERY production
// deploy, drove the live site with a real browser about 150 times in 30 days,
// and made and deleted about 13 accounts each time (roughly 1,950 in a billing
// cycle, against a few dozen real people). product_events showed exactly 109
// internal events per run, and the spike days were the days with the most
// deploys.
//
// So every QA script, test and agent goes through this file, and it enforces
// three things:
//
//   1. localBase()      the site under test is a build on THIS machine
//                       (`npx next build && npx next start -p 3222`). A
//                       swiftcard or vercel.app address stops the run.
//   2. seededAdmin()    the accounts are a small fixed set that is reused. A
//                       script still "creates" and "deletes" a user exactly as
//                       it always did; here that hands out one of the seeded
//                       accounts and takes it back, so no account is made or
//                       removed per run.
//   3. stubUploads()    pictures the app would upload are answered in the
//                       browser, so a run adds nothing to storage.
//
// tests/qa-local-only.test.ts fails if a script stops using them.

// ── 1. The base URL guard ───────────────────────────────────────────────────

/** Hosts a QA run may never be pointed at: the product's own domains and any
 *  Vercel deployment (production or preview). */
const FORBIDDEN_HOST = /(^|\.)(swiftcard\.(me|app)|vercel\.app)$/i;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|::1|10\.0\.2\.2|[a-z0-9-]+\.localhost)$/i;

export const DEFAULT_LOCAL_BASE = "http://localhost:3222";

/** Why a base URL is refused, or null when it is a local build. Pure, so the
 *  rule itself is unit-tested. */
export function baseUrlProblem(value) {
  let url;
  try { url = new URL(String(value)); } catch { return `"${value}" is not a URL`; }
  const host = url.hostname;
  if (FORBIDDEN_HOST.test(host)) {
    return `${url.origin} is the live site or a Vercel deployment. Tests, verification and agents never run there (CLAUDE.md).`;
  }
  if (!LOCAL_HOST.test(host)) {
    return `${url.origin} is not this machine. QA only runs against a local build.`;
  }
  return null;
}

const HOW = "Start a local build instead:  npx next build && npx next start -p 3222   then  BASE=http://localhost:3222";

/** The base URL a script may use: the given one if it is local, the default
 *  when none is given. Anything else ends the process before a single request. */
export function localBase(value, fallback = DEFAULT_LOCAL_BASE) {
  const base = String(value || fallback).replace(/\/$/, "");
  const problem = baseUrlProblem(base);
  if (problem) {
    console.error(`\nREFUSED: ${problem}\n${HOW}\n`);
    process.exit(2);
  }
  return base;
}

/** Same rule for code that must throw rather than exit (the browser helper). */
export function assertLocalBase(value) {
  const problem = baseUrlProblem(value);
  if (problem) throw new Error(`REFUSED: ${problem} ${HOW}`);
}

// ── 2. The seeded accounts ──────────────────────────────────────────────────
//
// QA_POOL_SIZE fixed accounts, with fixed ids, made once and kept. While one is
// parked its address is qa-seed-NN@swiftcard-seed.invalid. A script that asks
// for a user gets a parked one, emptied, carrying the address and password the
// script asked for; "deleting" it empties it again and parks it.
//
// app_metadata.qa_seed marks them, which is what keeps the app's own sweep of
// leftover QA accounts (lib/qa-account-sweep) from removing them.

export const QA_POOL_SIZE = 12;
export const QA_SEED_DOMAIN = "@swiftcard-seed.invalid";
/** A lease older than this belongs to a run that crashed; the account is reused. */
const LEASE_MS = 90 * 60 * 1000;

export const seedId = (n) => `5eed0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const seedEmail = (n) => `qa-seed-${String(n).padStart(2, "0")}${QA_SEED_DOMAIN}`;
const SEED_IDS = new Set(Array.from({ length: QA_POOL_SIZE }, (_, i) => seedId(i + 1)));
export const isSeedId = (id) => SEED_IDS.has(String(id).toLowerCase());

// Every table that holds rows for an account (the foreign keys to auth.users
// and profiles on 2026-11-15). Deleting a user used to clear these by cascade;
// a reused account has to be emptied by hand. A table that does not exist, or
// a column that was renamed, is skipped: the account is still handed out.
const OWNED_ROWS = [
  ["office_members", "user_id"],
  ["offices", "owner_id"],
  ["referrals", "referrer_id"],
  ["referrals", "referred_id"],
  ["apple_refresh_tokens", "user_id"],
  ["contact_devices", "owner_id"],
  ["contact_links", "owner_id"],
  ["email_logs", "user_id"],
  ["email_preferences", "user_id"],
  ["integrations", "user_id"],
  ["notifications", "user_id"],
  ["promo_code_redemptions", "user_id"],
  ["push_log", "user_id"],
  ["push_subscriptions", "user_id"],
  ["unsubscribe_events", "user_id"],
  ["user_devices", "user_id"],
  ["cards", "user_id"],
  ["profiles", "id"],
];

const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const bad = (status, msg) => new Response(JSON.stringify({ msg, error: msg }), { status, headers: { "Content-Type": "application/json" } });

/**
 * Wraps a script's admin fetch so that making and deleting auth users goes to
 * the seeded accounts. Everything else passes straight through.
 *
 *   const adm = seededAdmin((path, init) => fetch(SB + path, { ...init, headers }));
 */
export function seededAdmin(adm) {
  const held = new Set();

  async function empty(id) {
    // Rows keyed by username first (a card's views, events and leads), while
    // the cards that name them still exist.
    const cards = await adm(`/rest/v1/cards?user_id=eq.${id}&select=username`).then((r) => r.json()).catch(() => []);
    const names = (Array.isArray(cards) ? cards : []).map((c) => c.username).filter((u) => /^[a-z0-9-]+$/i.test(u ?? ""));
    if (names.length) {
      const list = names.flatMap((u) => [u, `${u}__links`]).join(",");
      await adm(`/rest/v1/card_views?username=in.(${list})`, { method: "DELETE" }).catch(() => {});
      await adm(`/rest/v1/card_events?card_owner_username=in.(${names.join(",")})`, { method: "DELETE" }).catch(() => {});
      await adm(`/rest/v1/leads?card_owner=in.(${names.join(",")})`, { method: "DELETE" }).catch(() => {});
    }
    for (const [table, column] of OWNED_ROWS) {
      await adm(`/rest/v1/${table}?${column}=eq.${id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }).catch(() => {});
    }
  }

  async function acquire(body) {
    for (let n = 1; n <= QA_POOL_SIZE; n++) {
      const id = seedId(n);
      if (held.has(id)) continue;
      const res = await adm(`/auth/v1/admin/users/${id}`);
      if (res.status === 404) {
        // First use ever of this slot: the one place an account is made. It is
        // never deleted afterwards.
        const made = await adm("/auth/v1/admin/users", {
          method: "POST",
          body: JSON.stringify({ id, email: seedEmail(n), password: body.password, email_confirm: true, app_metadata: { qa_seed: true } }),
        });
        const user = await made.json().catch(() => ({}));
        if (!made.ok || user.id !== id) return bad(500, `could not seed QA account ${n}: ${JSON.stringify(user).slice(0, 160)}`);
      } else if (res.ok) {
        const user = await res.json();
        const parked = String(user.email ?? "").endsWith(QA_SEED_DOMAIN);
        const leasedAt = Number(user.app_metadata?.qa_lease ?? 0);
        // Another run is using it. CI runs one QA job at a time (the job's
        // concurrency group), so there a lease can only be a cancelled run's.
        if (!parked && Date.now() - leasedAt < LEASE_MS && process.env.QA_POOL_RECLAIM !== "1") continue;
      } else {
        return res;
      }
      held.add(id);
      await empty(id);
      return adm(`/auth/v1/admin/users/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          email: body.email, password: body.password, email_confirm: true,
          user_metadata: body.user_metadata ?? {},
          app_metadata: { ...(body.app_metadata ?? {}), qa_seed: true, qa_lease: Date.now() },
        }),
      });
    }
    return bad(429, `all ${QA_POOL_SIZE} seeded QA accounts are in use; wait for the other run to finish`);
  }

  async function release(id) {
    await empty(id);
    held.delete(id);
    const n = Number(id.slice(-12));
    await adm(`/auth/v1/admin/users/${id}`, {
      method: "PUT",
      body: JSON.stringify({ email: seedEmail(n), email_confirm: true, user_metadata: {}, app_metadata: { qa_seed: true, qa_lease: 0 } }),
    });
    return ok({});
  }

  return async function seeded(path, init) {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "POST" && /^\/auth\/v1\/admin\/users\/?(\?.*)?$/.test(path)) {
      let body = {};
      try { body = JSON.parse(init?.body ?? "{}"); } catch { /* not JSON */ }
      return acquire(body);
    }
    const one = path.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})\/?$/i);
    if (method === "DELETE" && one && isSeedId(one[1])) return release(one[1].toLowerCase());
    return adm(path, init);
  };
}

// ── 3. Uploads answered in the browser ──────────────────────────────────────
//
// The app uploads a picture of the card whenever its owner looks at it, plus
// photos, logos and signature images. Against a real bucket those piled up to
// 2.8 GB of qa-*.png by 2026-10-20. Here the request never leaves the browser:
// it is answered with the same JSON shape the route returns, pointing at an
// image the local build already serves. QA_REAL_UPLOADS=1 turns this off for
// the rare run that is about the upload itself.

const STUB_IMAGE = "/brand-icon-192.png";
const STUB_FILE = new URL("../../public/brand-icon-192.png", import.meta.url).pathname;

export async function stubUploads(ctx, base) {
  if (process.env.QA_REAL_UPLOADS === "1") return ctx;
  const origin = String(base || DEFAULT_LOCAL_BASE).replace(/\/$/, "");
  const json = (route, body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  const named = (route, bucket) => {
    let username = "qa";
    try { username = route.request().postDataJSON()?.username ?? "qa"; } catch { /* multipart */ }
    return `${origin}${STUB_IMAGE}?stub=${bucket}/${encodeURIComponent(username)}.png&v=${Date.now()}`;
  };
  await ctx.route(/\/api\/(card-share-image|card-signature)(\?.*)?$/, (route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.fallback();
    const bucket = req.url().includes("card-signature") ? "card-signatures" : "card-shares";
    return json(route, { url: named(route, bucket) });
  });
  await ctx.route(/\/api\/upload(\/link-video)?(\?.*)?$/, (route) => {
    const method = route.request().method();
    if (method === "DELETE") return json(route, { ok: true });
    if (method !== "POST") return route.fallback();
    return json(route, { url: `${origin}${STUB_IMAGE}?stub=card-uploads&v=${Date.now()}` });
  });
  // The app then shows the stored picture from the bucket's public URL. For a
  // QA card (qa-…) nothing was stored, so that read is answered here as well.
  // Real cards' pictures are untouched.
  await ctx.route(/\/storage\/v1\/object\/public\/(card-signatures|card-shares)\/qa-[^/]*\.png/, (route) =>
    route.request().method() === "GET" ? route.fulfill({ status: 200, contentType: "image/png", path: STUB_FILE }) : route.fallback());
  // Direct-to-storage uploads (a signed upload URL) never reach the bucket either.
  await ctx.route(/\/storage\/v1\/object\/upload\/sign\//, (route) => json(route, { Key: "qa-stub" }));
  return ctx;
}
