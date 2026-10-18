import { createClient } from "@/lib/supabase-server";
import { deletedAccountResponse } from "@/lib/live-account";
import { isRateLimited } from "@/lib/rate-limit";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { clientIpFromHeaders } from "@/lib/client-ip";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

// A short video as a Swift Links tile preview (customization.links[i].media,
// type "video"). Videos can't ride through /api/upload: the platform caps a
// function's request body at ~4.5 MB, and even a ten-second clip is bigger.
// So the browser asks here for a SIGNED upload URL scoped to the user's own
// folder and PUTs the file straight to storage; nothing large ever touches a
// function. The URL is returned for the caller to persist in customization —
// there is no column, exactly like the "hero"/"link" image fields.
export const runtime = "nodejs";

// Autoplaying on every visit, so keep it short — this is a preview, not a
// player. 25 MB is ~30 s of phone video; the bucket's own cap is higher.
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
export const ALLOWED_VIDEO = ["video/mp4", "video/quicktime", "video/webm"] as const;
const EXT_BY_TYPE: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" };

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // A deleted account (its 30-day window) uploads nothing (audit SEC-12).
  if (user) { const gone = await deletedAccountResponse(user.id); if (gone) return gone; }
  // Guests (first card, homepage builders) get a signed URL too, into their own
  // random folder under guest/ and on a tighter per-connection throttle.
  const limitKey = user ? `upload-video:${user.id}` : `upload-video-guest:${clientIpFromHeaders(req.headers)}`;
  if (await isRateLimited(limitKey, user ? 20 : 6, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests — please wait a moment and try again." }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const contentType = typeof body.contentType === "string" ? body.contentType : "";
  const size = typeof body.size === "number" ? body.size : NaN;
  if (!(ALLOWED_VIDEO as readonly string[]).includes(contentType)) {
    return NextResponse.json({ error: "Use an MP4, MOV or WebM video." }, { status: 400 });
  }
  if (!Number.isFinite(size) || size <= 0) return NextResponse.json({ error: "Missing file size" }, { status: 400 });
  if (size > MAX_VIDEO_BYTES) {
    return NextResponse.json({ error: "Video too large (max 25 MB) — trim it to a few seconds." }, { status: 400 });
  }

  // The key is built from the SERVER-VERIFIED user id and an allow-listed
  // extension — never from anything the client sent — so a signed URL can
  // only ever write into this user's own folder.
  const path = user
    ? `${user.id}/link-video-${Date.now()}.${EXT_BY_TYPE[contentType]}`
    : `guest/${randomUUID()}/link-video-${Date.now()}.${EXT_BY_TYPE[contentType]}`;
  const admin = getAdminSupabase();
  const { data, error } = await admin.storage.from("card-uploads").createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: error?.message || "Could not start the upload" }, { status: 500 });
  const { data: { publicUrl } } = admin.storage.from("card-uploads").getPublicUrl(path);
  return NextResponse.json({ signedUrl: data.signedUrl, token: data.token, path, url: publicUrl });
}
