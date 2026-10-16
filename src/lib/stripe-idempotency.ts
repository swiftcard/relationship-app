import { getAdminSupabase } from "@/lib/supabase-admin";
import { reportError } from "@/lib/report-error";

// ── Webhook idempotency ───────────────────────────────────────────────────────
// Stripe delivers each event at least once, so redeliveries (and Stripe's own
// retries after our 500s) can replay a handler. We record each event id in
// `stripe_events` (see supabase/stripe-events-dedup.sql) and skip anything
// already handled. FAILS OPEN: if the table doesn't exist yet, or the insert
// errors, we process the event — the handlers are mostly idempotent, so a
// missed dedup is safe, whereas dropping a real event is not.
//
// The row records COMPLETION, not arrival (audit B-05). It is claimed as
// "processing" before the handler runs and marked "done" only once the handler
// has finished. It used to count as handled the moment it was inserted, so a
// run the platform killed part-way — a timeout, out of memory, a deploy cutting
// it off — never reached the catch that releases the claim, and every retry
// Stripe made was answered "duplicate": a paid customer never provisioned, a
// cancellation never applied.

/** The webhook's maxDuration is 60 s. A claim still "processing" well past that
 *  belongs to a run that died without releasing it, and a retry takes it over. */
export const STRIPE_EVENT_STALE_MS = 3 * 60 * 1000;

/** process: handle the event, then finishStripeEvent (or clearStripeEvent on
 *  failure). duplicate: already handled, answer 200. in_progress: another run
 *  is on it right now, answer non-2xx so Stripe asks again later — a 200 here
 *  would close the event even if that other run then dies. */
export type StripeEventClaim = "process" | "duplicate" | "in_progress";

const UNIQUE_VIOLATION = "23505";
// The `state` column not migrated yet: fall back to the old marker.
const MISSING_COLUMN = new Set(["42703", "PGRST204"]);
const codeOf = (e: unknown) => (e as { code?: string } | null)?.code;

export async function claimStripeEvent(eventId: string, type: string, nowMs: number = Date.now()): Promise<StripeEventClaim> {
  if (!eventId) return "process";
  const admin = getAdminSupabase();
  try {
    const { error } = await admin.from("stripe_events").insert({ event_id: eventId, type, state: "processing" });
    if (!error) return "process"; // first time we've seen it

    if (MISSING_COLUMN.has(codeOf(error) ?? "")) {
      const legacy = await admin.from("stripe_events").insert({ event_id: eventId, type });
      if (!legacy.error) return "process";
      if (codeOf(legacy.error) === UNIQUE_VIOLATION) return "duplicate";
      await reportError("stripe.idempotency.insert_failed", legacy.error, { eventId, type });
      return "process";
    }
    if (codeOf(error) !== UNIQUE_VIOLATION) {
      // Any other error (e.g. table missing) → fail open, process the event —
      // but this silently defeats dedup for every future delivery, so make it
      // visible rather than a permanently invisible gap (billing audit).
      await reportError("stripe.idempotency.insert_failed", error, { eventId, type });
      return "process";
    }

    // Seen before. Finished, still running, or abandoned?
    const { data: row, error: readError } = await admin
      .from("stripe_events")
      .select("state, created_at")
      .eq("event_id", eventId)
      .maybeSingle();
    // Unreadable, or released by a failed run between our insert and this
    // read: neither answer is safe to guess, so Stripe asks again later.
    if (readError || !row) return "in_progress";
    if (row.state !== "processing") return "duplicate";
    const startedMs = new Date(row.created_at as string).getTime();
    if (Number.isFinite(startedMs) && nowMs - startedMs < STRIPE_EVENT_STALE_MS) return "in_progress";

    // Abandoned by a run that died: take it over. Conditional on the exact
    // stamp just read, so two retries racing here can't both win.
    const { data: taken } = await admin
      .from("stripe_events")
      .update({ created_at: new Date(nowMs).toISOString() })
      .eq("event_id", eventId)
      .eq("state", "processing")
      .eq("created_at", row.created_at as string)
      .select("event_id");
    if (Array.isArray(taken) && taken.length > 0) {
      await reportError("stripe.idempotency.reclaimed", "a run died before finishing this event", { eventId, type });
      return "process";
    }
    return "in_progress";
  } catch (e) {
    await reportError("stripe.idempotency.insert_threw", e, { eventId, type });
    return "process";
  }
}

// Mark a claimed event handled. Only after this does a redelivery count as a
// duplicate. If the write fails the claim stays "processing", and a later
// redelivery re-runs the (idempotent) handler instead of being skipped — the
// safe direction to be wrong in.
export async function finishStripeEvent(eventId: string): Promise<void> {
  if (!eventId) return;
  try {
    const { error } = await getAdminSupabase().from("stripe_events").update({ state: "done" }).eq("event_id", eventId);
    if (error && !MISSING_COLUMN.has(codeOf(error) ?? "")) {
      await reportError("stripe.idempotency.finish_failed", error, { eventId });
    }
  } catch (e) {
    await reportError("stripe.idempotency.finish_threw", e, { eventId });
  }
}

// Remove the dedup marker for an event whose handler failed, so Stripe's retry
// is NOT skipped as a duplicate. Best-effort: if this delete itself fails the
// claim goes stale after STRIPE_EVENT_STALE_MS and the retry takes it over.
export async function clearStripeEvent(eventId: string): Promise<void> {
  if (!eventId) return;
  try {
    await getAdminSupabase().from("stripe_events").delete().eq("event_id", eventId);
  } catch {
    /* best-effort */
  }
}
