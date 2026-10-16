import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { resolveBrandTargetIds } from "@/lib/office-brand-targets";
import { overlayOfficeContact, stripOfficeContact, propagateBrandToOfficeCards, releaseOfficeLinks, OFFICE_DESIGN_KEYS, OFFICE_LINK_DESIGN_KEYS, cleanOfficeLinkStyle } from "@/lib/office-brand";
import { writeAudit } from "@/lib/audit";
import { normalizeSocial } from "@/lib/social-url";
import { requireOfficeCapability } from "@/lib/office-roles";
import { teamCustomLayout } from "@/lib/custom-layout";
import { insertNotification } from "@/lib/notify";
import { BRAND_NOTICE_TYPE, brandChangeNotice, brandContentChanged } from "@/lib/office-account-notifications";

// Office admin sets the uniform brand (logo / company / website / template /
// colors & fonts). This page is THE brand source — there is no primary card.
// Saves it on the office AND propagates it to every existing card under the
// office (the admin's + every active member's), so all cards stay uniform.
export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminSupabase();
  // Server-side authorization: caller must have manage_branding (owner or admin).
  const ctx = await requireOfficeCapability(user.id, "manage_branding");
  if (!ctx) return NextResponse.json({ error: "You don't have permission to manage branding." }, { status: 403 });

  // The office OWNER must currently be on a paid Office plan (the offices row
  // survives a cancel, so a downgraded team must not keep rewriting live cards).
  const { data: ownerProfile } = await admin.from("profiles").select("plan").eq("id", ctx.ownerId).maybeSingle();
  if (ownerProfile?.plan !== "enterprise") {
    return NextResponse.json({ error: "An active Office subscription is required." }, { status: 403 });
  }
  const { data: office } = await admin
    .from("offices")
    .select("id, brand_logo_url, brand_company, brand_website, brand_template, brand_phone, brand_fax, brand_address, brand_design")
    .eq("id", ctx.officeId)
    .maybeSingle();
  if (!office) return NextResponse.json({ error: "No office found." }, { status: 404 });

  const body = await req.json().catch(() => ({}));

  // The whole stored brand as it was, so members can be told afterwards what
  // this save actually changed on their card (see the end of this handler).
  // select("*") so a column this schema lacks can't fail the read.
  const { data: brandBefore } = await admin.from("offices").select("*").eq("id", office.id).maybeSingle();

  // The Links tab's CURRENT values, read on their own (best-effort: the columns
  // may predate this schema), so a save that clears or replaces them can take
  // the old ones off member pages below.
  const { data: oldLinkBrand } = await admin
    .from("offices")
    .select("brand_link_bio, brand_link_instagram, brand_links")
    .eq("id", ctx.officeId)
    .maybeSingle();

  // Company-controlled contact (spec §8) + template lock (spec §9).
  const addrIn = (body.address ?? null) as { street?: string; unit?: string; city?: string; state?: string; zip?: string } | null;
  const cleanAddr = addrIn && typeof addrIn === "object"
    ? {
        street: (addrIn.street ?? "").toString().trim(),
        unit: (addrIn.unit ?? "").toString().trim(),
        city: (addrIn.city ?? "").toString().trim(),
        state: (addrIn.state ?? "").toString().trim(),
        zip: (addrIn.zip ?? "").toString().trim(),
      }
    : null;
  const hasAddr = !!cleanAddr && Object.values(cleanAddr).some(Boolean);
  // ── EACH TAB SENDS ONLY ITS OWN KEYS ────────────────────────────────────────
  // A key the request does not carry KEEPS its stored value. This used to read
  // absent as "off"/"clear": saving the Links tab (no phone/fax/address, no
  // lockTemplate) deleted the office contact from every member card and turned
  // "Keep every card matching" back on, and saving the Card tab (no
  // lockLinkDesign) turned "Keep every Swift Links page matching" off. Found in
  // the 2026-09-16 office audit; pinned in tests/office-brand-partial-save.
  type StoredLocks = { template?: boolean; linkDesign?: boolean };
  const storedLocks: StoredLocks | null = await (async () => {
    try {
      const { data: lockRow } = await admin.from("offices").select("brand_locks").eq("id", ctx.officeId).maybeSingle();
      return (lockRow?.brand_locks as StoredLocks | null) ?? null;
    } catch { return null; /* pre-migration: no locks column — defaults below */ }
  })();
  // Card lock defaults ON (a uniform card is the point of an office); the
  // Swift Links lock is opt-in, because it overwrites pages members already built.
  const lockTemplate = "lockTemplate" in body ? body.lockTemplate !== false : storedLocks?.template !== false;
  const lockLinkDesign = "lockLinkDesign" in body ? body.lockLinkDesign === true : storedLocks?.linkDesign === true;

  // Company IDENTITY + look are set HERE — the Branding page is the brand's
  // single source of truth (the primary-card concept is gone). A field the
  // request omits keeps its current value; an explicitly-empty field clears it.
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : undefined);
  const OFFICE_TEMPLATES = ["classic-pro", "modern-bold", "photo-first", "local-business", "luxury-minimal", "logo-first", "custom"];
  const templateIn = str(body.template);
  const template =
    templateIn === undefined ? ((office.brand_template as string | null) ?? null)
    : OFFICE_TEMPLATES.includes(templateIn) ? templateIn
    : ((office.brand_template as string | null) ?? null);

  // The locked look — only known design keys, and only scalar values, so a
  // crafted request can't smuggle arbitrary JSON into every member card's
  // customization.
  //
  // panelDim is the one NUMBER in this set (the scrim over a panel photo, from
  // lib/card-finishes). A string-only filter dropped it silently, so an admin
  // could move the Darken slider, save, and have every member's card render the
  // photo at a dim they never chose. Clamped to the same 0-0.85 the renderer
  // clamps to, which is also what keeps a hostile value from being stored.
  let design: Record<string, unknown> | null | undefined = undefined;
  if ("design" in body) {
    const d = body.design;
    if (d && typeof d === "object" && !Array.isArray(d)) {
      const clean: Record<string, unknown> = {};
      for (const key of OFFICE_DESIGN_KEYS) {
        const v = (d as Record<string, unknown>)[key];
        if (typeof v === "string" && v.trim()) clean[key] = v.trim();
        else if (key === "panelDim" && typeof v === "number" && Number.isFinite(v)) {
          clean[key] = Math.min(0.85, Math.max(0, v));
        }
      }
      // The company logo's plate shape (Original / Circle). Not a Pro design
      // key — it is structural and free — so it rides beside them explicitly.
      const shape = (d as Record<string, unknown>).logoShape;
      if (shape === "circle" || shape === "auto") clean.logoShape = shape;
      design = Object.keys(clean).length ? clean : null;
    } else {
      design = null; // explicit clear
    }
  }

  // ── Swift Links branding ──────────────────────────────────────────────────
  // Only touched when the request actually carries the Links tab's fields, so
  // saving the Card tab can never blank the Links half and vice versa. Each
  // tab posts its own keys.
  const linkFields: Record<string, unknown> = {};
  if ("linkDesign" in body) {
    const d = body.linkDesign;
    const clean: Record<string, unknown> = {};
    if (d && typeof d === "object") {
      for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
        // Allow-listed to the Swift Links vocabulary, so a crafted request
        // cannot smuggle card keys (or anything else) into the links blob.
        if (!OFFICE_LINK_DESIGN_KEYS.includes(k as never)) continue;
        if (v === undefined || v === null || v === "") continue;
        clean[k] = typeof v === "string" ? v.slice(0, 500) : v;
      }
    }
    linkFields.brand_link_design = Object.keys(clean).length ? clean : null;
  }
  if ("linkBio" in body) linkFields.brand_link_bio = (str(body.linkBio) || null)?.slice(0, 500) ?? null;
  // A bare username is stored the way every other Instagram field stores it
  // (normalizeSocial → "@handle"); a pasted profile URL is reduced to its handle.
  if ("linkInstagram" in body) linkFields.brand_link_instagram = (normalizeSocial(str(body.linkInstagram) ?? "", "instagram") || null)?.slice(0, 120) ?? null;
  if ("links" in body) {
    const raw = Array.isArray(body.links) ? (body.links as unknown[]) : [];
    const clean = raw
      .map((l) => (l && typeof l === "object" ? (l as { label?: unknown; url?: unknown; kind?: unknown }) : null))
      .filter((l): l is { label?: unknown; url?: unknown; kind?: unknown } => !!l)
      .map((l) => ({
        label: String(l.label ?? "").trim().slice(0, 120),
        url: String(l.url ?? "").trim().slice(0, 500),
        // A SECTION HEADER chapters the page and has no destination — the same
        // `kind: "header"` row a member can add under their own links. Only
        // these two kinds exist; anything else is coerced to a plain link so a
        // crafted payload cannot invent a third.
        kind: l.kind === "header" ? ("header" as const) : undefined,
        // How the link LOOKS (Branding → Links → Link buttons), validated.
        style: cleanOfficeLinkStyle(l),
      }))
      // A LINK needs both halves — one with no destination is a dead button on
      // fifteen people's pages. A HEADER needs only its title.
      .filter((l) => (l.kind === "header" ? !!l.label : !!l.label && /^https?:\/\//i.test(l.url)))
      .map((l) => (l.kind === "header" ? { label: l.label, url: "", kind: "header" as const } : { label: l.label, url: l.url, ...l.style }))
      .slice(0, 20);
    linkFields.brand_links = clean.length ? clean : null;
  }

  const brand = {
    brand_logo_url: "logoUrl" in body ? (str(body.logoUrl) || null) : ((office.brand_logo_url as string | null) ?? null),
    brand_company: "company" in body ? (str(body.company) || null) : ((office.brand_company as string | null) ?? null),
    brand_website: "website" in body ? (str(body.website) || null) : ((office.brand_website as string | null) ?? null),
    brand_template: template,
    // The team's custom design, from the designer on the Branding page. Only
    // with the Custom template, validated like every layout, and never a face
    // image (teamCustomLayout) — that would put one person's details on every
    // member's card. Omitted, the stored layout is kept.
    ...(template === "custom" && "customLayout" in body && body.customLayout && typeof body.customLayout === "object"
      ? { brand_custom_layout: teamCustomLayout(body.customLayout) }
      : {}),
    brand_phone: "phone" in body ? (typeof body.phone === "string" ? body.phone.trim() || null : null) : ((office.brand_phone as string | null) ?? null),
    brand_fax: "fax" in body ? (typeof body.fax === "string" ? body.fax.trim() || null : null) : ((office.brand_fax as string | null) ?? null),
    brand_address: "address" in body ? (hasAddr ? cleanAddr : null) : ((office.brand_address as typeof cleanAddr) ?? null),
    // `saved`: an admin has saved Branding at least once. The brand is auto-
    // seeded from the owner's first card, so "a brand exists" can't tell the
    // setup checklist whether anyone actually set it up.
    brand_locks: { template: lockTemplate, linkDesign: lockLinkDesign, saved: true },
    ...(design !== undefined ? { brand_design: design } : {}),
    ...linkFields,
  };

  // Save, retrying without the newer columns ONLY when the database says those
  // columns don't exist yet (a migration not run). Any other failure used to
  // fall into the same retries, so a save could keep just the logo, company,
  // website and template, drop phone, fax, address, the design, the locks and
  // every Swift Links field, and still answer ok: "Applied ✓" for a change
  // that mostly didn't happen (audit C02-A01). Now any other error is an error.
  const missingColumn = (e: { code?: string } | null) => e?.code === "42703" || e?.code === "PGRST204";
  let { error } = await admin.from("offices").update(brand).eq("id", office.id);
  if (error && missingColumn(error) && Object.keys(linkFields).length) {
    // Swift Links columns missing (pre office-swiftlinks-branding.sql) — the
    // Card tab must still save.
    const withoutLinks = { ...brand };
    for (const k of Object.keys(linkFields)) delete (withoutLinks as Record<string, unknown>)[k];
    ({ error } = await admin.from("offices").update(withoutLinks).eq("id", office.id));
  }
  if (error && missingColumn(error)) {
    ({ error } = await admin.from("offices").update({
      brand_logo_url: brand.brand_logo_url, brand_company: brand.brand_company,
      brand_website: brand.brand_website, brand_template: brand.brand_template,
    }).eq("id", office.id));
  }
  if (error) {
    console.error("[office brand] save failed:", error.message);
    return NextResponse.json({ error: "Couldn't save the branding. Nothing was changed — try again." }, { status: 500 });
  }

  // Propagate to all cards owned by the admin + every active member. Cross-check
  // profiles.office_id too, not just office_members.status='active' — a member
  // who switched teams or whose office's subscription lapsed must not have their
  // live card overwritten with this office's branding just because a stale
  // office_members row wasn't cleaned up somewhere.
  const { data: members } = await admin
    .from("office_members")
    .select("user_id")
    .eq("office_id", office.id)
    .eq("status", "active");
  const memberIds = (members ?? []).map((m) => m.user_id).filter(Boolean) as string[];
  let verifiedInOffice: string[] = [];
  if (memberIds.length) {
    const { data: stillHere } = await admin
      .from("profiles")
      .select("id")
      .in("id", memberIds)
      .eq("office_id", office.id);
    verifiedInOffice = (stillHere ?? []).map((p) => p.id as string);
  }
  // Owner + members still verifiably in this office (intersection). A stale
  // office_members row alone never grants a rebrand — see office-brand-targets.
  // ctx.ownerId, NOT user.id: the helper's first parameter is the office OWNER,
  // who is deliberately excluded (their personal cards aren't org-branded). The
  // caller is not always the owner — a delegated `admin` role holds
  // manage_branding — so passing the caller excluded the WRONG person: a
  // delegated admin's own cards were skipped by every brand save, keeping fields
  // the company had just changed or cleared.
  const userIds = resolveBrandTargetIds(ctx.ownerId, memberIds, verifiedInOffice);

  const cardUpdate: Record<string, unknown> = {};
  if (brand.brand_logo_url) cardUpdate.logo_url = brand.brand_logo_url;
  if (brand.brand_company) cardUpdate.company = brand.brand_company;
  if (brand.brand_website) cardUpdate.website = brand.brand_website;
  if (lockTemplate && brand.brand_template) cardUpdate.template = brand.brand_template; // only force template when locked

  // Every query below is scoped to is_office_card=true — a card a member/owner
  // owns that ISN'T flagged as under the office (a separate personal venture)
  // must never be rewritten just because it shares their user_id.
  if (Object.keys(cardUpdate).length && userIds.length) {
    await admin.from("cards").update(cardUpdate).in("user_id", userIds).eq("is_office_card", true);
  }

  // Card nickname is company-controlled on MEMBER cards only (sourced from the
  // company name) — the owner's own card labels are theirs. verifiedInOffice is
  // the members-only subset of userIds, so the owner is naturally excluded.
  if (brand.brand_company && verifiedInOffice.length) {
    await admin.from("cards").update({ label: brand.brand_company }).in("user_id", verifiedInOffice).eq("is_office_card", true);
  }

  // Company phone/fax/address live in customization → per-card overlay so every
  // member card carries the uniform company contact (spec §8), preserving each
  // card's personal fields.
  if (userIds.length && (brand.brand_phone || brand.brand_fax || brand.brand_address)) {
    const contact = { phone: brand.brand_phone, fax: brand.brand_fax, address: brand.brand_address };
    const { data: memberCards } = await admin.from("cards").select("id, customization").in("user_id", userIds).eq("is_office_card", true);
    for (const c of memberCards ?? []) {
      const merged = overlayOfficeContact(c.customization as Record<string, unknown> | null, contact);
      await admin.from("cards").update({ customization: merged }).eq("id", c.id);
    }
  }

  // A brand field the owner just CLEARED must also come off the cards —
  // additive-only propagation left the old logo/company on every member card
  // forever. Only clear cards whose value still equals the OLD brand value, so
  // a personal value a member set themselves is never wiped.
  if (userIds.length) {
    const cleared: Array<{ column: "logo_url" | "company" | "website"; old: string; to: string | null }> = [];
    if (!brand.brand_logo_url && office.brand_logo_url) cleared.push({ column: "logo_url", old: office.brand_logo_url as string, to: null });
    if (!brand.brand_company && office.brand_company) cleared.push({ column: "company", old: office.brand_company as string, to: "" });
    // Company name cleared → member card nicknames that still carry it come off too.
    if (!brand.brand_company && office.brand_company && verifiedInOffice.length) {
      await admin.from("cards").update({ label: null }).in("user_id", verifiedInOffice).eq("is_office_card", true).eq("label", office.brand_company as string);
    }
    if (!brand.brand_website && office.brand_website) cleared.push({ column: "website", old: office.brand_website as string, to: "" });
    for (const c of cleared) {
      await admin.from("cards").update({ [c.column]: c.to }).in("user_id", userIds).eq("is_office_card", true).eq(c.column, c.old);
    }
  }

  // Cleared company CONTACT (phone/fax/address) must also come off member cards
  // — those live in customization, so the additive overlay above never removes
  // them. Strip only the values that still MATCH the OLD office brand, so a
  // personal value a member set is never wiped. (office audit M1)
  const clearedPhone = !brand.brand_phone && office.brand_phone;
  const clearedFax = !brand.brand_fax && office.brand_fax;
  const oldAddr = office.brand_address as { street?: string; unit?: string; city?: string; state?: string; zip?: string } | null;
  const hadAddr = !!oldAddr && Object.values(oldAddr).some((v) => (v ?? "").toString().trim());
  const clearedAddr = !brand.brand_address && hadAddr;
  if (verifiedInOffice.length && (clearedPhone || clearedFax || clearedAddr)) {
    const oldBrandContact = { phone: office.brand_phone as string | null, fax: office.brand_fax as string | null, address: hadAddr ? oldAddr : null };
    const { data: memberCards } = await admin.from("cards").select("id, customization").in("user_id", verifiedInOffice).eq("is_office_card", true);
    for (const c of memberCards ?? []) {
      const stripped = stripOfficeContact(c.customization as Record<string, unknown> | null, oldBrandContact);
      await admin.from("cards").update({ customization: stripped }).eq("id", c.id);
    }
  }

  // The Links half CLEARED or REPLACED: take the OLD company bio, Instagram and
  // pinned links off member pages (each member's own bio and handle come back
  // from where they were held), then the propagation below re-pins whatever
  // the office still sets. Only fields this request actually carried, and only
  // cards still showing the old value — the release matches before it removes.
  const oldBio = (oldLinkBrand?.brand_link_bio as string | null) || null;
  const oldIg = (oldLinkBrand?.brand_link_instagram as string | null) || null;
  const oldLinks = Array.isArray(oldLinkBrand?.brand_links)
    ? (oldLinkBrand!.brand_links as { label?: string; url?: string; kind?: "header" }[])
        .filter((l) => l && typeof l === "object" && typeof l.label === "string")
        .map((l) => ({ label: l.label as string, url: typeof l.url === "string" ? l.url : "", ...(l.kind === "header" ? { kind: "header" as const } : {}) }))
    : [];
  const release = {
    linkBio: "linkBio" in body && oldBio && linkFields.brand_link_bio !== oldBio ? oldBio : null,
    linkInstagram: "linkInstagram" in body && oldIg && linkFields.brand_link_instagram !== oldIg ? oldIg : null,
    links: "links" in body && oldLinks.length ? oldLinks : null,
  };
  if (verifiedInOffice.length && (release.linkBio || release.linkInstagram || release.links)) {
    const { data: memberCards } = await admin
      .from("cards").select("id, customization, instagram").in("user_id", verifiedInOffice).eq("is_office_card", true);
    for (const c of memberCards ?? []) {
      const out = releaseOfficeLinks(c.customization as Record<string, unknown> | null, c.instagram as string | null, release);
      const { error } = await admin.from("cards").update({ customization: out.customization, instagram: out.instagram }).eq("id", c.id);
      if (error) console.error("[office/brand] release failed for card", c.id, error.message);
    }
  }

  // Push the locked LOOK (colors/fonts) to every card on a brand save — the
  // design keys live in customization, so the top-level propagation above never
  // carries them. Re-applying the full brand overlay per card is idempotent and
  // best-effort; with no primary card, the owner's cards are included too.
  try {
    await propagateBrandToOfficeCards(office.id as string);
  } catch { /* best-effort — a member re-syncs on their next edit */ }

  // Tell each team member whose card this save changed — bell only, one
  // current line per member (lib/office-account-notifications). Not the person
  // who made the change. After the response: the admin's save never waits on it.
  const toTell = verifiedInOffice.filter((id) => id !== user.id);
  if (toTell.length) {
    after(async () => {
      try {
        const { data: brandAfter } = await admin.from("offices").select("*").eq("id", office.id).maybeSingle();
        const notice = brandChangeNotice({
          cardLock: [storedLocks?.template !== false, lockTemplate],
          linkLock: [storedLocks?.linkDesign === true, lockLinkDesign],
          contentChanged: brandContentChanged(brandBefore, brandAfter, { card: lockTemplate, link: lockLinkDesign }),
        });
        if (!notice) return;
        for (const uid of toTell) {
          // Supersede, don't stack: their previous unread brand notice is
          // replaced by this one, which describes the card as it is now.
          await admin.from("notifications").delete().eq("user_id", uid).eq("type", BRAND_NOTICE_TYPE).eq("read", false);
          // Tagged with THEIR office card, so it sits on that card's panel
          // and not on every personal card's too (isolation audit 2026-09-24).
          const { data: officeCard } = await admin
            .from("cards").select("username").eq("user_id", uid).eq("is_office_card", true)
            .order("created_at", { ascending: true }).limit(1).maybeSingle();
          await insertNotification({
            user_id: uid, type: BRAND_NOTICE_TYPE, title: notice.title, body: notice.body,
            ...(officeCard?.username ? { card_owner: officeCard.username as string } : {}),
          });
        }
      } catch { /* a notice must never fail a Branding save */ }
    });
  }

  await writeAudit({
    action: "brand.updated",
    actorId: user.id,
    orgId: office.id as string,
    metadata: { fields: Object.keys(cardUpdate), affectedUsers: userIds.length },
  });

  return NextResponse.json({ ok: true });
}
