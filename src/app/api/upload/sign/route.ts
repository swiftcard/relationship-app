import { createClient } from "@/lib/supabase-server";
import { deletedAccountResponse } from "@/lib/live-account";
import { isRateLimited } from "@/lib/rate-limit";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { getOwnerUsernames } from "@/lib/owner-usernames";
import { isPaidProfile, PLAN_COLUMNS } from "@/lib/effective-plan";
import { SHARE_CAPTURE_VERSION, SIGNATURE_CAPTURE_VERSION } from "@/lib/share-capture-version";
import {
  EXT_BY_IMAGE_TYPE, MAX_IMAGE_UPLOAD_BYTES, isImageUploadField, isImageUploadType,
} from "@/lib/upload-rules";
import { NextResponse } from "next/server";

// ── Signed upload URLs: pictures go straight to storage ─────────────────────
//
// /api/upload, /api/card-share-image and /api/card-signature each receive the
// whole file in the request body. Every byte of that is billed as incoming
// transfer to a function (7.4 GB in the 30 days before the site was switched
// off, 2026-11). Here the function only answers "yes, you may write THIS
// object" with a signed URL; the browser then PUTs the file to storage itself.
//
// The three older routes are untouched and still work: the browser falls back
// to them whenever this road fails, and guests still use /api/upload (their
// files must be decoded on the server before they are kept, audit SEC-04).
//
// One route, three jobs, chosen by the body:
//   { target: "media", field, contentType, size }  a photo for a card or page
//   { target: "share" | "signature", username, v }  a card capture (PNG)
//   { commit: { path, field, card_id? } }           save an uploaded photo/logo
//                                                   to its account/card column
export const runtime = "nodejs";

const UPLOADS = "card-uploads";
const CAPTURE_BUCKET = { share: "card-shares", signature: "card-signatures" } as const;
const CAPTURE_VERSION = { share: SHARE_CAPTURE_VERSION, signature: SIGNATURE_CAPTURE_VERSION } as const;

const tooMany = () =>
  NextResponse.json({ error: "Too many requests — please wait a moment and try again." }, { status: 429 });

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Signed-in only. A guest's 401 sends the browser to /api/upload, which
  // decodes a guest's file before storing it.
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  { const gone = await deletedAccountResponse(user.id); if (gone) return gone; }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const admin = getAdminSupabase();

  // ── Save an uploaded photo/logo to its column ─────────────────────────────
  if (body.commit && typeof body.commit === "object") {
    if (await isRateLimited(`upload-commit:${user.id}`, 60, 10 * 60 * 1000)) return tooMany();
    const { path, field, card_id: cardId } = body.commit as { path?: unknown; field?: unknown; card_id?: unknown };
    if (field !== "photo" && field !== "logo") return NextResponse.json({ error: "Invalid field" }, { status: 400 });
    // Only an object this route signed for THIS user and THIS field: the
    // server-verified id, the field, a timestamp and an allow-listed extension.
    const m = typeof path === "string" ? /^([0-9a-f-]{36})\/((photo|logo)-\d{10,16}\.(jpg|png|webp|gif))$/.exec(path) : null;
    if (!m || m[1] !== user.id || m[3] !== field) return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    // …and it must really be there: a URL is never saved for a file that was
    // not uploaded.
    const { data: found } = await admin.storage.from(UPLOADS).list(user.id, { search: m[2], limit: 5 });
    if (!(found ?? []).some((f) => f.name === m[2])) return NextResponse.json({ error: "Upload not found" }, { status: 400 });
    const { data: { publicUrl } } = admin.storage.from(UPLOADS).getPublicUrl(path as string);

    // The same writes /api/upload makes, in the same order.
    if (field === "logo" && typeof cardId === "string" && cardId) {
      const { error } = await admin.from("cards").update({ logo_url: publicUrl }).eq("id", cardId).eq("user_id", user.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ url: publicUrl });
    }
    const column = field === "photo" ? "photo_url" : "logo_url";
    const { error } = await admin.from("profiles").update({ [column]: publicUrl }).eq("id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ url: publicUrl });
  }

  // Per account, not per connection: a whole office behind one address never
  // shares a counter. 60 in ten minutes is far above anyone designing a card
  // by hand (each picture picked is one), and far below a script.
  if (await isRateLimited(`upload-sign:${user.id}`, 60, 10 * 60 * 1000)) return tooMany();

  // ── A card capture: the share preview or the email signature ──────────────
  if (body.target === "share" || body.target === "signature") {
    const target = body.target;
    const { username, v } = body as { username?: unknown; v?: unknown };
    // A page loaded before a capture fix keeps drawing the old picture; its
    // upload is refused exactly as the older routes refuse it.
    if (typeof v !== "number" || v < CAPTURE_VERSION[target]) {
      return NextResponse.json({ error: "outdated capture" }, { status: 409 });
    }
    if (typeof username !== "string" || !/^[a-z0-9-]{1,40}$/i.test(username)) {
      return NextResponse.json({ error: "bad username" }, { status: 400 });
    }
    const owned = await getOwnerUsernames(user.id);
    if (!owned.includes(username)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const bucket = CAPTURE_BUCKET[target];
    const path = `${username}.png`;
    // upsert: the capture replaces the card's previous one at the same name.
    // The bucket itself only accepts image/png up to 10 MB.
    const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(path, { upsert: true });
    if (error || !data) return NextResponse.json({ error: error?.message || "Could not start the upload" }, { status: 500 });
    const { data: pub } = admin.storage.from(bucket).getPublicUrl(path);
    return NextResponse.json({ signedUrl: data.signedUrl, token: data.token, path, url: `${pub.publicUrl}?v=${Date.now()}` });
  }

  // ── A photo for a card, a link tile or a page ─────────────────────────────
  if (body.target !== "media") return NextResponse.json({ error: "Invalid target" }, { status: 400 });
  const { field, contentType, size } = body as { field?: unknown; contentType?: unknown; size?: unknown };
  // `field` and the extension both become part of the object key, so both are
  // allow-listed; nothing the browser typed reaches the path.
  if (!isImageUploadField(field)) return NextResponse.json({ error: "Invalid field" }, { status: 400 });
  if (!isImageUploadType(contentType)) return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
    return NextResponse.json({ error: "Missing file size" }, { status: 400 });
  }
  if (size > MAX_IMAGE_UPLOAD_BYTES) return NextResponse.json({ error: "File too large (max 5 MB)" }, { status: 400 });
  if (field === "create") {
    const { data: planRow } = await admin.from("profiles").select(PLAN_COLUMNS).eq("id", user.id).maybeSingle();
    if (!isPaidProfile(planRow)) return NextResponse.json({ error: "pro_required" }, { status: 403 });
  }

  const path = `${user.id}/${field}-${Date.now()}.${EXT_BY_IMAGE_TYPE[contentType]}`;
  const { data, error } = await admin.storage.from(UPLOADS).createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: error?.message || "Could not start the upload" }, { status: 500 });
  const { data: { publicUrl } } = admin.storage.from(UPLOADS).getPublicUrl(path);
  return NextResponse.json({ signedUrl: data.signedUrl, token: data.token, path, url: publicUrl });
}
