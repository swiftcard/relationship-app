"use client";

// One-tap push-notification opt-in, reusable anywhere (card-creation success
// step, settings). Registers the service worker, asks permission, and stores
// the subscription so the server can send contact alerts + view milestones.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { detectNativeApp, detectNativePlatform } from "@/lib/platform";
import { nativePushPrefix } from "@/lib/push-device";
import { notePushOn, stopAsk } from "@/lib/push-ask-client";

type State = "loading" | "unsupported" | "ios-install" | "native" | "denied" | "subscribed" | "idle" | "working" | "error";

// iOS (iPhone/iPad) only allows web push for a site that's been ADDED TO THE
// HOME SCREEN and opened from there (standalone). In a normal Safari tab the
// PushManager API doesn't even exist — so we detect this case and guide the
// user to install, instead of a dead-end "not supported".
//
// NATIVE (Capacitor iOS shell): web push doesn't exist inside WKWebView, and the
// "Add to Home Screen" guidance is impossible there (no Safari share button) —
// showing it inside a native app reads as broken (App Review 2.1). When the
// shell ships the PushNotifications plugin, native gets REAL APNs push (the
// toggle below registers the device token as an "apns:<token>" endpoint on
// iOS ("fcm:<token>" on Android) and
// lib/apns.ts delivers). A plugin-less shell build falls back to a quiet,
// honest not-available state with NO instructions. Web is byte-identical.
function nativePushAvailable(): boolean {
  try {
    const cap = (window as unknown as {
      Capacitor?: { isPluginAvailable?: (name: string) => boolean };
    }).Capacitor;
    return !!cap?.isPluginAvailable?.("PushNotifications");
  } catch {
    return false;
  }
}

const APNS_ENDPOINT_KEY = "swiftcard_apns_endpoint";
// Which account enabled push on this device — NativeAppBridge's silent
// launch-time token refresh only re-registers when the CURRENT session matches
// this, so a rotated APNs token gets rebound for the user who opted in and
// never for anyone else. Cleared by unbindDevicePush.
const PUSH_UID_KEY = "swiftcard_push_uid";

// The session uid, for stamping PUSH_UID_KEY. Local cookie decode, no network;
// null (skip the stamp) on any failure — the stamp is an optimization, not a
// gate on enabling push.
async function sessionUid(): Promise<string | null> {
  try {
    const { createBrowserClient } = await import("@supabase/ssr");
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

// Push failures are invisible by nature: nobody files a bug for a toggle that
// flicks back, and the user-facing copy has to stay vague. Ship the real reason
// to the server so the next one is diagnosable from a log instead of a build
// bisect. Best-effort — never let reporting a failure cause one.
function reportPushFailure(message: string) {
  try {
    fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        context: "push-enable",
        url: typeof location !== "undefined" ? location.pathname : "",
      }),
      keepalive: true,
    }).catch(() => { /* ignore */ });
  } catch { /* ignore */ }
}

// ── A switch that shows ON must BE on ────────────────────────────────────────
//
// "Subscribed" is decided on the device: the OS permission plus a token (or a
// browser subscription) we remember registering. The SERVER row is what
// actually receives pushes, and it can vanish without the device ever hearing
// about it — production lost every iPhone's row to an APNs environment mix-up
// (lib/apns.ts sendApnsDetailed) while each of those phones went on showing the
// switch green. So when the switch reads ON we re-present this device's
// endpoint to the server: an idempotent upsert on a unique endpoint, once per
// session, fire-and-forget. If the row is there nothing changes; if it is gone
// it comes back, and the person never has to discover they were unsubscribed.
const RECONFIRM_KEY = "swiftcard_push_reconfirmed";
function reconfirmSubscription(body: { endpoint: string; p256dh: string; auth: string }) {
  try {
    if (sessionStorage.getItem(RECONFIRM_KEY) === body.endpoint) return;
    sessionStorage.setItem(RECONFIRM_KEY, body.endpoint);
  } catch { /* no session storage — reconfirm anyway; the route is rate limited */ }
  fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
  }).then((r) => {
    if (!r.ok && r.status !== 401 && r.status !== 429) reportPushFailure(`reconfirm returned ${r.status}`);
  }).catch(() => { /* offline — next session retries */ });
}

function detectEnv() {
  if (typeof window === "undefined") return { supported: false, iosNeedsInstall: false, native: false };
  if (detectNativeApp()) return { supported: false, iosNeedsInstall: false, native: true };
  const ua = navigator.userAgent || "";
  const isIOS = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in document);
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  const hasApis =
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  return { supported: hasApis, iosNeedsInstall: isIOS && !standalone && !hasApis, native: false };
}

// Why the last enable failed, when the honest message is not "try again".
// "old-build": the binary itself can't register (no aps-environment
// entitlement) — the App Store 1.0.0 build shipped that way, and no amount of
// re-tapping fixes it; only an update does.
type FailReason = "old-build" | null;

/**
 * What the OS says right now, asked again. Native only: after a "Don't Allow"
 * the person can flip the switch in the Settings app and come back, and the
 * state computed on mount would still say "denied". Moves the state to "idle"
 * the moment the OS allows again; leaves it alone otherwise.
 */
type Recheck = () => Promise<"granted" | "denied" | "other">;

// ── ONE device state for every switch on the page ────────────────────────────
//
// Whether this device can receive pushes is a fact about the DEVICE, not about
// a component. Kept per instance, the reminder under a notification (which
// reads the state to choose its words) and the switch inside it (which changes
// the state when tapped) each had their own copy: a "Don't Allow" answered in
// the switch left the reminder still saying "tap the switch", and coming back
// from Settings allowed updated one and not the other. A module-level store,
// read through useSyncExternalStore, keeps every instance on one truth.
let deviceState: State = "loading";
const deviceListeners = new Set<() => void>();
function setDeviceState(next: State | ((s: State) => State)): void {
  const v = typeof next === "function" ? next(deviceState) : next;
  if (v === deviceState) return;
  deviceState = v;
  for (const l of [...deviceListeners]) l();
}
function subscribeDevice(l: () => void): () => void {
  deviceListeners.add(l);
  return () => { deviceListeners.delete(l); };
}
const getDeviceState = () => deviceState;
const getServerDeviceState = (): State => "loading";

export function usePushState(): [State, () => Promise<boolean>, FailReason, Recheck] {
  const state = useSyncExternalStore(subscribeDevice, getDeviceState, getServerDeviceState);
  const [reason, setReason] = useState<FailReason>(null);

  const recheck: Recheck = async () => {
    if (!detectNativeApp() || !nativePushAvailable()) return "other";
    try {
      const { PushNotifications } = await import("@capacitor/push-notifications");
      const perm = await PushNotifications.checkPermissions();
      if (perm.receive === "granted") {
        setDeviceState((s) => (s === "denied" ? "idle" : s));
        return "granted";
      }
      if (perm.receive === "denied") { setDeviceState("denied"); return "denied"; }
      return "other";
    } catch {
      return "other";
    }
  };

  useEffect(() => {
    const { supported, iosNeedsInstall, native } = detectEnv();
    if (native) {
      if (!nativePushAvailable()) {
        setDeviceState("native");
        return;
      }
      // Native APNs path: subscribed = OS permission granted AND we registered
      // a token from this device before.
      (async () => {
        try {
          const { PushNotifications } = await import("@capacitor/push-notifications");
          const perm = await PushNotifications.checkPermissions();
          if (perm.receive === "denied") { setDeviceState("denied"); return; }
          let stored: string | null = null;
          try { stored = localStorage.getItem(APNS_ENDPOINT_KEY); } catch { /* ignore */ }
          const on = perm.receive === "granted" && !!stored;
          setDeviceState(on ? "subscribed" : "idle");
          // Only for the account that enabled push on this device — never bind
          // a device to an account that did not ask (lib/push-device.ts).
          if (on && stored) {
            let owner: string | null = null;
            try { owner = localStorage.getItem(PUSH_UID_KEY); } catch { /* ignore */ }
            const uid = await sessionUid();
            if (uid && owner === uid) reconfirmSubscription({ endpoint: stored, p256dh: "apns", auth: "apns" });
          }
        } catch {
          setDeviceState("native");
        }
      })();
      return;
    }
    if (!supported) {
       
      setDeviceState(iosNeedsInstall ? "ios-install" : "unsupported");
      return;
    }
    if (Notification.permission === "denied") { setDeviceState("denied"); return; }
    if (Notification.permission === "granted") {
      navigator.serviceWorker.ready
        .then((reg) => reg.pushManager.getSubscription())
        .then((sub) => {
          setDeviceState(sub ? "subscribed" : "idle");
          // Sign-out and account switches unsubscribe the browser itself
          // (unbindDevicePush), so a live subscription here belongs to whoever
          // is signed in now.
          const j = sub?.toJSON();
          if (j?.endpoint && j.keys?.p256dh && j.keys?.auth) {
            reconfirmSubscription({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth });
          }
        })
        .catch(() => setDeviceState("idle"));
    } else {
      setDeviceState("idle");
    }
  }, []);

  async function enable(): Promise<boolean> {
    setDeviceState("working");
    setReason(null);

    // Native APNs path (Capacitor shell with the PushNotifications plugin).
    if (detectNativeApp() && nativePushAvailable()) {
      let handles: { remove: () => void }[] = [];
      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");
        // iOS shows its "Allow / Don't Allow" sheet ONCE PER INSTALL. After
        // that this resolves instantly with the remembered answer and no UI —
        // "granted" simply switches push on, "denied" can only be changed in
        // the Settings app (the denied state below links straight there).
        const perm = await PushNotifications.requestPermissions();
        if (perm.receive === "denied") { setDeviceState("denied"); return false; }
        // Anything else that is not "granted" means the sheet was put away
        // without an answer. iOS will ask again, so stay tappable — this used
        // to show the permanent "go to Settings" message for a swipe.
        if (perm.receive !== "granted") { setDeviceState("idle"); return false; }

        // Both listeners must be ATTACHED before register() is called, and the
        // attach is asynchronous (it crosses the JS↔native bridge). The plugin
        // fires "registration"/"registrationError" with retainUntilConsumed
        // FALSE — unlike "pushNotificationActionPerformed" — so an event that
        // arrives before the listener exists is dropped and never redelivered.
        // Awaiting the handles is the whole difference between a token and a
        // silent 15-second timeout.
        let settle: ((r: { token?: string; error?: string }) => void) | null = null;
        const outcome = new Promise<{ token?: string; error?: string }>((resolve) => { settle = resolve; });
        const done = (r: { token?: string; error?: string }) => { settle?.(r); settle = null; };

        handles.push(await PushNotifications.addListener("registration", (t) => done({ token: t.value })));
        handles.push(await PushNotifications.addListener("registrationError", (e) =>
          done({ error: String((e as { error?: unknown })?.error ?? "registration failed") })));

        // ANDROID ONLY, AND MANDATORY. Android 8+ drops any notification
        // naming a channel that does not exist — silently, with the send
        // reported as delivered. The id must stay byte-identical to
        // FCM_CHANNEL_ID in lib/fcm.ts, which is what the server puts on every
        // message; tests/android-push-routing.test.ts pins the pair.
        // importance 4 = IMPORTANCE_HIGH, which is what makes a banner appear
        // over the app instead of a silent row in the shade — the Android
        // equivalent of the iOS presentationOptions in capacitor.config.ts.
        if (detectNativePlatform() === "android") {
          try {
            await PushNotifications.createChannel({
              id: "swiftcard-alerts",
              name: "Card activity",
              description: "New leads, card views and team news",
              importance: 4,
              visibility: 1,
            });
          } catch { /* an existing channel is not an error */ }
        }
        await PushNotifications.register();

        const timeout = new Promise<{ token?: string; error?: string }>((resolve) =>
          setTimeout(() => resolve({ error: "timed out waiting for an APNs token" }), 15_000));
        const result = await Promise.race([outcome, timeout]);

        if (!result.token) {
          // The reason matters and used to be discarded. "no valid
          // aps-environment entitlement string found for application" is a
          // BUILD defect, not a connection problem, and it looked identical to
          // being offline for as long as this was swallowed.
          reportPushFailure(`native registration failed: ${result.error ?? "unknown"}`);
          if (/aps-environment/.test(result.error ?? "")) setReason("old-build");
          setDeviceState("error");
          return false;
        }

        const endpoint = `${nativePushPrefix()}${result.token}`;
        // The endpoint this device held before, if the token rotated (OS
        // upgrade, restore from backup). The server deletes it, so one phone
        // never keeps two live rows and buzzing twice for every event.
        let previous: string | null = null;
        try { previous = localStorage.getItem(APNS_ENDPOINT_KEY); } catch { /* ignore */ }
        // Same table/route as web push; p256dh/auth are web-crypto fields that
        // don't exist for APNs — namespaced placeholders satisfy the schema.
        const res = await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint, p256dh: "apns", auth: "apns", replaces: previous, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
        });
        if (!res.ok) {
          reportPushFailure(`subscribe returned ${res.status}`);
          setDeviceState("error");
          return false;
        }
        try {
          localStorage.setItem(APNS_ENDPOINT_KEY, endpoint);
          const uid = await sessionUid();
          if (uid) localStorage.setItem(PUSH_UID_KEY, uid);
        } catch { /* ignore */ }
        setDeviceState("subscribed");
        return true;
      } catch (e) {
        reportPushFailure(`native enable threw: ${e instanceof Error ? e.message : String(e)}`);
        setDeviceState("error");
        return false;
      } finally {
        // Every tap used to leave two more live listeners behind.
        for (const h of handles) { try { h.remove(); } catch { /* ignore */ } }
        handles = [];
      }
    }

    try {
      // PERMISSION FIRST — it must be the first awaited thing in this tap.
      // Safari (Mac, and the iPhone home-screen app) and Firefox only show the
      // prompt while the click's "user activation" is still live, and awaiting
      // the service worker first spent it: the prompt never appeared, the
      // promise resolved "default", and the page then claimed notifications
      // were BLOCKED. Chrome is lenient, which is why this looked fine on a
      // desktop and was broken on every Apple browser.
      const perm = await Notification.requestPermission();
      if (perm === "denied") { setDeviceState("denied"); return false; }
      // "default" = the prompt was dismissed (or never shown). Nothing is
      // blocked and the browser will ask again: stay tappable.
      if (perm !== "granted") {
        reportPushFailure(`web permission resolved "${perm}" without a grant`);
        setDeviceState("idle");
        return false;
      }

      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });

      const json = sub.toJSON();
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      // CHECKED, like the native path. Unchecked, a 401/429/500 left the switch
      // showing ON for a browser the server had never heard of.
      if (!res.ok) {
        reportPushFailure(`web subscribe returned ${res.status}`);
        try { await sub.unsubscribe(); } catch { /* ignore */ }
        setDeviceState("error");
        return false;
      }

      setDeviceState("subscribed");
      return true;
    } catch (e) {
      // Never fail silently — the button returning to "idle" with no message
      // reads as broken. Show a retryable error state instead, and say why
      // where we can read it (the native path always did; this one never had).
      reportPushFailure(`web enable threw: ${e instanceof Error ? e.message : String(e)}`);
      setDeviceState("error");
      return false;
    }
  }

  return [state, enable, reason, recheck];
}

// The on/off switch itself.
function Switch({ on, busy, onClick }: { on: boolean; busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Push notifications"
      disabled={busy}
      onClick={onClick}
      className="relative w-12 h-7 rounded-full transition-colors shrink-0 disabled:opacity-60"
      style={{ background: on ? "#059669" : "#4b5563" }}
    >
      <span className="absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all" style={{ left: on ? "22px" : "2px" }} />
    </button>
  );
}

export default function EnablePushButton({
  onDone,
  compact = false,
}: {
  onDone?: () => void;
  /**
   * Inside the iPhone app after a "Don't Allow": render only the Open iPhone
   * Settings button. The reminder under a notification (PushAskCallout)
   * carries its own words above it; the amber paragraph is for Settings.
   */
  compact?: boolean;
  /** @deprecated kept for call-site compatibility — always a toggle now. */
  label?: string;
  allowDisable?: boolean;
}) {
  const [state, enable, reason, recheck] = usePushState();
  const [busyOff, setBusyOff] = useState(false);
  const [forcedOff, setForcedOff] = useState(false);

  // A "Don't Allow" at the phone's own prompt used to end the reminders on
  // every device, for good. It no longer does (owner, 2026-09-23): iOS asks
  // once per install, so the person who swiped that sheet away in the middle
  // of building their card has one road back — the Settings app — and the
  // reminder under their next new contact now carries that button, within the
  // same two-reminders-per-side budget. What still ends the reminders for good:
  // "Don't ask again", and switching push OFF on purpose (turnedOffOnPurpose).

  // ── The way back from Settings ───────────────────────────────────────────
  // The state is computed once, on mount. Someone who taps "Open iPhone
  // Settings", flips Allow, and returns would otherwise still see "denied".
  // Ask the OS again whenever the app comes back to the foreground while
  // denied; and if they went to Settings FROM HERE and came back allowed, that
  // is the clearest yes there is — turn push on without another tap
  // (permission is already granted, so enable() shows no sheet).
  const wentToSettings = useRef(false);
  useEffect(() => {
    if (state !== "denied" || !detectNativeApp()) return;
    const onVisible = async () => {
      if (document.visibilityState !== "visible") return;
      // Read BEFORE the recheck: a "granted" moves the shared state to idle,
      // which unmounts this listener mid-flight — the decision must not
      // depend on anything that cleanup touches.
      const cameFromHere = wentToSettings.current;
      wentToSettings.current = false;
      const perm = await recheck();
      if (perm !== "granted" || !cameFromHere) return;
      await enableAndReport();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
    // enableAndReport/recheck are stable for the life of this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Switching push OFF is a decision, and the reminders under notifications
  // must honour it: they end here, on every device (/api/push/ask). Not called
  // for sign-out or an account switch — those unbind the device without
  // anybody saying "I don't want this" (lib/push-device.ts).
  const turnedOffOnPurpose = () => stopAsk();

  // Unsubscribe this device: browser subscription + our server record.
  async function disable() {
    setBusyOff(true);
    try {
      // Native APNs path: delete the server record (iOS has no client-side
      // "unregister"; removing the endpoint stops all sends to this device).
      if (detectNativeApp()) {
        let endpoint: string | null = null;
        try { endpoint = localStorage.getItem(APNS_ENDPOINT_KEY); } catch { /* ignore */ }
        if (endpoint) {
          await fetch("/api/push/subscribe", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint }),
          }).catch(() => {});
          try { localStorage.removeItem(APNS_ENDPOINT_KEY); } catch { /* ignore */ }
        }
        // Without this the launch-time silent re-register (NativeAppBridge)
        // saw permission granted + a matching uid and turned push back ON.
        try { localStorage.removeItem(PUSH_UID_KEY); } catch { /* ignore */ }
        setForcedOff(true);
        turnedOffOnPurpose();
        setBusyOff(false);
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        }).catch(() => {});
      }
      setForcedOff(true); // usePushState computed once on mount — reflect the change locally
      turnedOffOnPurpose();
    } catch { /* leave state as-is; user can retry */ }
    setBusyOff(false);
  }

  if (state === "loading") return null;

  // Native Capacitor shell: web push can't work in WKWebView and the install
  // guidance below is impossible there. A quiet, honest note — no dead-end
  // instructions, no broken toggle.
  if (state === "native") {
    return (
      <p className="text-gray-500 text-xs text-center">
        Push notifications aren&apos;t available in this version of the app — you&apos;ll still see new contacts and activity here and by email.
      </p>
    );
  }

  // iPhone/iPad in a Safari tab: guide them to install, don't dead-end.
  if (state === "ios-install") {
    return (
      <div className="w-full rounded-2xl border border-blue-800/40 bg-blue-950/30 px-4 py-3 text-left">
        <p className="text-blue-200 text-sm font-semibold">Turn on notifications on iPhone</p>
        {/* The APP first: on iPhone it is the one place push simply works
            (it asks once), and most people already have it. The home-screen
            route stays for anyone who would rather keep to the website. No
            App Store button here — every screen this state shows on already
            offers one (GetTheAppCard directly below it on both "Your card is
            live!" screens; the "Get the iPhone app" card in Settings). */}
        <p className="text-blue-300/80 text-xs mt-1.5 leading-relaxed">
          Notifications come through the <strong>SwiftCard app</strong> — open it and allow them. Staying on the website? Tap the <strong>Share</strong> button, choose <strong>Add to Home Screen</strong>, then open SwiftCard from your home screen and switch notifications on here.
        </p>
      </div>
    );
  }

  if (state === "unsupported") {
    return (
      <p className="text-gray-500 text-xs text-center">
        This browser doesn&apos;t support push notifications. Try Chrome on Android, or add SwiftCard to your home screen on iPhone.
      </p>
    );
  }

  if (state === "denied") {
    // iOS remembers a "Don't Allow" forever and the app cannot re-prompt, so
    // this message is the ONLY way back. Sending an iPhone owner to "browser
    // settings" — which is what this said, because the whole component was
    // written for the web first — is a dead end inside the app: there is no
    // browser UI to open. Name the real path instead.
    //
    // Safe to branch on detectNativeApp() at render: "denied" is only reachable
    // after usePushState's effect has run, so this never renders on the server
    // or on the hydrating first paint.
    if (detectNativeApp()) {
      // iOS asks once per install and never again, so after a "Don't Allow"
      // this is the ONLY road back — make it one tap. app-settings: is
      // UIApplication.openSettingsURLString; Capacitor hands a non-http scheme
      // to the system, which opens SwiftCard's own page in Settings. If a
      // shell build cannot follow it nothing happens, and the written path
      // still stands. Remembered, so coming back allowed turns push on.
      const openSettings = (
        <button
          type="button"
          onClick={() => {
            wentToSettings.current = true;
            try { window.location.href = "app-settings:"; } catch { /* ignore */ }
          }}
          className={`${compact ? "" : "mt-2 "}inline-flex items-center justify-center rounded-full bg-amber-500/15 border border-amber-500/30 px-4 py-2 text-xs font-semibold text-amber-300`}
        >
          Open iPhone Settings
        </button>
      );
      if (compact) return openSettings;
      return (
        <div className="text-center">
          <p className="text-amber-400 text-xs leading-relaxed">
            Notifications are turned off for SwiftCard. Open the iPhone{" "}
            <strong>Settings</strong> app → <strong>SwiftCard</strong> →{" "}
            <strong>Notifications</strong>, switch <strong>Allow Notifications</strong> on,
            then come back here.
          </p>
          {openSettings}
        </div>
      );
    }
    return (
      <p className="text-amber-400 text-xs text-center">
        Notifications are blocked for this site — enable them in your browser settings, then reload.
      </p>
    );
  }

  const isOn = state === "subscribed" && !forcedOff;
  const busy = state === "working" || busyOff;

  // Turn push on and tell everyone who cares. onDone FIRST: a reminder that
  // turned push on marks itself for its "You're set" before notePushOn()
  // retires every other ask on screen. Shared by the switch and by the
  // come-back-from-Settings path above.
  async function enableAndReport() {
    const ok = await enable();
    if (ok) { setForcedOff(false); onDone?.(); notePushOn(); }
  }

  async function toggle() {
    if (isOn) { await disable(); return; }
    await enableAndReport();
  }

  return (
    <div className="space-y-2">
      <div className="w-full flex items-center justify-between gap-3 bg-gray-800/50 border border-gray-700/60 rounded-2xl py-2.5 px-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-100">
            {isOn ? "Push notifications" : "Turn on Push notifications!"}
          </p>
          {(busy || isOn) && (
            <p className="text-[0.6875rem] text-gray-500">
              {busy ? "One moment…" : "On for this device"}
            </p>
          )}
        </div>
        <Switch on={isOn} busy={busy} onClick={toggle} />
      </div>
      {state === "error" && reason === "old-build" && (
        <p className="text-amber-400 text-xs text-center leading-relaxed">
          This version of SwiftCard can&apos;t receive notifications yet. Update the app from the App Store, then come back and tap the switch again.
        </p>
      )}
      {state === "error" && reason !== "old-build" && (
        <p className="text-amber-400 text-xs text-center">Couldn&apos;t turn notifications on — check your connection and tap the switch again.</p>
      )}
    </div>
  );
}

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const arr = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) arr[i] = rawData.charCodeAt(i);
  return arr.buffer;
}
