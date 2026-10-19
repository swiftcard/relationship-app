import { contactFieldProblem } from "@/lib/contact-limits";
import { NextRequest, NextResponse, after } from "next/server";
import { deletedAccountResponse } from "@/lib/live-account";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { PLAN_LIMITS } from "@/lib/plan";
import { isPaidProfile, PLAN_COLUMNS } from "@/lib/effective-plan";
import { readUsage, bumpUsage } from "@/lib/usage";
import { getSourceLabel } from "@/lib/source-labels";
import { syncLeadToAllCrms, sendLeadToZapier } from "@/lib/crm-sync";
import { activeEvent } from "@/lib/event-tag";

// The CRM fan-out below runs in after() — give it the same room as capture.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // A deleted account (its 30-day window) creates nothing (audit SEC-12).
  { const gone = await deletedAccountResponse(user.id); if (gone) return gone; }

  const admin = getAdminSupabase();
  const { data: profile } = await admin.from("profiles").select(`username, ${PLAN_COLUMNS}`).eq("id", user.id).single();
  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const body = await req.json();
  // Text, and within lib/contact-limits, before anything is read from it: a
  // non-text name threw on .trim() — an uncaught 500 (audit F-CONTACTS-05).
  const tooBig = contactFieldProblem(body);
  if (tooBig) return NextResponse.json({ error: tooBig, message: tooBig }, { status: 400 });
  const { name, email, phone, company, notes, where_met, card_owner: requestedOwner } = body;
  if (!name?.trim()) return NextResponse.json({ error: "Name is required." }, { status: 400 });

  // "At an event?" covers EVERY contact added while it is on (owner,
  // 2026-09-19), not only the ones who fill in the card's form — this route is
  // also where a hand-typed contact and a scanned paper card land, and at a
  // conference those are the same event. What the owner TYPED always wins: the
  // tag only fills a blank "Where you met".
  const eventTag = activeEvent(profile.customization);
  const metAt = where_met?.trim() || eventTag?.label || null;

  // Attach the contact to the card the user currently has selected (validated to
  // belong to them), so it shows up in that card's scoped view. Falls back to the
  // profile's primary card if no/invalid card was passed.
  const { data: ownCards } = await admin.from("cards").select("id, username, name").eq("user_id", user.id);
  const ownUsernames = (ownCards ?? []).map((c) => c.username);
  const finalOwner =
    typeof requestedOwner === "string" && ownUsernames.includes(requestedOwner)
      ? requestedOwner
      : profile.username;

  // Manual adds count against the same monthly free-lead meter (5/month, on the
  // account so it survives card deletion). A deliberate owner action, so we hard-
  // block at the cap with an upgrade prompt rather than silently locking.
  const paid = isPaidProfile(profile); // an expired grant is Free here too (audit I-06)
  if (!paid && readUsage(profile.customization).leads >= PLAN_LIMITS.FREE_LEADS_PER_MONTH) {
    return NextResponse.json(
      {
        // Machine code for the native app (platform-agnostic). Additive only —
        // web keeps using message/error/upgrade byte-for-byte.
        code: "LEAD_LIMIT_REACHED",
        error: "limit",
        message: `You've captured your ${PLAN_LIMITS.FREE_LEADS_PER_MONTH} free leads this month. Upgrade to Pro to add unlimited contacts.`,
        upgrade: "/upgrade",
      },
      { status: 402 }
    );
  }

  const { data, error } = await admin
    .from("leads")
    .insert({
      name: name.trim(),
      email: email?.trim() || null,
      phone: phone?.trim() || null,
      company: company?.trim() || null,
      notes: notes?.trim() || null,
      where_met: metAt,
      card_owner: finalOwner,
      source: "manual",
      status: "new_contact",
    })
    .select()
    .single();

  // Not the database's own words, which can quote the value that failed
  // (audit F-CONTACTS-05): reported for us, a plain sentence for them.
  if (error) {
    console.error("[leads/manual] insert failed:", error.code ?? "", error.message);
    return NextResponse.json({ error: "Couldn't add that contact — please try again." }, { status: 500 });
  }
  if (!paid) await bumpUsage(admin, user.id, profile.customization as Record<string, unknown> | null, "leads");

  // ── To the CRM, like every other new contact ──────────────────────────────
  // "Add contact" is also where a scanned paper business card lands, and that
  // is the most CRM-bound contact there is: someone met at a trade show. This
  // route used to save it in SwiftCard only, so the one lead a salesperson
  // most expected to find in Salesforce never arrived. Same paid gate, same
  // after() semantics and same destinations as the public share form.
  if (paid) {
    const card = (ownCards ?? []).find((c) => c.username === finalOwner);
    const leadData = {
      name: name.trim(),
      email: email?.trim() || null,
      phone: phone?.trim() || null,
      company: company?.trim() || null,
      notes: notes?.trim() || null,
      whereMet: metAt,
      source: getSourceLabel("manual"),
      capturedByCard: finalOwner as string,
      capturedByName: (card?.name as string | null) ?? null,
      capturedByCardId: (card?.id as string | undefined) ?? null,
      leadId: (data?.id as string | undefined) ?? null,
    };
    after(
      Promise.allSettled([
        syncLeadToAllCrms(leadData, user.id),
        sendLeadToZapier(leadData, user.id),
      ]),
    );
  }

  return NextResponse.json({ lead: data });
}
