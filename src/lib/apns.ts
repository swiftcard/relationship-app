import crypto from "node:crypto";
import http2 from "node:http2";
import { normalizeApplePrivateKey } from "@/lib/apple-key";

// ── APNs sender for the native iOS app ───────────────────────────────────────
//
// Web push (VAPID) can't reach the Capacitor shell — WKWebView has no
// PushManager. Native devices register through @capacitor/push-notifications
// and store their APNs device token in the same push_subscriptions table as
// web subscriptions, namespaced as endpoint = "apns:<deviceToken>".
// lib/push.ts routes those rows here; web rows keep going through web-push.
//
// Completely safe to ship unconfigured: without the APPLE_PUSH_* env vars every
// call is a silent no-op ("not_configured").
//
// Env vars (owner action, documented in SHELL-RUNBOOK — created in the Apple
// Developer portal as an "Apple Push Notifications service (APNs)" key):
//   APPLE_TEAM_ID           – 10-char Team ID (shared with Wallet / Sign in)
//   APPLE_PUSH_KEY_ID       – Key ID of the APNs auth key (.p8)
//   APPLE_PUSH_PRIVATE_KEY  – the .p8 private key (PEM text)
//   APPLE_PUSH_TOPIC        – optional; defaults to the app bundle id
//   APPLE_PUSH_SANDBOX      – "1" for Xcode dev builds (sandbox APNs);
//                             unset/0 for TestFlight + App Store (production)

const APNS_TOPIC_DEFAULT = "me.swiftcard.app";

export const APNS_PREFIX = "apns:";

export function isApnsEndpoint(endpoint: string | null | undefined): boolean {
  return typeof endpoint === "string" && endpoint.startsWith(APNS_PREFIX);
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Module-scope JWT cache. Apple accepts a provider token for up to an hour but
// REJECTS tokens minted more often than roughly once per 20 minutes for the
// same key (TooManyProviderTokenUpdates, 403).
//
// The header above claimed a "per send batch" build; there was no batching —
// buildApnsJwt was called inside the per-MESSAGE send function, so every single
// notification minted a fresh token. That is fine at one push an hour and
// starts silently 403ing the moment volume rises.
//
// Refreshed at 50 minutes: comfortably inside Apple's 1h expiry, comfortably
// outside their ~20m mint floor.
const JWT_TTL_MS = 50 * 60 * 1000;
let cachedJwt: { token: string; mintedAt: number; key: string } | null = null;

function getApnsJwt(teamId: string, keyId: string, privateKey: string): string {
  // Keyed on the credentials too, so rotating them can't serve a stale token.
  const key = `${teamId}:${keyId}`;
  if (cachedJwt && cachedJwt.key === key && Date.now() - cachedJwt.mintedAt < JWT_TTL_MS) {
    return cachedJwt.token;
  }
  const token = buildApnsJwt(teamId, keyId, privateKey);
  cachedJwt = { token, mintedAt: Date.now(), key };
  return token;
}

// Provider-token JWT (ES256). Minted through getApnsJwt above — never call this
// directly from a send path, or you reintroduce the per-message minting.
function buildApnsJwt(teamId: string, keyId: string, privateKey: string): string {
  const header = { alg: "ES256", kid: keyId };
  const payload = { iss: teamId, iat: Math.floor(Date.now() / 1000) };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = crypto.sign("sha256", Buffer.from(signingInput), {
    key: normalizeApplePrivateKey(privateKey),
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${base64url(signature)}`;
}

export type ApnsSendResult = "sent" | "not_configured" | "gone" | "error";

/**
 * One HTTP/2 POST to APNs. The transport only — topic, headers and body are
 * the caller's business.
 *
 * Shared because there are two completely different kinds of push here: an
 * ALERT to the iOS app (topic = bundle id, visible payload) and a silent
 * WALLET push (topic = pass type id, empty payload) that tells iOS to
 * re-download a pass. They differ in every field and in nothing else, and the
 * connection handling — timeouts, reading the reason out of the body,
 * distinguishing a dead token from a misconfiguration — is the part that must
 * not be written twice.
 */
export type ApnsEnv = "production" | "sandbox";
const APNS_HOSTS: Record<ApnsEnv, string> = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
};

/** The environment this deployment talks to first (APPLE_PUSH_SANDBOX=1 → sandbox). */
export function configuredApnsEnv(): ApnsEnv {
  return process.env.APPLE_PUSH_SANDBOX === "1" ? "sandbox" : "production";
}

/** What one POST came back with. `reason` is Apple's own word for a failure. */
export type ApnsPostDetail = { result: ApnsSendResult; status: number; reason: string };

async function apnsPost(
  deviceToken: string,
  headers: Record<string, string>,
  body: string,
): Promise<ApnsSendResult> {
  return (await apnsPostTo(configuredApnsEnv(), deviceToken, headers, body)).result;
}

async function apnsPostTo(
  env: ApnsEnv,
  deviceToken: string,
  headers: Record<string, string>,
  body: string,
): Promise<ApnsPostDetail> {
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_PUSH_KEY_ID;
  const privateKey = process.env.APPLE_PUSH_PRIVATE_KEY;
  if (!teamId || !keyId || !privateKey) return { result: "not_configured", status: 0, reason: "not_configured" };
  if (!deviceToken) return { result: "error", status: 0, reason: "no_token" };

  const host = APNS_HOSTS[env];

  let jwt: string;
  try {
    jwt = getApnsJwt(teamId, keyId, privateKey);
  } catch {
    // malformed key — treat as unconfigured rather than throw
    return { result: "error", status: 0, reason: "bad_signing_key" };
  }

  return new Promise<ApnsPostDetail>((resolve) => {
    let settled = false;
    let status = 0;
    let reason = "";
    const done = (r: ApnsSendResult, why?: string) => {
      if (!settled) { settled = true; resolve({ result: r, status, reason: why ?? reason }); }
    };

    const client = http2.connect(host);
    client.on("error", () => { done("error", "connection_error"); try { client.close(); } catch { /* ignore */ } });

    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      "authorization": `bearer ${jwt}`,
      "content-type": "application/json",
      ...headers,
    });

    // Never hang a request path on APNs — pushes are best-effort.
    req.setTimeout(10_000, () => { done("error", "timeout"); try { req.close(); client.close(); } catch { /* ignore */ } });

    // APNs puts the actual cause in the RESPONSE BODY as { "reason": "..." },
    // and we never read it — so every 400 was treated as "this device token is
    // dead" and the caller permanently DELETED the push subscription. A 400 is
    // mostly config: BadTopic (wrong apns-topic), DeviceTokenNotForTopic (the
    // classic sandbox/production mismatch), BadExpirationDate, and so on. Any
    // one of those would unregister every device in the database on its first
    // run, with no signal.
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => { if (raw.length < 2048) raw += chunk; });

    req.on("response", (h) => { status = Number(h[":status"] ?? 0); });
    req.on("close", () => {
      try { client.close(); } catch { /* ignore */ }
      if (status === 200) return done("sent");

      try { reason = String((JSON.parse(raw) as { reason?: string }).reason ?? ""); } catch { /* body may be empty */ }

      // ONLY these two mean the token itself is finished. 410 is always
      // Unregistered; a 400 has to say so explicitly.
      //
      // BadDeviceToken is "gone" FOR THIS ENVIRONMENT ONLY. Apple returns the
      // same reason for a perfectly good token sent to the wrong host — a
      // sandbox token (any build installed from Xcode) at api.push.apple.com,
      // or the reverse. sendApnsNotification therefore asks the OTHER host
      // before anyone deletes anything; see the note there.
      if (reason === "Unregistered" || reason === "BadDeviceToken") return done("gone");
      if (status === 410 && !reason) return done("gone", "Unregistered");

      // Everything else is our problem, not the device's — log the reason so a
      // misconfigured topic or environment is visible instead of silently
      // eating the install base.
      if (status >= 400) {
        console.error(`[apns] send failed: status=${status} reason=${reason || "(none)"} topic=${headers["apns-topic"]}`);
      }
      done("error");
    });
    req.on("error", () => { done("error", "request_error"); try { client.close(); } catch { /* ignore */ } });

    req.end(body);
  });
}

/**
 * Tell a device its Wallet pass changed.
 *
 * Empty payload and topic = the PASS TYPE IDENTIFIER, not the app's bundle id.
 * That combination is the entire protocol: iOS receives it, calls back to the
 * pass's webServiceURL asking which serials changed, and re-downloads them.
 * There is no user-visible notification and no app involvement — a pass in a
 * wallet belonging to someone who has never installed the app still updates.
 */
export async function sendWalletPassPush(pushToken: string): Promise<ApnsSendResult> {
  const topic = process.env.APPLE_PASS_TYPE_ID;
  if (!topic) return "not_configured";
  return apnsPost(pushToken, { "apns-topic": topic, "apns-push-type": "background", "apns-priority": "5" }, "{}");
}

/**
 * Send one alert push to one APNs device token over HTTP/2.
 * Returns "gone" when Apple reports the token unregistered (caller should
 * delete the subscription row) — mirrors web-push's 404/410 handling.
 */
export type ApnsAlertPayload = {
  title: string;
  body: string;
  url: string;
  tag?: string;
  silent?: boolean;
  /** WHICH CARD this is about ("Work card") — iOS renders it as its own line
   *  between the title and the body. Only set for accounts with 2+ cards —
   *  or "Team · <office>" on an Office admin's team news. */
  subtitle?: string;
  /** Notification group (thread-id); the tag when unset. Team news shares one
   *  thread per office, so it stacks apart from the personal notifications. */
  thread?: string;
  /** The app icon's red number: the person's unread notifications (0 clears it). */
  badge?: number;
};

/**
 * The exact bytes and headers one alert becomes. Pure, and exported so the
 * shape can be asserted in a test instead of trusted — the whole install base
 * is behind it and a payload Apple rejects looks, from here, like silence.
 *
 * SILENT = a notification that updates one already on the screen without
 * interrupting anyone (the running view count, lib/push-policy.ts):
 *
 *   no `sound`                    — nothing to hear.
 *   interruption-level "passive"  — iOS 15+: adds it to the list WITHOUT
 *                                   lighting the screen. A plain aps key, not
 *                                   an entitlement: "time-sensitive" and
 *                                   "critical" need Apple's permission,
 *                                   "passive" and "active" never have.
 *   apns-priority 5               — the documented pairing for a push that does
 *                                   not need to wake the device.
 *
 * Older iOS ignores an aps key it does not know, so a passive push there is
 * simply a soundless one. Never a `content-available` background push: the
 * system throttles those for hours, which is the one thing a live counter
 * cannot survive. And an ordinary alert is byte-for-byte what it always was —
 * the silent branch adds a shape, it does not change the existing one.
 */
export function buildApnsAlert(payload: ApnsAlertPayload, topic: string): {
  headers: Record<string, string>;
  body: string;
} {
  const silent = payload.silent === true;

  const body = JSON.stringify({
    aps: {
      alert: { title: payload.title, ...(payload.subtitle ? { subtitle: payload.subtitle } : {}), body: payload.body },
      ...(silent ? { "interruption-level": "passive" } : { sound: "default" }),
      "thread-id": payload.thread ?? payload.tag ?? "swiftcard",
      ...(typeof payload.badge === "number" ? { badge: clampBadge(payload.badge) } : {}),
    },
    // Custom key: the in-app destination. NativeAppBridge navigates here when
    // the user taps the notification.
    url: payload.url,
  });

  // apns-collapse-id is what makes "one notification per visitor per visit"
  // TRUE ON THE LOCK SCREEN: iOS replaces a delivered notification carrying an
  // id it has already shown, instead of stacking a second one. Without it the
  // upgrade from "viewed your card" to "saved your contact card" arrives as a
  // second banner — which is the duplicate we are removing (lib/visit-notify).
  // Apple caps the header at 64 bytes; tags are short by construction, but
  // truncate rather than let APNs reject the whole send.
  const collapseId = (payload.tag ?? "").slice(0, 64);

  return {
    headers: {
      "apns-topic": topic,
      "apns-push-type": "alert",
      "apns-priority": silent ? "5" : "10",
      ...(collapseId ? { "apns-collapse-id": collapseId } : {}),
    },
    body,
  };
}

/** The icon's red number as Apple gets it: a whole number, 0…99. */
function clampBadge(n: number): number {
  return Math.max(0, Math.min(99, Math.round(n)));
}

/**
 * A push that does NOTHING but set the app icon's red number (lib/push.ts
 * syncAppBadge). No alert, no sound: iOS applies `aps.badge` itself and shows
 * nothing — no banner, no lock-screen entry, no Notification Center row — and
 * the app's code never runs, which is why it works on every build ever shipped,
 * not only the ones carrying AppBadge.swift.
 *
 * Still push type "alert": Apple's word for anything that alerts, sounds OR
 * BADGES ("background" is the content-available kind, which must carry none of
 * the three and is throttled for hours). Priority 10 is allowed because it
 * badges, and wanted: the number should be right by the time the person is
 * back on the home screen, not whenever the phone next feels like it.
 */
export function buildApnsBadge(count: number, topic: string): {
  headers: Record<string, string>;
  body: string;
} {
  return {
    headers: {
      "apns-topic": topic,
      "apns-push-type": "alert",
      "apns-priority": "10",
    },
    body: JSON.stringify({ aps: { badge: clampBadge(count) } }),
  };
}

// Which Apple environment each token turned out to live in. Warm-lambda memory
// only: it saves the wasted first request on the next send, and losing it costs
// exactly one extra request.
const tokenEnv = new Map<string, ApnsEnv>();

/**
 * THE ORDER TO TRY THE TWO APPLE ENVIRONMENTS IN, and what the answers mean.
 *
 * A device token belongs to ONE environment, fixed by how the build was signed:
 * App Store and TestFlight builds get production tokens, anything installed
 * from Xcode gets sandbox tokens (App.entitlements vs AppRelease.entitlements).
 * Sent to the wrong host, a perfectly good token comes back 400 BadDeviceToken —
 * the same words Apple uses for a token that really is dead.
 *
 * We used to believe it. Production, 2026-09-10 → 09-17: an account went from
 * two registered phones to one to none, losing one on every single send, each
 * logged as "sent"; the owner's own phone registered on the 12th and was gone
 * after its first push. From the app's side that is a switch which looks ON, a
 * permission prompt iOS will never show again (it asks once per install), and
 * no notification, ever.
 *
 * So BadDeviceToken from one host is a question for the other host, and a phone
 * is only "gone" when BOTH reject it — or when Apple says Unregistered, which is
 * unambiguous (the app was deleted).
 */
export async function sendApnsDetailed(
  endpoint: string,
  payload: ApnsAlertPayload,
  post: typeof apnsPostTo = apnsPostTo,
): Promise<ApnsPostDetail & { env: ApnsEnv }> {
  const topic = process.env.APPLE_PUSH_TOPIC || APNS_TOPIC_DEFAULT;
  return deliverToToken(endpoint, buildApnsAlert(payload, topic), post);
}

/** Set the icon's red number on one phone — see buildApnsBadge. Same two-host
 *  rule and same answers as an alert, so the caller prunes "gone" the same way. */
export async function sendApnsBadge(
  endpoint: string,
  count: number,
  post: typeof apnsPostTo = apnsPostTo,
): Promise<ApnsPostDetail & { env: ApnsEnv }> {
  const topic = process.env.APPLE_PUSH_TOPIC || APNS_TOPIC_DEFAULT;
  return deliverToToken(endpoint, buildApnsBadge(count, topic), post);
}

async function deliverToToken(
  endpoint: string,
  { headers, body }: { headers: Record<string, string>; body: string },
  post: typeof apnsPostTo,
): Promise<ApnsPostDetail & { env: ApnsEnv }> {
  const deviceToken = endpoint.slice(APNS_PREFIX.length);

  const first: ApnsEnv = tokenEnv.get(deviceToken) ?? configuredApnsEnv();
  const other: ApnsEnv = first === "production" ? "sandbox" : "production";

  const a = await post(first, deviceToken, headers, body);
  if (a.result === "sent") { tokenEnv.set(deviceToken, first); return { ...a, env: first }; }
  if (a.reason !== "BadDeviceToken") return { ...a, env: first };

  const b = await post(other, deviceToken, headers, body);
  if (b.result === "sent") { tokenEnv.set(deviceToken, other); return { ...b, env: other }; }
  tokenEnv.delete(deviceToken);
  // Dead only if the second host ALSO disowns it. Anything else from the second
  // host (a timeout, a 403, a 5xx) proves nothing about the token: keep the row.
  if (b.result === "gone") return { ...b, env: other };
  return { result: "error", status: b.status, reason: `BadDeviceToken@${first}; ${b.reason || "error"}@${other}`, env: other };
}

export async function sendApnsNotification(
  endpoint: string,
  payload: ApnsAlertPayload,
): Promise<ApnsSendResult> {
  return (await sendApnsDetailed(endpoint, payload)).result;
}

// ── Are the push credentials actually good? ─────────────────────────────────
//
// An unconfigured or expired APNs key is silent by nature: every send fails,
// nobody's phone buzzes, and nothing anywhere turns red. So ask Apple. A push
// to a deliberately fake device token is answered 400 BadDeviceToken ONLY IF
// the provider token was accepted first — a revoked key, a wrong team id or a
// wrong key id all come back 403 (InvalidProviderToken / ExpiredProviderToken)
// before Apple ever looks at the device. Nothing is delivered to anyone.
// Cached for ten minutes so the 15-minute uptime probe cannot add up to load.
export type ApnsHealth = { configured: boolean; ok: boolean; reason: string };
let apnsHealthCache: { at: number; value: ApnsHealth } | null = null;
const APNS_HEALTH_TTL_MS = 10 * 60 * 1000;

export async function checkApnsCredentials(post: typeof apnsPostTo = apnsPostTo): Promise<ApnsHealth> {
  if (apnsHealthCache && Date.now() - apnsHealthCache.at < APNS_HEALTH_TTL_MS) return apnsHealthCache.value;
  const topic = process.env.APPLE_PUSH_TOPIC || APNS_TOPIC_DEFAULT;
  const { headers, body } = buildApnsAlert({ title: "health", body: "health", url: "/" }, topic);
  const r = await post(configuredApnsEnv(), "0".repeat(64), headers, body);
  const value: ApnsHealth =
    r.result === "not_configured" ? { configured: false, ok: false, reason: "not_configured" }
    // "gone" here IS the success case: Apple authenticated us and then, as
    // expected, did not recognise a token made of zeros.
    : r.result === "gone" ? { configured: true, ok: true, reason: r.reason }
    : { configured: true, ok: false, reason: r.reason || `status ${r.status}` };
  apnsHealthCache = { at: Date.now(), value };
  return value;
}
