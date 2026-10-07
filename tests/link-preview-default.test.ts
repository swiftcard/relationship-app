// ── An additional link's default preview, and its little logo ──────────────
//
// Owner, 2026-10-07: "the default of that additional link is its preview (the
// link's preview) … if a user decides not to put a cover image or video on
// that additional link, you have to make sure that the link's default preview
// is working perfectly and that it works every time … make sure the little
// icon that shows on each additional link shows the correct preview or logo."
//
// What was wrong, each measured against production before the fix:
//   • Instagram, Facebook, TikTok and Zillow gave a browser-agent scrape a 403,
//     a login wall or no tags — no picture. Asked as iMessage asks, all four
//     answer with their real og:image.
//   • YouTube's og:image sits ~700 KB into its page; the reader stopped at 180 KB.
//   • A timeout was cached for a day and served stale for a week.
//   • Google answers "no icon" with a 404 carrying a grey globe that browsers
//     LOAD — so the "no icon" fallback never ran.
//   • A tile picture that failed to load in the browser had no onError: a
//     broken box.
//   • The card page's logos loaded before hydration, missed onLoad, and stayed
//     invisible behind their monograms.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractImage, extractTitle, extractIcons, parentHost, PREVIEW_AGENT } from "@/lib/link-preview-scrape";

const code = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const BASE = "https://example.com/listings/12";

describe("extractImage — the page's own preview picture", () => {
  it("reads og:image whichever order the attributes come in", () => {
    expect(extractImage(`<meta property="og:image" content="https://cdn.x/a.jpg">`, BASE)).toBe("https://cdn.x/a.jpg");
    expect(extractImage(`<meta content="https://cdn.x/b.jpg" property="og:image" />`, BASE)).toBe("https://cdn.x/b.jpg");
    expect(extractImage(`<meta property='og:image' content='https://cdn.x/c.jpg'>`, BASE)).toBe("https://cdn.x/c.jpg");
  });

  it("accepts name= where a CMS wrote it instead of property=", () => {
    expect(extractImage(`<meta name="og:image" content="https://cdn.x/d.jpg">`, BASE)).toBe("https://cdn.x/d.jpg");
  });

  it("prefers secure_url, then og:image, then twitter, then schema.org, then image_src", () => {
    const html = `
      <link rel="image_src" href="https://cdn.x/5.jpg">
      <meta itemprop="image" content="https://cdn.x/4.jpg">
      <meta name="twitter:image" content="https://cdn.x/3.jpg">
      <meta property="og:image" content="https://cdn.x/2.jpg">
      <meta property="og:image:secure_url" content="https://cdn.x/1.jpg">`;
    expect(extractImage(html, BASE)).toBe("https://cdn.x/1.jpg");
    expect(extractImage(`<meta name="twitter:image" content="https://cdn.x/3.jpg"><meta itemprop="image" content="/4.jpg">`, BASE)).toBe("https://cdn.x/3.jpg");
    expect(extractImage(`<meta itemprop="image" content="/4.jpg">`, BASE)).toBe("https://example.com/4.jpg");
    expect(extractImage(`<link rel="image_src" href="https://cdn.x/5.jpg">`, BASE)).toBe("https://cdn.x/5.jpg");
  });

  it("resolves relative pictures against the page and decodes entities", () => {
    expect(extractImage(`<meta property="og:image" content="/og.png?a=1&amp;b=2">`, BASE)).toBe("https://example.com/og.png?a=1&b=2");
    expect(extractImage(`<meta property="og:image" content="//cdn.x/e.png">`, BASE)).toBe("https://cdn.x/e.png");
  });

  it("ignores empty and non-web values", () => {
    expect(extractImage(`<meta property="og:image" content="">`, BASE)).toBeNull();
    expect(extractImage(`<meta property="og:image" content="javascript:alert(1)">`, BASE)).toBeNull();
    expect(extractImage(`<html><head><title>x</title></head></html>`, BASE)).toBeNull();
  });
});

describe("extractTitle", () => {
  it("og:title first, then the <title>", () => {
    expect(extractTitle(`<title>Plain</title><meta property="og:title" content="Rich &amp; Real">`)).toBe("Rich & Real");
    expect(extractTitle(`<title> Plain </title>`)).toBe("Plain");
    expect(extractTitle(`<p>none</p>`)).toBeNull();
  });
});

describe("extractIcons — the site's own logo, sharpest first", () => {
  it("puts apple-touch-icon ahead of sized icons ahead of the rest, and skips mask-icon", () => {
    const html = `
      <link rel="icon" href="/favicon-16.png" sizes="16x16">
      <link rel="mask-icon" href="/safari.svg">
      <link rel="shortcut icon" href="/favicon.ico">
      <link rel="icon" href="/favicon-96.png" sizes="96x96">
      <link rel="apple-touch-icon" href="/apple-touch-icon.png">`;
    expect(extractIcons(html, BASE)).toEqual([
      "https://example.com/apple-touch-icon.png",
      "https://example.com/favicon-96.png",
      "https://example.com/favicon-16.png",
      "https://example.com/favicon.ico",
    ]);
  });
  it("finds nothing on a page with no icon links", () => {
    expect(extractIcons(`<head><title>x</title></head>`, BASE)).toEqual([]);
  });
});

describe("parentHost — a subdomain borrows its site's logo", () => {
  it("drops one level", () => {
    expect(parentHost("api.leadconnectorhq.com")).toBe("leadconnectorhq.com");
    expect(parentHost("book.squareup.com")).toBe("squareup.com");
  });
  it("never climbs to a bare suffix", () => {
    expect(parentHost("calendly.com")).toBeNull();
    expect(parentHost("shop.co.uk")).toBeNull();
    expect(parentHost("agent.com.au")).toBeNull();
  });
});

describe("/api/link-preview — the picture the link previews with everywhere else", () => {
  const route = code("src/app/api/link-preview/route.ts");

  it("asks as iMessage first, as a browser second", () => {
    expect(PREVIEW_AGENT).toMatch(/facebookexternalhit\/1\.1/);
    const first = route.indexOf("scrapeAs(target, PREVIEW_AGENT");
    const second = route.indexOf("scrapeAs(target, BROWSER_AGENT");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
  });

  it("answers a video link with its own frame, no scrape", () => {
    expect(route).toMatch(/const video = videoThumbnail\(target\.toString\(\)\)/);
    expect(route.indexOf("videoThumbnail(target")).toBeLessThan(route.indexOf("isRateLimited("));
  });

  it("does not cache a lookup that never reached the page for a day", () => {
    expect(route).toMatch(/RETRY_HEADERS = \{ "Cache-Control": "public, max-age=300, s-maxage=600" \}/);
    expect(route).toMatch(/settled \? CACHE_HEADERS : RETRY_HEADERS/);
  });

  it("still names the logo when it is rate-limited", () => {
    expect(route).toMatch(/\{ image: null, favicon, title: null \}, \{ status: 429/);
  });
});

describe("/api/link-icon — a real 404 when a site has no logo", () => {
  const route = code("src/app/api/link-icon/route.ts");
  it("treats Google's 404 as 'no icon', never serving its globe", () => {
    expect(route).toMatch(/if \(res\.status === 404\) \{ res\.body\?\.cancel\(\)\.catch\(\(\) => \{\}\); return null; \}/);
  });
  it("falls back to the site's own icon, then the parent domain, then 404", () => {
    const own = route.indexOf("await fromSite(host");
    const parent = route.indexOf("await fromGoogle(parent");
    expect(own).toBeGreaterThan(-1);
    expect(parent).toBeGreaterThan(own);
    expect(route).toMatch(/status: 404, headers: \{ "Cache-Control": state\.failed \? RETRY : NONE \}/);
  });
  it("serves third-party bytes with img-proxy's armour", () => {
    expect(route).toMatch(/sandbox/);
    expect(route).toMatch(/"X-Content-Type-Options": "nosniff"/);
    expect(route).toMatch(/safeFetch\(/);
  });
  it("never serves a site's SVG as-is: it is drawn to a PNG first", () => {
    expect(route).toMatch(/raw\.type === "image\/svg\+xml" \? await rasterize\(raw\) : raw/);
    expect(route).toMatch(/return \{ body: new Uint8Array\(body\), type: "image\/png" \}/);
  });
  it("rejects placeholder 'icons' too small to be a logo", () => {
    expect(route).toMatch(/return width >= 16 && height >= 16/);
    expect(route).toMatch(/icon && \(await isRealLogo\(icon\)\)/);
  });
});

describe("Swift Links tiles and rows never show a broken picture or a wrong logo", () => {
  const tiles = code("src/components/SwiftLinkButtons.tsx");

  it("every link's logo comes from its URL, video links included", () => {
    expect(tiles).toMatch(/const icon = faviconFor\(link\.url\)/);
    expect(tiles).not.toMatch(/pv\?\.favicon/);
  });

  it("a logo shows only once it has painted, including one that beat hydration", () => {
    expect(tiles).toMatch(/onLoad=\{\(\) => markIconLoaded\(favicon\)\}/);
    expect(tiles).toMatch(/el\?\.complete && el\.naturalWidth > 0\) markIconLoaded\(u\)/);
  });

  it("the default picture is the link's own preview, with a fallback chain", () => {
    expect(tiles).toMatch(/pickPicture\(\[media\?\.type === "image" \? media\.url : null, videoThumb, pv\?\.image\]/);
    expect(tiles).toMatch(/\/api\/img-proxy\?url=\$\{encodeURIComponent\(c\)\}&w=1200/);
    expect(tiles).toMatch(/onError=\{\(\) => failPicture\(picture\.key\)\}/);
    expect(tiles).toMatch(/referrerPolicy="no-referrer"/);
  });

  it("the editor thumbnail shows the same picture as the tile", () => {
    const thumb = code("src/components/LinkPreviewThumb.tsx");
    expect(thumb).toMatch(/const picture = video \|\| pv\?\.image \|\| null/);
    expect(thumb).toMatch(/faviconFor\(href\)/);
    expect(thumb).toMatch(/fetchLinkPreview\(href\)/);
  });
});
