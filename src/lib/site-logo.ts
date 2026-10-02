import { safeFetch } from "@/lib/safe-fetch";
import { getLogoProvider, isPersonalEmailDomain, isValidDomain, type LogoCandidate } from "@/lib/logo-provider";

// ── Logo from the company's own website ─────────────────────────────────────
// Third source for "Suggest my company logo", after the name search and the
// work-email domain. When the user has typed their website we:
//   1. ask Logo.dev for that EXACT domain (the cleanest, square, hosted logo);
//   2. failing that, read the site's homepage and take the logo it declares
//      about itself: schema.org Organization logo → an <img> marked "logo" →
//      apple-touch-icon → a large / SVG favicon. og:image is never used — it's
//      a share banner, not a logo.
// Every candidate image is fetched once to prove it is a real, loadable image
// before it's offered. Nothing is applied until the user picks it.

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const HTML_CAP = 400_000;
const IMAGE_CAP = 3 * 1024 * 1024;
const IMAGE_TYPE = /^image\/(png|jpe?g|gif|webp|avif|svg\+xml)$/i;

/** "https://www.Acme.com/about" | "acme.com" → "acme.com" (null if not a domain). */
export function websiteToDomain(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s || s.length > 500 || /\s/.test(s)) return null;
  let host: string;
  try {
    host = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  host = host.replace(/^www\./, "").replace(/\.$/, "");
  if (!isValidDomain(host) || isPersonalEmailDomain(host)) return null;
  return host;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/").replace(/&#47;/g, "/")
    .replace(/&#39;/g, "'").replace(/&#x27;/gi, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  const v = m ? (m[1] ?? m[2] ?? m[3] ?? "") : "";
  return v.trim() ? decodeEntities(v.trim()) : null;
}

function absolute(src: string, base: string): string | null {
  if (/^data:/i.test(src)) return null;
  try {
    const u = new URL(src, base);
    // Upgrade http assets: the card is served over https and would block them.
    if (u.protocol === "http:") u.protocol = "https:";
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// schema.org: "logo": "https://…" or "logo": { "url": "https://…" }
function jsonLdLogos(html: string): string[] {
  const out: string[] = [];
  const blocks = html.match(/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) ?? [];
  for (const b of blocks) {
    const body = b.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
    let data: unknown;
    try { data = JSON.parse(body); } catch { continue; }
    const visit = (n: unknown, depth: number) => {
      if (!n || typeof n !== "object" || depth > 6) return;
      if (Array.isArray(n)) { n.forEach((x) => visit(x, depth + 1)); return; }
      const o = n as Record<string, unknown>;
      const logo = o.logo;
      if (typeof logo === "string") out.push(logo);
      else if (logo && typeof logo === "object") {
        const url = (logo as Record<string, unknown>).url ?? (logo as Record<string, unknown>).contentUrl;
        if (typeof url === "string") out.push(url);
      }
      for (const v of Object.values(o)) if (v && typeof v === "object") visit(v, depth + 1);
    };
    visit(data, 0);
  }
  return out;
}

/**
 * Pure: the logo URLs a homepage declares about itself, best first. Exported
 * for tests — no network.
 */
export function extractSiteLogoUrls(html: string, pageUrl: string): string[] {
  const ordered: string[] = [];

  ordered.push(...jsonLdLogos(html));

  // <img> whose src / alt / class / id says "logo" — usually the header wordmark.
  // Skip ones that are clearly someone else's (partner / client / award strips).
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const src = attr(tag, "src") ?? attr(tag, "data-src");
    if (!src) continue;
    // A long alt is a photo DESCRIBED as containing a logo, not the logo.
    const alt = attr(tag, "alt") ?? "";
    const hay = [src, alt.length <= 60 ? alt : "", attr(tag, "class"), attr(tag, "id"), attr(tag, "elementtiming")]
      .join(" ").toLowerCase();
    if (!/logo/.test(hay)) continue;
    // Demo / placeholder art on a template site is not the company's logo.
    if (/demo|sample|placeholder|example/.test(hay)) continue;
    if (/partner|client|customer|sponsor|award|badge|footer|payment|press|featured/.test(hay)) continue;
    ordered.push(src);
  }

  // Icons: apple-touch-icon (≥180px) beats a big favicon beats an SVG favicon.
  const links = html.match(/<link\b[^>]*>/gi) ?? [];
  const icons: Array<{ href: string; score: number }> = [];
  for (const tag of links) {
    const rel = (attr(tag, "rel") ?? "").toLowerCase();
    const href = attr(tag, "href");
    if (!href || !/icon/.test(rel)) continue;
    const size = Math.max(0, ...((attr(tag, "sizes") ?? "").match(/\d+/g) ?? []).map(Number));
    const svg = /\.svg(\?|$)/i.test(href) || /svg/i.test(attr(tag, "type") ?? "");
    if (/apple-touch-icon/.test(rel)) icons.push({ href, score: 1000 + size });
    else if (size >= 96) icons.push({ href, score: 500 + size });
    else if (svg) icons.push({ href, score: 400 });
  }
  icons.sort((a, b) => b.score - a.score);
  ordered.push(...icons.map((i) => i.href));

  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ordered) {
    const abs = absolute(raw, pageUrl);
    if (abs && !/\.ico(\?|$)/i.test(abs) && !seen.has(abs)) {
      seen.add(abs);
      out.push(abs);
    }
  }
  return out;
}

export function extractSiteName(html: string, domain: string): string {
  let raw: string | null = null;
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if ((attr(tag, "property") ?? "").toLowerCase() === "og:site_name") { raw = attr(tag, "content"); break; }
  }
  raw ??= html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.split(/\s[|\-–—:·]\s/)[0] ?? null;
  const name = raw ? decodeEntities(decodeEntities(raw)).trim() : "";
  return name && name.length <= 80 ? name : domain;
}

// HTML: keep the first `max` bytes (the header logo and <head> are near the
// top) instead of discarding a big page outright.
async function readHead(res: Response, max: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let html = "";
  let total = 0;
  while (total < max) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    html += dec.decode(value, { stream: true });
  }
  reader.cancel().catch(() => {});
  return html;
}

async function readCapped(res: Response, max: number): Promise<Buffer | null> {
  if (Number(res.headers.get("content-length") || 0) > max) return null;
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      try { await reader.cancel(); } catch { /* ignore */ }
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function fetchWithTimeout(url: string, accept: string, ms: number): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await safeFetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": BROWSER_UA, Accept: accept, "Accept-Language": "en-US,en;q=0.9" },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// A real, loadable image of a usable size (a 1×1 tracker or an empty file is not a logo).
async function isUsableImage(url: string): Promise<boolean> {
  const res = await fetchWithTimeout(url, "image/*", 4000);
  if (!res?.ok) return false;
  const type = (res.headers.get("content-type") || "").split(";")[0].trim();
  if (!IMAGE_TYPE.test(type)) return false;
  const buf = await readCapped(res, IMAGE_CAP);
  return !!buf && buf.byteLength >= 200;
}

/** Read the homepage and return the logo it declares, verified to load. */
export async function scrapeSiteLogo(domain: string): Promise<LogoCandidate | null> {
  for (const pageUrl of [`https://${domain}/`, `https://www.${domain}/`]) {
    const res = await fetchWithTimeout(pageUrl, "text/html,application/xhtml+xml", 6000);
    if (!res?.ok || !(res.headers.get("content-type") || "").includes("text/html")) continue;
    const html = await readHead(res, HTML_CAP);
    const finalUrl = res.url || pageUrl;
    // First three candidates only — bounded work per click.
    for (const logoUrl of extractSiteLogoUrls(html, finalUrl).slice(0, 3)) {
      if (await isUsableImage(logoUrl)) {
        return { name: extractSiteName(html, domain), domain, logoUrl };
      }
    }
    return null; // the page loaded but declares no usable logo — don't retry www.
  }
  return null;
}

/**
 * The logo for the user's website: Logo.dev's exact-domain match first, the
 * site's own declared logo second. Never throws.
 */
export async function logoForWebsite(website: string | null | undefined): Promise<LogoCandidate | null> {
  const domain = websiteToDomain(website);
  if (!domain) return null;
  try {
    const provider = getLogoProvider();
    if (provider.isConfigured()) {
      const r = await provider.suggest(domain);
      const exact = r.candidates.find((c) => c.domain === domain || domain.endsWith(`.${c.domain}`));
      if (exact) return exact;
    }
    return await scrapeSiteLogo(domain);
  } catch {
    return null;
  }
}
