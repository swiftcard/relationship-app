import type { CrewStore } from "../store";
import type { ActivityRow } from "../types";

// ── The audit trail ─────────────────────────────────────────────────────────
// One line for every outward action (real or simulated), every status change
// that came from the Sheet, every control flip and every sync failure. The
// Activity Log tab shows the last 500; crew_activity keeps them all. Logging
// never throws: an audit line must never break the action it records.

export async function logActivity(store: CrewStore, a: Partial<Omit<ActivityRow, "id" | "at">> & { action: string }): Promise<void> {
  try {
    await store.logActivity({
      agent_id: a.agent_id ?? null,
      platform: a.platform ?? null,
      action: a.action,
      target: a.target ?? null,
      message: a.message ? a.message.slice(0, 4000) : null,
      result: a.result ?? "ok",
      error: a.error ? a.error.slice(0, 500) : null,
      row_key: a.row_key ?? null,
      approved_by: a.approved_by ?? null,
      simulated: a.simulated ?? false,
    });
  } catch {
    /* never break the action being logged */
  }
}
