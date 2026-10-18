import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Keep the log tables at the size their own definitions promise (audit A-11).
 * Each says how long it keeps rows — product_events 90 days, error_events and
 * analytics_ingest_log 14 — and none was ever pruned: the two prune functions
 * had no caller, and the ingest log's 14-day delete ran once, when it was
 * created. Run by the daily cron. Each step is independent; a failure is
 * returned by name, never thrown, so one table can't stop the others.
 *
 * site_pageviews is NOT here: it never stated a retention, and deleting the
 * website's history is the owner's call.
 */
export async function pruneLogTables(admin: SupabaseClient, nowMs: number = Date.now()): Promise<{ failed: string[] }> {
  const failed: string[] = [];
  const step = async (name: string, run: () => PromiseLike<{ error: unknown }>) => {
    try {
      const { error } = await run();
      if (error) failed.push(name);
    } catch {
      failed.push(name);
    }
  };
  await step("product_events", () => admin.rpc("prune_product_events"));
  await step("error_events", () => admin.rpc("prune_error_events"));
  await step("analytics_ingest_log", () =>
    admin.from("analytics_ingest_log").delete().lt("created_at", new Date(nowMs - 14 * 24 * 60 * 60 * 1000).toISOString()),
  );
  return { failed };
}
