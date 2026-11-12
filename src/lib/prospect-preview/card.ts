import type { CardData } from "@/components/card-templates/types";
import type { ProspectPreview, TeamMember } from "./types";

// ── Card Builder: a preview row as a real card ──────────────────────────────
// Every preview wears the same house style (owner, 2026-11-11): the Logo First
// template, with the prospect's first brand colour as the card's ground and
// the second as its accent. The template itself keeps the accent readable
// against the ground (LogoFirst's readableAccent), so any two colours work.
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

type Branded = Pick<ProspectPreview, "slug" | "office_name" | "logo_url" | "brand_primary" | "brand_secondary">;

function base(p: Branded): Pick<CardData, "company" | "logoUrl" | "photoUrl" | "cardUrl" | "customization"> {
  return {
    company: p.office_name,
    logoUrl: p.logo_url,
    photoUrl: null,
    // What the card's QR points at: this preview, never a card that isn't theirs.
    cardUrl: `${APP_HOST}/p/${p.slug}`,
    customization: { bgColor: p.brand_primary, accentColor: p.brand_secondary },
  };
}

/** The owner's card, at the top of the page and in the link preview. */
export function ownerCard(p: ProspectPreview): CardData {
  return {
    ...base(p),
    name: p.owner_name,
    title: p.owner_title ?? "",
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
export function memberCard(p: Branded, m: TeamMember): CardData {
  return { ...base(p), name: m.name, title: m.title, phone: "", email: "", initials: initialsOf(m.name) };
}

/** A short hash of everything the link-preview picture shows, for its ?v=. */
export function previewVersion(p: ProspectPreview): string {
  const s = [p.owner_name, p.owner_title, p.office_name, p.phone, p.email, p.logo_url, p.brand_primary, p.brand_secondary].join("|");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
