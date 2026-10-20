// ── The LinkedIn photo ticket: one key for the whole round trip ─────────────
//
// Every "Connect LinkedIn" tap makes a random ticket. It rides to the callback
// in a cookie (LinkedIn's redirect_uri is fixed, so it cannot ride in the URL),
// and the callback stores the imported photo — or why there isn't one — under
// it. The page that tapped holds the same ticket in localStorage and asks for
// its photo whenever it gets control back, however that happened: the URL
// return, the app's swiftcard:// link, the app's sheet being closed, a popup
// closing, or the user switching back to the tab. See lib/linkedin-photo-return.
//
// Shared by the server routes and the page, so nothing here touches a browser
// or server API.

/** A crypto.randomUUID() — the only shape a ticket can take. */
const TICKET_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isLinkedInTicket(t: unknown): t is string {
  return typeof t === "string" && TICKET_RE.test(t);
}

/** The cookie the connect leg leaves the ticket in for the callback. */
export const LINKEDIN_TICKET_COOKIE = "li_ticket";

/** Folder in the public card-uploads bucket the one-shot import writes to. */
export const LINKEDIN_TICKET_FOLDER = "guest-linkedin";

/** Where the ticket's photo lands. Deterministic, so the page can find it. */
export function ticketPhotoPath(t: string): string {
  return `${LINKEDIN_TICKET_FOLDER}/${t}.jpg`;
}

/** The outcomes the callback can leave instead of a photo. */
export const TICKET_FAILURES = ["nophoto", "error"] as const;
export type TicketFailure = (typeof TICKET_FAILURES)[number];

/**
 * The marker for a failed import. The bucket only accepts images and video, so
 * the status rides in the NAME of a 1×1 GIF rather than in a text file.
 */
export function ticketStatusPath(t: string, status: TicketFailure): string {
  return `${LINKEDIN_TICKET_FOLDER}/${t}.status-${status}.gif`;
}

/** Read a stored object's name back into what it says about the ticket. */
export function readTicketObject(t: string, name: string): { photo: true } | { status: TicketFailure } | null {
  if (name === `${t}.jpg`) return { photo: true };
  for (const s of TICKET_FAILURES) if (name === `${t}.status-${s}.gif`) return { status: s };
  return null;
}

/** The smallest valid GIF: one transparent pixel. */
export const BLANK_GIF = Uint8Array.from(
  atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"),
  (c) => c.charCodeAt(0),
);
