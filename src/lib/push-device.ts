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
export async function unbindDevicePush(): Promise<void> {
  try {
    const endpoints = await collectDeviceEndpoints();
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
    try { localStorage.removeItem("swiftcard_push_uid"); } catch { /* ignore */ }
  } catch {
    /* never block the caller */
  }
}
