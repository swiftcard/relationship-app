import { NextRequest, NextResponse } from "next/server";
import { revalidateCardPage } from "@/lib/card-page-data";
import { releaseSlugArtifacts, prevSlugsOf } from "@/lib/release-slug";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { isPaidPlan, sanitizeCustomizationForPlan } from "@/lib/plan";
import { freeLiveCardIds } from "@/lib/card-active";
import { getMemberBrandForUser, overlayOfficeContact, overlayOfficeDesign, findManagedFieldViolations, overlayOfficeLinks, overlayOfficeInstagram } from "@/lib/office-brand";
import { normalizeSocial } from "@/lib/social-url";
import { getOfficeSubUserContext } from "@/lib/office-roles";
import { cardContentChanged, signatureContentChanged } from "@/lib/card-changed";
import { clampCardWrite } from "@/lib/card-limits";

const ALLOWED = ["name", "title", "company", "phone", "email", "website", "linkedin", "instagram", "twitter", "tiktok", "template", "customization", "logo_url", "label"];
const SOCIAL_COLUMNS = ["linkedin", "instagram", "twitter", "tiktok"] as const;

// What counts as a real card edit — which fields are printed ON the card, and
// therefore baked into the Swift Signature snapshot — lives in lib/card-changed,
// shared with the office-admin save route so the two can't disagree. ("label" is
// the dashboard nickname and is deliberately not one of them.)

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const updates: Record<string, unknown> = {};
  for (const key of ALLOWED) {
    if (key in body) updates[key] = body[key];
  }

  // Bring-back-online is the ONE offline transition an owner may make, and only
  // on a card that is not currently an office card.
  //
  // is_offline is an office-admin/staff switch (see office-primary-card.sql:
  // "reversible"), and it stays that way — this deliberately accepts only
  // `false`, so nobody can take a card dark through here, and it is refused
  // outright on an office card so an active employee can never undo their
  // admin. What it does fix: removal from a team took the member's cards
  // offline and then destroyed every relationship that could turn them back on
  // (office_id nulled, membership deleted), so the card was dark permanently.
  // Removal now unflags the cards, which makes them eligible here.
  const wantsOnline = body.is_offline === false;
  // Server-side normalize (backstop for older/other clients): stored social
  // values must always build a working profile URL. See lib/social-url.ts.
  for (const key of SOCIAL_COLUMNS) {
    if (key in updates) updates[key] = normalizeSocial(String(updates[key] ?? ""), key);
  }

  const admin = getAdminSupabase();

  // Handled up front, ahead of the plan gating below, and on purpose: removal
  // from a team also drops the member to Free, and on Free every card past the
  // first is view-only — so routing this through the normal edit path would
  // have 403'd exactly the person who needs it. Restoring a card's visibility
  // is not editing its content, so it is not gated on the plan.
  if (wantsOnline) {
    const { data: target } = await admin
      .from("cards")
      .select("is_office_card")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (target.is_office_card === true) {
      return NextResponse.json(
        { error: "Your company manages this card. Ask your Office admin to bring it back online." },
        { status: 403 }
      );
    }
    await admin.from("cards").update({ is_offline: false }).eq("id", id).eq("user_id", user.id);
    if (!Object.keys(updates).length) return NextResponse.json({ ok: true, online: true });
  }

  // Snapshot the card's on-card fields BEFORE the write, so after saving we can
  // tell whether anything the Swift Signature SHOWS actually changed and, if so,
  // nudge the owner to re-copy their email signature (it's a snapshot image, so
  // an edit leaves the pasted signature stale). A no-op save must never nag.
  const { data: beforeCard } = await admin
    .from("cards")
    .select("username, name, title, company, phone, email, website, linkedin, instagram, twitter, tiktok, template, logo_url, customization")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  // Enforce Pro-only features on the backend: custom template, Pro-only design
  // keys (accent/font), and the link-button cap — all stripped for non-paid.
  const { data: planRow } = await admin.from("profiles").select("plan, customization").eq("id", user.id).single();

  // A soft-deleted account's access token stays valid for its remaining
  // lifetime (signOut only revokes the refresh token) — block writes here too.
  if ((planRow?.customization as Record<string, unknown> | null)?._deleted === true) {
    return NextResponse.json({ error: "This account has been deleted." }, { status: 403 });
  }

  if (!isPaidPlan(planRow?.plan)) {
    // Grandfathering: a downgraded user keeps every card, but only the live
    // one(s) stay editable — the card they chose to keep when Pro ended, else
    // the oldest (lib/card-active). Extras are view-only and offline publicly.
    const editable = await freeLiveCardIds(user.id);
    if (!editable.includes(id)) {
      return NextResponse.json(
        { code: "CARD_VIEW_ONLY", error: "view_only", message: "This card is view-only on Free. Upgrade to Pro to edit all your cards.", upgrade: "/upgrade" },
        { status: 403 }
      );
    }
    if (updates.template === "custom") updates.template = "classic-pro";
  }

  // Resolved once, used by the merge below AND the branding section: is the
  // caller an office SUB-USER (active member, not the owner)?
  const subCtx = await getOfficeSubUserContext(user.id);

  // Merge the incoming customization onto THIS card's existing customization
  // (same card, ownership-scoped) rather than replacing the whole JSON. The form
  // only sends the keys it manages, so without this a key it doesn't send (e.g.
  // testimonials, or any future field) would be silently wiped on save. Merging
  // the card's OWN data can never introduce cross-card bleed — form keys win,
  // omitted keys are preserved. Free plans still have Pro-only keys stripped.
  if ("customization" in updates) {
    const { data: existingCard } = await admin
      .from("cards")
      .select("customization, template")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    // Server-owned "_"-prefixed keys never come from the client — strip any the
    // payload tries to send so a crafted request can't overwrite internal flags.
    const incoming = { ...(updates.customization as Record<string, unknown>) };
    for (const k of Object.keys(incoming)) if (k.startsWith("_")) delete incoming[k];
    // Company fax/address are org territory for a sub-user (even on an office
    // with no brand set yet — the UI never shows a member those inputs, so a
    // crafted value must not land either). Dropping them from `incoming` means
    // the merge below keeps the card's existing values; when a brand exists,
    // the overlay further down re-applies the org's own.
    if (subCtx) {
      delete incoming.fax;
      delete incoming.address;
    }
    const effectiveTemplate = (updates.template as string | undefined) ?? (existingCard?.template as string | undefined);
    // Free plans: sanitize what is BEING WRITTEN, not the merged result.
    //
    // This previously sanitized the whole merged blob, so a downgraded account
    // lost data it never touched: saving any unrelated field — a phone number, a
    // job title — re-wrote the entire customization, slicing Swift Links past the
    // Free cap off the stored row and deleting the Swift Links styling keys.
    // Permanently. Re-subscribing did not bring them back, because they were no
    // longer in the row to restore.
    //
    // That merge fixed the keys the form DOESN'T send. It could not fix the
    // ones it does: CardEditForm sends `links` on every save, and sends each
    // colour key explicitly (its own comment: "undefined → key cleared").
    // Those are therefore in `incoming` every time, so sanitizing `incoming`
    // still sliced the links to the Free cap and still snapped the colours,
    // and the merge then wrote that loss over the stored row. The identical
    // permanent-deletion bug, just narrowed to the fields the editor touches —
    // which is all of them.
    //
    // So the write preserves now, and DISPLAY is what enforces the plan. That
    // is not a weakening: it is where enforcement already lived. Every render
    // path independently sanitizes for the owner's CURRENT plan — the public
    // card page (card/[username]:201), the dashboard preview (:511), the Swift
    // Signature (share:102) all call this function without the option, and the
    // Swift Links page slices to FREE_MAX_LINKS and gates page theming on
    // `ownerPaid` inline. A Free account can store a fifth link or an old
    // accent colour; nobody will ever see it until they subscribe again.
    const safeIncoming = isPaidPlan(planRow?.plan)
      ? incoming
      : sanitizeCustomizationForPlan(incoming, false, effectiveTemplate, { preserveDowngraded: true });
    updates.customization = {
      ...((existingCard?.customization as Record<string, unknown> | null) ?? {}),
      ...safeIncoming,
    };
  }

  // Office uniform branding: force company-controlled fields so members can't
  // override them (spec §8). Template + the look are forced only when locked
  // (§9) — an unlocked office lets employees choose their own. This applies to
  // EVERY card under the office, the owner's included — the brand is edited on
  // /office/admin/branding, not by exempting any particular card.
  const brand = await getMemberBrandForUser(user.id);

  // THE OFFICE'S SWIFT LINKS BRANDING. The look (only while the office locks
  // it), the bio, and the pinned link buttons — which are ADDITIVE: the
  // office's lead the list and the member's follow, because an office wants
  // its booking link on every page, not to stop a salesperson linking their
  // own calendar.
  //
  // Applied to the MERGED result, because CardEditForm sends `links` and the
  // style keys on every save whether or not they changed. Sub-users only: the
  // owner's own cards are theirs, the rule every brand target follows.
  if (subCtx && brand && updates.customization) {
    updates.customization = overlayOfficeLinks(updates.customization as Record<string, unknown>, brand);
  }
  // Instagram is a top-level column, so it is resolved here beside company and
  // website rather than in the overlay. Every OTHER social stays the member's.
  //
  // The office's handle is what the page shows — a Swift Links page has exactly
  // one Instagram button and cannot show two — but the member's own is stashed
  // underneath and comes back if the office ever clears its own. That needs the
  // card's STORED handle: while the field is managed the form posts the COMPANY
  // handle back on every save, so trusting the submitted value would stash the
  // office's handle as "theirs" and quietly destroy the real one.
  if (subCtx && brand) {
    const { data: storedRow } = await admin
      .from("cards")
      .select("instagram")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    const out = overlayOfficeInstagram(
      (updates.customization as Record<string, unknown> | undefined) ?? null,
      (storedRow?.instagram as string | null) ?? null,
      brand,
    );
    // Only write customization back when this request was already writing it —
    // a save that never touched customization must not start doing so, or the
    // stash would clobber concurrent edits from another tab.
    if (updates.customization) updates.customization = out.customization;
    if (brand.linkInstagram || out.instagram !== ((storedRow?.instagram as string | null) ?? null)) {
      updates.instagram = out.instagram;
    }
  }

  // Company-level fields are org territory for a SUB-USER even when the office
  // has no brand set yet (the UI never shows those inputs to a member): a
  // crafted request must not write them either. Dropped from the update here
  // (fax/address were already dropped in the customization merge above); when
  // a brand exists, its own values are re-applied just below.
  if (subCtx) {
    delete updates.company;
    delete updates.website;
    delete updates.logo_url;
    delete updates.label;
    // What the office does NOT set can't linger either. A logo, company or
    // website from before they joined stayed on the card with no control left
    // to remove it (the editor hides those inputs for members) while the
    // editor said the organization manages it. Where the office DOES set one,
    // the brand block below re-applies it.
    if (!brand?.logoUrl) updates.logo_url = null;
    if (!brand?.company) updates.company = "";
    if (!brand?.website) updates.website = "";
    // Every number a member adds is their own mobile — the editor offers no
    // other type. Enforced here too: a crafted request could otherwise save an
    // "office"-labelled number, or a fake {office:true} company entry that
    // nothing strips when the office sets no phone. The office's real number
    // is re-added by overlayOfficeContact below.
    const cust = updates.customization as { phones?: unknown } | undefined;
    if (cust && Array.isArray(cust.phones)) {
      cust.phones = (cust.phones as { office?: unknown; label?: unknown }[])
        .filter((p) => p && typeof p === "object" && p.office !== true)
        .map((p) => ({ ...p, label: "mobile" }));
    }
  }
  if (brand) {
    // A SUB-USER (active member, not the owner) explicitly trying to CHANGE an
    // org-managed field is refused outright — even a hand-crafted request never
    // silently rewrites company data. Values that match the brand pass through
    // (the editor sends the whole card back), and the overlays below stay as
    // the normalization backstop.
    if (subCtx) {
      // Compare against the card's CURRENT stored values too, so echoing a
      // value the card already holds (managed data that lagged the brand) is
      // never rejected — only an actual off-brand change is. Prevents a
      // permanent save-lockout when brand propagation lagged.
      const { data: currentCard } = await admin
        .from("cards")
        .select("company, website, logo_url, template, customization")
        .eq("id", id)
        .eq("user_id", user.id)
        .maybeSingle();
      const violations = findManagedFieldViolations(body, brand, {
        company: currentCard?.company,
        website: currentCard?.website,
        logo_url: currentCard?.logo_url,
        template: currentCard?.template,
        customization: (currentCard?.customization as Record<string, unknown> | null) ?? null,
      });
      if (violations.length) {
        return NextResponse.json(
          {
            error: "managed_by_org",
            message: `The ${violations.join(", ")} on this card ${violations.length > 1 ? "are" : "is"} managed by your organization. Refresh the page to see the latest company details.`,
          },
          { status: 403 }
        );
      }
    }
    if (brand.logoUrl) updates.logo_url = brand.logoUrl;
    if (brand.company) updates.company = brand.company;
    // Nickname is company-controlled on connected cards (sourced from the
    // company name), so member dashboards all show the same label.
    if (brand.company && subCtx) updates.label = brand.company;
    if (brand.website) updates.website = brand.website;
    if (brand.lockTemplate && brand.template) updates.template = brand.template;
    // Company phone/fax/address + the locked look are enforced whenever the
    // client sends customization (the overlays re-apply on top of the edit).
    if ("customization" in updates) {
      if (brand.phone || brand.fax || brand.address) {
        updates.customization = overlayOfficeContact(updates.customization as Record<string, unknown>, brand);
      }
      updates.customization = overlayOfficeDesign(updates.customization as Record<string, unknown>, brand);
      if (brand.lockTemplate && brand.template === "custom" && brand.customLayout) {
        updates.customization = { ...(updates.customization as Record<string, unknown>), customLayout: brand.customLayout };
      }
    }
  }

  // The card prints at most lib/card-limits — the editor stops typing there,
  // and this holds the line for any client that does not.
  const { error } = await admin
    .from("cards")
    .update(clampCardWrite(updates))
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // The public card page reads through a per-slug cache — drop it now so the
  // owner's next look at their own card shows the edit, not the old copy.
  revalidateCardPage(beforeCard ? (beforeCard as { username?: string }).username : null);

  // The card URL follows the card (owner order 2026-08-26): a name/company
  // change moves an auto-managed slug to the new FirstLast-Company canonical.
  // Hand-picked slugs never move; old links 308-redirect via _prevSlugs.
  let renamedTo: string | null = null;
  if (beforeCard && ("name" in updates || "company" in updates)) {
    const b = beforeCard as { username: string; name: string | null; company: string | null };
    const { autoRenameCardSlug } = await import("@/lib/auto-rename-slug");
    renamedTo = await autoRenameCardSlug({
      cardId: id,
      userId: user.id,
      before: { username: b.username, name: b.name, company: b.company },
      afterName: ("name" in updates ? (updates.name as string | null) : b.name),
      afterCompany: ("company" in updates ? (updates.company as string | null) : b.company),
    });
    // A rename creates a second live slug (the old one 308-redirects); clear
    // both so neither serves a stale card.
    revalidateCardPage(renamedTo, b.username);
  }

  // Swift Signature freshness nudge: if anything shown ON the card actually
  // changed (a scalar on-card field, the template, or the design/customization
  // JSON), drop a bell + quick-contact notification telling the owner to re-copy
  // their email signature. Compared against the pre-write snapshot so opening the
  // editor and saving unchanged never notifies; deduped to one unread reminder
  // per card so a burst of edits doesn't spam. Best-effort — never fails a save.
  try {
    if (beforeCard) {
      const b = beforeCard as Record<string, unknown>;
      const cardChanged = cardContentChanged(b, updates);
      // Stricter question for the signature pieces: links edits and internal
      // customization keys are invisible to the signature image, so they must
      // not delete it or nudge the owner (see lib/card-changed).
      const signatureChanged = signatureContentChanged(b, updates);
      if (cardChanged) {
        const username = b.username as string;

        // WALLET freshness: a pass already in someone's wallet is frozen at
        // whatever it looked like when it was added, so the only way an edit
        // reaches it is to fingerprint the pass and push the devices holding
        // it. No-ops when the edit didn't touch anything the pass shows, and
        // when nobody has added this card to Wallet. The daily sweep covers
        // the change paths that don't run through this route.
        try {
          const { touchWalletPass } = await import("@/lib/wallet-registry");
          await touchWalletPass(username);
        } catch (e) {
          console.error("[wallet] pass refresh failed after card edit:", e);
        }

        // SHARE-PREVIEW freshness: the stored pixel-perfect capture
        // (card-shares/<username>.png) is now stale. Delete it so the card's
        // link preview immediately falls back to the LIVE-rendered Tier-2 image
        // (built from the current card data) instead of serving the OLD card,
        // until the client re-captures an exact copy on the next dashboard/editor
        // render. The versioned og:image URL busts the messenger cache in step.
        // Best-effort — never blocks the save.
        admin.storage.from("card-shares").remove([`${username}.png`]).then(() => {}, () => {});

        // SWIFT SIGNATURE freshness: same problem, and it was never handled —
        // only the share preview above was invalidated. card-signatures/<u>.png
        // is what outgoing email signs off with, so after any card edit every
        // email kept embedding the OLD card: the previous title, company or
        // phone number, sent to real contacts. The signature_stale notification
        // below only ASKS the user to re-copy; nothing stopped the stale image
        // being used until they did.
        //
        // Safe to delete: mail embeds /api/card-signature/<u>.png, which
        // resolves at FETCH time and falls through to the card's live
        // opengraph render when this object is gone. So deleting swaps a stale
        // card for a current one — in new mail AND in mail already delivered —
        // and never leaves a broken image. Best-effort, never blocks the save.
        if (signatureChanged) {
          admin.storage.from("card-signatures").remove([`${username}.png`]).then(() => {}, () => {});
        }

        // One pending (unread) reminder per card is enough — skip if one exists.
        if (!signatureChanged) {
          // Nothing the signature shows changed (a links edit, an internal
          // flag) — the freshness work above still ran where needed, but the
          // owner gets no "re-copy your signature" nudge for it.
          return NextResponse.json({ ok: true, ...(renamedTo ? { renamedTo } : {}), slug: renamedTo ?? ((beforeCard as { username?: string } | null)?.username ?? null) });
        }
        const { data: pending } = await admin
          .from("notifications")
          .select("id")
          .eq("user_id", user.id)
          .eq("type", "signature_stale")
          .eq("card_owner", username)
          .eq("read", false)
          .limit(1);
        if (!pending?.length) {
          const { insertNotification } = await import("@/lib/notify");
          await insertNotification({
            user_id: user.id,
            // After an auto-rename the card lives at the NEW slug — a
            // notification tagged with the old one would never surface in the
            // card-scoped panel.
            card_owner: renamedTo ?? username,
            type: "signature_stale",
            title: "Update your email signature",
            body: "You changed your card — re-copy your Swift Signature so the version in your email matches.",
          });
        }
      }
    }
  } catch {
    /* notification is a nicety; a card save must still succeed */
  }

  return NextResponse.json({ ok: true, ...(renamedTo ? { renamedTo } : {}), slug: renamedTo ?? ((beforeCard as { username?: string } | null)?.username ?? null) });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // A team member's card is their seat and the company's — only the Office
  // admin removes it (Remove member). The Settings UI already hides Delete.
  if (await getOfficeSubUserContext(user.id)) {
    return NextResponse.json({ error: "Your company card is managed by your Office admin." }, { status: 403 });
  }

  const admin = getAdminSupabase();

  // Look the card up first: everything keyed to it (leads, views, events,
  // notifications) is keyed by USERNAME. Deleting the row frees the username —
  // without this cleanup, whoever registers the same slug next would inherit
  // this card's leads and visitor history (a cross-account data leak). The
  // owner already loses access to these on delete, so removing them changes
  // nothing for them.
  const { data: cardRow } = await admin
    .from("cards")
    .select("username, customization")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!cardRow) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const username = cardRow.username as string;
  // Every address this card is giving up: its own and every old one it still
  // redirects from (an auto-rename keeps the old images and passes there).
  const released = [username, ...prevSlugsOf(cardRow.customization)];
  revalidateCardPage(...released);

  // Lead-child rows are keyed by lead_id, so they must be cleared BEFORE the
  // leads themselves — otherwise deleting the card orphaned every message and
  // reminder belonging to its contacts. Same children the account purge clears.
  const { data: cardLeads } = await admin.from("leads").select("id").eq("card_owner", username);
  const cardLeadIds = (cardLeads ?? []).map((l) => l.id as string).filter(Boolean);
  if (cardLeadIds.length) {
    await Promise.all([
      admin.from("lead_messages").delete().in("lead_id", cardLeadIds).then(() => {}, () => {}),
      admin.from("lead_reminders").delete().in("lead_id", cardLeadIds).then(() => {}, () => {}),
    ]);
  }

  await Promise.all([
    admin.from("leads").delete().eq("card_owner", username),
    // Slug-keyed like the rest — otherwise the next owner of this slug inherits it.
    admin.from("analytics_events").delete().eq("username", username).then(() => {}, () => {}),
    admin.from("card_views").delete().in("username", [username, `${username}__links`]),
    admin.from("card_events").delete().eq("card_owner_username", username),
    admin.from("notifications").delete().eq("user_id", user.id).eq("card_owner", username).then(() => {}, () => {}),
    // Stored card IMAGES are keyed by slug too, in PUBLIC buckets. Without this
    // they outlive the card forever: the deleted card's full image (name, phone,
    // email, headshot) stays downloadable at its public URL, and whoever
    // registers this freed slug next would have THEIR link previews and email
    // signatures serve THIS card's image. Same cross-account reasoning as the
    // table cleanup above. Best-effort — a missing object must not fail the delete.
    // Wallet passes are keyed by the card's address (serial = username). Left
    // behind, a later card given the freed address would be pushed to every
    // phone still holding this card's pass — a stranger's card in their
    // Wallet. The deleted card's pass simply stops updating instead.
    // (lib/release-slug: images + passes, for the aliases too.)
    releaseSlugArtifacts(admin, released),
  ]);

  const { error } = await admin
    .from("cards")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Again AFTER the row is gone: a visit during the cleanup above re-cached
  // the live card, and that entry is served stale to the first visitor after
  // someone else claims the address (isolation audit 2026-09-24).
  revalidateCardPage(...released);
  return NextResponse.json({ ok: true });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminSupabase();
  const { data, error } = await admin
    .from("cards")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ card: data });
}
