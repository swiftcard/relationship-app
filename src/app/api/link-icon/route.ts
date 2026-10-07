import { NextRequest, NextResponse } from "next/server";
import { safeFetch } from "@/lib/safe-fetch";
import { isRateLimited } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { iconHost } from "@/lib/link-brand";
import { PREVIEW_AGENT, extractIcons, isHtml, parentHost, readHead } from "@/lib/link-preview-scrape";

// Node runtime — the SSRF guard uses node:dns / node:net.
export const runtime = "nodejs";

// ── The little logo beside an additional link ───────────────────────────────
//
// GET /api/link-icon?host=calendly.com → the site's icon, or a 404 when it has
// none. Every surface asks here (lib/link-brand faviconFor): the card page's
// Swift Links box, the Swift Links page's rows and tile chips, the editor.
//
// Why not Google's favicon service directly, as before: it answers "no icon"
// with a 404 whose body is a grey globe, and browsers LOAD that — so `onError`
// never fired, and a site Google doesn't know (a new business site, a form
// host) showed a globe where the monogram should be. Here the status is seen:
//   1. Google's icon for the host (fast, sized, right for nearly every site);
//   2. the site's own declared icon — apple-touch-icon first, then
//      <link rel="icon">, then /favicon.ico;
//   3. Google's icon for the parent domain (book.squareup.com → squareup.com);
//   4. none → 404, and the caller paints its monogram / emoji / link glyph.
//
// Served from swiftcard.me, so it carries img-proxy's armour: images only, a
// sandbox CSP, nosniff, a size cap — and a site's SVG is drawn to a PNG before
// it is served, so no document from another site ever goes out under our name.

const MAX_BYTES = 512 * 1024;
const IMAGE_TYPE = /^image\/(png|jpe?g|gif|webp|avif|svg\+xml|x-icon|vnd\.microsoft\.icon|bmp)$/i;

// One cache entry per site: icons change rarely, so the edge answers for a
// week and keeps answering while it refreshes. A site with no icon is
// remembered for a day; a lookup that could not finish, for ten minutes.
const FOUND = "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000";
const NONE = "public, max-age=3600, s-maxage=86400";
const RETRY = "public, max-age=300, s-maxage=600";

type Icon = { body: Uint8Array; type: string };

async function readCapped(res: Response): Promise<Uint8Array | null> {
  if (Number(res.headers.get("content-length") || 0) > MAX_BYTES) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf.byteLength > 0 && buf.byteLength <= MAX_BYTES ? buf : null;
}

function asIcon(res: Response, body: Uint8Array | null): Icon | null {
  const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!body) return null;
  // Some servers label favicon.ico as octet-stream; the ICO magic number
  // (00 00 01 00) settles it.
  if (!IMAGE_TYPE.test(type)) {
    if (body[0] === 0 && body[1] === 0 && body[2] === 1 && body[3] === 0) return { body, type: "image/x-icon" };
    return null;
  }
  return { body, type };
}

/**
 * A real logo, not a placeholder. Site builders ship a 1×1 transparent GIF as
 * the "favicon" (remarkit.capital's, served as image/x-icon, measured
 * 2026-10-07) — which would fade the monogram out for an invisible square.
 * Anything under 16px, or that doesn't decode, is no icon at all.
 */
async function isRealLogo(icon: Icon): Promise<boolean> {
  const b = icon.body;
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) {
    // ICO: a directory of images; the byte at 6 + 16i is each one's width
    // (0 means 256).
    const count = b[4] | (b[5] << 8);
    if (!count || b.byteLength < 6 + 16 * count) return false;
    let widest = 0;
    for (let i = 0; i < count; i++) widest = Math.max(widest, b[6 + 16 * i] || 256);
    return widest >= 16;
  }
  try {
    const sharp = (await import("sharp")).default;
    const { width = 0, height = 0 } = await sharp(Buffer.from(b), { animated: false }).metadata();
    return width >= 16 && height >= 16;
  } catch {
    return false;
  }
}

/**
 * A site's SVG icon, drawn to a 128px PNG. An SVG is a document that can carry
 * script, and this route serves the owner-typed site's bytes from
 * swiftcard.me; the sandbox CSP below already stops it running, but a PNG has
 * nothing to stop. Undrawable → no icon.
 */
async function rasterize(icon: Icon): Promise<Icon | null> {
  try {
    const sharp = (await import("sharp")).default;
    const body = await sharp(Buffer.from(icon.body), { density: 384 })
      .resize(128, 128, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    return { body: new Uint8Array(body), type: "image/png" };
  } catch {
    return null;
  }
}

/** Google's icon, or null when it has none. `failed` is set when Google could
 *  not be asked at all, so the answer is not cached as "no icon". */
async function fromGoogle(host: string, state: { failed: boolean }): Promise<Icon | null> {
  try {
    const res = await fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.status === 404) { res.body?.cancel().catch(() => {}); return null; }
    if (!res.ok) { state.failed = true; res.body?.cancel().catch(() => {}); return null; }
    return asIcon(res, await readCapped(res));
  } catch {
    state.failed = true;
    return null;
  }
}

/** The site's own declared icon. */
async function fromSite(host: string, state: { failed: boolean }): Promise<Icon | null> {
  const deadline = AbortSignal.timeout(5000);
  let candidates: string[] = [];
  let base = `https://${host}/`;
  try {
    const res = await safeFetch(base, {
      signal: deadline,
      headers: { "User-Agent": PREVIEW_AGENT, Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" },
    });
    base = res.url || base;
    if (res.ok && isHtml(res.headers.get("content-type") || "")) {
      candidates = extractIcons(await readHead(res, 600_000), base);
    } else {
      res.body?.cancel().catch(() => {});
    }
  } catch {
    // The page would not load; /favicon.ico may still answer.
  }
  candidates.push(new URL("/favicon.ico", base).toString());
  for (const href of [...new Set(candidates)].slice(0, 4)) {
    try {
      const res = await safeFetch(href, { signal: deadline, headers: { "User-Agent": PREVIEW_AGENT, Accept: "image/*,*/*;q=0.5" } });
      if (!res.ok) { res.body?.cancel().catch(() => {}); continue; }
      const raw = asIcon(res, await readCapped(res));
      const icon = raw && raw.type === "image/svg+xml" ? await rasterize(raw) : raw;
      if (icon && (await isRealLogo(icon))) return icon;
    } catch {
      if (deadline.aborted) { state.failed = true; break; }
    }
  }
  return null;
}

function serve(icon: Icon): NextResponse {
  return new NextResponse(new Uint8Array(icon.body), {
    status: 200,
    headers: {
      "Content-Type": icon.type,
      "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": 'inline; filename="icon"',
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": FOUND,
    },
  });
}

export async function GET(req: NextRequest) {
  const host = iconHost(req.nextUrl.searchParams.get("host") || "");
  if (!host) return new NextResponse(null, { status: 400, headers: { "Cache-Control": NONE } });

  const state = { failed: false };
  const google = await fromGoogle(host, state);
  if (google) return serve(google);

  // Past here the route fetches an owner-typed host, so it is capped per IP
  // like the other outbound routes. The CDN answers repeat visitors before
  // this line is ever reached.
  if (await isRateLimited(`linkicon:${clientIp(req)}`, 120, 10 * 60 * 1000)) {
    return new NextResponse(null, { status: 429, headers: { "Cache-Control": "no-store" } });
  }

  const own = await fromSite(host, state);
  if (own) return serve(own);

  const parent = parentHost(host);
  if (parent) {
    const up = await fromGoogle(parent, state);
    if (up) return serve(up);
  }

  return new NextResponse(null, { status: 404, headers: { "Cache-Control": state.failed ? RETRY : NONE } });
}
