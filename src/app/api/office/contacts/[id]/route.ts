import { NextRequest, NextResponse } from "next/server";
import { requireOfficeCapability } from "@/lib/office-roles";
import { getOfficeContactDetail } from "@/lib/office-contact-detail";

// GET /api/office/contacts/<id> → one contact, for the drawer on the admin
// console's Contacts tab: when and how they were added, whose they are, and
// the history between that teammate and them (lib/office-contact-detail).
//
// Authorization is view_org_analytics via requireOfficeCapability — the same
// capability the Contacts tab and /api/office/leads/list are gated on, which
// also re-checks that the office owner is still on a paid Office plan. The
// office is resolved from the session, never from the request, and a contact
// outside it is a plain 404: the same answer as one that doesn't exist.
//
// Not under /api/office/leads/[id]: that path belonged to the retired status
// setter, and tests/office-leads-capacity keeps it gone.
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { createClient } = await import("@/lib/supabase-server");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });

  const ctx = await requireOfficeCapability(user.id, "view_org_analytics");
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });

  try {
    const detail = await getOfficeContactDetail({
      officeId: ctx.officeId,
      ownerId: ctx.ownerId,
      viewerId: user.id,
      contactId: id,
    });
    if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    return NextResponse.json(detail, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "Couldn't load this contact. Please try again." }, { status: 500, headers: NO_STORE });
  }
}
