import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import {
  detectStoreOs,
  looksLikeIpadAsMac,
  resolveDownloadTarget,
  storeUrlWithAttribution,
} from "@/lib/download-link";

// ── swiftcard.me/download — the smart store link ─────────────────────────────
//
// One address for QR codes, texts and signatures. The proxy reads the device
// and sends it to its store before any HTML; a computer, a bot or an unknown
// device gets the page with both stores. The store URLs are the production
// ones from lib/app-store (env), never typed here.

const code = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

const APP = "https://apps.apple.com/app/id6798875872";
const PLAY = "https://play.google.com/store/apps/details?id=me.swiftcard.app";
const STORES = { appStoreUrl: APP, playStoreUrl: PLAY };

// Real strings, one per family the route must get right.
const UA = {
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1",
  iphoneFirefox: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/126.0 Mobile/15E148 Safari/605.1.15",
  ipadLegacy: "Mozilla/5.0 (iPad; CPU OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1",
  ipadAsMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  iphoneInstagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21E236 Instagram 328.0.0.30.90 (iPhone15,3; iOS 17_4; en_US; en; scale=3.00; 1290x2796; 591524730)",
  iphoneFacebook: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21E236 [FBAN/FBIOS;FBAV/459.0.0.37.108;FBBV/590419098;FBDV/iPhone15,3;FBMD/iPhone;FBSN/iOS;FBSV/17.4;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]",
  iphoneLinkedIn: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21E236 LinkedInApp/9.29.1234",
  androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.53 Mobile Safari/537.36",
  androidTablet: "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.53 Safari/537.36",
  androidSamsung: "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  androidFirefox: "Mozilla/5.0 (Android 14; Mobile; rv:126.0) Gecko/126.0 Firefox/126.0",
  androidInstagram: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A.240405.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.179 Mobile Safari/537.36 Instagram 328.0.0.30.90 Android (34/14; 420dpi; 1080x2340; Google/google; Pixel 8; shiba; shiba; en_US; 591524730)",
  androidFacebook: "Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.179 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/459.0.0.44.103;]",
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  windowsEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
  linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0",
  windowsPhone: "Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1; Microsoft; Lumia 950) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/52.0.2743.116 Mobile Safari/537.36 Edge/15.14977",
  googlebotPhone: "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.53 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  applebot: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 (Applebot/0.1; +http://www.apple.com/go/applebot)",
  whatsapp: "WhatsApp/2.23.20.0",
  curl: "curl/8.4.0",
  garbage: "lol/1.0 (toaster)",
};

describe("which store", () => {
  it.each([
    ["iphoneSafari"], ["iphoneChrome"], ["iphoneFirefox"], ["ipadLegacy"],
    ["iphoneInstagram"], ["iphoneFacebook"], ["iphoneLinkedIn"],
  ] as const)("iOS: %s → App Store", (k) => {
    expect(detectStoreOs(UA[k])).toBe("ios");
  });

  it.each([
    ["androidChrome"], ["androidTablet"], ["androidSamsung"], ["androidFirefox"],
    ["androidInstagram"], ["androidFacebook"],
  ] as const)("Android: %s → Google Play", (k) => {
    expect(detectStoreOs(UA[k])).toBe("android");
  });

  it.each([
    ["macChrome"], ["windowsEdge"], ["linuxFirefox"], ["ipadAsMac"], ["garbage"],
  ] as const)("desktop/unknown: %s → the page", (k) => {
    expect(detectStoreOs(UA[k])).toBeNull();
  });

  it("a missing User-Agent is not a phone", () => {
    expect(detectStoreOs(null)).toBeNull();
    expect(detectStoreOs(undefined)).toBeNull();
    expect(detectStoreOs("")).toBeNull();
  });

  it("Windows Phone claims both Android and iPhone; neither store has an app for it", () => {
    expect(UA.windowsPhone).toMatch(/Android/);
    expect(detectStoreOs(UA.windowsPhone)).toBeNull();
  });

  it("iPadOS-as-Mac is caught on the client by the touch tell, and a real Mac never is", () => {
    expect(looksLikeIpadAsMac(UA.ipadAsMac, 5)).toBe(true);
    expect(looksLikeIpadAsMac(UA.ipadAsMac, 0)).toBe(false);
    expect(looksLikeIpadAsMac(UA.macChrome, 0)).toBe(false);
    expect(looksLikeIpadAsMac(UA.iphoneSafari, 5)).toBe(false); // already routed server-side
    expect(looksLikeIpadAsMac(UA.windowsEdge, 10)).toBe(false); // a touch laptop is not an iPad
  });
});

describe("the redirect target", () => {
  it("iPhone → the App Store listing, Android → the Play listing, exactly the configured URLs", () => {
    expect(resolveDownloadTarget(UA.iphoneSafari, "", STORES)).toBe(APP);
    expect(resolveDownloadTarget(UA.androidChrome, "", STORES)).toBe(PLAY);
  });

  it("a computer gets the page", () => {
    for (const k of ["macChrome", "windowsEdge", "linuxFirefox", "ipadAsMac"] as const) {
      expect(resolveDownloadTarget(UA[k], "?utm_source=x", STORES), k).toBeNull();
    }
  });

  it("crawlers, unfurlers and HTTP clients get the page even on a phone UA", () => {
    for (const k of ["googlebotPhone", "applebot", "whatsapp", "curl"] as const) {
      expect(resolveDownloadTarget(UA[k], "", STORES), k).toBeNull();
    }
  });

  it("a store that is not configured yet means the page, never a dead link", () => {
    expect(resolveDownloadTarget(UA.iphoneSafari, "", { appStoreUrl: null, playStoreUrl: PLAY })).toBeNull();
    expect(resolveDownloadTarget(UA.androidChrome, "", { appStoreUrl: APP, playStoreUrl: null })).toBeNull();
    expect(resolveDownloadTarget(UA.androidChrome, "", { appStoreUrl: APP, playStoreUrl: PLAY })).toBe(PLAY);
  });

  it("defaults to lib/app-store's URLs (the production env), not a hardcoded listing", () => {
    const src = code("src/lib/download-link.ts");
    expect(src).toMatch(/import \{ APP_STORE_URL, PLAY_STORE_URL \} from "@\/lib\/app-store"/);
    expect(src).not.toMatch(/apps\.apple\.com\/app\/id\d/);
    expect(src).not.toMatch(/details\?id=[a-z]/);
  });
});

describe("attribution survives the hop", () => {
  it("forwards utm_* and any other tag to the App Store", () => {
    const out = new URL(resolveDownloadTarget(UA.iphoneSafari, "?utm_source=linkedin&utm_campaign=launch&src=li_bio", STORES)!);
    expect(out.origin + out.pathname).toBe(APP);
    expect(out.searchParams.get("utm_source")).toBe("linkedin");
    expect(out.searchParams.get("utm_campaign")).toBe("launch");
    expect(out.searchParams.get("src")).toBe("li_bio");
  });

  it("forwards to Google Play AND packs the utm set into `referrer` for the Install Referrer API", () => {
    const out = new URL(resolveDownloadTarget(UA.androidChrome, "?utm_source=linkedin&utm_medium=social&fbclid=abc", STORES)!);
    expect(out.searchParams.get("id")).toBe("me.swiftcard.app");
    expect(out.searchParams.get("utm_source")).toBe("linkedin");
    expect(out.searchParams.get("fbclid")).toBe("abc");
    expect(out.searchParams.get("referrer")).toBe("utm_source=linkedin&utm_medium=social");
  });

  it("an explicit referrer on the link is respected, not overwritten", () => {
    const out = new URL(storeUrlWithAttribution(PLAY, "?referrer=utm_source%3Dqr&utm_source=linkedin", "android"));
    expect(out.searchParams.get("referrer")).toBe("utm_source=qr");
  });

  it("never lets a stray ?id= point the Play redirect at another app", () => {
    const out = new URL(storeUrlWithAttribution(PLAY, "?id=com.evil.app&utm_source=x", "android"));
    expect(out.searchParams.get("id")).toBe("me.swiftcard.app");
    expect(out.searchParams.getAll("id")).toEqual(["me.swiftcard.app"]);
  });

  it("no tags → the listing URL byte for byte, no trailing ?", () => {
    expect(storeUrlWithAttribution(APP, "", "ios")).toBe(APP);
    expect(storeUrlWithAttribution(PLAY, "", "android")).toBe(PLAY);
    expect(storeUrlWithAttribution(APP, new URLSearchParams(), "ios")).toBe(APP);
  });

  it("drops junk keys and oversized values rather than failing the redirect", () => {
    const long = "x".repeat(300);
    const out = new URL(storeUrlWithAttribution(APP, `?utm_source=ok&bad%20key=1&utm_content=${long}`, "ios"));
    expect(out.searchParams.get("utm_source")).toBe("ok");
    expect(out.searchParams.has("bad key")).toBe(false);
    expect(out.searchParams.has("utm_content")).toBe(false);
  });

  it("caps the number of forwarded params", () => {
    const many = Array.from({ length: 40 }, (_, i) => `p${i}=${i}`).join("&");
    const out = new URL(storeUrlWithAttribution(APP, `?${many}`, "ios"));
    expect([...out.searchParams].length).toBeLessThanOrEqual(24);
  });
});

describe("no loops, no collateral", () => {
  it("every redirect target is a store origin, never swiftcard.me", () => {
    for (const k of Object.keys(UA) as (keyof typeof UA)[]) {
      const t = resolveDownloadTarget(UA[k], "?next=/download&redirect=/download", STORES);
      if (t === null) continue;
      const u = new URL(t);
      expect(["apps.apple.com", "play.google.com"], k).toContain(u.hostname);
      expect(u.pathname, k).not.toContain("/download");
    }
  });

  it("the proxy refuses a target on its own origin and shows the page instead", () => {
    const src = code("src/proxy.ts");
    const block = src.slice(src.indexOf('pathname === "/download"'), src.indexOf("let supabaseResponse"));
    expect(block).toContain("new URL(target).origin === request.nextUrl.origin");
    expect(block).toContain("NextResponse.next()");
  });

  it("/download is in the proxy matcher and decided BEFORE any auth work, with a 307", () => {
    const src = code("src/proxy.ts");
    expect(src).toMatch(/matcher:\s*\[[^\]]*"\/download"/s);
    const decide = src.indexOf('pathname === "/download"');
    expect(decide).toBeGreaterThan(0);
    expect(decide).toBeLessThan(src.indexOf("createServerClient("));
    expect(src.slice(decide, src.indexOf("let supabaseResponse"))).toContain("NextResponse.redirect(target, 307)");
    // Not permanent: a cached 308 would pin one device's store onto a shared link.
    expect(src.slice(decide, src.indexOf("let supabaseResponse"))).not.toContain("308");
  });

  it("/download is not behind the login wall and no next.config redirect touches it", () => {
    const src = code("src/proxy.ts");
    const protectedLine = src.match(/const protectedPaths = \[[^\]]*\]/)![0];
    expect(protectedLine).not.toContain("/download");
    expect(code("next.config.ts")).not.toContain("/download");
  });

  it("the fallback page is static and has no redirect of its own (no second hop, no flash)", () => {
    const page = code("src/app/download/page.tsx");
    expect(page).not.toMatch(/from "next\/headers"/);
    expect(page).not.toMatch(/from "next\/navigation"/);
    expect(page).toMatch(/from "@\/components\/AppStoreBadge"/);
    expect(page).toContain("<AppStoreBadge");
    expect(page).toContain("<GooglePlayBadge");
  });

  it("the page's iPad fix uses the shared resolver, so the two never disagree", () => {
    const c = code("src/components/download/IpadStoreRedirect.tsx");
    expect(c).toContain('from "@/lib/download-link"');
    expect(c).toContain("looksLikeIpadAsMac(");
    expect(c).toContain("storeUrlWithAttribution(");
    expect(c).toContain("location.replace(");
  });

  it("both badges stay visible on this page despite the one-store-per-visitor rule", () => {
    const css = code("src/app/home.css");
    expect(css).toMatch(/\.hp-download-stores \.sc-appstore-badge\.sc-store-play[\s\S]*display:\s*inline-flex !important/);
    expect(code("src/app/download/page.tsx")).toMatch(/className="hp-download-stores/);
  });
});

// ── The proxy, end to end on a real NextRequest ─────────────────────────────
// The /download branch returns before the Supabase client is built, so no env
// or network is involved; the store URLs are stubbed the way production sets
// them (NEXT_PUBLIC_*), and lib/app-store is re-imported to pick them up.
describe("proxy(/download)", () => {
  beforeEach(() => { vi.resetModules(); vi.unstubAllEnvs(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  async function run(path: string, headers: Record<string, string>, stores = { app: APP, play: PLAY }) {
    vi.stubEnv("NEXT_PUBLIC_APP_STORE_URL", stores.app);
    vi.stubEnv("NEXT_PUBLIC_PLAY_STORE_URL", stores.play);
    const { proxy } = await import("@/proxy");
    return proxy(new NextRequest(`https://swiftcard.me${path}`, { headers }));
  }

  it("iPhone: a 307 to the App Store with the tags, before any HTML", async () => {
    const res = await run("/download?utm_source=qr&utm_campaign=booth", { "user-agent": UA.iphoneSafari });
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe(APP);
    expect(loc.searchParams.get("utm_source")).toBe("qr");
    expect(loc.searchParams.get("utm_campaign")).toBe("booth");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("Android (in-app browser): a 307 to Google Play with referrer", async () => {
    const res = await run("/download?utm_source=ig", { "user-agent": UA.androidInstagram });
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.hostname).toBe("play.google.com");
    expect(loc.searchParams.get("id")).toBe("me.swiftcard.app");
    expect(loc.searchParams.get("referrer")).toBe("utm_source=ig");
  });

  it("desktop, unknown UA and no UA: pass through to the page (200 path, no Location)", async () => {
    const cases: Record<string, string>[] = [{ "user-agent": UA.windowsEdge }, { "user-agent": UA.garbage }, {}];
    for (const h of cases) {
      const res = await run("/download?utm_source=x", h);
      expect(res.headers.get("location")).toBeNull();
      expect(res.status).toBe(200);
    }
  });

  it("Googlebot on a phone UA sees the page, not the store", async () => {
    const res = await run("/download", { "user-agent": UA.googlebotPhone });
    expect(res.headers.get("location")).toBeNull();
  });

  it("store not configured: a phone sees the page rather than a dead link", async () => {
    const res = await run("/download", { "user-agent": UA.iphoneSafari }, { app: "", play: PLAY });
    expect(res.headers.get("location")).toBeNull();
  });

  it("inside the native shell: /dashboard, like /pricing — never the store", async () => {
    const res = await run("/download", { "user-agent": UA.iphoneSafari + " SwiftCardApp/1.0" });
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/dashboard");
    const byCookie = await run("/download", { "user-agent": UA.androidChrome, cookie: "sc_shell=1" });
    expect(new URL(byCookie.headers.get("location")!).pathname).toBe("/dashboard");
  });

  it("a misconfigured store URL on our own origin can never loop", async () => {
    const res = await run("/download", { "user-agent": UA.iphoneSafari }, { app: "https://swiftcard.me/download", play: PLAY });
    expect(res.headers.get("location")).toBeNull();
  });

  it("the redirect never points back at /download, whatever the query says", async () => {
    const res = await run("/download?next=%2Fdownload&redirect=https%3A%2F%2Fswiftcard.me%2Fdownload", { "user-agent": UA.iphoneSafari });
    const loc = new URL(res.headers.get("location")!);
    expect(loc.hostname).toBe("apps.apple.com");
  });
});
