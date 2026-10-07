// ── Create + : the share link of something the owner linked ─────────────────
//
// The Links page's Create + side turns anything a Pro/Office owner pastes or
// drops — an email signature, a picture — into something that opens their
// SwiftCard (components/CreateLinkBox). Every click on it goes to ONE address:
//
//     https://swiftcard.me/<card slug>/p/<id>
//
// That page IS the card page (src/app/[username]/p/[id]/page.tsx), tracked as
// source "create_link". Its link preview is the thing they linked, so the same
// address pasted into iMessage or WhatsApp — apps that throw a clickable
// picture away and keep only the link — still shows their picture, and a tap
// still opens their card.
//
// The id names the picture in storage, so there is no table to keep in sync:
// the upload route stores it as card-uploads/<ownerId>/create-<ms>.<ext>, and
// the id is that timestamp plus one letter for the extension. The owner comes
// from the slug, so a /p/ link can only ever show its own card owner's upload.
//
// Pure (no DOM, no server imports): used by the browser and by the route.

export const CREATE_SOURCE = "create_link";

/** Gmail refuses a signature over 10,000 characters of HTML. */
export const GMAIL_SIGNATURE_LIMIT = 10_000;

/** The usual email content width — a lone picture is never shown wider. */
export const EMAIL_MAX_WIDTH = 600;

const EXT_LETTER: Record<string, string> = { jpg: "j", png: "p", gif: "g" };
const LETTER_EXT: Record<string, string> = { j: "jpg", p: "png", g: "gif" };

/** "create-1728330000000.png" (or a public URL ending in it) → "1728330000000p". */
export function createIdFromUpload(fileOrUrl: string): string | null {
  const m = /(?:^|\/)create-(\d{13})\.(jpg|png|gif)(?:[?#].*)?$/.exec(fileOrUrl);
  return m ? `${m[1]}${EXT_LETTER[m[2]]}` : null;
}

/** "1728330000000p" → "create-1728330000000.png"; null for anything else. */
export function createFileFromId(id: string): string | null {
  const m = /^(\d{13})([jpg])$/.exec(id);
  return m ? `create-${m[1]}.${LETTER_EXT[m[2]]}` : null;
}

export function isCreateId(id: string): boolean {
  return createFileFromId(id) !== null;
}

/** The one address every part of a creation opens. */
export function createShareUrl(appUrl: string, slug: string, id: string): string {
  return `${appUrl.replace(/\/+$/, "")}/${slug}/p/${id}`;
}

/** When there's no picture to preview (the capture failed): the card itself,
 *  still tracked as a Create link. */
export function createFallbackUrl(appUrl: string, slug: string): string {
  return `${appUrl.replace(/\/+$/, "")}/${slug}?source=${CREATE_SOURCE}`;
}
