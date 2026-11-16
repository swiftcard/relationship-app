import { getAdminSupabase } from "@/lib/supabase-admin";
import { doNotContact } from "@/lib/prospect-preview/outbox";

// ── Releasing approved openers to the Mac, at a pace (owner, 2026-11-16) ────
// An approved opener waits in prospect_outbox as 'scheduled' until its
// send_at (9 AM in the recipient's time zone, lib/prospect-preview/send-at.ts).
// Every 5 minutes /api/card-builder/release moves the due ones to 'queued',
// which is what the Mac sends, a few at a time: at most RELEASE_PER_RUN per
// run and never more than MAX_WAITING waiting on the Mac at once. So a
// morning with 40 due goes out over a couple of hours, not in one burst, and
// the Mac's own hours, daily cap and random gaps still apply on top.
//
// It sends nothing. The do-not-contact list is checked again on the way out.

export const RELEASE_PER_RUN = 2;
export const MAX_WAITING = 3;

export type ReleaseResult = { due: number; released: number; canceled: number; waiting: number };

export async function releaseDue(now: Date = new Date()): Promise<ReleaseResult> {
  const db = getAdminSupabase();
  const { count: waiting } = await db.from("prospect_outbox").select("id", { count: "exact", head: true }).eq("status", "queued");
  const room = Math.max(0, Math.min(RELEASE_PER_RUN, MAX_WAITING - (waiting ?? 0)));
  const { data: due, count } = await db.from("prospect_outbox").select("id, phone, preview_id", { count: "exact" })
    .eq("status", "scheduled").lte("send_at", now.toISOString()).order("send_at", { ascending: true }).limit(Math.max(room, 1) + 5);
  let released = 0, canceled = 0;
  for (const row of due ?? []) {
    if (released >= room) break;
    const { data: p } = await db.from("prospect_previews").select("email").eq("id", row.preview_id).maybeSingle();
    if (await doNotContact(row.phone as string, (p?.email as string | null) ?? null)) {
      await db.from("prospect_outbox").update({ status: "canceled", error: "on the do-not-contact list" }).eq("id", row.id).eq("status", "scheduled");
      canceled++;
      continue;
    }
    const { data: moved } = await db.from("prospect_outbox").update({ status: "queued" }).eq("id", row.id).eq("status", "scheduled").select("id");
    if (moved?.length) released++;
  }
  return { due: count ?? 0, released, canceled, waiting: (waiting ?? 0) + released };
}
