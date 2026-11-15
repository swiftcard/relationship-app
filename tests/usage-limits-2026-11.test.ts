import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  IMAGE_UPLOAD_FIELDS, IMAGE_UPLOAD_TYPES, MAX_IMAGE_UPLOAD_BYTES, captureShapeOk, maxDimFor,
} from "../src/lib/upload-rules";
import { DirectUploadRefused, directCaptureUpload, directImageUpload } from "../src/lib/direct-upload";
import { config as proxyConfig } from "../src/proxy";

// ── Usage, 2026-11 ───────────────────────────────────────────────────────────
//
// Vercel switched the site off for passing its limits: 12.66 GB of transfer
// between the CDN and functions (7.4 GB of it INCOMING, i.e. files posted to
// functions) and 887K function runs in 30 days. These pin the changes that
// keep ordinary use small: pictures go straight to storage, polling is slow
// and stops when nobody is looking, the proxy only runs where it must, and
// the public card page keeps recording every view from the browser.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

afterEach(() => { vi.unstubAllGlobals(); });

describe("pictures go straight to storage, not through a function", () => {
  const sign = read("src/app/api/upload/sign/route.ts");
  const legacy = read("src/app/api/upload/route.ts");

  it("both roads agree on what a picture may be", () => {
    for (const t of IMAGE_UPLOAD_TYPES) expect(legacy).toContain(`"${t}"`);
    for (const f of IMAGE_UPLOAD_FIELDS) expect(legacy).toContain(`field !== "${f}"`);
    expect(MAX_IMAGE_UPLOAD_BYTES).toBe(5 * 1024 * 1024);
    expect(legacy).toContain("const MAX_BYTES = 5 * 1024 * 1024;");
    // The sizes the old route resizes to, field by field.
    expect(legacy).toContain('field === "photo" ? 1000 : field === "pagebg" || field === "create" ? 1600 : field === "cardbg" ? 1400 : field === "hero" || field === "link" ? 1200 : 800');
    expect(IMAGE_UPLOAD_FIELDS.map(maxDimFor)).toEqual([1000, 800, 1200, 1200, 1600, 1400, 1600]);
  });

  it("the signing route is signed-in only, throttled per account, and builds the path itself", () => {
    expect(sign).toMatch(/if \(!user\) return NextResponse\.json\(\{ error: "Unauthorized" \}, \{ status: 401 \}\)/);
    expect(sign).toContain("deletedAccountResponse(user.id)");
    expect(sign).toMatch(/isRateLimited\(`upload-sign:\$\{user\.id\}`, 60, 10 \* 60 \* 1000\)/);
    expect(sign).toMatch(/isRateLimited\(`upload-commit:\$\{user\.id\}`, 60, 10 \* 60 \* 1000\)/);
    expect(sign).toContain("const path = `${user.id}/${field}-${Date.now()}.${EXT_BY_IMAGE_TYPE[contentType]}`;");
    expect(sign).toContain("isImageUploadField(field)");
    expect(sign).toContain("isImageUploadType(contentType)");
    expect(sign).toContain("size > MAX_IMAGE_UPLOAD_BYTES");
    // Create + stays a paid feature on this road too.
    expect(sign).toMatch(/field === "create"[\s\S]{0,200}pro_required/);
  });

  it("a capture is signed only for the card's owner and only for a current capture", () => {
    expect(sign).toMatch(/v < CAPTURE_VERSION\[target\][\s\S]{0,120}status: 409/);
    expect(sign).toMatch(/owned\.includes\(username\)\) return NextResponse\.json\(\{ error: "forbidden" \}, \{ status: 403 \}\)/);
  });

  it("a saved photo or logo must be this user's own, just-uploaded file", () => {
    expect(sign).toContain("m[1] !== user.id || m[3] !== field");
    expect(sign).toContain('"Upload not found"');
  });

  it("the older routes are still there for guests, the fallback and anything already loaded", () => {
    for (const p of ["src/app/api/upload/route.ts", "src/app/api/card-share-image/route.ts", "src/app/api/card-signature/route.ts", "src/app/api/upload/link-video/route.ts"]) {
      expect(read(p)).toMatch(/export async function POST/);
    }
    expect(read("src/lib/upload-media.ts")).toContain('fetch("/api/upload", { method: "POST", body: fd, signal })');
    expect(read("src/components/ShareCardCapture.tsx")).toMatch(/directCaptureUpload\("share"[\s\S]{0,120}\|\| \(await fetch\("\/api\/card-share-image"/);
    expect(read("src/components/EmailSignatureBox.tsx")).toMatch(/directCaptureUpload\("signature"[\s\S]{0,120}\|\| \(await fetch\("\/api\/card-signature"/);
    expect(read("src/components/ImageUpload.tsx")).toContain('await fetch("/api/upload", { method: "POST", body: form })');
  });

  it("uploads are stored with a year's cache, on both roads", () => {
    expect(legacy).toContain("cacheControl: IMMUTABLE_CACHE_SECONDS");
    expect(read("src/lib/direct-upload.ts")).toContain('"Cache-Control": `max-age=${IMMUTABLE_CACHE_SECONDS}`');
    expect(read("src/lib/upload-media.ts")).toContain('"Cache-Control": `max-age=${IMMUTABLE_CACHE_SECONDS}`');
  });

  it("a capture must be card-shaped, as the older routes require", () => {
    expect(captureShapeOk(1200, 686)).toBe(true);
    expect(captureShapeOk(600, 600)).toBe(false);
    expect(captureShapeOk(200, 120)).toBe(false);
    expect(captureShapeOk(1200, 400)).toBe(false);
  });
});

describe("the browser side falls back instead of failing", () => {
  const jpeg = () => new Blob([new Uint8Array(2048)], { type: "image/jpeg" });
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("signs, then PUTs the file to storage with a long cache", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url === "/api/upload/sign") return json(200, { signedUrl: "https://storage.test/put?token=t", path: "u/hero-1.jpg", url: "https://storage.test/public/u/hero-1.jpg" });
      return new Response(null, { status: 200 });
    }));
    const out = await directImageUpload(jpeg(), "hero", { resize: false });
    expect(out).toEqual({ url: "https://storage.test/public/u/hero-1.jpg", path: "u/hero-1.jpg" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ target: "media", field: "hero", contentType: "image/jpeg", size: 2048 });
    expect(calls[1].url).toBe("https://storage.test/put?token=t");
    expect(calls[1].init.method).toBe("PUT");
    expect((calls[1].init.headers as Record<string, string>)["Cache-Control"]).toBe("max-age=31536000");
  });

  it("a guest (401), a missing route (404) or a server error means: use the old route", async () => {
    for (const status of [401, 404, 500]) {
      vi.stubGlobal("fetch", vi.fn(async () => json(status, { error: "x" })));
      expect(await directImageUpload(jpeg(), "hero", { resize: false })).toBeNull();
    }
  });

  it("storage refusing the PUT means: use the old route", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/upload/sign"
      ? json(200, { signedUrl: "https://storage.test/put", path: "p", url: "u" })
      : new Response(null, { status: 403 })));
    expect(await directImageUpload(jpeg(), "hero", { resize: false })).toBeNull();
  });

  it("a real refusal (too many, not allowed) is reported, not retried on the old route", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(429, { error: "Too many requests" })));
    await expect(directImageUpload(jpeg(), "hero", { resize: false })).rejects.toBeInstanceOf(DirectUploadRefused);
  });

  it("never sends a file over the limit or of the wrong type", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await directImageUpload(new Blob([new Uint8Array(MAX_IMAGE_UPLOAD_BYTES + 1)], { type: "image/jpeg" }), "hero", { resize: false })).toBeNull();
    expect(await directImageUpload(new Blob(["<svg/>"], { type: "image/svg+xml" }), "hero", { resize: false })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("a capture that is not a card-shaped PNG is never uploaded directly", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await directCaptureUpload("share", "data:image/png;base64,AAAA", "maya", 99)).toBe(false);
    expect(await directCaptureUpload("share", "data:image/jpeg;base64,AAAA", "maya", 99)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("a card-shaped PNG capture is PUT with upsert and the one-minute cache", async () => {
    const png = new Uint8Array(64);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(png.buffer).setUint32(16, 1200);
    new DataView(png.buffer).setUint32(20, 686);
    const dataUrl = "data:image/png;base64," + Buffer.from(png).toString("base64");
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return url === "/api/upload/sign" ? json(200, { signedUrl: "https://storage.test/put", path: "maya.png", url: "u" }) : new Response(null, { status: 200 });
    }));
    expect(await directCaptureUpload("signature", dataUrl, "maya", 2)).toBe(true);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ target: "signature", username: "maya", v: 2 });
    const h = calls[1].init.headers as Record<string, string>;
    expect(h["x-upsert"]).toBe("true");
    expect(h["Cache-Control"]).toBe("max-age=60");
    expect(h["Content-Type"]).toBe("image/png");
  });
});

describe("our own pictures are read from storage, not through the image proxy", () => {
  it("Save Contact and Photo match try storage first and keep the proxy as the fallback", () => {
    const save = read("src/components/SaveContactButton.tsx");
    expect(save).toMatch(/isOwnStorageUrl\(url\)\s*\? await fetch\(url, \{ mode: "cors"/);
    expect(save).toContain("/api/img-proxy?url=");
    const tone = read("src/components/usePhotoTone.ts");
    expect(tone).toContain("isOwnStorageUrl(url)");
    expect(tone).toContain("img.src = proxied");
  });
});

describe("polling is slow and stops when nobody is looking", () => {
  it("both bells ask once a minute and not at all while hidden", () => {
    for (const p of ["src/components/NotificationBell.tsx", "src/components/office/OfficeNotificationBell.tsx"]) {
      const s = read(p);
      expect(s).toMatch(/setInterval\(poll, (BELL_POLL_MS|60_000)\)/);
      expect(s).not.toMatch(/setInterval\(poll, 30000\)/);
      expect(s).toContain('if (document.visibilityState === "hidden") return;');
      // …and still at once on open and on return, so nothing feels slower.
      expect(s).toMatch(/\n\s+poll\(\);/);
      expect(s).toContain('document.addEventListener("visibilitychange", onVisible)');
    }
  });

  it("the admin refreshers wait while the tab is hidden", () => {
    const chat = read("src/app/admin/crew/ChatAutoRefresh.tsx");
    expect(chat).toContain('if (document.visibilityState === "hidden") return;');
    expect(chat).toContain("everyMs = 5000");
    const banner = read("src/app/admin/ProspectAlertBanner.tsx");
    expect(banner).toContain("const POLL_MS = 20_000;");
    expect(banner).toMatch(/document\.visibilityState === "visible" \? start\(\) : stop\(\)/);
  });
});

describe("the proxy only runs where a session matters", () => {
  const matcher = proxyConfig.matcher as string[];

  it("is a list of named pages, never a catch-all", () => {
    expect(Array.isArray(matcher)).toBe(true);
    for (const m of matcher) {
      expect(typeof m).toBe("string");
      expect(m.startsWith("/")).toBe(true);
      // No regex groups, no negative look-aheads, no "everything" patterns.
      expect(m).not.toMatch(/\(|\.\*/);
      expect(m).not.toBe("/:path*");
    }
  });

  it("never matches static files, images, Next's own assets or the API", () => {
    const never = [
      "/_next/static/chunks/main.js", "/_next/image", "/_next/data/x.json", "/favicon.ico", "/icon.png",
      "/apple-icon.png", "/og/brand.png", "/marketing/photo.jpg", "/robots.txt", "/sitemap.xml",
      "/manifest.webmanifest", "/api/health", "/api/notifications", "/api/card-events", "/sw.js",
      // The public card and Swift Links pages: every QR scan, no session work.
      "/maya-chen", "/links/maya-chen", "/card/maya-chen",
    ];
    const hits = (path: string) => matcher.some((m) => {
      if (m.endsWith("/:path*")) { const base = m.slice(0, -"/:path*".length); return path === base || path.startsWith(base + "/"); }
      return path === m;
    });
    for (const p of never) expect(hits(p), p).toBe(false);
    // …and still covers what it must.
    for (const p of ["/", "/dashboard", "/cards/abc/edit", "/settings/flows", "/office/admin", "/pricing", "/download"]) expect(hits(p), p).toBe(true);
  });
});

describe("hot queries read only the columns they use", () => {
  it("the is-this-card-live check and lead capture no longer pull the whole card", () => {
    const active = read("src/lib/card-active.ts");
    expect(active).toContain('.select("id, user_id, is_offline")');
    const leads = read("src/app/api/leads/route.ts");
    expect(leads).toContain('.select("id, user_id, name, email, phone, company, is_offline")');
    // The kill-switch column must stay in both lists.
    expect(active.match(/select\("\*"\)/g)).toBeNull();
  });
});

describe("the public card page: cached data, views counted in the browser", () => {
  const page = read("src/app/[username]/page.tsx");
  const tracker = read("src/components/CardEventTracker.tsx");
  const data = read("src/lib/card-page-data.ts");

  it("the card's data is cached per card and dropped the moment it is saved", () => {
    expect(data).toMatch(/unstable_cache\(\(\) => loadCardPageData\(slug\), \["card-page", slug\], \{\s*tags: \[cardPageTag\(slug\)\],\s*revalidate: 60,/);
    for (const p of ["src/app/api/cards/[id]/route.ts", "src/app/api/cards/[id]/rename/route.ts", "src/app/api/office/cards/[id]/route.ts"]) {
      expect(read(p)).toContain("revalidateCardPage(");
    }
  });

  it("a view is recorded by the visitor's browser, never while the server builds the page", () => {
    // The page mounts the tracker; it does not write a view itself. This is
    // what makes a cached copy of the page safe for analytics: the copy can
    // be reused, the view is still sent by each visitor.
    expect(page).toMatch(/\{!isEmbed && !isOwnerView && <CardEventTracker username=\{profile\.username\} source=\{source\} \/>\}/);
    expect(page).not.toMatch(/from\("card_views"\)\s*\.insert/);
    expect(page).not.toMatch(/from\("card_events"\)\s*\.insert/);
    expect(tracker.startsWith('"use client";')).toBe(true);
    expect(tracker).toContain('outbox.fetch("/api/card-events"');
  });

  it("who is looking is still decided per request, so an owner's own visit is never counted", () => {
    // The reason the page's HTML is NOT cached whole (ISR): this check reads
    // the visitor's cookies, and a shared copy would give every visitor the
    // same answer.
    expect(page).toMatch(/const jar = await cookies\(\);/);
    expect(page).toMatch(/const isOwnerView = !!viewer && viewer\.id === ownerId;/);
    expect(page).not.toMatch(/export const revalidate\b/);
    expect(page).not.toMatch(/generateStaticParams/);
  });
});
