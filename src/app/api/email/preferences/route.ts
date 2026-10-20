import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { isRateLimited } from "@/lib/rate-limit";
import { verifyEmailToken } from "@/lib/email-token";
import {
  DEFAULT_PREFERENCES,
  MARKETING_CATEGORIES,
  readPreferences,
  recordOptOut,
  type EmailPreferences,
} from "@/lib/marketing-consent";

// ── The preference centre's data endpoint ───────────────────────────────────
//
// GET  ?t=<token>              → the account's current settings
// POST { t, action, ... }      → save / pause / digest-only / unsubscribe / reason
//
// Authenticated by the signed token alone. That is the point: a person deciding
// whether to keep hearing from us must never be asked to sign in first, because
// the alternative they DO have is the spam button.
//
// The token names the account, so no request body may carry a user id — that
// would be an open opt-out endpoint for anyone who can guess a uuid.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Action = "save" | "pause" | "digest_only" | "unsubscribe" | "reason";

const bad = () => NextResponse.json({ error: "This link is no longer valid." }, { status: 400 });

function shape(prefs: EmailPreferences) {
  return {
    lead_tips: prefs.lead_tips,
    product_updates: prefs.product_updates,
    digest: prefs.digest,
    digest_frequency: prefs.digest_frequency,
    promotions: prefs.promotions,
    paused_until: prefs.paused_until,
    marketing_opt_out: prefs.marketing_opt_out || prefs.marketing_emails === false,
  };
}

export async function GET(req: NextRequest) {
  const check = verifyEmailToken(req.nextUrl.searchParams.get("t"));
  if (!check.ok) return bad();

  const prefs = await readPreferences(check.userId);
  // Unreadable row: say so rather than rendering every switch "on" over a
  // database error, which would invite someone to "save" settings that then
  // silently do not persist.
  if (!prefs) return NextResponse.json({ error: "Couldn't load your preferences." }, { status: 503 });

  return NextResponse.json({ preferences: shape(prefs) });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    t?: string;
    action?: Action;
    preferences?: Partial<Record<string, unknown>>;
    reason?: string;
  };

  const check = verifyEmailToken(body.t);
  if (!check.ok) return bad();
  const userId = check.userId;

  // A signed token is long-lived by design, so cap how often one can be
  // replayed. Generous: a person fiddling with switches must never be blocked,
  // and the unsubscribe path is far below this ceiling.
  if (await isRateLimited(`email-prefs:${userId}`, 40, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many changes. Try again shortly." }, { status: 429 });
  }

  const admin = getAdminSupabase();
  const now = new Date();
  const patch: Record<string, unknown> = { user_id: userId, updated_at: now.toISOString() };

  switch (body.action) {
    case "save": {
      const p = body.preferences ?? {};
      for (const key of MARKETING_CATEGORIES) {
        if (typeof p[key] === "boolean") patch[key] = p[key];
      }
      if (p.digest_frequency === "weekly" || p.digest_frequency === "monthly") {
        patch.digest_frequency = p.digest_frequency;
      }
      // Saving preferences is an act of staying: it lifts a previous full
      // opt-out and clears a pause, otherwise the switches would appear to save
      // while nothing could actually send.
      patch.marketing_opt_out = false;
      patch.marketing_emails = true;
      patch.paused_until = null;
      break;
    }

    case "pause": {
      patch.paused_until = new Date(now.getTime() + 30 * 86400000).toISOString();
      break;
    }

    case "digest_only": {
      patch.lead_tips = false;
      patch.product_updates = false;
      patch.promotions = false;
      patch.digest = true;
      patch.digest_frequency = "monthly";
      patch.marketing_opt_out = false;
      patch.marketing_emails = true;
      patch.paused_until = null;
      break;
    }

    case "unsubscribe": {
      // Goes through the shared writer so the audit row and BOTH suppression
      // flags are handled in one place.
      const ok = await recordOptOut({ userId, source: "footer" });
      if (!ok) return NextResponse.json({ error: "Couldn't save that. Please try again." }, { status: 503 });
      const after = await readPreferences(userId);
      return NextResponse.json({ ok: true, preferences: after ? shape(after) : null });
    }

    case "reason": {
      // Optional, never required, and never a condition of the opt-out — which
      // has already happened by the time this is called. Recorded against the
      // most recent event so the survey answer sits with the opt-out it explains.
      const reason = typeof body.reason === "string" ? body.reason.slice(0, 200) : "";
      if (!reason) return NextResponse.json({ ok: true });
      try {
        const { data } = await admin
          .from("unsubscribe_events")
          .select("id")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(1);
        const id = data?.[0]?.id as string | undefined;
        if (id) await admin.from("unsubscribe_events").update({ reason }).eq("id", id);
        else await admin.from("unsubscribe_events").insert({ user_id: userId, source: "footer", reason });
      } catch { /* a survey answer must never fail the request */ }
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const { error } = await admin.from("email_preferences").upsert(patch, { onConflict: "user_id" });
  if (error) return NextResponse.json({ error: "Couldn't save that. Please try again." }, { status: 503 });

  const after = await readPreferences(userId);
  return NextResponse.json({
    ok: true,
    preferences: after ? shape(after) : { ...DEFAULT_PREFERENCES, ...patch },
  });
}
