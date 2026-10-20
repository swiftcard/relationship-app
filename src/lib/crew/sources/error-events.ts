import { getAdminSupabase } from "@/lib/supabase-admin";

// Read-only: production crashes that lib/report-error already records
// (error_events, kept 14 days, grouped by a stable fingerprint).
export type ErrorEvent = { created_at: string; context: string; message: string; stack: string | null; fingerprint: string; extra: Record<string, unknown> | null };

export async function readErrorEvents(sinceIso: string, limit = 1000): Promise<ErrorEvent[]> {
  const { data, error } = await getAdminSupabase()
    .from("error_events")
    .select("created_at, context, message, stack, fingerprint, extra")
    .eq("env", "production")
    .gt("created_at", sinceIso)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`error_events: ${error.message}`);
  return (data ?? []) as ErrorEvent[];
}
