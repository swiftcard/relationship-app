import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { getOwnerUsernames } from "@/lib/owner-usernames";
import { ownsLead } from "@/lib/lead-access";
import { contactCardUrl } from "@/lib/contact-links";
import { isRateLimited } from "@/lib/rate-limit";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

// ── This contact's own link to the owner's card ─────────────────────────────
//
// Owner, 2026-11-05: when a saved contact comes back to the card, every open
// and tap belongs in their Activity & Messages. A visitor is recognised only
// by evidence the owner earned — they shared from that browser, or opened a
// link made for THEM (lib/contact-links.ts) — and a contact the owner typed in
// or scanned has never shared from anywhere. So Share → Text / Email on the
// contact (components/ShareMyInfoButton) hands off this contact's personal
// link instead of the plain one: the browser they open it in is theirs from
// then on. The token leaves the address bar as soon as the page reads it
// (CardEventTracker), so a link they forward does not pass them along.
//
// Asked for when the owner opens Share, so the tap that opens Messages or
// Mail never waits on a request (iOS needs that navigation to ride on the
// tap). Any failure answers the plain link, which is exactly what was sent
// before this existed.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: leadId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const channel = body?.channel === "email" ? "email" : "sms";

  const admin = getAdminSupabase();
  const [{ data: lead }, usernames] = await Promise.all([
    admin.from("leads").select("id, card_owner, tags").eq("id", leadId).maybeSingle(),
    getOwnerUsernames(user.id),
  ]);
  if (!lead || !ownsLead(usernames, lead)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const plain = `${APP_URL}/${lead.card_owner}?shared=1`;
  // The sample contact is no one: it gets the plain link. So does an owner
  // opening Share over and over (a link row per open is cheap, not free).
  const sample = ((lead.tags as string[] | null) ?? []).includes("demo");
  if (sample || (await isRateLimited(`card-link:${user.id}`, 60, 10 * 60 * 1000))) {
    return NextResponse.json({ url: plain });
  }
  const url = await contactCardUrl(admin, { leadId: lead.id as string, cardSlug: lead.card_owner as string, channel, base: plain });
  return NextResponse.json({ url });
}
