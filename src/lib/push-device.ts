// ── This device's push binding ───────────────────────────────────────────────
//
// A push endpoint (web push subscription URL, or "apns:<token>" for the iOS
// shell) identifies a DEVICE. The push_subscriptions row binds it to an
// ACCOUNT — and that binding used to outlive the account on the device: sign
// out, or sign into a different account, and the previous account's lead/view
// notifications kept landing on this device's lock screen. On a shared or
// multi-account device that is a straight cross-account leak.
//
// The rule: AN AUTH-USER CHANGE ON A DEVICE SEVERS THE DEVICE'S PUSH BINDING.
// The next account gets pushes only after IT opts in (EnablePushButton) — a
// binding is never silently transferred to an account that didn't ask for it.
//
// Everything here is best-effort and must never block sign-out or navigation.

import { detectNativeApp, detectNativePlatform } from "@/lib/platform";

/**
 * The namespace this device's native token is stored under.
 *
 * lib/push.ts routes on exactly these two prefixes and hands everything else
 * to web-push, which POSTs to the endpoint as a URL — so a token filed under
 * the wrong one is not an error anywhere, just a notification that never
 * arrives. iOS keeps "apns:" it has always had; Android must be "fcm:".
 *
 * Falls back to "apns:" only where the platform cannot be read at all, which
 * on a device that reached this code means iOS.
 */
export function nativePushPrefix(): "apns:" | "fcm:" {
  return detectNativePlatform() === "android" ? "fcm:" : "apns:";
}

const APNS_ENDPOINT_KEY = "swiftcard_apns_endpoint";
// Set when an unbind could not reach the server; retried on the next load.
const UNBIND_PENDING_KEY = "swiftcard_push_unbind_pending";
/** The account that enabled native push on this device (EnablePushButton writes it). */
export const PUSH_UID_KEY = "swiftcard_push_uid";
/**
 * WHO HAD PUSH ON HERE when they signed out (audit NS-05).
 *
 * Signing out severs the binding, rightly: a signed-out phone must stop
 * receiving that account's alerts. But it was severed for good. When the SAME
 * person signed back in, nothing reconnected it: no binding, no owner stamp, a
 * switch that read "off", and a reminder budget long spent. Production was
 * down to one registered device. This remembers only the account id, only
 * after a plain sign-out on a device that had push on, and only that account
 * gets it back (resumePushForSameAccount). Anyone else signing in clears it.
 */
const RESUME_UID_KEY = "swiftcard_push_resume_uid";

/** The account this device's native push binding belongs to, if any. */
export function pushBindingOwner(): string | null {
  try { return localStorage.getItem(PUSH_UID_KEY); } catch { return null; }
}

/** An earlier unbind never reached the server — try it again now. */
export async function retryPendingPushUnbind(): Promise<void> {
  try {
    if (localStorage.getItem(UNBIND_PENDING_KEY) !== "1") return;
  } catch { return; }
  await unbindDevicePush();
}

// navigator.serviceWorker.ready never REJECTS — with no active registration it
// simply never settles. Sign-out awaits this module, so an unresolved promise
// here would leave the user stuck on a dead "Sign out" button. Cap the wait.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

/** This browser's live web-push subscription, or null (no SW / not subscribed / timed out). */
async function webPushSubscription(): Promise<PushSubscription | null> {
  try {
    if (!("serviceWorker" in navigator)) return null;
    const reg = await withTimeout(navigator.serviceWorker.ready, 2000);
    if (!reg) return null;
    return (await reg.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/** The push endpoints this device currently holds (0, 1, or — web+native never coexist — practically at most 1). */
async function collectDeviceEndpoints(): Promise<string[]> {
  const endpoints: string[] = [];
  // Native APNs token, stashed by EnablePushButton when it registered.
  try {
    const apns = localStorage.getItem(APNS_ENDPOINT_KEY);
    if (apns) endpoints.push(apns);
  } catch { /* storage blocked */ }
  // Web push subscription, if this browser has one.
  if (!detectNativeApp()) {
    const sub = await webPushSubscription();
    if (sub?.endpoint) endpoints.push(sub.endpoint);
  }
  return endpoints;
}

/**
 * Sever this device's push binding: delete the server rows for every endpoint
 * the device holds, drop the browser-side subscription (so the Settings toggle
 * honestly shows "off"), and forget the stashed APNs endpoint.
 *
 * Call while a session still exists (sign-out: BEFORE supabase.auth.signOut();
 * account switch: the new session is fine — the DELETE authorizes by endpoint
 * possession, see /api/push/subscribe).
 */
export async function unbindDevicePush(opts: { rememberFor?: string | null } = {}): Promise<void> {
  try {
    const endpoints = await collectDeviceEndpoints();
    // A plain sign-out by the person who had push on here: remember them, so
    // their own next sign-in reconnects it. Nothing to remember without push.
    try {
      if (opts.rememberFor && endpoints.length) localStorage.setItem(RESUME_UID_KEY, opts.rememberFor);
    } catch { /* storage blocked: they turn it back on in Settings */ }
    // Did the SERVER actually let go? An HTTP error used to count as success:
    // the stashed APNs endpoint was forgotten below, the next account's
    // unbind had nothing left to delete, and the previous account's alerts
    // kept reaching this iPhone for good (isolation audit 2026-09-24).
    const results = await Promise.all(endpoints.map((endpoint) =>
      fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      }).then((r) => r.ok, () => false)
    ));
    const severed = results.every(Boolean);

    // Browser-side subscription: drop it so push state reads "off" for the
    // next account. Permission stays granted, so re-enabling is one tap.
    if (!detectNativeApp()) {
      try {
        const sub = await webPushSubscription();
        await sub?.unsubscribe();
      } catch { /* ignore */ }
    }

    // Forget the endpoint only once the server row is gone. Kept, the next
    // unbind (sign-in on this device, or the launch-time retry in
    // AccountIsolationGuard) deletes it then.
    if (severed) {
      try { localStorage.removeItem(APNS_ENDPOINT_KEY); } catch { /* ignore */ }
      try { localStorage.removeItem(UNBIND_PENDING_KEY); } catch { /* ignore */ }
    } else {
      try { localStorage.setItem(UNBIND_PENDING_KEY, "1"); } catch { /* ignore */ }
    }
    // The owner stamp too — the silent launch-time re-registration must not
    // rebind a token for an account whose binding was just severed.
    try { localStorage.removeItem(PUSH_UID_KEY); } catch { /* ignore */ }
  } catch {
    /* never block the caller */
  }
}

/** A push failure nobody would otherwise see, filed like the switch's own (EnablePushButton). */
function reportResumeFailure(message: string): void {
  try {
    fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: "push.resume", message, url: location.origin + location.pathname }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* reporting must never throw */ }
}

function vapidKey(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr.buffer;
}

/** A native token WITHOUT asking: only when the OS permission is already granted. */
async function nativeEndpointSilently(): Promise<string | null> {
  const { PushNotifications } = await import("@capacitor/push-notifications");
  const perm = await PushNotifications.checkPermissions();
  if (perm.receive !== "granted") return null;
  const handles: { remove: () => void }[] = [];
  try {
    // Listeners attached BEFORE register(): the plugin drops a "registration"
    // event that fires before anyone is listening (EnablePushButton has the
    // full story).
    let settle: ((r: { token?: string; error?: string }) => void) | null = null;
    const outcome = new Promise<{ token?: string; error?: string }>((resolve) => { settle = resolve; });
    handles.push(await PushNotifications.addListener("registration", (t) => settle?.({ token: t.value })));
    handles.push(await PushNotifications.addListener("registrationError", (e) =>
      settle?.({ error: String((e as { error?: unknown })?.error ?? "registration failed") })));
    await PushNotifications.register();
    const r = await Promise.race([
      outcome,
      new Promise<{ token?: string; error?: string }>((resolve) => setTimeout(() => resolve({ error: "timed out waiting for a token" }), 15_000)),
    ]);
    if (!r.token) throw new Error(r.error ?? "no token");
    return `${nativePushPrefix()}${r.token}`;
  } finally {
    for (const h of handles) { try { h.remove(); } catch { /* ignore */ } }
  }
}

/** This browser's push subscription WITHOUT asking: only when notifications are already allowed. */
async function webSubscriptionSilently(): Promise<{ endpoint: string; p256dh: string; auth: string } | null> {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key || typeof Notification === "undefined" || Notification.permission !== "granted") return null;
  if (!("serviceWorker" in navigator)) return null;
  const reg = await withTimeout(navigator.serviceWorker.ready, 4000);
  if (!reg) return null;
  const sub = (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey(key) }));
  const j = sub.toJSON();
  return j.endpoint && j.keys?.p256dh && j.keys?.auth ? { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth } : null;
}

/**
 * The person who signed out with push on has signed back in: reconnect it,
 * silently. Never prompts. If the phone or browser no longer allows
 * notifications, nothing happens and the switch reads "off" as it should.
 * Returns true when push was reconnected.
 */
export async function resumePushForSameAccount(uid: string): Promise<boolean> {
  let remembered: string | null = null;
  try { remembered = localStorage.getItem(RESUME_UID_KEY); } catch { return false; }
  if (!remembered) return false;
  // Used up either way: one reconnect, for that one account. Someone else
  // signing in here simply clears it.
  try { localStorage.removeItem(RESUME_UID_KEY); } catch { /* ignore */ }
  if (remembered !== uid) return false;
  try {
    const native = detectNativeApp();
    const body = native
      ? await nativeEndpointSilently().then((endpoint) => (endpoint ? { endpoint, p256dh: "apns", auth: "apns" } : null))
      : await webSubscriptionSilently();
    if (!body) return false;
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    });
    if (!res.ok) {
      reportResumeFailure(`resume subscribe returned ${res.status}`);
      return false;
    }
    if (native) {
      try {
        localStorage.setItem(APNS_ENDPOINT_KEY, body.endpoint);
        localStorage.setItem(PUSH_UID_KEY, uid);
      } catch { /* ignore */ }
    }
    return true;
  } catch (e) {
    reportResumeFailure(`resume threw: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}
