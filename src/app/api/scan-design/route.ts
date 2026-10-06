import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";
import { aiVision, hasAiProvider } from "@/lib/ai";
import { isPaidPlan } from "@/lib/plan";
import { isRateLimited } from "@/lib/rate-limit";
import { SCAN_PROMPT, layoutFromScan } from "@/lib/custom-layout";
import { aiConsentBlock } from "@/lib/ai-consent-server";
import { prepareCardImage } from "@/lib/card-flatten";

// Photograph the printed card you already carry, and get it back as a starting
// point for the custom designer.
//
// Deliberately mirrors /api/scanner (the sibling route that reads OTHER people's
// cards into a contact): same auth, same Pro gate, same rate limit, same size
// bound. The difference is what comes back — this one reads the card's DESIGN
// rather than its contents.
//
// The model's answer is never trusted as structure. layoutFromScan validates
// every value against a whitelist and drops anything unrecognised, so the worst
// a bad or hostile reading can do is produce a plainer card.

const MAX_BASE64 = 10_000_000; // ~7MB of image; a card photo is far smaller
const ALLOWED_MEDIA = new Set(["image/jpeg", "image/png", "image/webp"]);

// Two vision reads now (find the card, then its layout) — room for both.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const userSupabase = await createClient();
  const { data: { user } } = await userSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Declining the AI notice has to actually stop the data leaving —
  // see lib/ai-consent-server.ts (App Review 5.1.1(i)/5.1.2(i)).
  const consentBlocked = await aiConsentBlock(user.id, request);
  if (consentBlocked) return consentBlocked;

  const adminSupabase = getAdminSupabase();
  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("plan")
    .eq("id", user.id)
    .single();

  // The custom designer is Pro, and this is a paid vision call on top of it.
  if (!isPaidPlan(profile?.plan)) {
    return NextResponse.json(
      {
        code: "SCAN_DESIGN_PRO_ONLY",
        error: "upgrade",
        message: "Rebuilding your printed card is a Pro feature.",
        upgrade: "/upgrade",
      },
      { status: 403 },
    );
  }

  // Pro gates WHO can scan, not how much — one paying account could otherwise
  // script this and run up AI spend without limit.
  if (await isRateLimited(`scan-design:${user.id}`, 40, 60 * 60 * 1000)) {
    return NextResponse.json(
      { error: "You're scanning very quickly — give it a minute and try again." },
      { status: 429 },
    );
  }

  let body: { imageBase64?: unknown; mediaType?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : "";
  if (!imageBase64) return NextResponse.json({ error: "no_image" }, { status: 400 });
  if (imageBase64.length > MAX_BASE64) {
    return NextResponse.json({ error: "image_too_large" }, { status: 413 });
  }
  // Take the declared type from a fixed set rather than echoing whatever the
  // client sent into the provider request.
  const mediaType = typeof body.mediaType === "string" && ALLOWED_MEDIA.has(body.mediaType)
    ? body.mediaType
    : "image/jpeg";

  if (!hasAiProvider()) return NextResponse.json({ error: "no_ai" }, { status: 503 });

  // A photo of a paper card is found and laid flat first (lib/card-flatten),
  // so the layout is measured on the card itself, not on a tilted shot of a
  // desk. A screenshot or a scan passes through untouched.
  const card = await prepareCardImage(imageBase64, mediaType);

  const text = (await aiVision({
    imageBase64: card.imageBase64,
    mediaType: card.mediaType,
    maxTokens: 700,
    json: true,
    prompt: SCAN_PROMPT,
  })) ?? "";

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return NextResponse.json({ error: "unreadable" }, { status: 422 });

  let reading: unknown;
  try {
    reading = JSON.parse(match[0]);
  } catch {
    return NextResponse.json({ error: "unreadable" }, { status: 422 });
  }
  if (!reading || typeof reading !== "object") {
    return NextResponse.json({ error: "unreadable" }, { status: 422 });
  }

  return NextResponse.json({ layout: layoutFromScan(reading) });
}
