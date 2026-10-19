import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { isRateLimited } from "@/lib/rate-limit";
import { isLikelyBot } from "@/lib/bot-detection";
import { isVisitorId, VISITOR_COOKIE } from "@/lib/visit-identity";
import { MAX_DURATION_S } from "@/lib/visit-device";

// ── How long a visit stayed on screen ────────────────────────────────────────
//
// Owner, 2026-10-18: every visit should say how long the person actually
// looked. The card and Swift Links pages count the time they are VISIBLE
// (components/CardEventTracker.tsx) and send it here when the visitor leaves —
// switches app, locks the phone, closes the tab — as a beacon, which is the one
// request a page that is going away can still make.
//
// This writes ONE column on a row that already exists: the viewed_card event
// the same page recorded a moment earlier. It creates nothing, counts nothing
// and notifies nobody, so it is not part of the ingest pipeline's decisions.
//
// WHY IT CANNOT BE USED TO INVENT ANYTHING. It is public, so:
//   • it finds the row by the visitor's OWN identity — the httpOnly sc_vid
//     cookie, or the page's id when the browser could keep no cookie — so a
//     caller can only ever touch views their own browser made;
//   • a duration can never exceed the time since that view was recorded (plus
//     the few seconds the human gate waits before recording), nor 30 minutes;
//   • it only ever RAISES the stored value — a second beacon from the same
//     visit (the tab hidden twice) can't shorten it, and a reload's fresh,
//     smaller count can't either.
// Every failure is silent: a visitor is never told analytics went wrong.

/** The human gate's dwell, plus network time, between page load and the row. */
const GATE_ALLOWANCE_S = 30;
/** A visit's beacon may arrive this long after the view was recorded. */
const VISIT_REACH_MS = 2 * 60 * 60 * 1000;

const ok = () => NextResponse.json({ ok: true });

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const slug = typeof body?.card_owner_username === "string" ? body.card_owner_username.trim().toLowerCase().slice(0, 80) : "";
    const surface: "card" | "links" = body?.surface === "links" ? "links" : "card";
    const seconds = Number(body?.seconds);
    if (!slug || !Number.isFinite(seconds) || seconds <= 0) return ok();
    if (isLikelyBot(req.headers.get("user-agent"))) return ok();

    // The cookie first, as everywhere: page script can neither read nor
    // rotate it. The page's own id only when no cookie came with the request.
    const cookieId = req.cookies.get(VISITOR_COOKIE)?.value;
    const clientId = typeof body?.visitor_id === "string" ? body.visitor_id.trim().slice(0, 64) : null;
    const visitorId = isVisitorId(cookieId) ? cookieId : isVisitorId(clientId) ? clientId : null;
    if (!visitorId) return ok();

    if (await isRateLimited(`dwell:${visitorId}:${slug}`, 30, 10 * 60 * 1000)) return ok();

    const admin = getAdminSupabase();
    const base = admin
      .from("card_events")
      .select("id, created_at, duration_s")
      .eq("card_owner_username", slug)
      .eq("visitor_id", visitorId)
      .eq("event_type", "viewed_card")
      .gte("created_at", new Date(Date.now() - VISIT_REACH_MS).toISOString());
    // A card view written before the surface column existed carries NULL.
    const { data: view, error } = await (surface === "card" ? base.or("surface.is.null,surface.eq.card") : base.eq("surface", surface))
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    // No view to describe (the owner's own visit, a deduped bot, or
    // visit-details.sql not applied yet): nothing to do.
    if (error || !view) return ok();

    const sinceRecorded = Math.floor((Date.now() - new Date(view.created_at as string).getTime()) / 1000);
    const secs = Math.floor(Math.min(seconds, sinceRecorded + GATE_ALLOWANCE_S, MAX_DURATION_S));
    const stored = (view.duration_s as number | null) ?? 0;
    if (secs <= stored) return ok();

    await admin
      .from("card_events")
      .update({ duration_s: secs })
      .eq("id", view.id as string)
      .or(`duration_s.is.null,duration_s.lt.${secs}`);
    return ok();
  } catch {
    return ok();
  }
}
