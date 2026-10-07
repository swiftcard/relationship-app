import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { seedDemoContact } from "@/lib/demo-contact";
import { isPaidProfile, PLAN_COLUMNS } from "@/lib/effective-plan";
import { redactPlaceLabel } from "@/lib/location-privacy";

export const runtime = "nodejs";

// POST /api/contacts/seed-demo  { cardOwner }
// Seeds the guided tour's sample contact ("Jordan Rivera") onto a card that has
// NONE — the tour's Contacts steps need a real contact to demonstrate. Normally
// this is seeded at first-card creation; this endpoint is the safety net for
// older accounts or when the user deleted the original demo contact and then
// (re)plays the tour. Idempotent: it only ever seeds when the card is empty.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const cardOwner = typeof body?.cardOwner === "string" ? body.cardOwner.trim() : "";
  if (!cardOwner) return NextResponse.json({ error: "missing_card" }, { status: 400 });

  const admin = getAdminSupabase();

  // The card must belong to this user — never seed onto someone else's card.
  const { data: card } = await admin
    .from("cards")
    .select("username")
    .eq("username", cardOwner)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!card) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // Idempotent: only seed when the card has zero contacts, so we never create a
  // duplicate "Jordan Rivera" for someone who already has (or kept) one.
  const { count } = await admin
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("card_owner", cardOwner);
  if ((count ?? 0) > 0) return NextResponse.json({ seeded: false });

  const contact = await seedDemoContact(cardOwner);
  // Same rule as the contacts page: a Free account is never handed a place
  // name, not even the sample contact's made-up one (2026-10-06).
  const { data: profile } = await admin.from("profiles").select(PLAN_COLUMNS).eq("id", user.id).maybeSingle();
  const safe = contact && !isPaidProfile(profile) && "location" in contact
    ? { ...contact, location: redactPlaceLabel((contact as { location?: string | null }).location) }
    : contact;
  return NextResponse.json({ seeded: !!contact, contact: safe });
}
