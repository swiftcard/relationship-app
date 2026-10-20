import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { isLinkedInTicket, LINKEDIN_TICKET_FOLDER, readTicketObject, ticketPhotoPath } from "@/lib/linkedin-ticket";

export const runtime = "nodejs";

// GET /api/integrations/linkedin/photo?t=<ticket> → what the LinkedIn round
// trip left under this page's ticket (lib/linkedin-ticket):
//   { url }     the imported photo, ready to crop
//   { status }  "nophoto" | "error" — say so instead of waiting
//   { pending } nothing yet (still at LinkedIn, or abandoned)
//
// No session needed: the ticket is a random UUID only the page that made it
// knows, and the photo it points at is the visitor's own, already in the public
// bucket. Nothing here can be enumerated — a malformed ticket is refused before
// storage is asked anything.
export async function GET(request: Request) {
  const t = new URL(request.url).searchParams.get("t");
  if (!isLinkedInTicket(t)) return NextResponse.json({ error: "bad_ticket" }, { status: 400 });

  const headers = { "cache-control": "no-store" };
  const bucket = getAdminSupabase().storage.from("card-uploads");
  const { data, error } = await bucket.list(LINKEDIN_TICKET_FOLDER, { search: t, limit: 10 });
  if (error) {
    console.warn("[linkedin/photo] list failed:", error.message);
    return NextResponse.json({ pending: true }, { headers });
  }

  let status: string | null = null;
  for (const o of data ?? []) {
    const what = readTicketObject(t, o.name);
    if (!what) continue;
    // A photo always wins: a retry under the same ticket can follow a failure.
    if ("photo" in what) {
      const { data: { publicUrl } } = bucket.getPublicUrl(ticketPhotoPath(t));
      return NextResponse.json({ url: publicUrl }, { headers });
    }
    status = what.status;
  }
  if (status) return NextResponse.json({ status }, { headers });
  return NextResponse.json({ pending: true }, { headers });
}
