import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { sendPushToUser } from "@/lib/push";
import { readPushPrefs } from "@/lib/push-policy";
import {
  ACTIVATION_COPY, ACTIVATION_MARK, ACTIVATION_MAX_AGE_MS, inActivationWindow, isActivationHour,
} from "@/lib/activation-nudge";

// ── The one-time "getting started" push (lib/activation-nudge.ts) ───────────
//
// Called by .github/workflows/push-catchup.yml with the same secret as the
// catch-up and the recap (Hobby plan: no hourly Vercel cron). Idempotent: the
// mark goes into push_log BEFORE the push, and once it exists the account is
// never considered again, so a duplicate or late run cannot buzz twice.
//
// Only accounts with a registered device are read — the push is the whole
// point, and there is no bell row (someone looking at the bell is already in
// the app).

export const runtime = "nodejs";
export const maxDuration = 60;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";
const PAGE = 1000;

function authorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  const accepted = [process.env.PUSH_CATCHUP_SECRET, process.env.CRON_SECRET]
    .filter((s): s is string => Boolean(s))
    .map((s) => `Bearer ${s}`);
  // An unset secret must never authorize (`Bearer undefined`).
  return accepted.length > 0 && !!auth && accepted.includes(auth);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = getAdminSupabase();
  const now = Date.now();
  const counts = { candidates: 0, sent: 0 };

  // Everyone with a device, paged (PostgREST stops at 1,000 silently).
  const withDevice = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data } = await admin.from("push_subscriptions").select("user_id").order("user_id").range(from, from + PAGE - 1);
    for (const r of data ?? []) if (r.user_id) withDevice.add(r.user_id as string);
    if (!data || data.length < PAGE) break;
  }
  if (!withDevice.size) return NextResponse.json(counts);

  // …who signed up in the last week (the window is checked exactly below).
  const ids = [...withDevice];
  const fresh: { id: string; plan: string | null; customization: unknown; created_at: string }[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin
      .from("profiles").select("id, plan, customization, created_at")
      .in("id", ids.slice(i, i + 200))
      .gte("created_at", new Date(now - ACTIVATION_MAX_AGE_MS).toISOString());
    for (const p of data ?? []) fresh.push(p as typeof fresh[number]);
  }

  for (const profile of fresh) {
    try {
      if (!inActivationWindow(profile.created_at, now)) continue;
      if ((profile.customization as { _deleted?: boolean } | null)?._deleted) continue;
      const prefs = readPushPrefs(profile.customization);
      if (prefs.getting_started === false) continue;
      if (!isActivationHour(now, prefs.timezone)) continue;

      // Once ever.
      const { data: done } = await admin.from("push_log").select("id")
        .eq("user_id", profile.id).eq("outcome", ACTIVATION_MARK).limit(1);
      if (done?.length) continue;

      // Not a single view on any of their cards or Swift Links pages.
      const { data: cards } = await admin.from("cards").select("username").eq("user_id", profile.id);
      const slugs = (cards ?? []).map((c) => c.username as string | null).filter((s): s is string => !!s);
      if (!slugs.length) continue; // nothing to share yet — the builder handles that
      const keys = slugs.flatMap((s) => [s, `${s}__links`]);
      const { count, error } = await admin.from("card_views")
        .select("id", { count: "exact", head: true }).in("username", keys);
      if (error || (count ?? 0) > 0) continue;
      counts.candidates++;

      // MARKED BEFORE SENDING: a crash costs the nudge, never a duplicate.
      await admin.from("push_log").insert({
        user_id: profile.id, category: "getting_started", plan: profile.plan ?? "free", outcome: ACTIVATION_MARK, endpoints: 0,
      });
      await sendPushToUser(profile.id, {
        category: "getting_started",
        title: ACTIVATION_COPY.title,
        body: ACTIVATION_COPY.body,
        url: `${APP_URL}/share`,
        tag: "getting-started",
      });
      counts.sent++;
    } catch {
      // One account's bad row must never stop everyone behind it.
    }
  }

  return NextResponse.json(counts);
}
