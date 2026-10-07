// The red number on the SwiftCard app icon (iOS).
//
// The server puts the unread count on every push (lib/push.ts); this keeps it
// TRUE afterwards: NotificationBell calls it with its own unread count, so
// reading the bell clears the icon. Calls the app-local AppBadge plugin
// (ios/App/App/AppBadge.swift, iOS 1.0.6+). Older builds and the web have no
// plugin, and this is a silent no-op there.

type AppBadgePlugin = { set: (opts: { count: number }) => Promise<unknown> };

let last: number | null = null;

export function setAppBadge(count: number): void {
  if (typeof window === "undefined") return;
  const plugin = (window as unknown as { Capacitor?: { Plugins?: { AppBadge?: AppBadgePlugin } } })
    .Capacitor?.Plugins?.AppBadge;
  if (!plugin) return;
  const n = Math.max(0, Math.min(99, Math.round(count)));
  if (n === last) return;
  last = n;
  void plugin.set({ count: n }).catch(() => { last = null; });
}
