import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { getOwnerUsernames } from "@/lib/owner-usernames";
import { buildCardData } from "@/lib/card-data";
import { isPaidPlan } from "@/lib/plan";

// The card exactly as its public page builds it, for ShareCardCapture on the
// two "Your card is live!" screens (the new-card wizard and /welcome).
//
// Those screens put a Share link button in front of someone seconds after the
// card exists, and nothing on them captured the card — the capture only ran on
// the dashboard and the editor. So the first link a person sent for a new card
// always unfurled as the server-drawn stand-in (owner, 2026-11-09: "the second
// i make a card and send it out the preview is always messed up"). Built here,
// from the saved row and the owner's CURRENT plan, the same way
// app/[username]/page.tsx builds it, so the capture is of the card a visitor
// sees — including after /welcome's Free choice flattened a Pro design.
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const username = (req.nextUrl.searchParams.get("username") ?? "").toLowerCase();
  if (!/^[a-z0-9-]{1,40}$/.test(username)) return NextResponse.json({ error: "bad username" }, { status: 400 });
  const owned = await getOwnerUsernames(user.id);
  if (!owned.includes(username)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const admin = getAdminSupabase();
  const { data: card } = await admin.from("cards").select("*").eq("username", username).maybeSingle();
  if (!card) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { data: owner } = await admin.from("profiles").select("plan, photo_url").eq("id", card.user_id).maybeSingle();
  const plan = (owner?.plan as string | null) ?? "free";
  const { data, template } = buildCardData({ ...card, plan } as Parameters<typeof buildCardData>[0], {
    appUrl: process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me",
    isPro: isPaidPlan(plan),
    accountPhotoUrl: (owner?.photo_url as string | null) ?? null,
  });
  return NextResponse.json({ data, template }, { headers: { "Cache-Control": "no-store" } });
}
