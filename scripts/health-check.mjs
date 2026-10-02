// Production health check — the credential-free half of the monitoring story.
//
// WHY THIS EXISTS: the Sentry stack (error reporting, daily triage, auto-rollback)
// is written and merged but dormant, because every piece of it needs an account
// and API tokens that only the owner can create. That left production with error
// CAPTURE (reportError -> Vercel logs) but no alerting: if swiftcard.me went down
// at 2am, nothing and nobody would say so.
//
// This needs nothing. No DSN, no token, no third-party account. It asks the live
// site a handful of questions the way a real visitor would, and the workflow that
// runs it opens a GitHub issue when an answer is wrong — which emails you.
//
// Deliberately checks BEHAVIOUR, not just status codes. A 200 that renders an
// empty card page is still an outage to the person holding the phone.
//
// It reads only. It never writes a card, never creates an account, never sends
// mail. The one POST is to /api/client-error, which is the reporting endpoint
// itself and is rate-limited and discarded — probing it is how we know the one
// piece of monitoring that IS live hasn't broken.
//
// PRIVACY / NOISE: page fetches here run no JavaScript, so CardEventTracker never
// fires and no real user's view counts or analytics are touched by this probe.
//
// Exit code is always 0: the workflow reads the JSON on stdout and decides. A
// non-zero exit here would fail the job before it could open the issue.

const BASE = process.env.HEALTH_BASE_URL || "https://swiftcard.me";
const DEMO = "demo-sales";
// Live customer cards to watch, comma-separated, set by the workflow. These are
// public URLs. Covers the thing demo data cannot: a REAL account's card, vCard
// and Swift Links still rendering after a deploy.
const REAL_CARDS = (process.env.HEALTH_REAL_CARDS || "").split(",").map((s) => s.trim()).filter(Boolean);

/** Transient blips are not outages. Every check gets three tries before it counts. */
async function attempt(fn, tries = 3) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fn();
      if (r.ok) return r;
      last = r;
    } catch (e) {
      last = { ok: false, detail: `threw: ${String(e.message).slice(0, 120)}` };
    }
    if (i < tries) await new Promise((r) => setTimeout(r, 4000 * i));
  }
  return last;
}

const get = async (path, init) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    return await fetch(BASE + path, { ...init, signal: ctrl.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
};

const CHECKS = [
  {
    name: "homepage renders",
    run: async () => {
      const res = await get("/");
      const body = await res.text();
      const ok = res.status === 200 && /SwiftCard/i.test(body);
      return { ok, detail: `status ${res.status}, ${body.length} bytes` };
    },
  },
  {
    name: "public card page renders",
    run: async () => {
      const res = await get(`/card/${DEMO}`);
      const body = await res.text();
      // The name must actually be in the HTML — a 200 with a blank card is an outage.
      const ok = res.status === 200 && /Alex Morgan/i.test(body) && /Save Contact/i.test(body);
      return { ok, detail: `status ${res.status}, name=${/Alex Morgan/i.test(body)}, saveBtn=${/Save Contact/i.test(body)}` };
    },
  },
  {
    name: "vCard download works (QR + Save Contact backbone)",
    run: async () => {
      const res = await get(`/api/card/${DEMO}/vcard`);
      const body = await res.text();
      const type = res.headers.get("content-type") || "";
      const ok = res.status === 200 && type.includes("vcard") && body.startsWith("BEGIN:VCARD") && /FN:/.test(body);
      return { ok, detail: `status ${res.status}, type=${type.split(";")[0]}, ${body.length} bytes` };
    },
  },
  {
    name: "card link-preview / signature image renders",
    run: async () => {
      // Powers link previews in iMessage/WhatsApp and the Swift Signature artwork.
      // It is generated, not static, so it fails independently of the card page.
      const res = await get(`/card/${DEMO}/opengraph-image`);
      const type = res.headers.get("content-type") || "";
      const buf = await res.arrayBuffer();
      const ok = res.status === 200 && type.startsWith("image/") && buf.byteLength > 5000;
      return { ok, detail: `status ${res.status}, ${type}, ${buf.byteLength} bytes` };
    },
  },
  {
    name: "Swift Links page renders",
    run: async () => {
      const res = await get(`/links/${DEMO}`);
      const ok = res.status === 200;
      return { ok, detail: `status ${res.status}` };
    },
  },
  {
    // For a week in 2026-09 not one notification reached a phone and nothing
    // anywhere said so: a push that fails is silent by nature. /api/health asks
    // Apple about a fake device token — BadDeviceToken back means the APNs key,
    // team id and connection are all good; a 403 means they are not.
    name: "push notifications can be delivered (APNs + FCM credentials valid, web push configured)",
    run: async () => {
      const res = await get("/api/health");
      let push = null;
      try { push = (await res.json()).push; } catch { /* reported below */ }
      if (!push) return { ok: false, detail: `no push block in /api/health (status ${res.status})` };
      // Android (FCM) too, once it is configured: a broken Firebase key fails
      // every Android phone exactly as silently as a broken APNs key fails
      // every iPhone. Not configured is fine — that is "no Android build yet".
      const fcmOk = push.fcm?.configured !== true || push.fcm?.ok === true;
      const ok = push.apns?.configured === true && push.apns?.ok === true && push.webPush === true && fcmOk;
      return {
        ok,
        detail: ok
          ? `apns ok (${push.apns.reason}), web push configured, fcm ${push.fcm?.configured ? "ok" : "not configured"}`
          : `apns configured=${push.apns?.configured} ok=${push.apns?.ok} reason=${push.apns?.reason}; webPush=${push.webPush}; fcm configured=${push.fcm?.configured} ok=${push.fcm?.ok} reason=${push.fcm?.reason}` +
            " — check APPLE_TEAM_ID / APPLE_PUSH_KEY_ID / APPLE_PUSH_PRIVATE_KEY, the VAPID keys and the Firebase service account in Vercel.",
      };
    },
  },
  {
    name: "pricing page renders",
    run: async () => {
      const res = await get("/pricing");
      const ok = res.status === 200;
      return { ok, detail: `status ${res.status}` };
    },
  },
  {
    // Apple's client secret is a JWT WE sign, and Apple caps its lifetime at 6
    // months (next expiry ≈ 2027-02-05). When it lapses, Supabase silently goes
    // back to "provider is not enabled" and every Apple user is locked out —
    // typically users with a private-relay address and no password, so they
    // cannot fall back to email either. Nothing else in the stack notices.
    // Regenerate with scripts/supabase-enable-apple.mjs.
    name: "Sign in with Apple still works (client secret not expired)",
    run: async () => {
      const url =
        "https://grxmovpmlgmjncnyiyrt.supabase.co/auth/v1/authorize" +
        "?provider=apple&redirect_to=" + encodeURIComponent("swiftcard://auth-callback");
      const res = await fetch(url, { redirect: "manual" });
      const location = res.headers.get("location") || "";
      const ok = res.status === 302 && location.startsWith("https://appleid.apple.com");
      if (ok) return { ok, detail: "302 → appleid.apple.com" };
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        detail:
          `status ${res.status}` +
          (/not enabled/i.test(body)
            ? " — provider disabled; the Apple client secret has most likely EXPIRED. " +
              "Re-run scripts/supabase-enable-apple.mjs."
            : ` ${body.slice(0, 120)}`),
      };
    },
  },
  {
    // Apple Wallet went live 2026-08-10 and the App Store submission copy now
    // promises it to reviewers and users. If the pass cert is revoked or the
    // APPLE_PASS_* env vars drift, the endpoint quietly reverts to 501 and the
    // "Add to Apple Wallet" button vanishes — turning the reviewer notes false
    // without any error anywhere. This keeps the claim honest.
    name: "Apple Wallet pass endpoint serves a signed pass",
    run: async () => {
      const res = await get("/api/wallet/pass?card=" + DEMO);
      const type = res.headers.get("content-type") || "";
      const ok = res.status === 200 && type.includes("vnd.apple.pkpass");
      return { ok, detail: `status ${res.status} type ${type.split(";")[0]}` };
    },
  },
  {
    name: "sign-in page reachable",
    run: async () => {
      const res = await get("/login");
      const ok = res.status === 200;
      return { ok, detail: `status ${res.status}` };
    },
  },
  {
    name: "create-a-card wizard reachable",
    run: async () => {
      // The whole funnel. A 500 here means nobody can sign up.
      const res = await get("/cards/new");
      const body = await res.text();
      const ok = res.status === 200 && /Full name|New card/i.test(body);
      return { ok, detail: `status ${res.status}, form=${/Full name|New card/i.test(body)}` };
    },
  },
  {
    name: "portal routes healthy and not leaking to anonymous visitors",
    run: async () => {
      // Two failure modes at once. A 5xx means the portal is DOWN for signed-in
      // users — which an anonymous probe can otherwise never see. And whatever a
      // logged-out request gets back must never contain someone's account data.
      const routes = ["/dashboard", "/contacts", "/share", "/settings", "/office/admin"];
      const bad = [];
      for (const r of routes) {
        const res = await get(r);
        if (res.status >= 500) { bad.push(`${r}:${res.status}`); continue; }
        const body = await res.text();
        // Signed-in-only markers. Their presence in a logged-out response is a leak.
        if (/Copy signature|Total leads|Mark read|swiftcard\.me\/links\//i.test(body)) bad.push(`${r}:LEAK`);
      }
      return { ok: bad.length === 0, detail: bad.length ? bad.join(", ") : `${routes.length} routes ok, no leaks` };
    },
  },
  {
    name: "error reporting endpoint accepting reports",
    run: async () => {
      // If this is broken we lose the one piece of monitoring that IS live.
      const res = await get("/api/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level: "info", context: "healthcheck.probe", message: "uptime probe" }),
      });
      const ok = res.status >= 200 && res.status < 300;
      return { ok, detail: `status ${res.status}` };
    },
  },
];

// Real customer accounts — demo data can pass while a live card is broken.
for (const slug of REAL_CARDS) {
  CHECKS.push({
    name: `live account /${slug}: card, vCard and Swift Links`,
    run: async () => {
      const parts = [];
      const card = await get(`/card/${slug}`);
      const cardBody = await card.text();
      // Structural, not name-matching: no customer's name is hardcoded here.
      const cardOk = card.status === 200 && /Save Contact/i.test(cardBody) && cardBody.length > 5000;
      parts.push(`card ${card.status}${cardOk ? "" : " BAD"}`);

      const v = await get(`/api/card/${slug}/vcard`);
      const vBody = await v.text();
      const vOk = v.status === 200 && vBody.startsWith("BEGIN:VCARD") && /FN:.+/.test(vBody);
      parts.push(`vcard ${v.status}${vOk ? "" : " BAD"}`);

      const l = await get(`/links/${slug}`);
      const lOk = l.status === 200;
      parts.push(`links ${l.status}${lOk ? "" : " BAD"}`);

      return { ok: cardOk && vOk && lOk, detail: parts.join(", ") };
    },
  });
}

// ── Speed budget ─────────────────────────────────────────────────────────────
// "Constantly moving as fast as it can" needs a number that fails, not a
// report somebody reads. Median of three full-response timings per route,
// measured from the GitHub runner (US east). Functions run in Vercel pdx1
// since 2026-09-24, beside the database (Supabase us-west-2): the runner pays
// one cross-country hop per request, where each page used to pay one per
// database query from iad1. The
// budgets are ~2x the healthy baseline so a slow deploy trips them and a
// single network blip does not; the three-try wrapper above absorbs the rest.
const SPEED_BUDGET_MS = { "/": 2500, "/card/demo-sales": 2500, "/links/demo-sales": 2500, "/login": 2500, "/pricing": 2500, "/api/health": 1500 };
async function medianMs(path) {
  const t = [];
  for (let i = 0; i < 3; i++) { const t0 = Date.now(); await (await get(path)).text(); t.push(Date.now() - t0); }
  return t.sort((a, b) => a - b)[1];
}
CHECKS.push({
  name: "speed budget (median of 3, full response)",
  run: async () => {
    const parts = [], slow = [];
    for (const [path, budget] of Object.entries(SPEED_BUDGET_MS)) {
      const ms = await medianMs(path);
      parts.push(`${path} ${ms}ms`);
      if (ms > budget) slow.push(`${path} ${ms}ms > ${budget}ms`);
    }
    return { ok: slow.length === 0, detail: slow.length ? `SLOW: ${slow.join("; ")}` : parts.join(", ") };
  },
});
CHECKS.push({
  name: "database answers quickly (/api/health dbMs)",
  run: async () => {
    const res = await get("/api/health");
    const j = await res.json().catch(() => ({}));
    const ok = res.status === 200 && j.ok === true && Number(j.dbMs) < 1200;
    return { ok, detail: `status ${res.status}, db=${j.db}, dbMs=${j.dbMs}` };
  },
});

const started = Date.now();
const results = [];
for (const c of CHECKS) {
  const t0 = Date.now();
  const r = await attempt(c.run);
  results.push({ name: c.name, ok: !!r?.ok, detail: r?.detail ?? "no response", ms: Date.now() - t0 });
}

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({
  base: BASE,
  healthy: failed.length === 0,
  checked: results.length,
  failedCount: failed.length,
  totalMs: Date.now() - started,
  results,
}, null, 2));
