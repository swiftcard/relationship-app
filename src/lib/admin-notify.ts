import { getAdminSupabase } from "@/lib/supabase-admin";

// ── Telling the site admin something important ──────────────────────────────
//
// The owner, 2026-10-28: "a notification center in our admin page … for
// really important things" — money, customers leaving, the agents. Shown only
// inside /admin (the bell and /admin/notifications); no email, no push.
//
// Every writer is a customer flow (a payment, a cancellation, a deleted
// account) or the agents' clock, so this NEVER throws and never slows one
// down: one insert, errors swallowed and logged. `dedupeKey` makes a retry —
// Stripe redelivering an event, a second tick seeing the same failure — a
// no-op instead of a second notification.

export type AdminNotificationKind = "money" | "leaving" | "agents";
export type AdminNotificationSeverity = "urgent" | "important";

export type AdminNotification = {
  kind: AdminNotificationKind;
  severity?: AdminNotificationSeverity;
  title: string;
  body?: string | null;
  /** Where in the admin it's explained, e.g. /admin/users/<id>. */
  href?: string | null;
  dedupeKey: string;
  meta?: Record<string, unknown>;
};

export const ADMIN_NOTIFICATION_KINDS: { key: AdminNotificationKind; label: string }[] = [
  { key: "money", label: "Money" },
  { key: "leaving", label: "Customers leaving" },
  { key: "agents", label: "Agents" },
];

/** One "is cancelling" per subscription per day, whichever writes it first:
 *  the cancel flow (which knows the reason in words) or the Stripe webhook
 *  (which also sees cancellations made in Stripe itself). */
export function cancelKey(subscriptionId: string, now = new Date()): string {
  return `cancel:${subscriptionId}:${now.toLocaleDateString("en-CA", { timeZone: "America/New_York" })}`;
}

/** Dollars for a notification line: "$4.99", "$49.90". */
export function dollars(cents: number | null | undefined): string {
  return `$${((cents ?? 0) / 100).toFixed(2)}`;
}

export async function notifyAdmin(n: AdminNotification): Promise<void> {
  try {
    const { error } = await getAdminSupabase()
      .from("admin_notifications")
      .upsert({
        kind: n.kind,
        severity: n.severity ?? "important",
        title: n.title.slice(0, 200),
        body: n.body ? n.body.slice(0, 1000) : null,
        href: n.href ?? null,
        dedupe_key: n.dedupeKey.slice(0, 300),
        meta: n.meta ?? {},
      }, { onConflict: "dedupe_key", ignoreDuplicates: true });
    if (error) console.error("[admin-notify]", n.dedupeKey, error.message);
  } catch (e) {
    console.error("[admin-notify]", n.dedupeKey, e instanceof Error ? e.message : e);
  }
}
