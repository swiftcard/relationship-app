import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { aiVision, hasAiProvider } from "@/lib/ai";
import { isRateLimited } from "@/lib/rate-limit";
import { aiConsentBlock } from "@/lib/ai-consent-server";
import { clientIp } from "@/lib/client-ip";

// POST /api/profile-import — read a screenshot of the person's OWN profile
// page (LinkedIn, a company site, an email signature…) and return the fields
// the card builder asks for. This is how a new user fills in their card
// without typing it: LinkedIn's own API hands over only a name, an email and
// a photo (title and company are behind its partner programme), and reading a
// profile from a pasted link would be scraping. A screenshot is the person's
// own data, given deliberately.
//
// Open to Free accounts and to guests in the builder — it is an activation
// step, not a lead-capture feature like /api/scanner (Pro). Guests are
// rate-limited by IP, accounts by id; signed-in users pass the same AI
// consent gate every AI call does (App Review 5.1.1(i)/5.1.2(i)).

export type ImportedProfile = {
  name?: string;
  title?: string;
  company?: string;
  city?: string;
  state?: string;
  website?: string;
};

const FIELDS: (keyof ImportedProfile)[] = ["name", "title", "company", "city", "state", "website"];

export async function POST(request: NextRequest) {
  const userSupabase = await createClient();
  const { data: { user } } = await userSupabase.auth.getUser();

  if (user) {
    const consentBlocked = await aiConsentBlock(user.id, request);
    if (consentBlocked) return consentBlocked;
  }

  const key = user ? `profile-import:${user.id}` : `profile-import:ip:${clientIp(request)}`;
  if (await isRateLimited(key, 12, 60 * 60 * 1000)) {
    return NextResponse.json(
      { error: "rate_limited", message: "That's a lot of imports in a row — give it a few minutes and try again." },
      { status: 429 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { imageBase64?: string; mediaType?: string };
  const { imageBase64, mediaType = "image/jpeg" } = body;
  if (!imageBase64) return NextResponse.json({ error: "no_image", message: "Pick a screenshot first." }, { status: 400 });
  if (imageBase64.length > 10_000_000) {
    return NextResponse.json({ error: "image_too_large", message: "That image is too large — a plain screenshot is enough." }, { status: 413 });
  }
  if (!hasAiProvider()) return NextResponse.json({ error: "no_ai", message: "Import isn't available right now — please type the details in." }, { status: 503 });

  const text = (await aiVision({
    imageBase64,
    mediaType,
    maxTokens: 300,
    json: true,
    prompt:
      "This is a screenshot of one person's professional profile page (LinkedIn or similar). Extract THAT person's own details — the profile being viewed, never the viewer's account, people in a sidebar, or ads. " +
      'Return ONLY valid JSON with these exact fields, omitting any you cannot confidently read: {"name":"","title":"","company":"","city":"","state":"","website":""}. ' +
      '"name" is their full name without pronouns, degrees or emoji. "title" is their current job title only (not the whole headline; if the headline is a slogan, take the title from the current position). "company" is their current employer. "city" and "state" come from the location line; "state" is the 2-letter US code when in the US, otherwise the region. "website" only if a personal or company website is shown.',
  })) ?? "";

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return NextResponse.json({});
  try {
    const raw = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const out: ImportedProfile = {};
    for (const f of FIELDS) {
      const v = raw[f];
      if (typeof v === "string") {
        const clean = v.replace(/\s+/g, " ").trim().slice(0, 120);
        if (clean) out[f] = clean;
      }
    }
    return NextResponse.json(out);
  } catch {
    return NextResponse.json({});
  }
}
