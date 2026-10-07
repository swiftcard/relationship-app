// Brand marks and colour safety for the public card's Swift Links section.
//
// Pure and dependency-free so it can be unit-tested and used from both a server
// component and a client one.

/** Normalize a possibly-schemeless user-entered URL into something parseable. */
function toUrl(raw: string): URL | null {
  const v = (raw || "").trim();
  if (!v) return null;
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

/** Normalize a user-entered link for use as an href. Matches the existing rule. */
export function fullHref(url: string): string {
  const v = (url || "").trim();
  if (!v) return "#";
  return /^https?:\/\//i.test(v) ? v : `https://${v.replace(/^[a-z][a-z0-9+.-]*:\/*/i, "")}`;
}
