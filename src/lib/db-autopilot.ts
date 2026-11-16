import { getAdminSupabase } from "@/lib/supabase-admin";
import { notifyAdmin } from "@/lib/admin-notify";
import { sendPushToUser } from "@/lib/push";
import { adminUserIds } from "@/lib/prospect-preview/alert";

// ── Database size autopilot (owner, 2026-11-16) ─────────────────────────────
// Supabase's free plan stops at 500 MB. Nightly (/api/db-autopilot):
//   1. rollup_view_events(): website page views older than 90 days become one
//      row per day and page in view_daily_summaries, and the raw rows go;
//      product events get the same daily rows before the existing 90-day
//      prune removes them. card_views is NOT touched: customers' lifetime
//      view counts and milestones are counted from it.
//   2. The database's size. Past ALERT_BYTES, one notification in the admin
//      bell and one push to each admin, at most once a week while it stays
//      there.
// Schema: supabase/card-builder-autopilot.sql.

export const LIMIT_BYTES = 500 * 1024 * 1024;
export const ALERT_BYTES = 400 * 1024 * 1024;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

export const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);

export async function databaseSize(): Promise<number | null> {
  const { data, error } = await getAdminSupabase().rpc("admin_database_size");
  return error || data === null || data === undefined ? null : Number(data);
}

/** The week, for "at most once a week": 2026-W47. */
export function weekKey(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return `${d.getUTCFullYear()}-W${String(Math.ceil(((d.getTime() - start.getTime()) / 86_400_000 + 1) / 7)).padStart(2, "0")}`;
}

export type AutopilotResult = { rollup: unknown; bytes: number | null; alerted: boolean };

export async function runDbAutopilot(now: Date = new Date()): Promise<AutopilotResult> {
  const db = getAdminSupabase();
  const { data: rollup, error } = await db.rpc("rollup_view_events", { p_days: 90 });
  if (error) console.error("[db-autopilot] rollup", error.message);
  const bytes = await databaseSize();
  let alerted = false;
  if (bytes !== null && bytes >= ALERT_BYTES) {
    const dedupeKey = `db-size:${weekKey(now)}`;
    const { data: had } = await db.from("admin_notifications").select("id").eq("dedupe_key", dedupeKey).limit(1);
    if (!had?.length) {
      const title = `Database is at ${mb(bytes)} MB of ${mb(LIMIT_BYTES)} MB`;
      const body = "Supabase's free plan stops writing at 500 MB. Old page views are already being rolled up nightly; the biggest tables are listed in Supabase → Database → Tables.";
      await notifyAdmin({ kind: "agents", severity: "urgent", title, body, href: "/admin", dedupeKey, meta: { bytes } });
      for (const userId of await adminUserIds()) {
        await sendPushToUser(userId, { title, body, url: `${APP_URL}/admin`, tag: "db-size", category: "prospect_view" }).catch(() => {});
      }
      alerted = true;
    }
  }
  return { rollup: error ? { error: error.message } : rollup, bytes, alerted };
}
