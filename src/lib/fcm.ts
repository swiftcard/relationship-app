import crypto from "node:crypto";

// ── Android push, the exact mirror of lib/apns.ts ───────────────────────────
//
// Android devices in the Capacitor shell register with Firebase Cloud
// Messaging, not APNs, and their tokens are stored in the SAME
// `push_subscriptions` table namespaced `fcm:<token>` — the way iOS uses
// `apns:<token>`.
//
// WHY THE PREFIX IS LOAD-BEARING: lib/push.ts used to split subscriptions into
// "APNs" and "everything else", and "everything else" is handed to the
// web-push library, which POSTs to the endpoint AS A URL. An Android token
// landing in that branch is not a loud failure — it is a blocked endpoint,
// logged once and never delivered, so Android push would simply never work and
// nothing would turn red. push.ts now filters on both prefixes explicitly and
// tests/android-shell.test.ts fails if that regresses.
//
// Completely safe to ship unconfigured, exactly like APNs: with no FIREBASE_*
// environment set every send resolves `not_configured` and no notification is
// attempted. Nothing throws, nothing is pruned.

export const FCM_PREFIX = "fcm:";

/** Is this an Android (FCM) subscription rather than a browser or iOS one? */
export function isFcmEndpoint(endpoint: string | null | undefined): boolean {
  return typeof endpoint === "string" && endpoint.startsWith(FCM_PREFIX);
}

/**
 * The notification channel every SwiftCard alert is posted to.
 *
 * Android 8+ REQUIRES a channel: a message naming one that does not exist is
 * dropped by the system with no error to the sender. The client creates this
 * exact id at registration time (EnablePushButton), so the two must stay in
 * step — it is not a label, it is a key.
 */
export const FCM_CHANNEL_ID = "swiftcard-alerts";

export type FcmSendResult = "sent" | "not_configured" | "gone" | "error";
export type FcmPostDetail = { result: FcmSendResult; status: number; reason: string };

export type FcmAlertPayload = {
  title: string;
  body: string;
  url: string;
  tag?: string;
  silent?: boolean;
  /** Notification group. Android stacks by `tag`; `thread` maps onto it when
   *  set, so team news groups apart from personal alerts, as it does on iOS. */
  thread?: string;
};

/**
 * Vercel stores a multi-line secret with literal backslash-n in it, and a
 * pasted key often arrives wrapped in quotes. Both produce a key OpenSSL
 * rejects at sign time, which reads downstream as "push is broken" rather than
 * "the environment variable is malformed". Same normalisation lib/apns.ts does
 * for the Apple key, for the same reason.
 */
function normalizeServiceAccountKey(raw: string): string {
  return raw.trim().replace(/^"|"$/g, "").replace(/\\n/g, "\n");
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

type ServiceAccount = { projectId: string; clientEmail: string; privateKey: string };

function serviceAccount(): ServiceAccount | null {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey: normalizeServiceAccountKey(privateKey) };
}

/** Is Android push configured at all? Cheap, synchronous, no network. */
export function fcmConfigured(): boolean {
  return serviceAccount() !== null;
}

// Google mints an access token valid for an hour and rate-limits the minting
// endpoint, so the token is cached until shortly before it expires — the same
// shape apns.ts uses for its provider JWT, and for the same reason: one token
// per process, not one per notification.
let cachedToken: { token: string; expiresAt: number } | null = null;

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

/** Exported for tests only — lets a test start from a known cache state. */
export function resetFcmTokenCache(): void {
  cachedToken = null;
}

async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 300) return cachedToken.token;

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.clientEmail,
      scope: FCM_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const signature = b64url(crypto.sign("RSA-SHA256", Buffer.from(signingInput), sa.privateKey));
  const assertion = `${signingInput}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`token ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("token response had no access_token");
  cachedToken = { token: json.access_token, expiresAt: now + (json.expires_in ?? 3600) };
  return cachedToken.token;
}

/**
 * The exact JSON one alert becomes. Pure, and exported so its shape can be
 * asserted in a test rather than trusted.
 *
 * Two things here are easy to get wrong and silent when wrong:
 *
 *  • `url` lives in `data`, NOT in `notification`. Capacitor's
 *    pushNotificationActionPerformed hands the web layer `notification.data`,
 *    so a url anywhere else means tapping the notification opens the app on
 *    whatever page it was last on instead of the thing it is about.
 *  • Every value in `data` must be a STRING. FCM rejects the whole message
 *    with 400 INVALID_ARGUMENT if any value is a number, boolean or object,
 *    and the rejection names the request, not the field.
 *
 * SILENT is the running view counter (lib/push-policy.ts): it should update
 * the shade without lighting the screen. On Android that is PRIORITY_LOW plus
 * no sound, and a NORMAL delivery priority so the device is not woken.
 */
export function buildFcmMessage(payload: FcmAlertPayload, token: string): Record<string, unknown> {
  const silent = payload.silent === true;
  const group = payload.thread ?? payload.tag;
  return {
    message: {
      token,
      notification: { title: payload.title, body: payload.body },
      data: { url: payload.url },
      android: {
        priority: silent ? "NORMAL" : "HIGH",
        ...(group ? { collapse_key: group } : {}),
        notification: {
          channel_id: FCM_CHANNEL_ID,
          ...(group ? { tag: group } : {}),
          notification_priority: silent ? "PRIORITY_LOW" : "PRIORITY_DEFAULT",
          default_sound: !silent,
        },
      },
    },
  };
}

/**
 * Google's way of saying "this device is gone": the app was uninstalled, the
 * token was rotated, or the registration was revoked. Everything else is a
 * fault worth reporting rather than a row worth deleting — the distinction
 * matters because the "gone" branch DELETES the subscription.
 */
function isGone(status: number, bodyText: string): boolean {
  if (status === 404) return true;
  if (status === 400 && /registration.token|invalid.argument/i.test(bodyText)) {
    // 400 INVALID_ARGUMENT is returned both for a malformed message and for a
    // malformed token. Only treat it as "gone" when the error actually names
    // the token, so our own bad payload can never quietly delete real devices.
    return /registration.token|not a valid fcm registration token/i.test(bodyText);
  }
  return /UNREGISTERED|NOT_FOUND/i.test(bodyText);
}

type FcmPost = (
  url: string,
  init: { headers: Record<string, string>; body: string },
) => Promise<{ status: number; text: string }>;

const fcmPostTo: FcmPost = async (url, init) => {
  const res = await fetch(url, { method: "POST", headers: init.headers, body: init.body });
  return { status: res.status, text: await res.text() };
};

/**
 * Send one alert to one Android device. Never throws: every failure comes back
 * as a result the caller can act on, because the caller is a notification fan
 * out and one bad row must not take the rest of them down.
 */
export async function sendFcmDetailed(
  endpoint: string,
  payload: FcmAlertPayload,
  post: FcmPost = fcmPostTo,
): Promise<FcmPostDetail> {
  const sa = serviceAccount();
  if (!sa) return { result: "not_configured", status: 0, reason: "not_configured" };

  const token = endpoint.slice(FCM_PREFIX.length);
  if (!token) return { result: "error", status: 0, reason: "empty token" };

  let bearer: string;
  try {
    bearer = await accessToken(sa);
  } catch (e) {
    // A bad service-account key fails here, before any device is contacted.
    return { result: "error", status: 0, reason: e instanceof Error ? e.message : String(e) };
  }

  try {
    const { status, text } = await post(
      `https://fcm.googleapis.com/v1/projects/${sa.projectId}/messages:send`,
      {
        headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildFcmMessage(payload, token)),
      },
    );
    if (status >= 200 && status < 300) return { result: "sent", status, reason: "" };
    if (isGone(status, text)) return { result: "gone", status, reason: "unregistered" };
    // An expired cached token shows up as a one-off 401; drop it so the next
    // send mints a fresh one rather than repeating the same failure forever.
    if (status === 401) cachedToken = null;
    return { result: "error", status, reason: text.slice(0, 200) };
  } catch (e) {
    return { result: "error", status: 0, reason: e instanceof Error ? e.message : String(e) };
  }
}

export type FcmHealth = { configured: boolean; ok: boolean; reason: string };

/**
 * Are the Android push credentials actually good?
 *
 * Same problem APNs has: a wrong or revoked service-account key is silent —
 * every send fails, no Android phone buzzes, and nothing turns red. So ask
 * Google. Minting an access token proves the key, the client email and the
 * project all line up; it is the step that fails when any of them is wrong,
 * and it costs one request with no notification sent to anyone.
 */
export async function checkFcmCredentials(): Promise<FcmHealth> {
  const sa = serviceAccount();
  if (!sa) return { configured: false, ok: false, reason: "not_configured" };
  try {
    await accessToken(sa);
    return { configured: true, ok: true, reason: "" };
  } catch (e) {
    return { configured: true, ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
