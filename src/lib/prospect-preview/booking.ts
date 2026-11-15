import { notifyAdmin } from "@/lib/admin-notify";
import { sendPushToUser } from "@/lib/push";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { DEMO_TIME_ZONE, PREVIEW_CALL_MIN, teamSizeFor } from "@/lib/demo/config";
import { fmtWhenShort } from "@/lib/demo/format";
import { alertTargets } from "./alert";
import { SLUG_RE } from "./input";
import { previewState } from "./real-view";
import { getPreviewBySlug, markMeetingBooked } from "./store";
import type { ProspectPreview } from "./types";

// ── Card Builder: the preview's one button books a setup call ───────────────
//
// Owner, 2026-11-15: no separate calendar link. "Claim your team's cards" on
// swiftcard.me/p/<slug> opens the Office demo booking (/demo?ref=<slug>): the
// same form, the same confirmation, the same emails and bell row. Three things
// differ, and all three are decided HERE, on the server, from the slug:
//
//   · the call is 15 minutes (lib/demo/config PREVIEW_CALL_MIN);
//   · the form starts filled in with what the preview page already shows that
//     person about themselves (their name, office, and the phone and email on
//     the card). Nothing that is not already on their public preview;
//   · when it is booked the preview moves to "meeting booked" and the owner's
//     phone gets a push.
//
// The slug is the reference, not the row id: it is what is already in the
// address the prospect was sent. Only a published, unexpired preview counts,
// so a paused or expired one books an ordinary demo.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

export type BookingPrefill = { name: string; company: string; email: string; phone: string; teamSize: string };

/** The live preview behind /demo?ref=<slug>, or null. */
export async function previewForRef(ref: unknown): Promise<ProspectPreview | null> {
  const slug = typeof ref === "string" ? ref.trim().toLowerCase() : "";
  if (!slug || !SLUG_RE.test(slug)) return null;
  const preview = await getPreviewBySlug(slug).catch(() => null);
  return preview && previewState(preview) === "live" ? preview : null;
}

export function prefillFor(p: ProspectPreview): BookingPrefill {
  return {
    name: p.owner_name,
    company: p.office_name,
    email: p.email ?? "",
    phone: p.phone ?? "",
    // From the team strip the page shows, not the researched head count.
    teamSize: teamSizeFor(p.team_members.length + 1),
  };
}

/** A setup call was booked from this preview: the stage moves, the phone rings. Never throws. */
export async function previewCallBooked(preview: { id: string; alert_user_id?: string | null }, booking: { id: string; name: string; company: string; starts_at: string }): Promise<void> {
  const previewId = preview.id;
  try {
    // Already booked, won or lost: nothing moves and the phone stays quiet
    // (the booking still has its Demos row and email like any other).
    if (!(await markMeetingBooked(previewId, booking.id))) return;
    const title = `Meeting booked: ${booking.name}`.slice(0, 60);
    const body = `${booking.company} · ${fmtWhenShort(new Date(booking.starts_at), DEMO_TIME_ZONE)} · ${PREVIEW_CALL_MIN}-min setup call`;
    const path = "/admin/demos";
    await notifyAdmin({ kind: "prospects", severity: "urgent", title, body, href: path, dedupeKey: `prospect-booked:${booking.id}` });
    const ids = await alertTargets(preview);
    await Promise.all(ids.map((userId) =>
      sendPushToUser(userId, { title, body, url: `${APP_URL}${path}`, tag: `prospect-booked-${previewId}`, category: "prospect_view", sticky: true }).catch(() => {}),
    ));
  } catch (e) {
    console.error("[prospect-booking]", previewId, e instanceof Error ? e.message : e);
  }
}

/** That call was canceled: the preview goes back in play (only if it is still tied to this booking). Never throws. */
export async function previewCallCanceled(previewId: string, bookingId: string, now: Date = new Date()): Promise<void> {
  try {
    await getAdminSupabase().from("prospect_previews")
      .update({ demo_booking_id: null, stage: null, updated_at: now.toISOString() })
      .eq("id", previewId).eq("demo_booking_id", bookingId).eq("stage", "meeting_booked");
  } catch (e) {
    console.error("[prospect-booking]", previewId, e instanceof Error ? e.message : e);
  }
}
