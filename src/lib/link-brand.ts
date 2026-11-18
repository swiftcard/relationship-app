// Brand marks and colour safety for the public card's Swift Links section.
//
// Pure and dependency-free so it can be unit-tested and used from both a server
// component and a client one.

/** Normalize a possibly-schemeless user-entered URL into something parseable.
 *  Null for a contact link (mailto:/tel:/sms: or a bare email address): it has
 *  no site, so no host line, no site logo and no monogram is read off it. */
function toUrl(raw: string): URL | null {
  const v = (raw || "").trim();
  if (!v || contactKind(v)) return null;
  const withScheme = /^(https?:)?\/\//i.test(v) ? v.replace(/^\/\//, "https://") : `https://${v.replace(/^[a-z][a-z0-9+.-]*:\/*/i, "")}`;
  try {
    return new URL(withScheme);
  } catch {
    return null;
  }
}

/**
 * The host as a human trust signal: lowercased, no "www.", no path.
 * This is the line under a feature link's label — on a professional's card the
 * visitor is checking "is this the real org", so the domain earns its own row.
 */
export function hostLabel(url: string): string {
  const u = toUrl(url);
  if (!u) return "";
  return u.hostname.replace(/^www\./i, "").toLowerCase();
}

/** The host to ask for a site's icon: lowercased, no "www." — one cache entry
 *  per site, and the icon is the same for both. Null for anything that is not
 *  a plausible public hostname. */
export function iconHost(raw: string): string | null {
  const h = (raw || "").trim().toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  if (!h || h.length > 253 || !h.includes(".")) return null;
  if (!/^[a-z0-9.-]+$/.test(h) || /^[.-]|[.-]$|\.\./.test(h)) return null;
  return h;
}

/**
 * A link's icon (its site's logo), derived from its hostname alone — the one
 * address every surface uses: the card page's Swift Links box, the Swift Links
 * page's rows and tiles, and the editor.
 *
 * It is /api/link-icon, not Google's favicon service directly. Google answers
 * "no icon" with a 404 that still carries a grey globe, and browsers LOAD it —
 * so a site Google doesn't know showed a meaningless globe instead of falling
 * back to the monogram, and there was no way to tell it from a real 16px logo
 * (Cash App's is one). The route sees the status, tries the site's own icon
 * and then its parent domain, and answers a real 404 when there is none, so
 * `onError` finally means "no logo".
 *
 * Still deliberately NOT /api/link-preview: that route is a page scrape with a
 * 5s abort and an IP rate limit a conference NAT would exhaust, and this page
 * is opened on mobile data seconds after a QR scan. The icon route is keyed by
 * host and CDN-cached for a week, so a visitor is answered from the edge — and
 * on the connection the page already has open, instead of two new handshakes
 * to google.com and gstatic.com.
 */
export function faviconFor(url: string): string | null {
  const u = toUrl(url);
  if (!u) return null;
  const host = iconHost(u.hostname);
  return host ? `/api/link-icon?host=${encodeURIComponent(host)}` : null;
}

/** Single uppercase letter for the monogram shown until (or instead of) a favicon. */
export function monogramFor(url: string): string {
  const host = hostLabel(url);
  const first = host.replace(/[^a-z0-9]/gi, "").charAt(0);
  return (first || "?").toUpperCase();
}

// Muted editorial gradients chosen FOR cream — every stop is dark enough to
// carry white type at AA. Deliberately not the /links page's neon set, which is
// tuned for a near-black background and reads as a party flyer here.
const TINTS = [
  "linear-gradient(135deg, #1E3A8A 0%, #3B4FA8 100%)", // indigo ink
  "linear-gradient(135deg, #14532D 0%, #2F6B4F 100%)", // forest
  "linear-gradient(135deg, #7C2D12 0%, #B45309 100%)", // clay
  "linear-gradient(135deg, #4C1D3F 0%, #7E2A5A 100%)", // plum
  "linear-gradient(135deg, #0F3D3E 0%, #1F6F6B 100%)", // deep teal
  "linear-gradient(135deg, #1E293B 0%, #3E4C63 100%)", // slate navy
];

/**
 * Stable tint for a link's monogram, hashed from the HOSTNAME.
 *
 * Hostname, not array index: indexing by position means reordering links
 * reshuffles every colour on the card (a real defect in SwiftLinkButtons). Keyed
 * on the host, the same domain is always the same colour, forever.
 */
export function monogramTint(url: string): string {
  const host = hostLabel(url);
  if (!host) return TINTS[0];
  let h = 0;
  for (let i = 0; i < host.length; i++) h = (h * 31 + host.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}

// NOTE: this file once exported safeAccent()/inkOn() — a luminance guard for
// filling a link button with the owner's accent colour. The accent-filled
// "feature" link was dropped (owner call: every action link is now the same
// quiet row), so nothing reads an accent on this surface any more and the
// helpers went with it rather than linger as untouched exports. If a saturated
// control ever returns here, the guard is mandatory, not optional:
// modern-bold's presets include "#ffffff" and plan.ts SNAPS a Free card's
// accent onto that list, so white-on-white is a real, reachable state.

/**
 * The fill behind a platform's glyph. Instagram is the only platform whose brand
 * is a gradient rather than a flat colour.
 *
 * Shared by the /links page's circles and the card page's disc rail so the two
 * surfaces can never disagree about what Instagram looks like.
 */
export function brandBackground(label: string, color?: string): string {
  if (label === "Instagram") {
    return "radial-gradient(circle at 30% 107%, #fdf497 0%, #fdf497 5%, #fd5949 45%, #d6249f 60%, #285AEB 90%)";
  }
  return color || "rgba(255,255,255,0.1)";
}

const CONTACT_SCHEME = /^(mailto|tel|sms):/i;
// One @, a dot in the domain, no spaces, no slash: "na276@cornell.edu".
const BARE_EMAIL = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;

/**
 * The ONE rule for turning an owner-typed link into an href, used by the card
 * page's link rows, the Swift Links page, the editor's thumbnails and the
 * vCard. Until 2026-11-18 it kept only http(s), so an "Email me" button saved
 * as mailto:… or as a bare address became https://na276@cornell.edu, a dead
 * page.
 *
 *   ""                      → "#"
 *   http(s)://…             → unchanged
 *   mailto:/tel:/sms:…      → unchanged (trimmed)
 *   a bare email address    → "mailto:" + it
 *   anything else           → "https://" + it, any leading scheme or slashes
 *                             stripped, so "javascript:alert(1)" can never
 *                             come back as a javascript: href
 */
export function fullHref(url: string): string {
  const v = (url || "").trim();
  if (!v) return "#";
  if (/^https?:\/\//i.test(v)) return v;
  if (CONTACT_SCHEME.test(v)) return v;
  if (BARE_EMAIL.test(v)) return `mailto:${v}`;
  return `https://${v.replace(/^[a-z][a-z0-9+.-]*:\/*/i, "").replace(/^\/+/, "")}`;
}

export type ContactKind = "email" | "phone" | "text";

/** What a contact link does, or null for a web link. Takes the raw value or
 *  its fullHref. */
export function contactKind(url: string): ContactKind | null {
  const v = (url || "").trim();
  const scheme = CONTACT_SCHEME.exec(v)?.[1]?.toLowerCase();
  if (scheme) return scheme === "mailto" ? "email" : scheme === "tel" ? "phone" : "text";
  return !/^https?:\/\//i.test(v) && BARE_EMAIL.test(v) ? "email" : null;
}

/** The address a contact link goes to, as a person reads it: the email
 *  address or the number, without the scheme or any ?subject=. */
export function contactAddress(url: string): string {
  const href = fullHref(url);
  const rest = href.replace(CONTACT_SCHEME, "").split("?")[0];
  try {
    return decodeURIComponent(rest);
  } catch {
    return rest;
  }
}

/** True for a link that should open in a new tab: a web page. A mailto:/tel:/
 *  sms: link opens an app; target=_blank opened a blank tab first on iPhone. */
export function opensNewTab(href: string): boolean {
  return /^https?:\/\//i.test(href);
}
