import { createHash } from "node:crypto";
import { canonicalJson } from "@/lib/profile-customization";

// ── Two editors on one card (audit C02-006) ──────────────────────────────────
//
// Every Save in Edit card sends the whole form, and the server merged it over
// the row with no check — so a phone and a laptop (or two tabs) editing the
// same card silently overwrote each other's links, colours and photo, and the
// losing one still said "Saved".
//
// The card row has no updated_at, so the version is a fingerprint of exactly
// what the editor writes: these columns and these customization keys, read
// from the stored row. The edit page sends it down with the card; a Save sends
// it back; a mismatch means someone else saved in between, and the editor asks
// before replacing their work. Keys the editor never writes (the `_` system
// keys, the slug, view counters) are left out, so background writes can't
// raise a false alarm.
//
// tests/card-edit-version.test.ts holds the customization list to the editor's
// actual save body.

export const CARD_EDIT_COLUMNS = [
  "name", "company", "title", "email", "website", "phone", "label", "template", "logo_url",
  "linkedin", "instagram", "twitter", "tiktok",
] as const;

export const CARD_EDIT_CUSTOMIZATION_KEYS = [
  "bio", "facebook", "snapchat", "youtube", "address", "links", "customLayout", "phones", "fax",
  "accentColor", "bgColor", "surfaceColor", "textColor", "infoColor", "titleColor", "companyColor",
  "fontFamily", "finish", "panelMedia", "panelMediaType", "panelMediaPoster", "panelDim", "photoShape",
  "linkLook", "linkIconShape", "linkIconFill", "linkBgColor", "linkTextColor", "linkFontFamily",
  "linkHeroStyle", "linkHeroContent", "linkHeroImage", "linkHeroMediaType", "linkButtonStyle",
  "linkButtonColor", "linkBgMedia", "linkBgMediaType", "linkBgDim", "linkGlass", "linkAccentColor",
  "hideCardLink", "photoUrl", "logoShape",
] as const;

/** The `select` that reads everything cardEditVersion needs. */
export const CARD_EDIT_SELECT = `${CARD_EDIT_COLUMNS.join(", ")}, customization`;

export const CARD_CHANGED_ELSEWHERE = "CARD_CHANGED_ELSEWHERE";

/** Fingerprint of the editor-owned part of a stored card row. */
export function cardEditVersion(row: Record<string, unknown>): string {
  const cust = (row.customization ?? {}) as Record<string, unknown>;
  const picked = {
    c: Object.fromEntries(CARD_EDIT_COLUMNS.map((k) => [k, row[k] ?? null])),
    x: Object.fromEntries(CARD_EDIT_CUSTOMIZATION_KEYS.map((k) => [k, cust[k] ?? null])),
  };
  return createHash("sha256").update(canonicalJson(picked)).digest("hex").slice(0, 24);
}
