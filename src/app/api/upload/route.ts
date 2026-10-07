import { createClient } from "@/lib/supabase-server";
import { isRateLimited } from "@/lib/rate-limit";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { clientIpFromHeaders } from "@/lib/client-ip";
import { isPaidProfile, PLAN_COLUMNS } from "@/lib/effective-plan";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

// sharp (image resizing) needs the Node runtime.
export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Light throttle on the cheap delete path.
  if (await isRateLimited(`upload-delete:${user.id}`, 60, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests — please wait a moment and try again." }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const field = body.field as string | undefined; // "photo" or "logo"
  const cardId = body.card_id as string | undefined;

  // Clear a per-card logo.
  if (field === "logo" && cardId) {
    const admin = getAdminSupabase();
    const { error } = await admin.from("cards").update({ logo_url: null }).eq("id", cardId).eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // A card's own image (headshot, card background …) lives in that card's
  // customization, which the caller clears. Never the ACCOUNT's photo/logo on
  // a card's behalf — that blanked it on every other card (isolation audit
  // 2026-09-24).
  if (cardId) return NextResponse.json({ ok: true });

  // Clear the account-level photo or logo — only those two.
  if (field !== "photo" && field !== "logo") return NextResponse.json({ ok: true });
  const column = field === "photo" ? "photo_url" : "logo_url";
  const admin = getAdminSupabase();
  const { error } = await admin.from("profiles").update({ [column]: null }).eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // GUESTS may upload too (owner, 2026-09-17): someone building their first
  // card in "Get Started" or a homepage builder has no account yet, and a photo
  // or video behind the card was the one design step they could not try. A
  // guest upload is ALWAYS deferred (it writes no row — there is no row to
  // write), lands in its own random folder under guest/, and is throttled per
  // connection far tighter than a signed-in user.
  if (user) {
    // Per-user throttle on the EXPENSIVE path: sharp decode/resize/re-encode +
    // public-bucket write. Previously uncapped (cost/abuse guard).
    if (await isRateLimited(`upload:${user.id}`, 30, 10 * 60 * 1000)) {
      return NextResponse.json({ error: "Too many requests — please wait a moment and try again." }, { status: 429 });
    }
  } else if (await isRateLimited(`upload-guest:${clientIpFromHeaders(req.headers)}`, 15, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many uploads — please wait a moment and try again." }, { status: 429 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  const field = formData.get("field") as string | null; // see the allow-list below
  const cardId = formData.get("card_id") as string | null;
  const defer = formData.get("defer") as string | null; // "true" = just return the URL, write nothing

  if (!file || !field) return NextResponse.json({ error: "Missing file or field" }, { status: 400 });
  // `field` and the filename extension both flow into the storage object key, so
  // they must be strictly allow-listed — otherwise field="../<otherUserId>/photo"
  // (with upsert) could traverse out of this user's folder and overwrite another
  // user's file. Only these fields exist, and the extension is derived from
  // the re-encoded content-type below, never from the attacker's filename.
  // "hero" is the Swift Links header image (customization.linkHeroImage),
  // "link" a per-link tile photo (customization.links[i].media) and "pagebg"
  // the Swift Links page background (customization.linkBgMedia) — all three
  // ALWAYS deferred (the URL lives in customization, there is no column), so
  // the DB-write branches below never see them. Videos do NOT come through
  // here for a link tile or a page background: they exceed the request-body
  // limit and go straight to storage via /api/upload/link-video.
  // "create" is a picture for the Links page's Create + side (lib/create-link):
  // something the owner linked to their card, whose file name becomes its
  // share link's id. Pro and Office only, so never a guest's.
  if (field !== "photo" && field !== "logo" && field !== "hero" && field !== "link" && field !== "pagebg" && field !== "cardbg" && field !== "create") return NextResponse.json({ error: "Invalid field" }, { status: 400 });
  if (!ALLOWED.includes(file.type)) return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File too large (max 5 MB)" }, { status: 400 });
  if (field === "create") {
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data: planRow } = await getAdminSupabase().from("profiles").select(PLAN_COLUMNS).eq("id", user.id).maybeSingle();
    if (!isPaidProfile(planRow)) return NextResponse.json({ error: "pro_required" }, { status: 403 });
  }

  // Resize + compress at upload. Phone photos arrive at 3-5MB / 4000px+ — storing
  // originals made every card page, signature and share capture slow. 1000px is
  // ~3x the largest display size, so everything stays retina-sharp, never blurry.
  //   photo → JPEG (q85, EXIF-rotated)   logo → PNG (keeps transparency)
  //   gif  → passthrough (may be animated)
  const arrayBuffer = await file.arrayBuffer();
  let body: ArrayBuffer | Buffer = arrayBuffer;
  let contentType = file.type;
  // Extension is derived from the (validated) MIME type — NEVER from the
  // attacker-supplied filename, which could carry path separators or ".." and
  // corrupt the storage key. ALLOWED is already checked above.
  const EXT_BY_TYPE: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  };
  let ext = EXT_BY_TYPE[file.type] ?? "jpg";
  if (file.type === "image/gif") {
    // GIFs bypass the sharp re-encode (may be animated), so the declared type
    // is otherwise taken on faith — verify the magic bytes ("GIF87a"/"GIF89a")
    // before storing a client-declared image/gif in the public bucket.
    const head = Buffer.from(arrayBuffer.slice(0, 6)).toString("latin1");
    if (head !== "GIF87a" && head !== "GIF89a") {
      return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
    }
  }
  if (file.type !== "image/gif") {
    try {
      const sharp = (await import("sharp")).default;
      // hero fills the 430px-wide cover at up to 2x — 1200 keeps it sharp
      // without storing phone-camera originals.
      // A link tile is 1.91:1 at up to 430px wide × 2x — 1200 keeps it sharp.
      // "pagebg" gets more: it is cover-cropped over the WHOLE page, so its
      // long edge is stretched to the full scroll height (often 3-4x the
      // viewport) rather than to a tile. 1600 is the most the 5 MB cap will
      // carry at a sane JPEG quality.
      // "create" is shown up to 600px wide in an email (lib/create-link) and as
      // a 1200px link preview — 1600 keeps both sharp.
      const MAXDIM = field === "photo" ? 1000 : field === "pagebg" || field === "create" ? 1600 : field === "cardbg" ? 1400 : field === "hero" || field === "link" ? 1200 : 800;
      const img = sharp(Buffer.from(arrayBuffer)).rotate().resize(MAXDIM, MAXDIM, { fit: "inside", withoutEnlargement: true });
      // A linked picture keeps its look: transparency (a logo, a signature
      // snapshot) and crisp text stay PNG; photos become JPEG like the rest.
      const keepPng = field === "create" && (file.type === "image/png" || (await sharp(Buffer.from(arrayBuffer)).metadata()).hasAlpha === true);
      if (field === "logo" || keepPng) {
        body = await img.png({ compressionLevel: 9 }).toBuffer();
        contentType = "image/png";
        ext = "png";
      } else {
        body = await img.jpeg({ quality: 85 }).toBuffer();
        contentType = "image/jpeg";
        ext = "jpg";
      }
    } catch {
      // sharp failure → store the original rather than fail the upload.
      body = arrayBuffer;
      contentType = file.type;
    }
  }

  const path = user
    ? `${user.id}/${field}-${Date.now()}.${ext}`
    : `guest/${randomUUID()}/${field}-${Date.now()}.${ext}`;

  // Admin client (service role, bypasses RLS) — ownership is already enforced
  // here in application code: `path` is built from the SERVER-VERIFIED
  // `user.id`, never client input, so a user can only ever write into their
  // own folder. Matches every other write path in this app (cards, drafts,
  // profiles below) rather than relying on storage.objects RLS, which was
  // rejecting legitimate same-user uploads ("new row violates row-level
  // security policy") even though the path matched the user's own folder.
  const admin = getAdminSupabase();

  const { error: uploadError } = await admin.storage
    .from("card-uploads")
    .upload(path, body, { contentType, upsert: true });

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const { data: { publicUrl } } = admin.storage
    .from("card-uploads")
    .getPublicUrl(path);

  // Deferred upload (e.g. while creating a card that doesn't exist yet): just return
  // the URL so the caller can persist it when the row is created.
  if (defer === "true" || !user) {
    return NextResponse.json({ url: publicUrl });
  }

  // These three have no DB column — the URL is persisted by the caller inside
  // customization (linkHeroImage / links[i].media / linkBgMedia). Returned
  // here unconditionally so a caller that forgets defer=true can never fall
  // through and clobber logo_url.
  if (field === "hero" || field === "link" || field === "pagebg" || field === "create") {
    return NextResponse.json({ url: publicUrl });
  }

  // If field is "logo" and card_id is provided, save to cards table instead
  if (field === "logo" && cardId) {
    const { error: cardUpdateError } = await admin
      .from("cards")
      .update({ logo_url: publicUrl })
      .eq("id", cardId)
      .eq("user_id", user.id);
    if (cardUpdateError) return NextResponse.json({ error: cardUpdateError.message }, { status: 500 });
    return NextResponse.json({ url: publicUrl });
  }

  // Only "photo" and "logo" have an ACCOUNT column. Anything else (cardbg, a
  // future field) used to fall through to logo_url and replace the account's
  // logo on every card (isolation audit 2026-09-24).
  if (field !== "photo" && field !== "logo") return NextResponse.json({ url: publicUrl });
  const column = field === "photo" ? "photo_url" : "logo_url";
  const { error: updateError } = await admin
    .from("profiles")
    .update({ [column]: publicUrl })
    .eq("id", user.id);

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json({ url: publicUrl });
}
