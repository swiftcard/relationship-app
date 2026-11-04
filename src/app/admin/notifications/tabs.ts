// ── The notification center's tabs ──────────────────────────────────────────
// Everything, then the three things the owner asked to hear about (2026-10-28):
// money, customers leaving, the agents; and since 2026-11-03 the Office demos
// people book from the pricing page. A plain module so the server page and the
// tests can read it.

export const NOTIFICATION_TABS = [
  { key: "all", label: "All" },
  { key: "money", label: "Money" },
  { key: "leaving", label: "Customers leaving" },
  { key: "agents", label: "Agents" },
  { key: "demos", label: "Demos" },
] as const;

/** The kinds "Mark all read" may be scoped to (api/admin/notifications/read). */
export const NOTIFICATION_KINDS: ReadonlySet<string> = new Set(NOTIFICATION_TABS.map((t) => t.key).filter((k) => k !== "all"));

export type NotificationTab = (typeof NOTIFICATION_TABS)[number]["key"];

export function resolveNotificationTab(v: string | undefined): NotificationTab {
  return (NOTIFICATION_TABS.find((t) => t.key === v)?.key ?? "all") as NotificationTab;
}

/** Where a Mark read sends you back to: this page only, never an outside address. */
export function notificationsBack(tab: NotificationTab, unreadOnly: boolean): string {
  const qs = new URLSearchParams({ ...(tab === "all" ? {} : { tab }), ...(unreadOnly ? { unread: "1" } : {}) }).toString();
  return qs ? `/admin/notifications?${qs}` : "/admin/notifications";
}

export function safeBack(v: unknown): string {
  return typeof v === "string" && /^\/admin\/notifications(\?[\w=&%-]*)?$/.test(v) ? v : "/admin/notifications";
}
