import { NextRequest, NextResponse } from "next/server";
import { safeFetch } from "@/lib/safe-fetch";
import { isRateLimited } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";

// Node runtime — the SSRF guard uses node:dns / node:net.
export const runtime = "nodejs";

// Open Graph fetcher for Swift Links thumbnails ("the face of the page"). Fetches the
// target page, pulls og:image / twitter:image + og:title, and ALWAYS returns a favicon
// so links that block scraping (e.g. Zillow's PerimeterX) still show a branded preview.
// SSRF is enforced by safeFetch (resolve + private-IP block + per-redirect recheck).

type Preview = { image: string | null; favicon: string | null; title: string | null };
const cache = new Map<string, { data: Preview; at: number }>();
const TTL = 1000 * 60 * 60 * 24; // 24h

// `max-age` alone is a BROWSER cache: Vercel's CDN ignores it and every visitor
// to a Swift Links page reached the function, which re-scraped each link
// whenever the in-memory Map above was cold (a fresh serverless instance) — a
// third-party fetch of up to 5s per tile, per visit (perf audit 2026-10-06).
// s-maxage lets the CDN answer for a day per URL; stale-while-revalidate keeps
// answering instantly for a week while it refreshes in the background.
const CACHE_HEADERS = { "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800" };

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/").replace(/&#47;/g, "/")
    .replace(/&#39;/g, "'").replace(/&#x27;/gi, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
}

function firstMatch(html: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeEntities(m[1].trim());
  }
  return null;
}

function extractImage(html: string, baseUrl: string): string | null {
  const raw = firstMatch(html, [
    /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:image:url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
  ]);
  if (!raw) return null;
  try { return new URL(raw, baseUrl).toString(); } catch { return raw; }
}

function extractTitle(html: string): string | null {
  return firstMatch(html, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
    /<title[^>]*>([^<]+)<\/title>/i,
  ]);
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) return NextResponse.json({ image: null, favicon: null, title: null });

  let target: URL;
  try { target = new URL(raw.startsWith("http") ? raw : `https://${raw}`); }
  catch { return NextResponse.json({ image: null, favicon: null, title: null }); }

  // Always available, even when the page itself blocks scraping.
  const favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(target.hostname)}&sz=128`;

  // A warm hit makes no outbound request, so it is answered before the rate
  // limiter (itself a store round trip) — the limiter guards the fetch below.
  const key = target.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) {
    return NextResponse.json(hit.data, { headers: CACHE_HEADERS });
  }

  // SSRF-guarded, but cap per IP so it can't be used as an outbound fetch relay.
  const ip = clientIp(req);
  if (await isRateLimited(`linkpreview:${ip}`, 120, 10 * 60 * 1000)) {
    return NextResponse.json({ image: null, favicon: null, title: null }, { status: 429, headers: { "Cache-Control": "no-store" } });
  }

  let image: string | null = null;
  let title: string | null = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await safeFetch(target.toString(), {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    clearTimeout(timer);

    const ct = res.headers.get("content-type") || "";
    if (res.ok && ct.includes("text/html")) {
      const reader = res.body?.getReader();
      let html = "";
      if (reader) {
        const dec = new TextDecoder();
        let total = 0;
        while (total < 180_000) {
          const { done, value } = await reader.read();
          if (done) break;
          html += dec.decode(value, { stream: true });
          total += value.byteLength;
          if (html.includes("</head>")) break;
        }
        reader.cancel().catch(() => {});
      } else {
        html = await res.text();
      }
      image = extractImage(html, target.toString());
      title = extractTitle(html);
    }
  } catch {
    /* blocked / timeout — favicon fallback still returned */
  }

  const data: Preview = { image, favicon, title };
  cache.set(key, { data, at: Date.now() });
  return NextResponse.json(data, { headers: CACHE_HEADERS });
}
