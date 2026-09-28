import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { isPaidUser, redactForPlan } from "@/lib/notification-privacy";
import { hideForReader, notificationReader } from "@/lib/office-account-notifications";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Service role, scoped to this user on every query: the notifications table
  // is not readable with a user's own session (supabase/lock-client-reads.sql)
  // — a Free account could otherwise read the unredacted location text in
  // devtools. The session is used only to identify the user.
  const db = getAdminSupabase();

  // No ?card= → ALL cards (the bell). ?card=X → that card only, plus legacy
  // un-tagged/account-level notifications (the dashboard panel).
  const card = (req.nextUrl.searchParams.get("card") || "").replace(/[^a-zA-Z0-9_-]/g, "");

  // lead_id (warm-lead-alerts.sql) lets a row about a known contact open THAT
  // contact instead of guessing from the name. Asked for first; without the
  // column the query below runs exactly as it always did.
  const scopedQuery = (cols: string) => {
    let q = db.from("notifications").select(cols).eq("user_id", user.id);
    if (card) q = q.or(`card_owner.eq.${card},card_owner.is.null`);
    // Unread first, then newest. With a plain created_at order, 20 recent READ
    // rows pushed every older unread one out of the window — it vanished from
    // the list AND from the badge, which only counts the rows it was handed.
    return q.order("read", { ascending: true }).order("created_at", { ascending: false }).limit(20);
  };
  let { data: scoped, error } = await scopedQuery("id, type, title, body, read, created_at, card_owner, lead_id");
  if (error) ({ data: scoped, error } = await scopedQuery("id, type, title, body, read, created_at, card_owner"));
  let data: Record<string, unknown>[] | null = scoped as unknown as Record<string, unknown>[] | null;

  // If the card_owner column migration hasn't run yet, selecting/filtering on
  // it errors and the bell would show nothing — fall back to the plain query.
  // Never for a CARD-scoped read: an unscoped retry after ANY error (a timeout,
  // not just a missing column) listed every card's rows in card B's panel.
  // The column is live everywhere now; a scoped read that fails shows nothing
  // rather than the wrong card (isolation audit 2026-09-24).
  if (error && card) {
    return NextResponse.json([]);
  }
  if (error) {
    ({ data } = await db
      .from("notifications")
      .select("id, type, title, body, read, created_at")
      .eq("user_id", user.id)
      .order("read", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(20));
  }

  // An Office account is never handed referral pitches, nor a team member
  // billing rows about a subscription they no longer have
  // (lib/office-account-notifications). Same rule as the dashboard's lists.
  //
  // Both reads hit the same profiles row and neither needs the other's answer,
  // so they go together — this endpoint is polled every 10–30s by every
  // signed-in tab, and it was paying for two serial round trips per poll.
  // Each keeps its own error handling, so the fallbacks are unchanged.
  const [reader, paid] = await Promise.all([
    notificationReader(user.id),
    isPaidUser(user.id),
  ]);
  data = hideForReader(data ?? [], reader);

  return NextResponse.json(redactForPlan(data ?? [], paid));
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Service role, scoped to this user on every query: the notifications table
  // is not readable with a user's own session (supabase/lock-client-reads.sql)
  // — a Free account could otherwise read the unredacted location text in
  // devtools. The session is used only to identify the user.
  const db = getAdminSupabase();

  let body: { id?: string; read?: boolean; card?: string } = {};
  try { body = await req.json(); } catch { /* no body = mark all read */ }

  if (body.id) {
    // Toggle a single notification's read state.
    await db
      .from("notifications")
      .update({ read: body.read ?? true })
      .eq("user_id", user.id)
      .eq("id", body.id);
  } else {
    // Mark all read. With { card } (the per-card dashboard panel) only that
    // card's notifications + account-level ones are touched — never another
    // card's. Without it (the bell) it's genuinely all cards.
    const card = (body.card || "").replace(/[^a-zA-Z0-9_-]/g, "");
    let q = db
      .from("notifications")
      .update({ read: true })
      .eq("user_id", user.id)
      .eq("read", false);
    if (card) q = q.or(`card_owner.eq.${card},card_owner.is.null`);
    const { error } = await q;
    // A failed card-scoped update is NOT retried unscoped: that marked every
    // other card's rows read from card B's panel (isolation audit 2026-09-24).
    if (error) return NextResponse.json({ error: "Couldn't update notifications." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// Dismiss notifications: { id } removes one, { read: true } clears all read
// ones — card-scoped when { card } is given (the per-card panel).
export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Service role, scoped to this user on every query: the notifications table
  // is not readable with a user's own session (supabase/lock-client-reads.sql)
  // — a Free account could otherwise read the unredacted location text in
  // devtools. The session is used only to identify the user.
  const db = getAdminSupabase();

  let body: { id?: string; read?: boolean; card?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }

  if (body.id) {
    await db.from("notifications").delete().eq("user_id", user.id).eq("id", body.id);
  } else if (body.read) {
    const card = (body.card || "").replace(/[^a-zA-Z0-9_-]/g, "");
    let q = db.from("notifications").delete().eq("user_id", user.id).eq("read", true);
    if (card) q = q.or(`card_owner.eq.${card},card_owner.is.null`);
    const { error } = await q;
    // Never retried unscoped: "Clear read" on card B deleted card A's rows
    // whenever the scoped delete failed (isolation audit 2026-09-24).
    if (error) return NextResponse.json({ error: "Couldn't clear notifications." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
