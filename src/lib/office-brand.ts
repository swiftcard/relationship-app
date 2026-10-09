import { getAdminSupabase } from "@/lib/supabase-admin";
import { isApplePaid } from "@/lib/iap-entitlement";
import { PRO_CUSTOMIZATION_KEYS } from "@/lib/plan";
import { OFFICE_LINK_DESIGN_KEYS } from "@/lib/office-link-design";
import { withoutFaceImage } from "@/lib/custom-layout";

export type OfficeAddress = { street?: string; unit?: string; city?: string; state?: string; zip?: string };

// The look an office owns: colors + fonts, set on the office Branding page.
// These are the ONLY customization keys the office overwrites — an employee's
// personal content (photoUrl, bio, links, socials, testimonials) is never touched.
// Plus Photo First's photo shape: every plan, so it is not a Pro key, but it
// IS the office's look — the Branding page shows the same Photo shape step,
// and with the look locked every member's card follows it.
export const OFFICE_DESIGN_KEYS = [...PRO_CUSTOMIZATION_KEYS, "photoShape"] as const;

export type OfficeBrand = {
  logoUrl: string | null;
  company: string | null;
  website: string | null;
  template: string | null;
  customLayout: unknown | null;
  // The locked look (colors + fonts), set on the office Branding page. Applied
  // only while lockTemplate is on — it travels with the template, since a
  // template without its colors/fonts isn't a consistent look.
  design: Record<string, unknown> | null;
  // Company-controlled uniform contact (spec §8) — applied to member cards' data.
  phone: string | null;
  fax: string | null;
  address: OfficeAddress | null;
  // Per-field locks (spec §9). lockTemplate=false lets employees pick their own
  // template AND colors/fonts; true (default) forces the office look. Required
  // contact fields (logo/company/website/phone/fax/address) are ALWAYS
  // company-controlled regardless of this flag.
  lockTemplate: boolean;
  // ── The Swift Links page ──────────────────────────────────────────────────
  //
  // The mirror of everything above, for the link-in-bio page a QR code or an
  // email signature actually opens. Two different rules, deliberately, and they
  // are the same two the card already uses:
  //
  //   APPEARANCE (linkDesign) follows lockLinkDesign, exactly as the card's
  //   design follows lockTemplate. Unlocked, every member styles their own.
  //
  //   CONTENT (linkBio, linkInstagram, links) follows the COMPANY-INFORMATION
  //   rule: whatever the admin fills in is applied and read-only for members
  //   regardless of the design lock, the same way brand_company and
  //   brand_logo_url already are. A field left blank stays the member's.
  /** SwiftLinkStyle keys (LINK_STYLE_KEYS + LINK_STRUCTURAL_KEYS), or null. */
  linkDesign: Record<string, unknown> | null;
  /** The bio on every member's links page. Null = each member writes their own. */
  linkBio: string | null;
  /** The company Instagram. Null = each member's own. Every OTHER social stays theirs. */
  linkInstagram: string | null;
  /**
   * Link buttons pinned to every member's page.
   *
   * ADDITIVE, never exclusive: a member can always add their own on top, and
   * these sit in front and cannot be edited or removed by them. An office wants
   * its booking link on every page — not to stop a salesperson linking their
   * own calendar.
   */
  links: ({ label: string; url: string; kind?: "header" } & OfficeLinkStyle)[] | null;
  /** "Keep every Swift Links page matching." Default FALSE — see the loader. */
  lockLinkDesign: boolean;
};

// The Swift Links vocabulary lives in lib/office-link-design — a client-safe
// module, because the admin's Branding page needs it and this file reaches for
// the service-role database client. Re-exported so server callers keep one
// import.
export { OFFICE_LINK_DESIGN_KEYS } from "@/lib/office-link-design";

// Pull just the design keys out of a card's customization blob. Used to seed a
// fresh office's look from the admin's first card (one-time copy).
export function extractDesign(
  customization: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  const cust = customization ?? {};
  const design: Record<string, unknown> = {};
  for (const key of OFFICE_DESIGN_KEYS) {
    if (cust[key] !== undefined && cust[key] !== null && cust[key] !== "") design[key] = cust[key];
  }
  return Object.keys(design).length ? design : null;
}


// ── The office's pinned link buttons ────────────────────────────────────────
//
// ADDITIVE by design. The office's links always lead the list and a member can
// never edit or remove them; everything the member adds follows. This replaces
// an earlier all-or-nothing "members cannot touch links" lock, which was the
// wrong shape: an office wants its booking link on every page, not to stop a
// salesperson linking their own calendar.
//
// Identity is the URL, not the label or the position: a member's payload sends
// the whole list back on every save, and matching on label would let a renamed
// office link become "theirs" (and then be removable), while matching on index
// would break the moment they reorder their own.
//
// Returns a NEW array; never mutates the input.
export function pinOfficeLinks(
  memberLinks: unknown,
  brand: Pick<OfficeBrand, "links"> | null | undefined,
): { label: string; url: string; kind?: "header" }[] | unknown[] {
  const office = brand?.links ?? null;
  const own = Array.isArray(memberLinks) ? (memberLinks as unknown[]) : [];
  if (!office?.length) return own;

  // Real links are identified by URL. SECTION HEADERS have no URL at all — they
  // are `kind: "header"` rows that chapter a long page — so matching them on URL
  // would make every header in the list identical to every other one, office and
  // member alike: the office's first header would swallow the member's, or the
  // member's would be mistaken for the office's and become unremovable.
  //
  // So office entries are also MARKED. The marker is authoritative and is
  // re-stamped from the office's own record on every pass, which means a member
  // cannot forge one: anything arriving marked is dropped here and only genuine
  // office entries are re-added below. Same `office: true` device the company
  // phone entry already uses in overlayOfficeContact.
  const officeUrls = new Set(
    office.filter((l) => !isHeaderEntry(l)).map((l) => normalizeLinkUrl(l.url)),
  );
  // A header has no URL, so its LABEL is its identity — the same role the URL
  // plays for a link. Needed for rows that predate the `office: true` stamp (and
  // any payload that simply omits it): without it, a member's form echoing the
  // company's header back produced a SECOND copy of it on their page every save.
  const officeHeaders = new Set(
    office.filter(isHeaderEntry).map((l) => normalizeHeaderLabel(l.label)),
  );
  // Whatever the member sent that ISN'T one of ours, in their order. An office
  // link they tried to rename, reorder or delete simply falls out here and is
  // re-added from the office's own record below.
  const theirs = own.filter((l) => {
    if (!l || typeof l !== "object") return false;
    // Claims to be the office's — believe the office's record, not the payload.
    if ((l as { office?: unknown }).office === true) return false;
    // A member's own section header is theirs — unless it is the company's
    // under another name for the same title.
    if (isHeaderEntry(l)) {
      const label = (l as { label?: unknown }).label;
      return !officeHeaders.has(normalizeHeaderLabel(typeof label === "string" ? label : ""));
    }
    const url = (l as { url?: unknown }).url;
    return !officeUrls.has(normalizeLinkUrl(typeof url === "string" ? url : ""));
  });
  return [...office.map((l) => ({ ...l, office: true })), ...theirs];
}

/** How a company link LOOKS — Featured / Grid / Compact, its row style, and an
 *  uploaded photo or video — validated so a crafted request cannot store
 *  anything else on every member's page. Admins set these in Branding → Links
 *  (Link buttons); before 2026-09-16 they were dropped on save and on read. */
export type OfficeLinkStyle = { size?: "featured" | "grid" | "compact"; rowStyle?: "tile" | "solid" | "outline"; media?: { url: string; type: "image" | "video" }; glass?: boolean };
export function cleanOfficeLinkStyle(l: unknown): OfficeLinkStyle {
  const r = (l && typeof l === "object" ? l : {}) as { size?: unknown; rowStyle?: unknown; media?: unknown; glass?: unknown };
  const out: OfficeLinkStyle = {};
  if (r.size === "featured" || r.size === "grid" || r.size === "compact") out.size = r.size;
  if (r.rowStyle === "tile" || r.rowStyle === "solid" || r.rowStyle === "outline") out.rowStyle = r.rowStyle;
  if (typeof r.glass === "boolean") out.glass = r.glass;
  const m = r.media as { url?: unknown; type?: unknown } | null | undefined;
  if (m && typeof m.url === "string" && m.url.startsWith("https://") && (m.type === "image" || m.type === "video")) {
    out.media = { url: m.url.slice(0, 500), type: m.type };
  }
  return out;
}

/** A section header row: a chapter title on the page, with no URL of its own. */
export function isHeaderEntry(l: unknown): boolean {
  return !!l && typeof l === "object" && (l as { kind?: unknown }).kind === "header";
}

/** Loose header identity: case and surrounding space must not create a duplicate. */
function normalizeHeaderLabel(label: string): string {
  return String(label ?? "").trim().toLowerCase();
}

/** Loose URL identity: trailing slash and case must not create a duplicate. */
function normalizeLinkUrl(url: string): string {
  return String(url ?? "").trim().toLowerCase().replace(/\/+$/, "");
}

// Returns the office brand for a given office, or null if none is set.
export async function getOfficeBrand(officeId: string | null | undefined): Promise<OfficeBrand | null> {
  if (!officeId) return null;
  const admin = getAdminSupabase();
  // Select the newer columns defensively — a pre-migration schema without them
  // errors, so fall back to the base columns.
  let office: Record<string, unknown> | null = null;
  {
    const { data } = await admin
      .from("offices")
      .select("brand_logo_url, brand_company, brand_website, brand_template, brand_custom_layout, brand_phone, brand_fax, brand_address, brand_locks, brand_design, brand_link_design, brand_link_bio, brand_link_instagram, brand_links")
      .eq("id", officeId)
      .maybeSingle();
    office = data as Record<string, unknown> | null;
  }
  if (!office) {
    // Swift Links columns missing (pre office-swiftlinks-branding.sql) — the
    // card half must keep working, so retry without them.
    const { data } = await admin
      .from("offices")
      .select("brand_logo_url, brand_company, brand_website, brand_template, brand_custom_layout, brand_phone, brand_fax, brand_address, brand_locks, brand_design")
      .eq("id", officeId)
      .maybeSingle();
    office = data as Record<string, unknown> | null;
  }
  if (!office) {
    // brand_design missing (pre office-primary-card.sql) — retry without it.
    const { data } = await admin
      .from("offices")
      .select("brand_logo_url, brand_company, brand_website, brand_template, brand_custom_layout, brand_phone, brand_fax, brand_address, brand_locks")
      .eq("id", officeId)
      .maybeSingle();
    office = data as Record<string, unknown> | null;
  }
  if (!office) {
    const { data } = await admin
      .from("offices")
      .select("brand_logo_url, brand_company, brand_website, brand_template, brand_custom_layout")
      .eq("id", officeId)
      .maybeSingle();
    office = data as Record<string, unknown> | null;
  }
  if (!office) return null;

  const addr = office.brand_address as OfficeAddress | null | undefined;
  const hasAddr = !!addr && Object.values(addr).some((v) => (v ?? "").toString().trim());
  const design = (office.brand_design as Record<string, unknown> | null) ?? null;
  const hasDesign = !!design && Object.keys(design).length > 0;
  // A brand is "active" once the admin has set the logo or ANY company field.
  // The Swift Links half counts too. Without this, an admin who branded ONLY
  // the links page would get a null brand and nothing would ever apply.
  const linkDesign = (office.brand_link_design as Record<string, unknown> | null) ?? null;
  const hasLinkDesign = !!linkDesign && Object.keys(linkDesign).length > 0;
  const rawLinks = office.brand_links;
  // A row is a LINK (label + url) or a SECTION HEADER (label only, kind
  // "header") that chapters the page. `kind` has to survive this parse and a
  // header has to survive the filter: dropping either one loses the header
  // silently between the database and the member's card — it saves, it shows on
  // the admin's own screen, and it simply never arrives.
  const links = Array.isArray(rawLinks)
    ? (rawLinks as unknown[])
        .map((l) => (l && typeof l === "object" ? l as { label?: unknown; url?: unknown; kind?: unknown } : null))
        .filter((l): l is { label?: unknown; url?: unknown; kind?: unknown } => !!l)
        .map((l) => {
          const label = String(l.label ?? "").slice(0, 120);
          return l.kind === "header"
            ? { label, url: "", kind: "header" as const }
            : { label, url: String(l.url ?? "").slice(0, 500), ...cleanOfficeLinkStyle(l) };
        })
        .filter((l) => (l.kind === "header" ? !!l.label : !!l.label && !!l.url))
    : null;
  const hasLinks = !!links && links.length > 0;
  const linkBio = ((office.brand_link_bio as string | null) || null);
  const linkInstagram = ((office.brand_link_instagram as string | null) || null);

  if (!office.brand_logo_url && !office.brand_company && !office.brand_website && !office.brand_template
      && !office.brand_phone && !office.brand_fax && !hasAddr && !hasDesign
      && !hasLinkDesign && !hasLinks && !linkBio && !linkInstagram) {
    return null;
  }
  const locks = (office.brand_locks as { template?: boolean; linkDesign?: boolean } | null) ?? null;
  return {
    logoUrl: (office.brand_logo_url as string) ?? null,
    company: (office.brand_company as string) ?? null,
    website: (office.brand_website as string) ?? null,
    template: (office.brand_template as string) ?? null,
    // Never a face image on a TEAM brand (lib/custom-layout withoutFaceImage):
    // it is one person's card with their details baked in.
    customLayout: withoutFaceImage(office.brand_custom_layout ?? null),
    design: hasDesign ? design : null,
    phone: (office.brand_phone as string) ?? null,
    fax: (office.brand_fax as string) ?? null,
    address: hasAddr ? (addr as OfficeAddress) : null,
    lockTemplate: locks?.template !== false, // default true (preserve uniform look)
    linkDesign: hasLinkDesign ? linkDesign : null,
    linkBio,
    linkInstagram,
    links: hasLinks ? links : null,
    // Default FALSE, unlike the card's template lock: an office that has never
    // opened this tab must not silently start overwriting pages its members
    // already built.
    lockLinkDesign: locks?.linkDesign === true,
  };
}

// ── Pure overlay: force the office's locked look (colors + fonts) onto a card's
// customization. Only runs while the template lock is on — an unlocked office
// lets employees pick their own look. The employee's personal content
// (photoUrl, bio, links, socials, …) is never touched, only the design keys.
// Exported for unit testing.
export function overlayOfficeDesign(
  customization: Record<string, unknown> | null | undefined,
  brand: Pick<OfficeBrand, "design" | "lockTemplate"> & { template?: string | null },
): Record<string, unknown> {
  const cust: Record<string, unknown> = { ...(customization ?? {}) };
  // The logo is company territory whether or not the design is locked ("They
  // can never change: Company logo"), so its plate shape — Original or Circle,
  // the same control Card design has — follows the office always.
  const shape = brand.design?.logoShape;
  if (shape === "circle" || shape === "auto") cust.logoShape = shape;
  // Locked means "the office's look", even when the office stored no colours
  // (a brand seeded from an owner's default-coloured card, before anyone saved
  // Branding): then the office's look IS the template's defaults. Returning
  // early there locked the member's editor while their own colours, finish and
  // panel photo stayed on the card, unchangeable. The editor locks on the same
  // condition (lockTemplate && (template || design)).
  if (!brand.lockTemplate || !(brand.design || brand.template)) return cust;
  for (const key of OFFICE_DESIGN_KEYS) {
    // Whatever the office set wins; a key the office does NOT define is cleared
    // so an employee can't reintroduce an off-brand colour the office omitted.
    const v = brand.design?.[key];
    if (v !== undefined) cust[key] = v;
    else delete cust[key];
  }
  return cust;
}

/**
 * Apply the office's SWIFT LINKS branding to a member's customization.
 *
 * The mirror of overlayOfficeDesign + overlayOfficeContact for the links page,
 * and it keeps their two different rules deliberately apart:
 *
 *   THE LOOK is applied only while lockLinkDesign is on, exactly as the card's
 *   design follows lockTemplate. Unlocked, every member designs their own —
 *   and a key the office did NOT set is cleared, so a member cannot keep an
 *   off-brand colour the office left out of its scheme.
 *
 *   THE CONTENT (bio, Instagram, pinned links) is applied whenever the office
 *   has set it, lock or no lock — the company-information rule that
 *   brand_company and brand_logo_url already follow. A field the office left
 *   blank is untouched and stays the member's own.
 *
 * Links are ADDITIVE via pinOfficeLinks: the office's lead, the member's
 * follow, and the member can never remove the office's.
 *
 * Pure and total: returns a NEW object and never mutates its input.
 */
// Where a member's OWN value waits while the office is showing its own in that
// slot. Both live in the card's customization JSON, so they travel with the
// card in the same write and can never drift away from it. Nothing renders
// them — they exist purely so "the company set a bio" is reversible.
//
// Not underscore-prefixed: sanitizeCustomizationForPlan is a deny-list that
// returns paid customizations untouched, and an Office member is paid by
// definition, so no prefix is needed to survive it.
export const OWN_BIO = "ownBio";
export const OWN_INSTAGRAM = "ownInstagram";

export function overlayOfficeLinks(
  customization: Record<string, unknown> | null | undefined,
  brand: Pick<OfficeBrand, "linkDesign" | "lockLinkDesign" | "linkBio" | "linkInstagram" | "links"> | null | undefined,
): Record<string, unknown> {
  const cust: Record<string, unknown> = { ...(customization ?? {}) };
  if (!brand) return cust;

  // Locked with no look stored (the admin ticked "Keep every Swift Links page
  // matching" without touching a style) means the DEFAULT look — the same rule
  // as the card design above. Skipping it left each member's old custom look on
  // their page while their editor said the organization sets it.
  if (brand.lockLinkDesign) {
    for (const key of OFFICE_LINK_DESIGN_KEYS) {
      const k = key as string;
      const v = brand.linkDesign?.[k];
      if (v !== undefined) cust[k] = v;
      else delete cust[k];
    }
  }

  // `bio` is the Swift Links bio — the same customization key the member's own
  // Socials tab writes, which is why the office's REPLACES theirs on the page.
  //
  // Replaces, never destroys. The member's own bio is stashed underneath and
  // handed straight back the moment the office stops setting one. Without this,
  // an admin who typed a company bio, saved, and changed their mind an hour
  // later had permanently deleted fifteen people's bios — and the only copy was
  // gone, so "undo" meant asking each person to remember what they'd written.
  // Same reasoning as preserveDowngraded in sanitizeCustomizationForPlan: on
  // WRITE, replacing a value you don't own is deleting it.
  if (brand.linkBio) {
    if (cust[OWN_BIO] === undefined && cust.bio !== brand.linkBio) {
      cust[OWN_BIO] = typeof cust.bio === "string" ? cust.bio : "";
    }
    cust.bio = brand.linkBio;
  } else if (cust[OWN_BIO] !== undefined) {
    cust.bio = cust[OWN_BIO];
    delete cust[OWN_BIO];
  }
  if (brand.links?.length) cust.links = pinOfficeLinks(cust.links, brand);
  else if (Array.isArray(cust.links) && cust.links.some((l) => (l as { office?: unknown } | null)?.office === true)) {
    // The office pins nothing any more: its marked rows come off (pinOfficeLinks
    // only ever swaps them for the current set, so deleting the LAST company
    // link left every member carrying it, undeletable). Theirs stay put.
    cust.links = (cust.links as unknown[]).filter((l) => (l as { office?: unknown } | null)?.office !== true);
  }

  // NOTE: Instagram is deliberately NOT here. It is a TOP-LEVEL card column
  // (cards.instagram), not a customization key — the same shape as company and
  // website — so it is handled by overlayOfficeInstagram below, which returns
  // both halves. Writing customization.instagram would have created a second,
  // silently ignored copy.

  return cust;
}

/**
 * The office's Instagram, and the member's own kept safe underneath it.
 *
 * A Swift Links page has ONE Instagram button — it cannot show two — so when
 * the office sets a company handle, that is the one the page shows and the
 * member's field goes read-only. That part is correct and deliberate.
 *
 * What was NOT correct: their own handle was overwritten in the column and
 * gone forever. Drop the company Instagram later and they got a blank box, not
 * their handle back. It is stashed in customization (same row, same write, so
 * it cannot drift from the card it belongs to) and restored the moment the
 * office stops setting one — or when they leave the office entirely.
 *
 * `currentInstagram` must be the card's STORED handle, never the one a member
 * just submitted: while the field is managed their form posts the COMPANY
 * handle back, and stashing that would overwrite the very thing being saved.
 *
 * Pure and total: returns a new object, never mutates its input.
 */
export function overlayOfficeInstagram(
  customization: Record<string, unknown> | null | undefined,
  currentInstagram: string | null | undefined,
  brand: Pick<OfficeBrand, "linkInstagram"> | null | undefined,
): { customization: Record<string, unknown>; instagram: string } {
  // cards.instagram is NOT NULL (default ''). A null here made Postgres reject
  // the WHOLE card update — customization included — and the Supabase client
  // reports that as a returned error, not a throw, so it vanished silently.
  const cust: Record<string, unknown> = { ...(customization ?? {}) };
  const current = currentInstagram ?? "";
  if (!brand) return { customization: cust, instagram: current };

  if (brand.linkInstagram) {
    if (cust[OWN_INSTAGRAM] === undefined && current !== brand.linkInstagram) {
      cust[OWN_INSTAGRAM] = current ?? "";
    }
    return { customization: cust, instagram: brand.linkInstagram };
  }

  if (cust[OWN_INSTAGRAM] !== undefined) {
    const restored = cust[OWN_INSTAGRAM];
    delete cust[OWN_INSTAGRAM];
    return { customization: cust, instagram: typeof restored === "string" ? restored : "" };
  }
  return { customization: cust, instagram: current };
}

// ── Pure overlay: apply the company-controlled contact fields onto a card's
// customization JSON (spec §8). Injects the office phone as a labeled "Office"
// phone entry (marked office:true so it's replaceable/removable), and forces the
// company fax + address. Personal phones and other fields are preserved.
// Exported for unit testing.
type PhoneEntry = { number?: string; label?: string; showOnCard?: boolean; office?: boolean };
export function overlayOfficeContact(
  customization: Record<string, unknown> | null | undefined,
  brand: Pick<OfficeBrand, "phone" | "fax" | "address">,
): Record<string, unknown> {
  const cust: Record<string, unknown> = { ...(customization ?? {}) };
  // Company phone → first entry, labeled Office. Drop any prior office entry.
  const phones = Array.isArray(cust.phones) ? (cust.phones as PhoneEntry[]).filter((p) => !p?.office) : [];
  if (brand.phone && brand.phone.trim()) {
    cust.phones = [{ number: brand.phone.trim(), label: "Office", showOnCard: true, office: true }, ...phones];
  } else {
    cust.phones = phones;
  }
  if (brand.fax != null) cust.fax = brand.fax.trim();
  if (brand.address) cust.address = brand.address;
  return cust;
}

// Remove the company contact overlay from a card's customization (used when a
// member leaves). Only clears fields that still match the office values.
export function stripOfficeContact(
  customization: Record<string, unknown> | null | undefined,
  brand: Pick<OfficeBrand, "phone" | "fax" | "address">,
): Record<string, unknown> {
  const cust: Record<string, unknown> = { ...(customization ?? {}) };
  cust.phones = Array.isArray(cust.phones) ? (cust.phones as PhoneEntry[]).filter((p) => !p?.office) : [];
  if (brand.fax && cust.fax === brand.fax.trim()) cust.fax = "";
  if (brand.address && JSON.stringify(cust.address) === JSON.stringify(brand.address)) delete cust.address;
  return cust;
}

// Resolves the office (as owner OR member) for a user, then its brand.
// Display/read-only surfaces may use this; card WRITES must use
// getMemberBrandForUser below so the owner's own cards stay personal.
export async function getOfficeBrandForUser(userId: string): Promise<OfficeBrand | null> {
  const admin = getAdminSupabase();
  const { data: profile } = await admin.from("profiles").select("office_id").eq("id", userId).maybeSingle();
  let officeId: string | null = (profile?.office_id as string | null) ?? null;
  if (!officeId) {
    const { data: owned } = await admin.from("offices").select("id").eq("owner_id", userId).maybeSingle();
    officeId = (owned?.id as string | null) ?? null;
  }
  return getOfficeBrand(officeId);
}

// The brand to APPLY to a user's cards — MEMBERS ONLY. The office OWNER's
// personal cards are individual to the admin (owner decision, Jul 2026):
// uniform branding governs sub-users' cards, never the admin's own. Returns
// null for the owner so every card-write overlay (create, save, claim,
// profile) leaves their cards untouched.
export async function getMemberBrandForUser(userId: string): Promise<OfficeBrand | null> {
  const admin = getAdminSupabase();
  const { data: profile } = await admin.from("profiles").select("office_id").eq("id", userId).maybeSingle();
  const officeId = (profile?.office_id as string | null) ?? null;
  if (!officeId) return null;
  const { data: office } = await admin.from("offices").select("owner_id").eq("id", officeId).maybeSingle();
  if (((office?.owner_id as string | null) ?? null) === userId) return null; // owner is exempt
  return getOfficeBrand(officeId);
}

// ── Join/leave card sync ──────────────────────────────────────────────────────

// Apply the office brand to every card a user already owns — used when someone
// ACCEPTS an invite. Without this, a member who had cards before joining keeps
// unbranded cards until their next edit, breaking the "one brand across
// everyone" promise for the most common onboarding path.
export async function applyBrandToUserCards(
  userId: string,
  brand: OfficeBrand,
  opts: { setLabel?: boolean } = {},
): Promise<void> {
  const admin = getAdminSupabase();
  const topLevel: Record<string, unknown> = {};
  if (brand.logoUrl) topLevel.logo_url = brand.logoUrl;
  if (brand.company) topLevel.company = brand.company;
  // The card nickname is company-controlled on MEMBER cards, sourced from the
  // company name — every connected card shows the same label on the dashboard.
  // The OWNER keeps their own labels (setLabel:false when propagating to them).
  if (brand.company && opts.setLabel !== false) topLevel.label = brand.company;
  if (brand.website) topLevel.website = brand.website;
  if (brand.lockTemplate && brand.template) topLevel.template = brand.template;
  // NOTE: the Swift Links Instagram is a top-level column like company and
  // website, but it is deliberately NOT set here. A blanket column write would
  // overwrite each member's own handle with no copy kept, so it is resolved
  // PER CARD below, where their handle can be stashed first.

  const hasContact = !!(brand.phone || brand.fax || brand.address);

  // EVERY pass reads and rewrites each card — no "nothing to apply" shortcut.
  // The shortcut was computed from the NEW brand, so the moments that most
  // needed a pass skipped it: the office CLEARING its bio or Instagram (the
  // member's own, held underneath, never came back), removing its last pinned
  // link, locking a look with no stored values, or changing the logo shape
  // while the design was unlocked. Every overlay below is idempotent and a
  // no-op when it has nothing to do, so an unconditional pass is always right.
  //
  // Scoped to cards actually flagged as under the office — a card the user
  // owns that ISN'T part of the office (a separate personal venture) must
  // never be touched.
  const { data: cards } = await admin
    .from("cards")
    .select("id, customization, instagram")
    .eq("user_id", userId)
    .eq("is_office_card", true);
  for (const c of cards ?? []) {
    let merged = c.customization as Record<string, unknown> | null;
    if (hasContact) merged = overlayOfficeContact(merged, brand);
    merged = overlayOfficeDesign(merged, brand);
    const perCard: Record<string, unknown> = {};
    merged = overlayOfficeLinks(merged, brand);
    // The card's STORED handle, never a submitted one — this is the only
    // moment their own Instagram can still be read before the office's
    // replaces it.
    const ig = overlayOfficeInstagram(merged, c.instagram as string | null, brand);
    merged = ig.customization;
    perCard.instagram = ig.instagram;
    if (brand.lockTemplate && brand.template === "custom" && brand.customLayout) {
      merged = { ...(merged ?? {}), customLayout: brand.customLayout };
    }
    const { error } = await admin.from("cards").update({ ...topLevel, ...perCard, customization: merged ?? {} }).eq("id", c.id);
    if (error) console.error("[office-brand] brand pass failed for card", c.id, error.message);
  }
  await refreshCardSurfaces(userId, { officeCardsOnly: true });
}

/** A brand with nothing set — what an office that cleared everything applies. */
export const EMPTY_OFFICE_BRAND: OfficeBrand = {
  logoUrl: null, company: null, website: null, template: null, customLayout: null, design: null,
  phone: null, fax: null, address: null, lockTemplate: false, linkDesign: null, linkBio: null,
  linkInstagram: null, links: null, lockLinkDesign: false,
};

/**
 * After the brand changes what a card shows: drop the page cache, the stored
 * share preview and the stored email-signature image, and nudge the Wallet
 * pass. The member's own save already does all of this (api/cards/[id]); a
 * brand save, a removal or a lapse didn't, so every teammate's email kept the
 * old logo and phone after a rebrand, and an ex-member's email kept the former
 * employer's branding indefinitely. Deleting the images is safe: the signature
 * and preview URLs resolve at fetch time and fall back to a live render of the
 * current card. Best-effort; never throws.
 */
export async function refreshCardSurfaces(userId: string, opts: { officeCardsOnly?: boolean } = {}): Promise<void> {
  try {
    const admin = getAdminSupabase();
    let q = admin.from("cards").select("username").eq("user_id", userId);
    if (opts.officeCardsOnly) q = q.eq("is_office_card", true);
    const { data } = await q;
    const slugs = (data ?? []).map((c) => c.username as string).filter(Boolean);
    if (!slugs.length) return;
    const files = slugs.map((s) => `${s}.png`);
    await Promise.all([
      admin.storage.from("card-shares").remove(files).then(() => {}, () => {}),
      admin.storage.from("card-signatures").remove(files).then(() => {}, () => {}),
    ]);
    const { revalidateCardPage } = await import("@/lib/card-page-data");
    revalidateCardPage(...slugs);
    try {
      const { touchWalletPass } = await import("@/lib/wallet-registry");
      await Promise.all(slugs.map((s) => touchWalletPass(s).catch(() => {})));
    } catch { /* wallet not configured */ }
  } catch { /* best-effort */ }
}

// Re-apply the office brand to every ACTIVE MEMBER's cards. The OWNER is
// deliberately excluded: the admin's personal cards are individual to them
// (owner decision, Jul 2026) — an earlier version included the owner here,
// which silently rewrote the admin's own cards with the office template on
// every Branding save. The brand lives on the office row (edited on
// /office/admin/branding) and governs sub-user cards only.
export async function propagateBrandToOfficeCards(officeId: string): Promise<void> {
  const admin = getAdminSupabase();
  // A null brand is an office that cleared everything — the pass must still run
  // (with nothing set) so members get their own bio and Instagram back and the
  // company rows come off. It used to return here, stranding all of it.
  const brand = (await getOfficeBrand(officeId)) ?? EMPTY_OFFICE_BRAND;

  const { data: officeRow } = await admin.from("offices").select("owner_id").eq("id", officeId).maybeSingle();
  const ownerId = (officeRow?.owner_id as string | null) ?? null;

  const { data: members } = await admin
    .from("office_members")
    .select("user_id")
    .eq("office_id", officeId)
    .eq("status", "active");

  const seen = new Set<string>();
  const targets: string[] = [];
  for (const m of members ?? []) {
    const uid = m.user_id as string | null;
    if (uid && uid !== ownerId && !seen.has(uid)) { targets.push(uid); seen.add(uid); }
  }

  for (const uid of targets) {
    try {
      await applyBrandToUserCards(uid, brand);
    } catch {
      // Best-effort per user — one bad card must not abort the rest. Their
      // next card edit re-applies the overlay anyway.
    }
  }
}

// One-time brand seed for a freshly provisioned office: copy the owner's OLDEST
// card's identity + look into offices.brand_* so the team doesn't start
// unbranded. A plain COPY — no ongoing link, no primary card. Never overwrites
// a brand the admin has already set (any identity/design field present = no-op);
// from then on the Branding page is the only writer.
export async function seedBrandFromOwnersFirstCard(officeId: string, ownerId: string): Promise<void> {
  const admin = getAdminSupabase();

  const { data: office } = await admin
    .from("offices")
    .select("brand_logo_url, brand_company, brand_website, brand_template, brand_design")
    .eq("id", officeId)
    .maybeSingle();
  if (!office) return;
  const design = office.brand_design as Record<string, unknown> | null;
  const alreadyBranded =
    !!office.brand_logo_url || !!office.brand_company || !!office.brand_website ||
    !!office.brand_template || (!!design && Object.keys(design).length > 0);
  if (alreadyBranded) return;

  const { data: card } = await admin
    .from("cards")
    .select("id, logo_url, company, website, template, customization")
    .eq("user_id", ownerId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!card) return; // owner has no card yet — the Branding page starts blank

  const cust = (card.customization as Record<string, unknown> | null) ?? {};
  // The whole card, not just its look (owner, 2026-09-22: "Why would someone
  // design their card in SwiftLinks and then have to go back into branding and
  // do that also?"). The company's phone is the number they labelled "office"
  // — a "mobile" is theirs, never the team's. The Swift Links design comes too;
  // the page's CONTENT (bio, links) stays theirs.
  const officePhone = Array.isArray(cust.phones)
    ? (cust.phones as Array<{ number?: unknown; label?: unknown }>)
        .find((p) => p?.label === "office" && typeof p.number === "string" && p.number.trim())?.number as string | undefined
    : undefined;
  const rawAddr = cust.address && typeof cust.address === "object" ? cust.address as Record<string, unknown> : null;
  const address: OfficeAddress = {};
  for (const k of ["street", "unit", "city", "state", "zip"] as const) {
    const v = rawAddr?.[k];
    if (typeof v === "string" && v.trim()) address[k] = v.trim();
  }
  const linkDesign: Record<string, unknown> = {};
  for (const key of OFFICE_LINK_DESIGN_KEYS) {
    const v = cust[key as string];
    if (v !== undefined && v !== null && v !== "") linkDesign[key as string] = v;
  }
  // Only what BRANDING needs. A header photo the owner uploaded for their own
  // Swift Links page ("custom") is usually a picture of them — copied, it would
  // headline every teammate's page. Left out: members' headers fall back to
  // Auto (each person's own photo), and the admin can still set a company
  // header on the Branding → Links tab. "photo"/"logo"/"initials" are rules
  // each page applies to its OWN data, so they carry over as chosen.
  if (linkDesign.linkHeroContent === "custom") delete linkDesign.linkHeroContent;
  delete linkDesign.linkHeroImage;
  delete linkDesign.linkHeroMediaType;
  const update: Record<string, unknown> = {
    brand_logo_url: (card.logo_url as string | null) ?? null,
    brand_company: (card.company as string | null) || null,
    brand_website: (card.website as string | null) || null,
    brand_template: (card.template as string | null) || null,
    brand_custom_layout: withoutFaceImage(cust.customLayout ?? null),
    brand_phone: officePhone?.trim() || null,
    brand_fax: (typeof cust.fax === "string" && cust.fax.trim()) || null,
    brand_address: Object.keys(address).length ? address : null,
    brand_design: extractDesign(cust),
    brand_link_design: Object.keys(linkDesign).length ? linkDesign : null,
  };

  const { error } = await admin.from("offices").update(update).eq("id", officeId);
  if (error) {
    // A newer column missing (pre-migration schema) — seed what we can.
    delete update.brand_design;
    delete update.brand_link_design;
    await admin.from("offices").update(update).eq("id", officeId);
  }

  // NOTE: the seed card is deliberately NOT flagged is_office_card. It used to
  // be — so branding saves kept reaching it — but that made the admin's own
  // card follow the office template forever. The seed is a one-time COPY of
  // the owner's look into the office brand; the owner's cards stay personal.

  await propagateBrandToOfficeCards(officeId);
}

// Strip the office brand from a departing member's cards — used on removal and
// on the webhook cascades. Only clears a field when the card's current value
// MATCHES the office brand (a personal value the member set themselves is
// never wiped); an ex-member must not walk away with the former employer's
// logo/company baked into their live public card.
export async function stripBrandFromUserCards(userId: string, brand: OfficeBrand | null): Promise<void> {
  if (!brand) return;
  const admin = getAdminSupabase();
  if (brand.logoUrl) {
    await admin.from("cards").update({ logo_url: null }).eq("user_id", userId).eq("is_office_card", true).eq("logo_url", brand.logoUrl);
  }
  if (brand.company) {
    await admin.from("cards").update({ company: "" }).eq("user_id", userId).eq("is_office_card", true).eq("company", brand.company);
    await admin.from("cards").update({ label: null }).eq("user_id", userId).eq("is_office_card", true).eq("label", brand.company);
  }
  if (brand.website) {
    await admin.from("cards").update({ website: "" }).eq("user_id", userId).eq("is_office_card", true).eq("website", brand.website);
  }
  // Company contact (phone/fax/address) AND the Swift Links half (bio,
  // Instagram, pinned links) both live per-card → one read/merge/write pass.
  //
  // The Links fields were missing here when the feature shipped, so a departing
  // employee kept the former employer's bio, company Instagram and booking
  // links live on their public page indefinitely — the exact thing this
  // function's first line exists to prevent, just for the newer fields. Their
  // OWN bio and handle come back at the same time, because this is where they
  // were being held.
  const needsContact = !!(brand.phone || brand.fax || brand.address);
  const needsLinks = !!(brand.linkBio || brand.linkInstagram || brand.links?.length);
  if (needsContact || needsLinks) {
    const { data: cards } = await admin
      .from("cards")
      .select("id, customization, instagram")
      .eq("user_id", userId)
      .eq("is_office_card", true);
    for (const c of cards ?? []) {
      let cust = c.customization as Record<string, unknown> | null;
      if (needsContact) cust = stripOfficeContact(cust, brand);
      const patch: Record<string, unknown> = {};
      if (needsLinks) {
        const out = releaseOfficeLinks(cust, c.instagram as string | null, brand);
        cust = out.customization;
        patch.instagram = out.instagram;
      }
      const { error } = await admin.from("cards").update({ ...patch, customization: cust ?? {} }).eq("id", c.id);
      if (error) console.error("[office-brand] de-brand failed for card", c.id, error.message);
    }
  }
  // template deliberately kept — a card must always have SOME template, and the
  // office's choice is as good a default as any once the brand fields are gone.
  await refreshCardSurfaces(userId);
}

/**
 * Undo the office's Swift Links branding on ONE card — used when a member
 * leaves, is removed, or the office's subscription cascades away.
 *
 * The mirror image of overlayOfficeLinks + overlayOfficeInstagram: give the
 * member their own bio and Instagram back, and take the company's pinned links
 * off the page while leaving every link they added themselves exactly where it
 * was.
 *
 * Conservative in the same way stripBrandFromUserCards is: a field is cleared
 * only when it still MATCHES the office's value. If a member's bio no longer
 * equals the company bio, it is theirs — something else set it — and it is left
 * alone. The design keys are deliberately NOT reverted: a page must have some
 * look, and the office's is as good a parting default as any (the same call
 * this function's caller already makes for `template`).
 *
 * Pure and total: returns new objects, never mutates its input.
 */
export function releaseOfficeLinks(
  customization: Record<string, unknown> | null | undefined,
  currentInstagram: string | null | undefined,
  brand: Pick<OfficeBrand, "linkBio" | "linkInstagram" | "links"> | null | undefined,
): { customization: Record<string, unknown>; instagram: string } {
  // Never null — cards.instagram is NOT NULL (see overlayOfficeInstagram).
  // Returning null for a member with no handle of their own failed the whole
  // de-brand write: an ex-member kept the office phone, fax, address, company
  // bio, Instagram and pinned links.
  const cust: Record<string, unknown> = { ...(customization ?? {}) };
  const current = currentInstagram ?? "";
  if (!brand) return { customization: cust, instagram: current };

  // Bio: hand back what they wrote, if the office's is still the one showing.
  // The held copy is dropped only when THAT field is being released: a call
  // releasing just the pinned links (the office replaced its links but kept
  // its bio) must not throw away the member's own bio waiting underneath —
  // nothing could ever bring it back after that.
  if (brand.linkBio) {
    if (cust.bio === brand.linkBio) {
      const own = cust[OWN_BIO];
      cust.bio = typeof own === "string" ? own : "";
    }
    delete cust[OWN_BIO];
  }

  // Instagram: same rule, on the top-level column.
  let instagram = current;
  if (brand.linkInstagram) {
    if (current === brand.linkInstagram) {
      const own = cust[OWN_INSTAGRAM];
      instagram = typeof own === "string" && own ? own : "";
    }
    delete cust[OWN_INSTAGRAM];
  }

  // Pinned links: drop the office's, keep theirs, by the same normalized-URL
  // identity pinOfficeLinks used to put them there.
  if (brand.links?.length && Array.isArray(cust.links)) {
    const officeUrls = new Set(
      brand.links.filter((l) => !isHeaderEntry(l)).map((l) => normalizeLinkUrl(l.url)),
    );
    const officeHeaders = new Set(
      brand.links.filter(isHeaderEntry).map((l) => normalizeHeaderLabel(l.label)),
    );
    cust.links = (cust.links as { url?: string; label?: string; office?: unknown }[]).filter((l) => {
      if (l?.office === true) return false;      // marked as the office's
      if (isHeaderEntry(l)) {
        return !officeHeaders.has(normalizeHeaderLabel(typeof l?.label === "string" ? l.label : ""));
      }
      return !officeUrls.has(normalizeLinkUrl(typeof l?.url === "string" ? l.url : ""));
    });
  }

  return { customization: cust, instagram };
}

// ── Managed-field rejection (sub-users only) ─────────────────────────────────
// Given the raw PATCH body an office SUB-USER submitted, list the org-managed
// fields the request tries to CHANGE. A field is a violation only when the
// submitted value differs from BOTH the office brand AND the card's CURRENT
// stored value — i.e. the user actively typed a new off-brand value. Echoing a
// stale value the card already holds (which happens whenever brand propagation
// lagged, e.g. the admin re-enabled the design lock and the design keys hadn't
// been pushed yet) is NOT a violation: it's allowed through and the overlays
// normalize it back to the brand. Without the "differs from both" rule, a
// legitimate personal-field save would be rejected forever on any card whose
// managed values drifted from the brand, with no way for the employee to
// recover. Fields the office left blank are never managed. Design fields count
// only while the office's design lock (lockTemplate) is on.
//
// `current` is the card's stored row (top-level company/website/logo_url/
// template + its customization). Pass {} to fall back to brand-only comparison.
export function findManagedFieldViolations(
  body: Record<string, unknown>,
  brand: OfficeBrand,
  current: { company?: unknown; website?: unknown; logo_url?: unknown; template?: unknown; customization?: Record<string, unknown> | null } = {},
): string[] {
  const out: string[] = [];
  const t = (v: unknown) => (v == null ? "" : String(v).trim());
  const cur = (current.customization ?? {}) as Record<string, unknown>;
  // changed(field, submitted, brandVal, currentVal): only a violation if the
  // submitted value matches neither the brand nor what's already on the card.
  const changed = (submitted: unknown, brandVal: string, currentVal: unknown) =>
    t(submitted) !== brandVal.trim() && t(submitted) !== t(currentVal);

  if (brand.company && "company" in body && changed(body.company, brand.company, current.company)) out.push("company name");
  if (brand.website && "website" in body && changed(body.website, brand.website, current.website)) out.push("website");
  if (brand.logoUrl && "logo_url" in body && changed(body.logo_url, brand.logoUrl, current.logo_url)) out.push("company logo");
  if (brand.lockTemplate && brand.template && "template" in body && changed(body.template, brand.template, current.template)) out.push("card design");
  const cust = body.customization as Record<string, unknown> | undefined;
  if (cust && typeof cust === "object") {
    if (brand.fax && brand.fax.trim() && "fax" in cust && changed(cust.fax, brand.fax, cur.fax)) out.push("fax number");
    if (brand.address && "address" in cust) {
      const a = (cust.address ?? {}) as Record<string, unknown>;
      const b = brand.address as Record<string, unknown>;
      const c = (cur.address ?? {}) as Record<string, unknown>;
      const keys = ["street", "unit", "city", "state", "zip"] as const;
      const diffsBrand = keys.some((k) => t(a[k]) !== t(b[k]));
      const diffsCurrent = keys.some((k) => t(a[k]) !== t(c[k]));
      if (diffsBrand && diffsCurrent) out.push("address");
    }
    if (brand.lockTemplate && brand.design && !out.includes("card design")) {
      for (const key of OFFICE_DESIGN_KEYS) {
        if (brand.design[key] !== undefined && key in cust && changed(cust[key], String(brand.design[key] ?? ""), cur[key])) {
          out.push("card design");
          break;
        }
      }
    }
  }
  return out;
}

// The plan a member should land on when they leave an office: members who had
// (and still have) their OWN Stripe subscription go back to Pro, not free —
// otherwise removing them from a team silently clobbers a subscription they
// are still paying for.
export async function memberFallbackPlan(userId: string): Promise<"pro" | "free"> {
  const admin = getAdminSupabase();
  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_subscription_id, customization")
    .eq("id", userId)
    .maybeSingle();
  return profile?.stripe_subscription_id || isApplePaid(profile?.customization) ? "pro" : "free";
}
