import { adminEmailList } from "@/lib/admin";
import { notifyAdmin } from "@/lib/admin-notify";
import { sendPushToUser } from "@/lib/push";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { alertText } from "./real-view";

// ── Card Builder: "[Owner] is viewing their card. Call [phone]." ────────────
//
// Sent to every site admin (ADMIN_EMAILS) on the first real view of a preview
// and again on the first view from each new device. Three places at once
// (owner, 2026-11-11: "make the alert hard to miss"):
//
//   1. a push to every device the admin has notifications on: the phone, and
//      any computer whose browser they enabled them in. On a computer it stays
//      on screen until clicked (`sticky` → requireInteraction in sw.js).
//   2. a row in the admin's notification center (admin_notifications).
//   3. the banner across the admin, which polls for views this file marked
//      `alerted` (components: app/admin/ProspectAlertBanner).
//
// The tap opens the Call screen, not the dialer: the iOS and Android apps only
// follow swiftcard.me links from a notification (NativeAppBridge), and the
// service worker's rule is that every tap lands in the app. The Call screen is
// one big button.
//
// This is the ONLY notifier for preview views, and it never touches the
// card-view pipeline (lib/visit-notify.ts): that one tells a customer about
// their own card, and tests there pin that views never go to admins.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

export const callScreenPath = (previewId: string) => `/admin/card-builder/call/${previewId}`;

/** The accounts behind ADMIN_EMAILS. Empty when none has signed up yet. */
export async function adminUserIds(): Promise<string[]> {
  const emails = adminEmailList();
  if (!emails.length) return [];
  const { data } = await getAdminSupabase().from("profiles").select("id, email").in("email", emails);
  return [...new Set((data ?? []).map((p) => p.id as string))];
}

export async function alertAdminsOfView(v: {
  viewId: string;
  preview: { id: string; owner_name: string; office_name: string; phone: string };
}): Promise<void> {
  const { title, body } = alertText(v.preview);
  const path = callScreenPath(v.preview.id);

  // The notification center first: it is the record, and it must exist even
  // on a night when no device can be reached. Never throws (lib/admin-notify).
  await notifyAdmin({ kind: "prospects", severity: "urgent", title, body, href: path, dedupeKey: `prospect-view:${v.viewId}` });

  const ids = await adminUserIds();
  await Promise.all(ids.map((userId) =>
    sendPushToUser(userId, {
      title,
      body,
      url: `${APP_URL}${path}`,
      // One notification per preview on a lock screen: a second device's alert
      // replaces the first (and re-alerts) instead of stacking under it.
      tag: `prospect-${v.preview.id}`,
      category: "prospect_view",
      sticky: true,
    }).catch(() => {}),
  ));
}
