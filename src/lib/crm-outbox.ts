import { getAdminSupabase } from "./supabase-admin";

// ── Contacts waiting to be sent ──────────────────────────────────────────────
//
// A CRM that was busy (429), down (5xx) or silent when a contact arrived used
// to cost that contact for good: one attempt in after(), then nothing — while
// Settings promised "new leads will keep trying" (audit 2026-10-12, I-02).
//
// Now the contact waits here, one row per contact per destination, and the
// daily job (lib/crm-outbox-drain via /api/reminders) sends it again from the
// lead as it is THEN — so an edit made in the meantime goes too. Settings
// counts these rows as "waiting to send". After five days of trying the row
// is dropped and the connection's banner says so plainly.
//
// Only lead.created-style sends are queued. Card-view and notification events
// to Zapier are a stream, and a stale view replayed a day later is noise.

export type OutboxProvider = "google" | "hubspot" | "pipedrive" | "highlevel" | "salesforce" | "zapier";

export type OutboxEntry = {
  leadId: string;
  provider: OutboxProvider;
  /** Whose contact it is — the account the lead belongs to. */
  capturedBy: string;
  /** Whose CRM or webhook it was going to (an Office owner, for a member's lead). */
  ownerId: string;
  mode: "capture" | "update";
  error: string;
};

/** How soon a queued contact may be tried again. The daily job does the trying. */
const FIRST_RETRY_AFTER_MS = 15 * 60 * 1000;

/** Queue a contact for the daily catch-up. False if it couldn't be queued. */
export async function enqueueCrmRetry(e: OutboxEntry): Promise<boolean> {
  try {
    // One row per contact per destination: a second failure for the same
    // contact refreshes the error rather than queueing it twice. attempts and
    // created_at are left out on purpose, so a re-queue keeps the original
    // five-day clock instead of restarting it.
    const { error } = await getAdminSupabase().from("crm_sync_outbox").upsert(
      {
        lead_id: e.leadId,
        provider: e.provider,
        user_id: e.capturedBy,
        owner_id: e.ownerId,
        mode: e.mode,
        last_error: e.error.slice(0, 500),
        next_attempt_at: new Date(Date.now() + FIRST_RETRY_AFTER_MS).toISOString(),
      },
      { onConflict: "lead_id,provider" },
    );
    return !error;
  } catch {
    return false; // table missing (migration unapplied) — caller falls back to the banner
  }
}

/** How many contacts are waiting for each of this account's destinations. */
export async function countWaiting(ownerId: string): Promise<Partial<Record<OutboxProvider, number>>> {
  try {
    const { data } = await getAdminSupabase()
      .from("crm_sync_outbox")
      .select("provider")
      .eq("owner_id", ownerId)
      .limit(1000);
    const out: Partial<Record<OutboxProvider, number>> = {};
    for (const r of data ?? []) {
      const p = r.provider as OutboxProvider;
      out[p] = (out[p] ?? 0) + 1;
    }
    return out;
  } catch {
    return {};
  }
}
