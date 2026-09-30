import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { requireOfficeCapability } from "@/lib/office-roles";
import { officeOwnsCard, isOwnersCard } from "@/lib/office-cards";
import { getOfficeBrand, overlayOfficeContact, overlayOfficeDesign, overlayOfficeLinks } from "@/lib/office-brand";
import { normalizeSocial } from "@/lib/social-url";
import { writeAudit } from "@/lib/audit";
import { cardContentChanged, signatureContentChanged } from "@/lib/card-changed";

// The office admin edits an employee's PERSONAL details and can take the card
// offline. Company-controlled fields (logo/company/website/office contact) and
// the locked look are deliberately NOT editable here — they're set once on the
// Branding page for the whole team.
const ALLOWED = ["name", "title", "phone", "email", "linkedin", "instagram", "twitter", "tiktok", "customization", "label"];
const SOCIAL_COLUMNS = ["linkedin", "instagram", "twitter", "tiktok"] as const;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = await requireOfficeCapability(user.id, "manage_member_cards");
  if (!ctx) return NextResponse.json({ error: "You don't have permission to manage team cards." }, { status: 403 });

  // Authorization gate: the card must belong to THIS office (owner or an active
  // member). Without this, any office admin could edit any card by id.
  if (!(await officeOwnsCard(ctx.officeId, id))) {
    return NextResponse.json({ error: "That card isn't part of your team." }, { status: 404 });
  }

  const admin = getAdminSupabase();

  // manage_member_cards means "any EMPLOYEE's card" — the office OWNER's own
  // card is exempt from a delegated (non-owner) admin's reach here. Without
  // this, officeOwnsCard's controlled-user set (which includes the owner)
  // would let a non-owner admin edit or take offline the owner's own card.
  if (!ctx.isOwner) {
    const { data: targetCard } = await admin.from("cards").select("user_id").eq("id", id).maybeSingle();
    if (isOwnersCard(ctx.ownerId, targetCard?.user_id as string | null | undefined)) {
      return NextResponse.json({ error: "Only the office owner can edit their own card." }, { status: 403 });
    }
  }

  const body = await req.json();
  const updates: Record<string, unknown> = {};

  for (const key of ALLOWED) {
    if (key in body) updates[key] = body[key];
  }
  for (const key of SOCIAL_COLUMNS) {
    if (key in updates) updates[key] = normalizeSocial(String(updates[key] ?? ""), key);
  }

  // Take offline / bring back online. Hides the public card without deleting it.
  const offlineChanged = typeof body.is_offline === "boolean";
  if (offlineChanged) updates.is_offline = body.is_offline;

  if (!Object.keys(updates).length) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  // Snapshot BEFORE the write. Two uses: merging customization (below), and
  // telling afterwards whether anything the card SHOWS actually changed.
  //
  // Every ON_CARD_SCALARS column must be listed. A column missing here reads as
  // undefined and makes an unchanged value look like an edit — the exact false
  // positive this snapshot exists to prevent. Written out literally because the
  // typed Supabase client cannot parse an interpolated select; a test asserts
  // this string stays in sync with ON_CARD_SCALARS.
  const { data: beforeCard } = await admin
    .from("cards")
    .select("username, user_id, customization, name, title, company, phone, email, website, linkedin, instagram, twitter, tiktok, template, logo_url, is_offline")
    .eq("id", id)
    .maybeSingle();

  // Merge customization onto the card's own existing blob so keys the admin's
  // form doesn't send (bio, links, testimonials, the employee's headshot) aren't
  // wiped. Server-owned "_"-prefixed keys never come from the client.
  if ("customization" in updates) {
    const existingCard = beforeCard;
    const incoming = { ...(updates.customization as Record<string, unknown>) };
    for (const k of Object.keys(incoming)) if (k.startsWith("_")) delete incoming[k];
    let merged: Record<string, unknown> = {
      ...((existingCard?.customization as Record<string, unknown> | null) ?? {}),
      ...incoming,
    };
    // Re-assert the office brand, exactly as the MEMBER's own save would. The
    // owner's own cards are exempt, as everywhere else (propagation skips
    // them): this said "the owner's included" and would have forced the
    // office contact and look onto the owner's card from here alone.
    if (beforeCard?.user_id && beforeCard.user_id !== ctx.ownerId) {
      const brand = await getOfficeBrand(ctx.officeId);
      if (brand) {
        if (brand.phone || brand.fax || brand.address) merged = overlayOfficeContact(merged, brand);
        merged = overlayOfficeDesign(merged, brand);
        // The company's pinned links lead a MEMBER's page whoever saves it — an
        // admin editing the card included (office audit 2026-09-16).
        merged = overlayOfficeLinks(merged, brand);
      }
    }
    updates.customization = merged;
  }

  // "Edit details → Phone" wrote only the top-level column, but a card with a
  // phones list (every card the wizard makes, and every office card, which
  // carries the company number) SHOWS the list — so the save succeeded and the
  // card kept the old number. Put the number where the card reads it: the
  // person's own first entry, never the company's office row.
  if ("phone" in updates && typeof updates.phone === "string") {
    const base = (updates.customization ?? beforeCard?.customization ?? {}) as Record<string, unknown>;
    if (Array.isArray(base.phones)) {
      const phones = [...(base.phones as Record<string, unknown>[])];
      const num = (updates.phone as string).trim();
      const own = phones.findIndex((p) => p && p.office !== true && String(p.label ?? "").toLowerCase() !== "office");
      if (own >= 0) {
        if (num) phones[own] = { ...phones[own], number: num };
        else phones.splice(own, 1);
      } else if (num) {
        const officeRows = phones.filter((p) => p?.office === true).length;
        phones.splice(officeRows, 0, { number: num, label: "mobile", showOnCard: true });
      }
      updates.customization = { ...base, phones };
    }
  }

  const { error } = await admin.from("cards").update(updates).eq("id", id);
  // Every other error on this route is a sentence written for the admin
  // ("That card isn't part of your team."). This one handed back Postgres's own
  // text, which OfficeCardActions then printed verbatim — an admin could be
  // shown a constraint name (audit 2026-09-29). The real message still reaches
  // the server log.
  if (error) {
    console.error("[office/cards] update failed", error.message);
    return NextResponse.json({ error: "Couldn't save that card. Please try again." }, { status: 500 });
  }

  // An office admin editing an employee's card leaves the same two cached
  // artifacts stale that the employee's own save invalidates: the share-preview
  // PNG (what iMessage/WhatsApp show for the card link) and the Swift Signature
  // image automated emails sign off with. This route updated the row and went
  // straight to the audit write, so an admin-side edit — a new company name, a
  // corrected title — left both surfaces showing the OLD card indefinitely.
  // Mirrors api/cards/[id]; best-effort, never blocks the save.
  // Compared against the pre-write snapshot, exactly as the employee's own save
  // does (lib/card-changed). This used to be `some(k => k !== "is_offline")` —
  // "a field was SUBMITTED", not "a value CHANGED" — so an admin opening an
  // employee's card and pressing Save without touching anything deleted both
  // cached PNGs and told that employee their card had changed. `label` is an
  // internal name and is deliberately not an on-card field, so renaming a card
  // no longer nags either.
  const contentChanged = !!beforeCard && cardContentChanged(beforeCard as Record<string, unknown>, updates);
  // The signature shows neither the links list nor internal customization
  // keys — those edits keep the share-preview refresh but must not delete the
  // signature or nag the employee (see lib/card-changed).
  const signatureChanged = !!beforeCard && signatureContentChanged(beforeCard as Record<string, unknown>, updates);
  if (contentChanged) {
    try {
      const uname = beforeCard?.username as string | undefined;
      const cardOwnerId = beforeCard?.user_id as string | null | undefined;
      if (uname) {
        admin.storage.from("card-shares").remove([`${uname}.png`]).then(() => {}, () => {});
        if (signatureChanged) {
          admin.storage.from("card-signatures").remove([`${uname}.png`]).then(() => {}, () => {});
        }
        // The reminder goes to the EMPLOYEE whose signature it is, not the admin
        // who made the edit. One unread reminder per card is enough.
        if (cardOwnerId && signatureChanged) {
          const { data: pending } = await admin
            .from("notifications")
            .select("id")
            .eq("user_id", cardOwnerId)
            .eq("type", "signature_stale")
            .eq("card_owner", uname)
            .eq("read", false)
            .limit(1);
          if (!pending?.length) {
            const { insertNotification } = await import("@/lib/notify");
            await insertNotification({
              user_id: cardOwnerId,
              card_owner: uname,
              type: "signature_stale",
              title: "Update your email signature",
              body: "Your team admin updated your card — re-copy your Swift Signature so the version in your email matches.",
            });
          }
        }
      }
    } catch { /* freshness is a nicety; the card save must still succeed */ }
  }

  // The public card page is cached (lib/card-page-data); without this a card
  // the admin took offline kept serving, and an edit showed old details, until
  // the cache expired. The member's own save already does this.
  if (beforeCard?.username && (contentChanged || offlineChanged)) {
    try {
      const { revalidateCardPage } = await import("@/lib/card-page-data");
      revalidateCardPage(beforeCard.username as string);
    } catch { /* best-effort */ }
  }

  // Tell the person when their admin switches their card off or on — a card
  // going dark with no word was indistinguishable from a bug, and Settings no
  // longer offers them a Bring-online button that the office card refuses.
  const ownerOfCard = beforeCard?.user_id as string | null | undefined;
  const wasOffline = (beforeCard as { is_offline?: boolean } | null)?.is_offline === true;
  if (offlineChanged && ownerOfCard && ownerOfCard !== user.id && wasOffline !== body.is_offline) {
    try {
      const { insertNotification } = await import("@/lib/notify");
      await insertNotification({
        user_id: ownerOfCard,
        card_owner: (beforeCard?.username as string | undefined) ?? undefined,
        type: body.is_offline ? "card_taken_offline" : "card_brought_online",
        title: body.is_offline ? "Your team admin took your card offline" : "Your card is back online",
        body: body.is_offline
          ? "Your card link, QR code and NFC taps show nothing for now. Ask your team admin if you need it turned back on."
          : "Your team admin turned your card back on — your link, QR code and NFC taps work again.",
      });
    } catch { /* a notice must never fail the change */ }
  }

  if (offlineChanged) {
    await writeAudit({
      action: body.is_offline ? "card.taken_offline" : "card.brought_online",
      actorId: user.id,
      orgId: ctx.officeId,
      targetId: id,
    });
  }

  return NextResponse.json({ ok: true });
}
