import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { aiComplete, hasAiProvider } from "@/lib/ai";
import { isRateLimited } from "@/lib/rate-limit";
import { aiConsentBlock } from "@/lib/ai-consent-server";
import { clientIp } from "@/lib/client-ip";
import { isShellRequest } from "@/lib/shell-request";
import { parseTidyBio, tidyBioPrompt } from "@/lib/linkedin-bio";

// POST /api/ai/tidy-bio { text } → { bio }
//
// "Use LinkedIn bio": shortens a LinkedIn About the person PASTED into a
// card-sized bio. Nothing is read from LinkedIn — LinkedIn doesn't share the
// About with apps (lib/linkedin-bio). Every refusal here is soft: the client
// falls back to tidyBioLocally, so a 403/429/503 never leaves the button dead.
//
// Callers mirror /api/design-generate: a signed-in account honours the AI
// notice; a visitor building a card before their account exists is capped per
// IP, and in the app (no stored consent to honour) never reaches the model.

const TEN_MIN = 10 * 60 * 1000;
const tooFast = () => NextResponse.json({ error: "too_fast" }, { status: 429 });

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const consentBlocked = await aiConsentBlock(user.id, req);
    if (consentBlocked) return consentBlocked;
    if (await isRateLimited(`tidy-bio:${user.id}`, 10, TEN_MIN)) return tooFast();
  } else {
    if (await isRateLimited(`tidy-bio:ip:${clientIp(req)}`, 10, TEN_MIN)) return tooFast();
    if (isShellRequest(req)) return NextResponse.json({ error: "no_ai" }, { status: 503 });
  }

  let text = "";
  try {
    const body = (await req.json()) as { text?: unknown };
    text = typeof body.text === "string" ? body.text.trim() : "";
  } catch { /* handled below */ }
  // Too little to shorten: the button only sends an About longer than a bio,
  // and on a scrap of text the model invents a bio instead of rewriting one.
  if (text.length < 120 || text.length > 3000) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  if (!hasAiProvider()) return NextResponse.json({ error: "no_ai" }, { status: 503 });
  const bio = parseTidyBio(await aiComplete(tidyBioPrompt(text), { maxTokens: 200, json: true }));
  if (!bio) return NextResponse.json({ error: "no_ai" }, { status: 503 });
  return NextResponse.json({ bio });
}
