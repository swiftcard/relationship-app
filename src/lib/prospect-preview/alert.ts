import { adminEmailList } from "@/lib/admin";
import { notifyAdmin } from "@/lib/admin-notify";
import { sendPushToUser } from "@/lib/push";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { sendSms } from "@/lib/messaging";
import { openAlertText } from "./opener";
import { alertText } from "./real-view";
import type { ProspectPreview } from "./types";

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

/**
 * Whose devices hear about this preview: every admin, unless it is the
 * automated test's own throwaway preview, which names the one account to tell
 * so a deploy never rings the owner's phone (supabase/prospect-previews-qa.sql).
 */
export async function alertTargets(preview: { alert_user_id?: string | null }): Promise<string[]> {
  return preview.alert_user_id ? [preview.alert_user_id] : adminUserIds();
}

/**
 * 4. a TEXT to the owner's own phone (OWNER_ALERT_PHONE), on the first alert
 *    of a preview in a day (owner, 2026-11-16): name, company, the number to
 *    tap, the opener they got, three talking points and a first line for the
 *    call that doesn't give away that we saw them open it (opener.ts). Not
 *    for the automated test's preview, which must never reach a real phone.
 */
export async function alertAdminsOfView(v: {
  viewId: string;
  preview: Pick<ProspectPreview, "id" | "owner_name" | "office_name" | "phone"> & Partial<ProspectPreview>;
  /** No alert has rung for this preview in the last 24 hours: the text goes too. */
  firstToday?: boolean;
}): Promise<void> {
  const { title, body } = alertText(v.preview);
  const path = callScreenPath(v.preview.id);

  // The notification center first: it is the record, and it must exist even
  // on a night when no device can be reached. Never throws (lib/admin-notify).
  await notifyAdmin({ kind: "prospects", severity: "urgent", title, body, href: path, dedupeKey: `prospect-view:${v.viewId}` });

  const ids = await alertTargets(v.preview);
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

  const ownerPhone = process.env.OWNER_ALERT_PHONE;
  if (v.firstToday && ownerPhone && !v.preview.alert_user_id) {
    await sendSms(ownerPhone, openAlertText({ specifics: [], team_size: null, sources: {}, current_tool: null, hook_why: null, ...v.preview }, { sentText: await lastOpenerSent(v.preview.id) })).catch(() => {});
  }
}

/** The opener this prospect was actually sent (the Mac or a Send tap records it). */
async function lastOpenerSent(previewId: string): Promise<string | null> {
  const { data } = await getAdminSupabase().from("prospect_message_events").select("after").eq("preview_id", previewId).eq("kind", "sent").eq("message", "opener").order("at", { ascending: false }).limit(1);
  return (data?.[0]?.after as string | null | undefined) ?? null;
}
