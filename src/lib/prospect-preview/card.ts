import type { CardData } from "@/components/card-templates/types";
import { readableOn } from "./colors";
import type { ProspectPreview, TeamMember } from "./types";

// ── Card Builder: a preview row as a real card ──────────────────────────────
// Every preview wears the same house style (owner, 2026-11-11): the Logo First
// template, with the prospect's first brand colour as the card's ground and
// the second as its accent. The template itself keeps the accent readable
// against the ground by brightness (LogoFirst's readableAccent); that let two
// colours of the same lightness and different hue through (teal on green), so
// the accent is first made readable here, by contrast ratio (colors.ts
// readableOn). Any two colours work.
//
// A plain module (no server imports): the page, the admin's own look at a
// preview and the tests all build the same card from it.

export const HOUSE_TEMPLATE = "logo-first";

const APP_HOST = (process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me").replace(/^https?:\/\//, "");

export function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

/** "https://www.harborrealty.com/" → "harborrealty.com", as a card prints it. */
export function displayHost(url: string): string {
  try {
    const u = new URL(url);
    return (u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/$/, "")).slice(0, 60);
  } catch {
    return "";
  }
}

type Branded = Pick<ProspectPreview, "slug" | "office_name" | "logo_url" | "brand_primary" | "brand_secondary"> & Partial<Pick<ProspectPreview, "type_feel">>;

/** The card's type when their own site is set in a serif. Otherwise the house sans. */
const SERIF_STACK = "Georgia, 'Times New Roman', serif";

/** A short hash of an address, so a changed logo is never served from a cache. */
export function logoVersion(url: string): string {
  let h = 2166136261;
  for (let i = 0; i < url.length; i++) h = Math.imul(h ^ url.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/**
 * Where the page gets the logo WITH ITS MARGIN (lib/prospect-preview/logo-server).
 * Most logo files are cut tight to the artwork, and the card's tile clips to
 * the file's edges, so a raw file sits hard against them. The public page of
 * a published preview and staff's look at a draft each have their own route.
 */
export function paddedLogoSrc(p: Pick<ProspectPreview, "id" | "slug" | "logo_url"> & Partial<Pick<ProspectPreview, "brand_primary">>, forStaff: boolean): string | null {
  if (!p.logo_url) return null;
  // The card's colour is part of the picture (a logo that would blend into it
  // gets a plate behind it), so it is part of the address too.
  const v = logoVersion(`${p.logo_url}|${p.brand_primary ?? ""}`);
  return forStaff ? `/api/admin/card-builder/${p.id}/logo?v=${v}` : `/p/${p.slug}/logo?v=${v}`;
}

/** Their title with their licence line after it, the way a real card prints both. */
export function titleLine(title: string | null | undefined, license: string | null | undefined): string {
  return [title, license].map((s) => (s ?? "").trim()).filter(Boolean).join(" · ");
}

function base(p: Branded, logoSrc?: string | null): Pick<CardData, "company" | "logoUrl" | "photoUrl" | "cardUrl" | "customization"> {
  return {
    company: p.office_name,
    logoUrl: p.logo_url ? logoSrc ?? p.logo_url : null,
    photoUrl: null,
    // What the card's QR points at: this preview, never a card that isn't theirs.
    cardUrl: `${APP_HOST}/p/${p.slug}`,
    customization: { bgColor: p.brand_primary, accentColor: readableOn(p.brand_primary, p.brand_secondary), ...(p.type_feel === "serif" ? { fontFamily: SERIF_STACK } : {}) },
  };
}

/** The owner's card, at the top of the page and in the link preview. */
export function ownerCard(p: ProspectPreview, logoSrc?: string | null): CardData {
  return {
    ...base(p, logoSrc),
    name: p.owner_name,
    title: titleLine(p.owner_title, p.license),
    phone: p.phone,
    email: p.email ?? "",
    website: p.website ? displayHost(p.website) : "",
    address: p.address ?? "",
    initials: initialsOf(p.owner_name),
  };
}

/**
 * A teammate's card in the "Your team" strip. We only know their name and
 * title, so the card carries those under the office's logo and colours and
 * invents nothing: no phone number or email that isn't theirs.
 */
export function memberCard(p: Branded, m: TeamMember, logoSrc?: string | null): CardData {
  return { ...base(p, logoSrc), name: m.name, title: m.title, phone: "", email: "", initials: initialsOf(m.name) };
}

/** A short hash of everything the link-preview picture shows, for its ?v=. */
export function previewVersion(p: ProspectPreview): string {
  const s = [p.owner_name, p.owner_title, p.license, p.office_name, p.phone, p.email, p.logo_url, p.brand_primary, p.brand_secondary].join("|");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
