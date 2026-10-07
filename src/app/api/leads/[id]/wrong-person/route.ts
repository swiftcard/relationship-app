import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { getOwnerUsernames } from "@/lib/owner-usernames";
import { ownsLead } from "@/lib/lead-access";
import { VIEW_VISIT_WINDOW_MS } from "@/lib/view-window";
import { syncPhoneBadgeAfter } from "@/lib/app-badge-sync";

// "Wrong person?" on a named alert (warm-lead plan §2.1 step 5).
//
// The owner says the visit we named wasn't this contact. Every browser that
// was stamped with this contact during that visit is unbound from them
// (contact_devices.wrong_at), so it is anonymous from now on, and the alert
// is removed. The binding row is kept, marked, because the number of these
// marks per named alert is THE trust metric for the whole feature — target
// under 2% (docs/plans/warm-lead-alerts.md §2.9).
//
// A later form submission from that browser clears the mark: the person
// telling us who they are outranks an earlier guess (lib/known-contact.ts).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: leadId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const notificationId = typeof body?.notificationId === "string" ? body.notificationId : null;
  if (!notificationId) return NextResponse.json({ error: "notificationId required" }, { status: 400 });

  const admin = getAdminSupabase();
  const [{ data: lead }, usernames, { data: note }] = await Promise.all([
    admin.from("leads").select("id, card_owner").eq("id", leadId).maybeSingle(),
    getOwnerUsernames(user.id),
    admin.from("notifications").select("id, user_id, lead_id, created_at").eq("id", notificationId).maybeSingle(),
  ]);
  if (!lead || !ownsLead(usernames, lead) || !note || note.user_id !== user.id || note.lead_id !== leadId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // The browsers stamped with this contact during that visit. An upgrade
  // moves the row's created_at to the visit's latest event, so the window
  // runs one visit back from it.
  const at = Date.parse(note.created_at as string);
  const { data: events } = await admin
    .from("card_events")
    .select("visitor_id")
    .eq("lead_id", leadId)
    .in("card_owner_username", usernames)
    .gte("created_at", new Date(at - VIEW_VISIT_WINDOW_MS).toISOString())
    .lte("created_at", new Date(at + 60_000).toISOString());
  const visitorIds = [...new Set((events ?? []).map((e) => e.visitor_id as string).filter(Boolean))];

  if (visitorIds.length) {
    await admin
      .from("contact_devices")
      .update({ wrong_at: new Date().toISOString() })
      .eq("lead_id", leadId)
      .in("visitor_id", visitorIds)
      .is("wrong_at", null);
    // Those events were about someone else: take the contact off them, so the
    // contact's history and score stop counting them.
    await admin.from("card_events").update({ lead_id: null, lead_confidence: null })
      .eq("lead_id", leadId).in("visitor_id", visitorIds)
      .gte("created_at", new Date(at - VIEW_VISIT_WINDOW_MS).toISOString());
    await admin.from("card_views").update({ lead_id: null })
      .eq("lead_id", leadId).in("visitor_id", visitorIds)
      .gte("viewed_at", new Date(at - VIEW_VISIT_WINDOW_MS).toISOString());
  }
  await admin.from("notifications").delete().eq("id", notificationId).eq("user_id", user.id);
  // The alert leaves the bell, so its count leaves the iPhone icon too.
  syncPhoneBadgeAfter(req, user.id);

  return NextResponse.json({ unbound: visitorIds.length });
}
