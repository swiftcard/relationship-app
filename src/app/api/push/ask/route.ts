import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { mutateCustomization } from "@/lib/profile-customization";
import { isRateLimited } from "@/lib/rate-limit";
import { isShellRequest } from "@/lib/shell-request";
import {
  PUSH_ASK_KEY, PUSH_ASK_MAX_AGE_MS, decidePushAsk, isAskableType, laterPushAsk, pushAlreadyOn, pushAskQuietUntil,
  readPushAsk, snoozePushAsk, stopPushAsk, type AskPlatform,
} from "@/lib/push-ask";

// The "turn on notifications" reminder under an important bell row — whether it
// may show, and the record of every time it did. All the rules are in
// lib/push-ask.ts; this route is the only thing that applies them, so a phone
// and a laptop share one "Don't ask again", while the app keeps its own
// reminders (the ones that matter most) apart from the website's.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** App or website — from the request itself (user agent / shell cookie), never from the body. */
const platformOf = (req: NextRequest): AskPlatform => (isShellRequest(req) ? "app" : "web");

/** Already getting what this side would ask for? A failed read says yes: never nag on a guess. */
async function alreadyOn(userId: string, platform: AskPlatform): Promise<boolean> {
  const { data, error } = await getAdminSupabase()
    .from("push_subscriptions")
    .select("endpoint")
    .eq("user_id", userId);
  if (error) return true;
  return pushAlreadyOn((data ?? []).map((r) => String(r.endpoint)), platform);
}

/**
 * Did push once WORK for this account? A delivered push on record, read only
 * once nothing of theirs is receiving any more (the caller checks that): then
 * it was lost, not refused, and one more reminder is allowed (lib/push-ask).
 * A failed read says no: never nag on a guess.
 */
async function hadPushBefore(userId: string): Promise<boolean> {
  const { data, error } = await getAdminSupabase()
    .from("push_log")
    .select("id")
    .eq("user_id", userId)
    .eq("outcome", "sent")
    .limit(1);
  return !error && (data ?? []).length > 0;
}

/** For the dashboard box: is there any point asking this account, here, now? */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const platform = platformOf(req);
  const { data } = await getAdminSupabase().from("profiles").select("customization").eq("id", user.id).maybeSingle();
  const ledger = readPushAsk(((data?.customization ?? {}) as Record<string, unknown>)[PUSH_ASK_KEY]);
  const quiet = pushAskQuietUntil(ledger, platform);
  return NextResponse.json({
    pushOn: await alreadyOn(user.id, platform),
    stopped: ledger.stop,
    // Something asked recently on this side (the box or a reminder) — nothing
    // else asks until then.
    quietUntil: quiet && quiet > Date.now() ? new Date(quiet).toISOString() : null,
  });
}

/**
 * { id }                     — may the ask show on this notification? Records it.
 * { action: "later", id }    — "Not now" on that one.
 * { action: "snooze" }       — "Not now" on the dashboard box: a quiet period.
 * { action: "stop" }         — never again ("Don't ask again", or switching
 *                              push off on purpose).
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (await isRateLimited(`push-ask:${user.id}`, 60, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const platform = platformOf(req);
  const body = (await req.json().catch(() => ({}))) as { id?: unknown; action?: unknown };
  const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : null;
  const save = async (mutate: (cur: unknown) => unknown) => {
    const r = await mutateCustomization<unknown>(user.id, PUSH_ASK_KEY, mutate);
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not saved" }, { status: 500 });
  };

  if (body.action === "stop") return save((cur) => stopPushAsk(readPushAsk(cur)) ?? cur);
  if (body.action === "snooze") return save((cur) => snoozePushAsk(readPushAsk(cur), platform) ?? cur);

  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  if (body.action === "later") return save((cur) => laterPushAsk(readPushAsk(cur), platform, id) ?? cur);

  // ── Claim ──────────────────────────────────────────────────────────────────
  if (await alreadyOn(user.id, platform)) return NextResponse.json({ show: false });

  // The row must be THEIRS, unread, recent, and one of the kinds worth a buzz.
  // Checked here, not trusted from the client, so nothing can spend the budget
  // on the wrong notification — or on someone else's.
  const { data: row } = await getAdminSupabase()
    .from("notifications")
    .select("id, type, read, created_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  const age = row ? Date.now() - Date.parse(row.created_at as string) : Infinity;
  if (!row || row.read || !isAskableType(row.type as string) || !(age <= PUSH_ASK_MAX_AGE_MS)) {
    return NextResponse.json({ show: false });
  }

  // Decided INSIDE the verified read-modify-write: two tabs claiming two
  // different rows at once cannot both spend a reminder the budget does not
  // have — the loser re-decides against what the winner wrote.
  let show = false;
  const lostPush = await hadPushBefore(user.id);
  const r = await mutateCustomization<unknown>(user.id, PUSH_ASK_KEY, (cur) => {
    const d = decidePushAsk(readPushAsk(cur), platform, id, Date.now(), { lostPush });
    show = d.show;
    return d.next ?? cur;
  });
  // Unrecorded means uncounted — and an uncounted ask is one that could repeat
  // past the limit. Say no rather than show it.
  if (!r.ok) return NextResponse.json({ show: false });
  return NextResponse.json({ show });
}
