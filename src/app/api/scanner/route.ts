import { NextRequest, NextResponse } from "next/server";
import { deletedAccountResponse } from "@/lib/live-account";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";
import { aiVision, hasAiProvider } from "@/lib/ai";
import { isPaidPlan } from "@/lib/plan";
import { isRateLimited } from "@/lib/rate-limit";
import { aiConsentBlock } from "@/lib/ai-consent-server";

export async function POST(request: NextRequest) {
  const userSupabase = await createClient();
  const { data: { user } } = await userSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // A deleted account (its 30-day window) creates nothing (audit SEC-12).
  { const gone = await deletedAccountResponse(user.id); if (gone) return gone; }
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

  // The AI card scanner is a Pro feature — no free allowance (owner decision,
  // Jul 2026; it previously gave Free 3 scans/month). 403 rather than 402: this
  // isn't a meter that refills on the 1st, it's simply not on the Free plan.
  if (!isPaidPlan(profile?.plan)) {
    return NextResponse.json(
      { code: "SCANNER_PRO_ONLY", error: "upgrade", message: "Scanning business cards is a Pro feature. Upgrade to scan unlimited cards.", upgrade: "/upgrade" },
      { status: 403 }
    );
  }

  // Each scan is a paid vision call. Pro gates WHO can scan, not how much —
  // a single paying account could script this and run up AI spend without
  // limit. The sibling SMS route is capped for exactly this reason.
  if (await isRateLimited(`scanner:${user.id}`, 60, 60 * 60 * 1000)) {
    return NextResponse.json(
      { error: "You're scanning very quickly — give it a minute and try again." },
      { status: 429 },
    );
  }

  const body = await request.json();
  const { imageBase64, mediaType = "image/jpeg" } = body as { imageBase64?: string; mediaType?: string };
  if (!imageBase64) return NextResponse.json({ error: "no_image" }, { status: 400 });
  // Bound the image. base64 is ~4/3 of the raw bytes, so this is roughly a 7MB
  // photo — well past any real business card, and the difference between a
  // capped request and an arbitrarily large one billed by the token.
  if (imageBase64.length > 10_000_000) {
    return NextResponse.json({ error: "image_too_large" }, { status: 413 });
  }
  if (!hasAiProvider()) return NextResponse.json({ error: "no_ai" }, { status: 503 });

  const text = (await aiVision({
    imageBase64,
    mediaType,
    maxTokens: 256,
    json: true,
    prompt: 'Extract contact information from this business card. Return ONLY valid JSON with these exact fields (omit any field you cannot confidently read): {"name":"","title":"","company":"","phone":"","email":"","website":""}',
  })) ?? "";

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return NextResponse.json({});

  try {
    // Pro-only, and Pro is unlimited — nothing to meter or report.
    return NextResponse.json(JSON.parse(jsonMatch[0]));
  } catch {
    return NextResponse.json({});
  }
}
