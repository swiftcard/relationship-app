// Shared vCard (RFC 6350 / vCard 3.0) builder.
//
// This de-duplicates the two vCard implementations that used to live inline in
// SaveContactButton (client "download my contact") and api/leads/vcard (server
// "download a captured lead"). Both now call buildVCard so escaping, field
// ordering, and the optional embedded PHOTO stay identical everywhere.
//
// The builder is PURE — it never fetches. Callers that want to embed a headshot
// fetch the image themselves (client: via the SSRF-guarded /api/img-proxy;
// server: fetched server-side) and hand the already-encoded bytes in as a
// VCardPhoto. A missing/failed image simply omits PHOTO — it never throws and
// never corrupts the card.

import { socialUrl } from "@/lib/social-url";
import { unitLine } from "@/lib/address-unit";
import { fullHref } from "@/lib/link-brand";

export type VCardPhone = { number: string; label?: string | null; showOnCard?: boolean };

/** One of the card's own Swift Links buttons ("Book a call", "Listings"). */
export type VCardLink = { label?: string | null; url?: string | null; kind?: string | null };

export type VCardAddress = {
  street?: string | null;
  unit?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

export interface VCardPerson {
  name: string;
  title?: string | null;
  company?: string | null;
  email?: string | null;
  /** Legacy single phone — used only when `phones` is empty. */
  phone?: string | null;
  phones?: VCardPhone[] | null;
  fax?: string | null;
  website?: string | null;
  /**
   * The saver's own SwiftCard link (https://swiftcard.me/<slug>).
   *
   * Saved into the contact so the card doesn't end at "Create New Contact":
   * everything that lives on the card but not in a vCard — the design, Swift
   * Links, testimonials, the full bio — stays one tap away from the contact
   * card forever. Especially matters for the QR flow, where the phone may never
   * have opened the card in a browser at all.
   */
  cardUrl?: string | null;
  /**
   * Free-text NOTE — for a captured lead, where you met them and your notes.
   *
   * The web "Save to phone" button hand-rolled its own vCard and included this;
   * the server route (which native uses) omitted it. So the same button
   * produced a different contact depending on the platform. Escaped like every
   * other field, unlike the hand-rolled version.
   */
  note?: string | null;
  address?: VCardAddress | null;
  linkedin?: string | null;
  instagram?: string | null;
  twitter?: string | null;
  tiktok?: string | null;
  facebook?: string | null;
  snapchat?: string | null;
  youtube?: string | null;
  /**
   * The card's other Swift Links buttons, exactly the ones the visitor sees
   * (already capped to the owner's plan by the caller — see cardContactLinks).
   */
  links?: VCardLink[] | null;
}

/**
 * The Swift Links buttons a saved contact carries: the ones the card page
 * shows, in its order. Headers are label-only rows and carry no link. Free
 * shows its first `freeMax`, so a contact never holds a link the card hides.
 * Shared by the card page (the button) and the server vCard (phones, QR scans,
 * the app) so the two can't disagree.
 */
export function cardContactLinks(raw: unknown, freeMax: number | null): VCardLink[] {
  const all = (Array.isArray(raw) ? raw : []) as VCardLink[];
  const shown = freeMax === null ? all : all.slice(0, freeMax);
  return shown.filter((l) => l && l.kind !== "header" && String(l.label ?? "").trim() && String(l.url ?? "").trim());
}

export interface VCardPhoto {
  /** Base64 payload — a bare base64 string OR a full `data:` URL (both accepted). */
  base64: string;
  /** Image mime type (e.g. "image/jpeg"). Inferred from a data: URL if omitted. */
  mime?: string | null;
}

export type ContactImageKind = "headshot" | "logo";

/**
 * The last-resort contact picture: the person's initials, white on SwiftCard
 * blue. Drawn when a card has neither a headshot nor a logo — or when the one
 * it has fails to load — so the "Create New Contact" sheet never opens on an
 * empty picture (owner order 2026-09-25: headshot → logo → initials). The
 * browser draws it on a canvas (SaveContactButton), the server with Satori
 * (lib/contact-initials-photo); both read these values so they match.
 */
export const CONTACT_INITIALS_BG = "#1D4ED8";
export const CONTACT_INITIALS_FG = "#FFFFFF";

/** Up to two initials from a name ("Alex Morgan" → "AM"), "" when there is no name. */
export function contactInitials(name: string | null | undefined): string {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const firstChar = (w: string) => Array.from(w)[0] ?? "";
  const picked = words.length === 1 ? [words[0]] : [words[0], words[words.length - 1]];
  return picked.map(firstChar).join("").toUpperCase();
}

/**
 * Which picture a saved contact carries: the person's headshot first, their
 * company logo when there is no headshot (owner order 2026-09-24 — a contact
 * exchanged through SwiftCard always lands in the phone with a face or a
 * logo), and their initials when there is neither (contactInitials above).
 * Pure and client-safe; the server-side lookup for a captured lead lives in
 * lib/contact-photo.ts.
 */
export function pickContactImage(
  headshotUrl: string | null | undefined,
  logoUrl: string | null | undefined,
): { url: string; kind: ContactImageKind } | null {
  const h = (headshotUrl ?? "").trim();
  if (h) return { url: h, kind: "headshot" };
  const l = (logoUrl ?? "").trim();
  if (l) return { url: l, kind: "logo" };
  return null;
}

// vCard escaping (RFC 6350): a ";", "," or "\" in a value would otherwise shift
// field boundaries and corrupt (or, for visitor-supplied values, inject into)
// the saved contact. Newlines are collapsed so they can't add fake fields.
export function escapeVCardValue(v?: string | null): string {
  return String(v ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/([,;\\])/g, "\\$1")
    .trim();
}

// NOTE is free text — a bio is written in paragraphs, and collapsing its line
// breaks to spaces ran them together in the saved contact. RFC 6350 §3.4 lets a
// text value carry a newline as the two characters "\n", which every Contacts
// app turns back into a real line break; a raw CR/LF can still never start a
// new property, so this is exactly as injection-safe as escapeVCardValue.
export function escapeVCardText(v?: string | null): string {
  return String(v ?? "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .replace(/([,;\\])/g, "\\$1")
    .replace(/\n/g, "\\n");
}

// Absolute URL for a bare domain / handle so URL/social lines are clickable.
export function normalizeVCardUrl(url?: string | null): string {
  const s = String(url ?? "").trim();
  if (!s) return "";
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

// Every social, in the card's own order (lib/social-url buildConnectLinks),
// with the name the contact shows next to it.
const SOCIAL_ROWS = [
  ["linkedin", "LinkedIn"],
  ["instagram", "Instagram"],
  ["tiktok", "TikTok"],
  ["facebook", "Facebook"],
  ["twitter", "X"],
  ["snapchat", "Snapchat"],
  ["youtube", "YouTube"],
] as const;

// Same link written two ways ("https://www.x.com/a/", "x.com/a") is one row.
function sameLinkKey(url: string): string {
  return url.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
}

// A Swift Links button's address, as the card's button opens it (fullHref), or
// null when it isn't a web address at all.
function linkButtonUrl(raw?: string | null): string | null {
  const href = fullHref(String(raw ?? ""));
  try {
    return new URL(href).hostname.includes(".") ? href : null;
  } catch {
    return null;
  }
}

// Build the folded PHOTO line, or null if the payload is unusable. iOS/macOS
// import a base64-embedded photo reliably in vCard 3.0 form:
//   PHOTO;ENCODING=b;TYPE=JPEG:<base64>
// Long lines are folded at 75 octets with a leading space on continuations
// (RFC 2426 §2.6) so strict parsers still accept the card.
function photoLine(photo: VCardPhoto): string | null {
  let b64 = (photo.base64 || "").trim();
  if (!b64) return null;

  let mime = (photo.mime || "").toLowerCase();
  const dataMatch = b64.match(/^data:([^;,]+)?(?:;base64)?,([\s\S]*)$/i);
  if (dataMatch) {
    if (!mime && dataMatch[1]) mime = dataMatch[1].toLowerCase();
    b64 = dataMatch[2];
  }
  b64 = b64.replace(/\s+/g, "");
  // Guard: must look like base64 and carry real bytes.
  if (!b64 || !/^[A-Za-z0-9+/=]+$/.test(b64)) return null;

  const type = /png/.test(mime)
    ? "PNG"
    : /gif/.test(mime)
    ? "GIF"
    : /webp/.test(mime)
    ? "WEBP"
    : "JPEG";

  const full = `PHOTO;ENCODING=b;TYPE=${type}:${b64}`;
  const folded: string[] = [];
  for (let i = 0; i < full.length; i += 74) {
    folded.push((i === 0 ? "" : " ") + full.slice(i, i + 74));
  }
  return folded.join("\r\n");
}

// Assemble a complete vCard string. Empty/absent fields are simply omitted.
export function buildVCard(person: VCardPerson, photo?: VCardPhoto | null): string {
  const esc = escapeVCardValue;
  const name = (person.name || "").trim();
  const parts = name.split(" ");
  const first = parts[0] ?? "";
  const rest = parts.slice(1).join(" ");

  const lines: string[] = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${esc(name)}`,
    `N:${esc(rest)};${esc(first)};;;`,
  ];

  if (person.title) lines.push(`TITLE:${esc(person.title)}`);
  if (person.company) lines.push(`ORG:${esc(person.company)}`);
  if (person.email) lines.push(`EMAIL;TYPE=WORK:${esc(person.email)}`);

  // All phones, typed (mobile → CELL, office → WORK); fall back to the legacy
  // single phone; fax last.
  const phones = (Array.isArray(person.phones) ? person.phones : []).filter((p) => p?.number?.trim());
  if (phones.length) {
    for (const p of phones) {
      // Case-insensitive: the office overlay writes the label as "Office" (capital
      // O), which used to miss this === "office" check and export office numbers
      // as CELL. (cards audit L2)
      const type = String(p.label).toLowerCase() === "office" ? "WORK,VOICE" : "CELL,VOICE";
      lines.push(`TEL;TYPE=${type}:${esc(p.number)}`);
    }
  } else if (person.phone) {
    lines.push(`TEL:${esc(person.phone)}`);
  }
  if (person.fax && person.fax.trim()) lines.push(`TEL;TYPE=FAX:${esc(person.fax)}`);

  // Every link after the website is a NAMED row: "SwiftCard", "Instagram",
  // "Book a call". Written the way iPhone Contacts writes its own custom
  // labels — itemN.URL + itemN.X-ABLabel — which iPhone reads back as that
  // name and Android saves as a website row; on both the row opens the link.
  // Socials used to be X-SOCIALPROFILE lines, which Android drops entirely, and
  // Facebook, Snapchat, YouTube and the Swift Links buttons weren't written at
  // all — a contact saved from a card simply lost them.
  const seen = new Set<string>();
  let item = 0;
  const namedLink = (label: string, url: string) => {
    const key = sameLinkKey(url);
    if (!key || seen.has(key)) return;
    seen.add(key);
    item += 1;
    lines.push(`item${item}.URL:${esc(url)}`);
    lines.push(`item${item}.X-ABLabel:${esc(label.trim().slice(0, 40))}`);
  };

  if (person.website) {
    const site = normalizeVCardUrl(person.website);
    lines.push(`URL:${esc(site)}`);
    seen.add(sameLinkKey(site));
  }

  // Their SwiftCard itself, as its own row rather than a second anonymous URL
  // indistinguishable from their website.
  if (person.cardUrl) namedLink("SwiftCard", normalizeVCardUrl(person.cardUrl));

  // socialUrl (not normalizeVCardUrl) — the same address the card's own button
  // opens, so a pasted link, an @handle and a bare handle all land on the
  // right profile ("john-doe" → linkedin.com/in/john-doe, not https://john-doe).
  for (const [platform, label] of SOCIAL_ROWS) {
    const url = socialUrl(platform, person[platform]);
    if (url) namedLink(label, url);
  }

  for (const l of Array.isArray(person.links) ? person.links : []) {
    if (!l || l.kind === "header") continue;
    const url = linkButtonUrl(l.url);
    const label = String(l.label ?? "").trim();
    if (url && label) namedLink(label, url);
  }

  const addr = person.address;
  if (addr && (addr.street || addr.city || addr.state || addr.zip)) {
    const street = [addr.street, unitLine(addr.unit)].filter(Boolean).join(" ");
    lines.push(`ADR;TYPE=WORK:;;${esc(street)};${esc(addr.city)};${esc(addr.state)};${esc(addr.zip)};`);
  }

  if (person.note && person.note.trim()) lines.push(`NOTE:${escapeVCardText(person.note)}`);

  // Embedded headshot — best-effort; a bad/missing image is silently skipped so
  // saving a contact never breaks over a photo.
  if (photo) {
    const pl = photoLine(photo);
    if (pl) lines.push(pl);
  }

  lines.push("END:VCARD");
  // Trailing CRLF: RFC 6350 §3.2 ends a vCard with END:VCARD *followed by* a
  // line break, and every line in the body is already CRLF-delimited. Every
  // mainstream parser (iOS Contacts, Android, Outlook) accepts the file without
  // it — which is why this went unnoticed — but strict parsers and anything
  // concatenating multiple vCards into one stream need the terminator to know
  // where this card ends.
  return lines.join("\r\n") + "\r\n";
}
