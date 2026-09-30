import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { decryptToken } from "@/lib/token-crypto";
import { fetchLinkedInProfile, isLinkedInEnabled } from "@/lib/sync-linkedin";
import { fetchLinkedInPhoto } from "@/lib/linkedin-photo";

export const runtime = "nodejs";

// GET /api/integrations/linkedin → the CONNECTED user's importable profile photo.
// This is the approval step: we return the photo URL (clearly LinkedIn-sourced)
// so the UI can preview it and let the user CHOOSE to apply it. Applying, manual
// upload, and removal all remain the user's action — nothing is auto-applied.
export async function GET() {
  if (!isLinkedInEnabled()) {
    return NextResponse.json({ error: "not_configured" }, { status: 501 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = getAdminSupabase();
  const { data: row } = await admin
    .from("integrations")
    .select("access_token")
    .eq("user_id", user.id)
    .eq("provider", "linkedin")
    .maybeSingle();

  if (!row?.access_token) return NextResponse.json({ connected: false });

  let token: string;
  try {
    token = decryptToken(row.access_token as string);
  } catch {
    return NextResponse.json({ connected: true, photo: null, error: "token_unreadable" });
  }

  const profile = await fetchLinkedInProfile(token);
  if (!profile) {
    // Token likely revoked or the member has no accessible photo — record it so
    // the card can prompt a reconnect, mirroring the Google/HubSpot sync_error UX.
    await admin.from("integrations")
      .update({ sync_error: "LinkedIn access expired or was revoked — reconnect to import your photo." })
      .eq("user_id", user.id).eq("provider", "linkedin");
    return NextResponse.json({ connected: true, photo: null, error: "revoked_or_no_photo" });
  }

  return NextResponse.json({
    connected: true,
    photo: profile.picture ?? null, // clearly labelled LinkedIn-sourced in the UI
    name: profile.name ?? null,
    source: "linkedin",
  });
}

// POST /api/integrations/linkedin → IMPORT the approved photo. LinkedIn's CDN
// URLs expire, so "Use this photo" copies the image into our own storage and
// returns a durable URL the caller saves onto the card — the same flow as a
// manual upload, just sourced from LinkedIn. Only ever called after the user
// confirms the preview; nothing is applied automatically.
export async function POST() {
  if (!isLinkedInEnabled()) {
    return NextResponse.json({ error: "not_configured" }, { status: 501 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = getAdminSupabase();
  const { data: row } = await admin
    .from("integrations")
    .select("access_token")
    .eq("user_id", user.id)
    .eq("provider", "linkedin")
    .maybeSingle();
  if (!row?.access_token) return NextResponse.json({ error: "not_connected" }, { status: 400 });

  let token: string;
  try {
    token = decryptToken(row.access_token as string);
  } catch {
    return NextResponse.json({ error: "not_connected" }, { status: 400 });
  }

  const profile = await fetchLinkedInProfile(token);
  if (!profile?.picture) {
    return NextResponse.json({ error: "no_photo" }, { status: 404 });
  }

  // Download the largest rendition LinkedIn's CDN will give (https-validated
  // upstream), enhance it if only the thumbnail came back, and re-encode
  // exactly like a manual photo upload so the stored file is ours.
  const photo = await fetchLinkedInPhoto(profile.picture);
  if (!photo) return NextResponse.json({ error: "fetch_failed" }, { status: 502 });
  const body = photo.body;

  const path = `${user.id}/photo-linkedin-${Date.now()}.jpg`;
  const { error: uploadError } = await admin.storage
    .from("card-uploads")
    .upload(path, body, { contentType: "image/jpeg", upsert: true });
  if (uploadError) return NextResponse.json({ error: "save_failed" }, { status: 500 });

  const { data: { publicUrl } } = admin.storage.from("card-uploads").getPublicUrl(path);
  // Deferred like the manual uploader — the caller persists it on card save,
  // after the user's explicit confirmation. `small` tells the UI the best
  // LinkedIn had was a thumbnail, so it can suggest a sharper upload.
  return NextResponse.json({ url: publicUrl, small: photo.wasSmall });
}

// DELETE /api/integrations/linkedin → disconnect (revoke our stored tokens).
export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = getAdminSupabase();
  await admin.from("integrations").delete().eq("user_id", user.id).eq("provider", "linkedin");

  return NextResponse.json({ ok: true });
}
