// The red number on the SwiftCard app icon (iOS).
//
// One number everywhere: the bell's unread count. Three things write it —
//   • every push carries it (lib/push.ts), so it is right the moment
//     something lands, app open or closed;
//   • reading on the WEBSITE re-sends it as a silent badge-only push
//     (lib/app-badge-sync → syncAppBadge);
//   • reading in the APP sets it here: NotificationBell calls this with its own
//     unread count, so reading the bell clears the icon.
//
// In the app, two ways to reach the icon:
//   1. AppBadge (ios/App/App/AppBadge.swift, iOS 1.0.6+) sets the exact number.
//   2. Every build: once nothing is unread, the push plugin's
//      removeAllDeliveredNotifications(), which also sets the icon to 0 and
//      takes SwiftCard's notifications off the lock screen — the way Mail does
//      once the mail is read. Before 1.0.6 this is the only thing that can
//      lower the number at all: pushes started carrying it (2026-10-06) before
//      any installed app could take it away again, and an icon stuck on "1"
//      over an empty bell was the owner's report (2026-10-07).
// The web has neither, and this is a silent no-op there.

import { detectNativeApp } from "@/lib/platform";

type AppBadgePlugin = { set: (opts: { count: number }) => Promise<unknown> };

let last: number | null = null;
let clearRetry: ReturnType<typeof setTimeout> | null = null;

export function setAppBadge(count: number): void {
  if (!detectNativeApp()) return;
  const n = Math.max(0, Math.min(99, Math.round(count)));
  if (n === last) return;
  last = n;
  const plugin = (window as unknown as { Capacitor?: { Plugins?: { AppBadge?: AppBadgePlugin } } })
    .Capacitor?.Plugins?.AppBadge;
  if (plugin) void plugin.set({ count: n }).catch(() => { last = null; });
  if (n === 0) clearDelivered(0);
}

// iOS refuses removeAllDeliveredNotifications until this launch has registered
// for push (NativeAppBridge does that at startup, a moment after the bell first
// renders) — so a refusal is retried a few times, and dropped the moment the
// count is no longer 0.
const CLEAR_RETRY_MS = [1500, 4000, 10000];

function clearDelivered(attempt: number): void {
  if (clearRetry) { clearTimeout(clearRetry); clearRetry = null; }
  void import("@capacitor/push-notifications")
    .then(({ PushNotifications }) => PushNotifications.removeAllDeliveredNotifications())
    .catch(() => {
      if (last !== 0 || attempt >= CLEAR_RETRY_MS.length) return;
      clearRetry = setTimeout(() => clearDelivered(attempt + 1), CLEAR_RETRY_MS[attempt]);
    });
}
