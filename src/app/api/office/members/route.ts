import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { getOfficeBrand, stripBrandFromUserCards, memberFallbackPlan } from "@/lib/office-brand";
import { keepContactsWithOffice, slugsHeldBy } from "@/lib/office-departure";
import { reportError } from "@/lib/report-error";
import { writeAudit } from "@/lib/audit";
import { requireOfficeCapability } from "@/lib/office-roles";
import { insertNotification } from "@/lib/notify";
import { officeRemovedMessage } from "@/lib/office-billing-sync";
import { PLAN_CHOSEN_KEY } from "@/lib/welcome-email";
import { NextResponse } from "next/server";

// DELETE ?id=<member_id> — remove an active member, OR revoke a pending invite.
// A pending invite is REVOKED (status → 'revoked') rather than hard-deleted, so
// the action is tracked and its reserved seat is released. An active member is
// fully removed (plan reverted, office brand stripped) — that path is unchanged.
export async function DELETE(req: Request) {
  const supabaseUser = await createClient();
  const { data: { user } } = await supabaseUser.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const memberId = searchParams.get("id");
  if (!memberId) return NextResponse.json({ error: "Member ID required" }, { status: 400 });

  // Server-side authorization: caller must have remove_members in an office.
  const ctx = await requireOfficeCapability(user.id, "remove_members");
  if (!ctx) return NextResponse.json({ error: "You don't have permission to remove members." }, { status: 403 });

  const supabase = getAdminSupabase();
  const office = { id: ctx.officeId };

  const { data: member } = await supabase
    .from("office_members")
    .select("user_id, status, invite_email")
    .eq("id", memberId)
    .eq("office_id", office.id)
    .single();

  if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  // Pending invite → revoke (tracked, seat released) instead of hard delete.
  if (member.status === "pending") {
    const { error } = await supabase
      .from("office_members")
      .update({ status: "revoked" })
      .eq("id", memberId)
      .eq("office_id", office.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await writeAudit({ action: "invite.revoked", actorId: user.id, orgId: office.id as string, targetId: (member.invite_email as string) ?? memberId });
    return NextResponse.json({ ok: true, revoked: true });
  }

  // The card addresses they held when they left, recorded with the removal so
  // the console can still date their stint after a card is renamed or deleted
  // (lib/office-contact-detail: history stops at the removal).
  let removedSlugs: string[] = [];

  // Active member → full removal (revert plan, de-brand, delete row).
  if (member?.user_id) {
    // Keep the contacts they captured visible to the office AFTER their slugs
    // drop out of the team set — the removal dialog promises "the contacts they
    // captured stay with your company", and without this stamp they'd silently
    // vanish from the Contacts tab the moment the row below is deleted. Stamps
    // EVERY contact on their cards; this used to stop at the first 1,000
    // (lib/office-departure). Only contacts that exist NOW: anything they
    // capture after leaving is theirs alone. Its own try, so a failure here is
    // reported and never stops the rest of the removal.
    try {
      removedSlugs = await slugsHeldBy(member.user_id as string);
      const kept = await keepContactsWithOffice(office.id as string, member.user_id as string, removedSlugs);
      if (kept.missed) {
        await reportError("office.remove-contacts-missed", new Error(`${kept.missed} contacts not stamped`), { officeId: office.id, userId: member.user_id }).catch(() => {});
      }
    } catch (e) {
      await reportError("office.remove-contacts-failed", e, { officeId: office.id, userId: member.user_id }).catch(() => {});
    }
    try {
      const { data: memberCards } = await supabase.from("cards").select("id").eq("user_id", member.user_id);
      // "Their cards will be turned off": the office paid for and branded these
      // cards, so they stop serving on removal.
      //
      // Scoped to is_office_card. This used to update every card the user owned,
      // which reached cards that were never part of the office at all.
      //
      // Then UNFLAG. Joining sets is_office_card on all of the member's cards
      // (join/route.ts), and that flag was previously never cleared anywhere —
      // so a card stayed marked as office property forever after the person
      // left. Clearing it here is what the join comment already claims happens
      // ("leaving is what un-flags/strips them"), and it is what hands the card
      // back to its owner: PATCH /api/cards/[id] lets an owner bring a card of
      // their own back online, but deliberately refuses while it is still an
      // office card, so an active employee can never override their admin.
      //
      // Without that handoff this removal was terminal: the flag stayed set,
      // office_id is nulled two statements below, the membership row is deleted,
      // and the office admin loses all reach — leaving the ex-member's card page,
      // QR, NFC and wallet pass dark with no in-app way back for anyone but us.
      if (memberCards?.length) {
        await supabase.from("cards").update({ is_offline: true }).eq("user_id", member.user_id).eq("is_office_card", true);
        // De-brand BEFORE the unflag: stripBrandFromUserCards only touches
        // is_office_card rows, so run after it (as it used to be) it matched
        // nothing — the ex-member kept the company logo, name, website,
        // contact details, the company bio/Instagram (their own never came
        // back) and pinned links they could never delete. The webhook
        // cascades already strip first and unflag second.
        try {
          const brand = await getOfficeBrand(office.id);
          await stripBrandFromUserCards(member.user_id, brand);
        } catch { /* best-effort */ }
        await supabase.from("cards").update({ is_office_card: false }).eq("user_id", member.user_id);
      }
    } catch { /* best-effort — removal itself must never be blocked */ }

    // A member who still pays for their OWN subscription goes back to Pro, not
    // free — removal from a team must not clobber a plan they're paying for.
    const plan = await memberFallbackPlan(member.user_id);
    // Their plan is settled (it is whatever they pay for themselves), so a
    // newer account is not held behind the plan step: without the marker
    // lib/card-active rule 5 kept their card dark and /dashboard sent them to
    // /welcome to choose — as if they had just signed up.
    const { data: memberProf } = await supabase.from("profiles").select("customization").eq("id", member.user_id).maybeSingle();
    const memberCust = (memberProf?.customization as Record<string, unknown> | null) ?? {};
    await supabase
      .from("profiles")
      .update({
        plan,
        office_id: null,
        ...(memberCust[PLAN_CHOSEN_KEY] ? {} : { customization: { ...memberCust, [PLAN_CHOSEN_KEY]: plan } }),
      })
      .eq("id", member.user_id);
    // Best-effort, separate like the webhook paths (column may not exist in
    // older schemas — must never block the critical plan revert above).
    await supabase.from("profiles").update({ plan_expires_at: null }).eq("id", member.user_id);
    // Tell them. Every AUTOMATED way off a team says so in the bell
    // (office_seat_trimmed, office_subscription_ended, office_plan_downgraded);
    // an admin pressing Remove was the one path that said nothing — the
    // person's card, QR, NFC tag and wallet pass went dark in silence (2026-09-23
    // audit). Same type and words as the teardown cascade, bell only.
    await insertNotification({
      user_id: member.user_id,
      type: "office_plan_downgraded",
      title: "Your Office access ended",
      body: officeRemovedMessage(plan),
    }).catch(() => {});
  }

  const { error } = await supabase
    .from("office_members")
    .delete()
    .eq("id", memberId)
    .eq("office_id", office.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await writeAudit({ action: "member.removed", actorId: user.id, orgId: office.id as string, targetId: (member.user_id as string) ?? memberId, metadata: { slugs: removedSlugs } });
  return NextResponse.json({ ok: true });
}
