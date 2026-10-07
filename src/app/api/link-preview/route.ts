import { NextRequest, NextResponse } from "next/server";
import { safeFetch } from "@/lib/safe-fetch";
import { isRateLimited } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { faviconFor } from "@/lib/link-brand";
import { videoThumbnail } from "@/lib/video";
import { PREVIEW_AGENT, BROWSER_AGENT, extractImage, extractTitle, isHtml, readHead } from "@/lib/link-preview-scrape";

// Node runtime — the SSRF guard uses node:dns / node:net.
export const runtime = "nodejs";

// Open Graph fetcher for Swift Links thumbnails ("the face of the page"). Fetches the
// target page, pulls og:image / twitter:image + og:title, and ALWAYS returns an icon
// so links that block scraping still show a branded preview.
// SSRF is enforced by safeFetch (resolve + private-IP block + per-redirect recheck).
//
// The picture is the one the link previews with everywhere else (owner,
// 2026-10-07: "the default of that additional link is its preview"):
//   • YouTube / Vimeo — the video's own thumbnail, no scrape (YouTube puts its
//     og:image ~700 KB into a browser-agent page; the tile already used this).
//   • a direct image link — the image itself.
//   • any other page — its og:image, asked for the way iMessage asks
//     (lib/link-preview-scrape PREVIEW_AGENT), then as a browser.

type Preview = { image: string | null; favicon: string | null; title: string | null };
const cache = new Map<string, { data: Preview; at: number; ttl: number }>();
const TTL = 1000 * 60 * 60 * 24; // 24h
const RETRY_TTL = 1000 * 60 * 10; // 10 min

// `max-age` alone is a BROWSER cache: Vercel's CDN ignores it and every visitor
// to a Swift Links page reached the function, which re-scraped each link
// whenever the in-memory Map above was cold (a fresh serverless instance) — a
// third-party fetch of up to 5s per tile, per visit (perf audit 2026-10-06).
// s-maxage lets the CDN answer for a day per URL; stale-while-revalidate keeps
// answering instantly for a week while it refreshes in the background.
const CACHE_HEADERS = { "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800" };
// A lookup that never reached the page (timeout, network error, the site
// answering 403/5xx) says nothing about the link. Cached a day, one slow moment
// left a tile without its picture for a day and served stale for a week after.
// Ten minutes, then the next visitor asks again.
const RETRY_HEADERS = { "Cache-Control": "public, max-age=300, s-maxage=600" };

type Attempt = { reached: boolean; image: string | null; title: string | null };

async function scrapeAs(target: URL, agent: string, ms: number): Promise<Attempt> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await safeFetch(target.toString(), {
      signal: ctrl.signal,
      headers: {
        "User-Agent": agent,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/*;q=0.8,*/*;q=0.7",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    // Relative og:image paths resolve against where the page actually is,
    // after any redirects — not the address the owner typed.
    const base = res.url || target.toString();
    const ct = res.headers.get("content-type") || "";
    if (!res.ok) {
      res.body?.cancel().catch(() => {});
      return { reached: false, image: null, title: null };
    }
    if (/^image\//i.test(ct)) {
      res.body?.cancel().catch(() => {});
      return { reached: true, image: base, title: null };
    }
    if (!isHtml(ct)) {
      res.body?.cancel().catch(() => {});
      return { reached: true, image: null, title: null };
    }
    // The cheap substring test first: the full tag parse only runs once a
    // chunk could actually hold the picture.
    const html = await readHead(res, undefined, (h) => /og:image|twitter:image/i.test(h) && extractImage(h, base) !== null && extractTitle(h) !== null);
    return { reached: true, image: extractImage(html, base), title: extractTitle(html) };
  } catch {
    return { reached: false, image: null, title: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) return NextResponse.json({ image: null, favicon: null, title: null });

  let target: URL;
  try { target = new URL(raw.startsWith("http") ? raw : `https://${raw}`); }
  catch { return NextResponse.json({ image: null, favicon: null, title: null }); }

  // Always available, even when the page itself blocks scraping: the same
  // first-party icon every other surface shows (see /api/link-icon).
  const favicon = faviconFor(target.toString());

  // A video's thumbnail is known from its address alone.
  const video = videoThumbnail(target.toString());
  if (video) return NextResponse.json({ image: video, favicon, title: null }, { headers: CACHE_HEADERS });

  // A warm hit makes no outbound request, so it is answered before the rate
  // limiter (itself a store round trip) — the limiter guards the fetch below.
  const key = target.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) {
    return NextResponse.json(hit.data, { headers: hit.ttl === TTL ? CACHE_HEADERS : RETRY_HEADERS });
  }

  // SSRF-guarded, but cap per IP so it can't be used as an outbound fetch relay.
  const ip = clientIp(req);
  if (await isRateLimited(`linkpreview:${ip}`, 120, 10 * 60 * 1000)) {
    return NextResponse.json({ image: null, favicon, title: null }, { status: 429, headers: { "Cache-Control": "no-store" } });
  }

  // As iMessage first; as a browser only when that found no picture.
  const first = await scrapeAs(target, PREVIEW_AGENT, 5000);
  let { image, title } = first;
  let reached = first.reached;
  if (!image) {
    const second = await scrapeAs(target, BROWSER_AGENT, 4000);
    image = second.image;
    title = title || second.title;
    reached = reached || second.reached;
  }

  const data: Preview = { image, favicon, title };
  // A picture, or a page that was read and simply has none, is an answer worth
  // keeping. Anything else is asked again shortly.
  const settled = !!image || reached;
  cache.set(key, { data, at: Date.now(), ttl: settled ? TTL : RETRY_TTL });
  return NextResponse.json(data, { headers: settled ? CACHE_HEADERS : RETRY_HEADERS });
}
