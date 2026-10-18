import { NextRequest, NextResponse } from "next/server";
import { uploadToPublicBucket } from "@/lib/public-bucket";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { getOwnerUsernames } from "@/lib/owner-usernames";
import { SIGNATURE_CAPTURE_VERSION } from "@/lib/share-capture-version";

const BUCKET = "card-signatures";

// Stores a client-rendered PNG of ONE of the user's cards so it can be hot-linked
// from an email signature (a public, stable URL). One image per card username.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { dataUrl, username, v } = (await req.json().catch(() => ({}))) as { dataUrl?: string; username?: string; v?: number };
  // Only the capture code that verifies its pixels may replace the image every
  // sent email points at (lib/share-capture-version, audit C02-002).
  if (typeof v !== "number" || v < SIGNATURE_CAPTURE_VERSION) {
    return NextResponse.json({ error: "outdated capture" }, { status: 409 });
  }
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,")) {
    return NextResponse.json({ error: "bad image" }, { status: 400 });
  }
  if (typeof username !== "string" || !/^[a-z0-9-]{1,40}$/i.test(username)) {
    return NextResponse.json({ error: "bad username" }, { status: 400 });
  }
  // The card must belong to this user.
  const owned = await getOwnerUsernames(user.id);
  if (!owned.includes(username)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const buffer = Buffer.from(dataUrl.split(",")[1], "base64");
  if (buffer.length > 12_000_000) return NextResponse.json({ error: "too large" }, { status: 413 });

  // A real PNG of a card, as the share preview demands: anything else means
  // the capture failed mid-layout, and storing it would put a wrong picture
  // in every email already sent (audit C02-002).
  if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) {
    return NextResponse.json({ error: "not a png" }, { status: 400 });
  }
  const pngW = buffer.readUInt32BE(16);
  const ratio = pngW / Math.max(1, buffer.readUInt32BE(20));
  if (pngW < 300 || ratio < 1.25 || ratio > 2.4) {
    return NextResponse.json({ error: "not card-shaped" }, { status: 400 });
  }

  const admin = getAdminSupabase();
  // Created only if missing (lib/public-bucket, audit C02-001).
  const path = `${username}.png`;
  const { error } = await uploadToPublicBucket(admin, BUCKET, path, buffer, {
    contentType: "image/png",
    upsert: true,
    cacheControl: "60",
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({ url: `${pub.publicUrl}?v=${Date.now()}` });
}
