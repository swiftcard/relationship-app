// ── Reading a web page's own preview: picture, title, icon ──────────────────
//
// Shared by /api/link-preview (a Swift Links tile's picture) and
// /api/link-icon (the little logo beside every additional link). Server-only:
// the readers take a fetch Response; the extractors are pure strings-in,
// strings-out so they can be tested without the network.

/** What iMessage sends when it builds a link preview. Instagram, Facebook,
 *  TikTok and Zillow answer a browser with a login wall, a 403 or a page with no
 *  preview tags at all — and answer THIS with their real og:image, because they
 *  want their links to preview. Measured 2026-10-07: a Chrome agent got a
 *  picture from none of those four, this one from all of them. It is also,
 *  exactly, "the link's preview" an owner has seen in Messages. */
export const PREVIEW_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0";

/** A desktop browser — the second try, for the sites that turn bots away. */
export const BROWSER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** How far into a page to look for its <head> tags. YouTube's head runs to
 *  ~1.2 MB and a Zillow listing's og:image sits at ~175 KB — the old 180 KB cap
 *  stopped short of both. Reading stops early at </head> or once a picture is
 *  found, so a normal page costs what it always did. */
export const HEAD_READ_CAP = 1_500_000;

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/").replace(/&#47;/g, "/")
    .replace(/&#39;/g, "'").replace(/&#x27;/gi, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
}

type Attrs = Record<string, string>;

/** Every <meta>/<link> tag's attributes, in any order and any quoting. Sites
 *  write content= before property=, name= instead of property=, single quotes
 *  or none — a fixed regex per ordering missed real pages. */
function tagsNamed(html: string, tag: "meta" | "link"): Attrs[] {
  const out: Attrs[] = [];
  const re = new RegExp(`<${tag}\\b([^>]*)>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const attrs: Attrs = {};
    const ar = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
    let a: RegExpExecArray | null;
    while ((a = ar.exec(m[1]))) attrs[a[1].toLowerCase()] = decodeEntities((a[2] ?? a[3] ?? a[4] ?? "").trim());
    out.push(attrs);
  }
  return out;
}

function absolute(raw: string, baseUrl: string): string | null {
  try {
    const u = new URL(raw, baseUrl);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// Strongest claim first: the page's declared share picture, then Twitter's,
// then the older schema.org / image_src conventions some CMSs still emit.
const IMAGE_KEYS = ["og:image:secure_url", "og:image:url", "og:image", "twitter:image", "twitter:image:src", "image"];

/** The page's preview picture (og:image and its fallbacks), absolute, or null. */
export function extractImage(html: string, baseUrl: string): string | null {
  const metas = tagsNamed(html, "meta");
  for (const key of IMAGE_KEYS) {
    for (const t of metas) {
      const k = (t.property || t.name || t.itemprop || "").toLowerCase();
      if (k !== key || !t.content) continue;
      const abs = absolute(t.content, baseUrl);
      if (abs) return abs;
    }
  }
  for (const t of tagsNamed(html, "link")) {
    if ((t.rel || "").toLowerCase() === "image_src" && t.href) {
      const abs = absolute(t.href, baseUrl);
      if (abs) return abs;
    }
  }
  return null;
}

export function extractTitle(html: string): string | null {
  const metas = tagsNamed(html, "meta");
  for (const key of ["og:title", "twitter:title"]) {
    const t = metas.find((x) => (x.property || x.name || "").toLowerCase() === key && x.content);
    if (t) return t.content;
  }
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m?.[1] ? decodeEntities(m[1].trim()) || null : null;
}

/**
 * The page's own declared icons, best first, absolute. apple-touch-icon is the
 * site's logo at 180px — sharper than any favicon — so it leads; then sized
 * icons largest first; then the rest. mask-icon is skipped: it is a one-colour
 * silhouette meant to be tinted, and shows as a black blob untinted.
 */
export function extractIcons(html: string, baseUrl: string): string[] {
  const scored: { href: string; score: number; i: number }[] = [];
  tagsNamed(html, "link").forEach((t, i) => {
    const rel = (t.rel || "").toLowerCase().split(/\s+/);
    if (!t.href || rel.includes("mask-icon")) return;
    const touch = rel.includes("apple-touch-icon") || rel.includes("apple-touch-icon-precomposed");
    if (!touch && !rel.includes("icon")) return;
    const abs = absolute(t.href, baseUrl);
    if (!abs) return;
    const size = Number((t.sizes || "").match(/(\d+)x\d+/i)?.[1] || 0);
    const svg = /\.svg(\?|#|$)/i.test(abs) || /svg/i.test(t.type || "");
    const score = touch ? 1000 + (size || 180) : svg ? 900 : size ? Math.min(size, 512) : 1;
    scored.push({ href: abs, score, i });
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return [...new Set(scored.map((s) => s.href))];
}

export function isHtml(contentType: string): boolean {
  return /text\/html|application\/xhtml\+xml/i.test(contentType);
}

/**
 * Read a page up to its </head> (or `cap` bytes), stopping early once `enough`
 * says the head already holds what is needed. Cancels the rest of the body so
 * a 2 MB page never downloads in full.
 */
export async function readHead(res: Response, cap = HEAD_READ_CAP, enough?: (html: string) => boolean): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, cap);
  const dec = new TextDecoder();
  let html = "";
  let total = 0;
  try {
    while (total < cap) {
      const { done, value } = await reader.read();
      if (done) break;
      html += dec.decode(value, { stream: true });
      total += value.byteLength;
      if (/<\/head>/i.test(html.slice(-value.byteLength - 8))) break;
      if (enough?.(html)) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return html;
}

/**
 * The site one level up — "book.squareup.com" → "squareup.com" — for a
 * subdomain Google has no icon for (a booking widget, a form host). Null when
 * there is no level to drop, or when dropping one would leave a public suffix
 * like "co.uk".
 */
export function parentHost(host: string): string | null {
  const parts = host.split(".");
  if (parts.length < 3) return null;
  const parent = parts.slice(1);
  const [sld, tld] = parent.slice(-2);
  if (parent.length === 2 && tld.length === 2 && ["co", "com", "org", "net", "gov", "ac", "edu"].includes(sld)) return null;
  return parent.join(".");
}
