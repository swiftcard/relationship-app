import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { getAdminSupabase } from "@/lib/supabase-admin";
import NotificationsView, { type NotificationRow } from "./NotificationsView";
import { NOTIFICATION_TABS, resolveNotificationTab, type NotificationTab } from "./tabs";

export const metadata = { title: "Notifications — SwiftCard Admin" };
export const dynamic = "force-dynamic";

// The newest 200 in the view. A notification is a thing that happened; older
// ones stay in the table and are on the people's own pages anyway.
const SHOW = 200;

export default async function AdminNotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (!(await requireAdmin())) notFound();
  const sp = await searchParams;
  const tab = resolveNotificationTab(sp.tab);
  const unreadOnly = sp.unread === "1";

  const admin = getAdminSupabase();
  let q = admin.from("admin_notifications").select("id, created_at, kind, severity, title, body, href, meta, read_at")
    .order("created_at", { ascending: false }).limit(SHOW);
  if (tab !== "all") q = q.eq("kind", tab);
  if (unreadOnly) q = q.is("read_at", null);
  const [{ data: rows }, { data: unreadRows }] = await Promise.all([
    q,
    admin.from("admin_notifications").select("kind").is("read_at", null).limit(1000),
  ]);

  const unread = Object.fromEntries(NOTIFICATION_TABS.map((t) => [t.key, 0])) as Record<NotificationTab, number>;
  for (const r of unreadRows ?? []) {
    unread.all++;
    const k = r.kind as NotificationTab;
    if (k in unread) unread[k]++;
  }

  return <NotificationsView rows={(rows ?? []) as NotificationRow[]} tab={tab} unreadOnly={unreadOnly} unread={unread} />;
}
