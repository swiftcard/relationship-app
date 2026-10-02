import { getAdminSupabase } from "@/lib/supabase-admin";

// In-app notification writer, resilient to the notifications.card_owner column
// not existing yet (supabase/notifications-card-scope.sql not applied). Inserts
// WITH the card scope; on "column does not exist" (42703) retries without it so
// notifications are never silently dropped. Once the migration runs, scoping
// just starts working — no code change needed.
// Returns TRUE only when this call actually wrote the row. Callers that fire a
// side effect alongside the notification (e.g. a push) must gate it on this:
// with the milestone unique index in place, the loser of a concurrent race gets
// a 23505 here, and without a signal it would carry on and send a duplicate push
// for a notification it never created.
/** How long an identical notification counts as a redelivery of the same event. */
export const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

export async function insertNotification(row: {
  user_id: string;
  card_owner?: string | null;
  /** The contact this row is about. The bell opens THAT contact with it
   *  (NotificationBell contactHref); redactForPlan withholds it from a Free
   *  reader whenever the name is blocked out. */
  lead_id?: string | null;
  type: string;
  title: string;
  body: string;
}, opts: {
  /** The caller has its OWN idempotency key and identical words can be real
   *  news: a contact texting "Yes" twice is two replies. (Twilio inbound dedupes
   *  on MessageSid.) Skips the identical-words check below. */
  allowRepeat?: boolean;
} = {}): Promise<boolean> {
  const admin = getAdminSupabase();

  // THE SAME WORDS TWICE IN TEN MINUTES IS A RETRY, NOT NEWS.
  //
  // Everything that reaches this function is driven by something that
  // redelivers: a Stripe webhook that 500s and is sent again, a Twilio webhook
  // that timed out, a cron run overlapping the last one, two code paths that
  // both notice Pro ended (Stripe + Apple). Each caller had its own idea of
  // idempotency and several had none, so the bell could show the same sentence
  // twice — and where a push rides on the row, the phone buzzed twice.
  //
  // Identical means identical: same person, same type, same title, same body,
  // same card. Two different replies from one contact differ in body and both
  // go through. Returns false like any other rejected duplicate, which is the
  // signal callers already gate their push on. Best-effort: if the lookup fails
  // the row is written, because a missing notification is worse than a rare
  // double.
  if (!opts.allowRepeat) try {
    let q = admin
      .from("notifications")
      .select("id")
      .eq("user_id", row.user_id)
      .eq("type", row.type)
      .eq("title", row.title)
      .eq("body", row.body)
      .gte("created_at", new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString())
      .limit(1);
    q = row.card_owner ? q.eq("card_owner", row.card_owner) : q.is("card_owner", null);
    const { data: twin } = await q;
    if (twin?.length) return false;
  } catch { /* fall through and write it */ }

  const { error } = await admin.from("notifications").insert(row);
  if (!error) return true;
  // Missing column surfaces as 42703 (Postgres) or PGRST204 (PostgREST schema
  // cache) depending on the path — retry without the card scope on either.
  const code = (error as { code?: string } | null)?.code;
  if (code === "42703" || code === "PGRST204") {
    if (row.card_owner === undefined) return false;
    const { card_owner: _unused, ...rest } = row;
    void _unused;
    const { error: retryError } = await admin.from("notifications").insert(rest);
    return !retryError;
  }
  // 23505 = a dedupe index rejected this as a duplicate: someone else already
  // wrote it. Not an error, but this call did NOT create it.
  return false;
}
