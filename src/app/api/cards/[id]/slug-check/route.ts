import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { slugAvailability } from "@/lib/username";

// GET /api/cards/[id]/slug-check?slug=…
// The card URL editor asks this while the owner types, so a URL that is
// already taken says so BEFORE they tap "Change URL" (owner, 2026-11-12).
// Same rules as the rename itself (lib/username.ts slugAvailability); the
// rename still checks on its own and stays the authority.
//
// Signed in, and only for a card that is yours: it answers "taken" or
// "available" and nothing else, and never for someone else's card.
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });

  const admin = getAdminSupabase();
  const { data: card, error: cardError } = await admin
    .from("cards")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (cardError) return NextResponse.json({ slug: "", status: "error" }, { headers: NO_STORE });
  if (!card) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });

  const raw = req.nextUrl.searchParams.get("slug") ?? "";
  const result = await slugAvailability(admin, raw, id);
  return NextResponse.json(result, { headers: NO_STORE });
}
