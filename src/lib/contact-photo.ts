// The picture a saved contact carries — SERVER SIDE.
//
// Owner order 2026-09-24: whenever two people exchange details through
// SwiftCard, the person whose details are being saved should land in the other
// person's phone WITH their face — or, failing that, their company's logo.
// Both directions:
//
//   • Visitor saves the CARD  → owner's headshot, else the card's logo.
//     (client: SaveContactButton via pickContactImage; server: the QR / native
//     path in api/card/[username]/vcard.)
//   • Owner saves a LEAD who shared their info → resolveLeadImageUrl below.
//     A lead has no photo field, so the picture is found, never stored:
//       1. the lead is a SwiftCard user themselves (their contact email is on a
//          live card) → that card's headshot, else its logo, else the account
//          photo;
//       2. otherwise a business email → the company's logo from the branding
//          provider (lib/logo-provider), only on an EXACT domain match so a
//          stranger's logo never ends up on a contact.
//
// Everything here is best-effort and never throws: a missing or unusable
// picture simply omits PHOTO and the contact still saves.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  pickContactImage, contactLogoBackground, visibleLuminance,
  CONTACT_PHOTO_EDGE, CONTACT_PHOTO_MAX_BYTES, CONTACT_PHOTO_QUALITIES, CONTACT_LOGO_BOX,
  type ContactImageKind, type VCardPhoto,
} from "@/lib/vcard";
import { safeFetch } from "@/lib/safe-fetch";
import { cardHeadshot } from "@/lib/card-media";
import { isCardActive, ownerIsDeleted } from "@/lib/card-active";
import { extractEmailDomain, getLogoProvider, isPersonalEmailDomain } from "@/lib/logo-provider";

/** Past this iOS/Android start refusing the .vcf outright — never exceed it. */
export const VCARD_PHOTO_MAX_BYTES = 700_000;
/** Longest edge of the embedded picture. Contacts shows it at ~200pt. */
export const VCARD_PHOTO_EDGE = 512;
const FETCH_TIMEOUT_MS = 4000;

export type { ContactImageKind };

/**
 * Fetch a picture and shrink it for embedding.
 *
 * photo_url / logo_url are owner-controlled and this runs on PUBLIC,
 * unauthenticated routes, so a plain fetch() here would be a server-side
 * request to any address the owner names — cloud metadata, an internal
 * Supabase port. safeFetch rejects non-http(s) schemes, localhost/.internal
 * names and private IPs, pins DNS at connect time and re-validates every
 * redirect hop. Never swap it back to bare fetch().
 *
 * The bytes are then resized to VCARD_PHOTO_EDGE with sharp (a headshot to
 * JPEG, a logo to PNG so its transparency survives). A 1000px upload can run
 * past the 700KB ceiling, and before this the ceiling silently DROPPED the
 * photo — the contact saved with no face, the exact thing the owner asked to
 * never happen. If sharp is unavailable the raw bytes are used when they fit.
 */
export async function fetchVCardPhoto(
  url: string,
  kind: ContactImageKind = "headshot",
  // forContact: the picture goes INTO a saved contact (the vCard routes), so it
  // is finished by contactPhotoFromBytes. Left off by the link-preview image,
  // which needs the logo's transparency and its own proportions.
  opts: { forContact?: boolean } = {},
): Promise<VCardPhoto | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await safeFetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!type.startsWith("image/")) return null;
    const raw = Buffer.from(await res.arrayBuffer());
    if (!raw.byteLength) return null;
    // Anything past a few MB is not a headshot; don't hand it to the resizer.
    if (raw.byteLength > 6_000_000) return null;

    if (opts.forContact) {
      const finished = await contactPhotoFromBytes(raw, kind);
      if (finished) return finished;
      // No sharp: the upload itself, only when it is already a picture
      // Contacts reads and small enough to survive iCloud.
      if (raw.byteLength > CONTACT_PHOTO_MAX_BYTES || !/^image\/(jpeg|png)$/.test(type)) return null;
      return { base64: raw.toString("base64"), mime: type };
    }

    const shrunk = await shrinkForVCard(raw, kind);
    if (shrunk) return shrunk;

    if (raw.byteLength > VCARD_PHOTO_MAX_BYTES) return null;
    // SVG can't be resized without sharp and iOS Contacts won't render it.
    if (!/^image\/(jpeg|png|gif|webp)$/.test(type)) return null;
    return { base64: raw.toString("base64"), mime: type };
  } catch {
    return null;
  }
}

async function shrinkForVCard(raw: Buffer, kind: ContactImageKind): Promise<VCardPhoto | null> {
  try {
    const sharp = (await import("sharp")).default;
    const img = sharp(raw, { animated: false })
      .rotate()
      .resize(VCARD_PHOTO_EDGE, VCARD_PHOTO_EDGE, { fit: "inside", withoutEnlargement: true });
    const out = kind === "logo"
      ? await img.png({ compressionLevel: 9 }).toBuffer()
      : await img.jpeg({ quality: 82 }).toBuffer();
    if (!out.byteLength || out.byteLength > VCARD_PHOTO_MAX_BYTES) return null;
    return { base64: out.toString("base64"), mime: kind === "logo" ? "image/png" : "image/jpeg" };
  } catch {
    return null;
  }
}

// The JFIF APP0 segment every camera, browser and Contacts itself writes after
// SOI. libvips leaves it out (its JPEGs open FF D8 FF DB). Most decoders
// accept that, but a saved contact's picture should be the plainest JPEG there
// is, not one that relies on a decoder being lenient.
const JFIF_APP0 = Buffer.from([
  0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
]);

/** The same JPEG with a JFIF header, when it has none. Anything else is returned as is. */
export function withJfifHeader(jpeg: Buffer): Buffer {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) return jpeg;
  return Buffer.concat([jpeg.subarray(0, 2), JFIF_APP0, jpeg.subarray(2)]);
}

/**
 * Any picture → the picture a saved contact carries (see lib/vcard, "The
 * picture as iPhone keeps it"): a CONTACT_PHOTO_EDGE square JPEG with a JFIF
 * header, no larger than CONTACT_PHOTO_MAX_BYTES.
 *
 *   • headshot (and the initials tile): fills the square, centred — the same
 *     crop the card's round headshot shows.
 *   • logo: whole, centred in CONTACT_LOGO_BOX of the square on white — or on
 *     dark when the logo itself is near-white — so the circle Contacts cuts
 *     never clips it and transparency never turns black.
 *
 * Null when the bytes aren't a picture sharp can read; the caller falls back.
 */
export async function contactPhotoFromBytes(raw: Buffer, kind: ContactImageKind): Promise<VCardPhoto | null> {
  try {
    const sharp = (await import("sharp")).default;
    const edge = CONTACT_PHOTO_EDGE;
    let square: Buffer;
    if (kind === "logo") {
      const box = Math.round(edge * CONTACT_LOGO_BOX);
      const logo = await sharp(raw, { animated: false })
        .rotate()
        .resize(box, box, { fit: "inside" })
        .ensureAlpha()
        .png()
        .toBuffer();
      const sample = await sharp(logo).resize(48, 48, { fit: "inside" }).ensureAlpha().raw().toBuffer();
      const background = contactLogoBackground(visibleLuminance(sample));
      square = await sharp({ create: { width: edge, height: edge, channels: 3, background } })
        .composite([{ input: logo, gravity: "centre" }])
        .png()
        .toBuffer();
    } else {
      square = await sharp(raw, { animated: false })
        .rotate()
        .resize(edge, edge, { fit: "cover", position: "centre" })
        .flatten({ background: "#ffffff" })
        .png()
        .toBuffer();
    }
    for (const quality of CONTACT_PHOTO_QUALITIES) {
      const jpeg = withJfifHeader(
        await sharp(square).flatten({ background: "#ffffff" }).jpeg({ quality, chromaSubsampling: "4:2:0" }).toBuffer(),
      );
      if (jpeg.byteLength && jpeg.byteLength <= CONTACT_PHOTO_MAX_BYTES) {
        return { base64: jpeg.toString("base64"), mime: "image/jpeg" };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Literal ilike: `%`, `_` and `\` in an address match themselves, never as wildcards. */
export function escapeIlikeLiteral(v: string): string {
  return v.replace(/[\\%_]/g, (c) => `\\${c}`);
}

type LeadForImage = { email?: string | null; phone?: string | null };
type CardRowForImage = {
  username?: string | null;
  user_id?: string | null;
  customization?: unknown;
  logo_url?: string | null;
};

/**
 * Find the picture for a captured lead (see the header). Returns the image URL
 * and whether it is a face or a logo, or null when nothing trustworthy exists.
 */
export async function resolveLeadImageUrl(
  admin: SupabaseClient,
  lead: LeadForImage,
): Promise<{ url: string; kind: ContactImageKind } | null> {
  const email = typeof lead.email === "string" ? lead.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@") || email.length > 254) return null;

  const fromCard = await fromSwiftCardUser(admin, email).catch(() => null);
  if (fromCard) return fromCard;

  return fromCompanyDomain(email).catch(() => null);
}

// 1. The lead has a SwiftCard of their own: the address they typed into the
//    share form is the contact email on one of their cards (or their account).
//    Only a LIVE card counts — an offline / deleted / over-limit card is not
//    public, so its picture must not leak out through a contact file either.
async function fromSwiftCardUser(
  admin: SupabaseClient,
  email: string,
): Promise<{ url: string; kind: ContactImageKind } | null> {
  const literal = escapeIlikeLiteral(email);

  const { data: cards } = await admin
    .from("cards")
    .select("username, user_id, customization, logo_url")
    .ilike("email", literal)
    .order("created_at", { ascending: true })
    .limit(5);

  for (const card of (cards ?? []) as CardRowForImage[]) {
    if (!card.username) continue;
    if (!(await isCardActive(card.username))) continue;

    // Same per-card resolution the card page uses: the card's own headshot,
    // falling back to the account photo only for cards that never set one.
    let headshot = cardHeadshot(card.customization, null);
    if (!headshot && card.user_id && !Object.prototype.hasOwnProperty.call(card.customization ?? {}, "photoUrl")) {
      const { data: owner } = await admin.from("profiles").select("photo_url").eq("id", card.user_id).maybeSingle();
      headshot = cardHeadshot(card.customization, (owner?.photo_url as string | null) ?? null);
    }
    const pick = pickContactImage(headshot, card.logo_url);
    if (pick) return pick;
  }

  // Legacy: the address is the ACCOUNT email of a SwiftCard user with no
  // matching card row — the account photo is what their card shows.
  const { data: profile } = await admin
    .from("profiles")
    .select("photo_url, customization")
    .ilike("email", literal)
    .limit(1)
    .maybeSingle();
  if (profile && !ownerIsDeleted(profile.customization)) {
    const pick = pickContactImage(profile.photo_url as string | null, null);
    if (pick) return pick;
  }
  return null;
}

// 2. A business address → the company's logo. Gmail / iCloud / Outlook and the
//    rest of the personal providers are skipped (there is no company to show,
//    and "Google" on every gmail contact would be wrong). The provider returns
//    ranked GUESSES; only a candidate whose domain is exactly the address's
//    domain (or a parent of it: mail.acme.com → acme.com) is accepted.
async function fromCompanyDomain(email: string): Promise<{ url: string; kind: ContactImageKind } | null> {
  const domain = extractEmailDomain(email);
  if (!domain || isPersonalEmailDomain(domain)) return null;

  const provider = getLogoProvider();
  if (!provider.isConfigured()) return null;
  const result = await provider.suggest(domain);
  if (result.status !== "ok") return null;

  const match = result.candidates.find((c) => {
    const d = c.domain.toLowerCase();
    return d === domain || domain.endsWith(`.${d}`);
  });
  if (!match) return null;
  return { url: withLogoSize(match.logoUrl), kind: "logo" };
}

// Logo.dev serves 128px by default; ask for a sharper tile when the URL is
// theirs. Any other host is used exactly as returned.
export function withLogoSize(url: string, size = 256): string {
  try {
    const u = new URL(url);
    if (u.hostname.toLowerCase() === "img.logo.dev" && !u.searchParams.has("size")) {
      u.searchParams.set("size", String(size));
      return u.toString();
    }
  } catch { /* leave it */ }
  return url;
}
