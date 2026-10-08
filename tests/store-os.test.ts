import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectStoreOsClient, resolveStoreOs, storeOsBoot, type StoreOs } from "@/lib/store-os";
import { detectStoreOs, looksLikeIpadAsMac } from "@/lib/download-link";

// ── Which store badge a visitor sees — the one decision, three copies ───────
//
// The rules live in lib/store-os as a TypeScript function AND as the ES5
// string the root layout inlines before paint (an inline script can't import).
// The proxy's /download redirect has a third, server-side copy (no touch
// points, bot filtering). This matrix runs every user agent through all three
// and fails the moment any two disagree — the only way to keep copies honest.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** Run the inline snippet the way a browser would, with a fake navigator/document. */
function runBoot(snippet: string, userAgent: string, maxTouchPoints: number): string | null {
  let set: string | null = null;
  const documentStub = { documentElement: { setAttribute(name: string, value: string) { if (name === "data-sc-os") set = value; } } };
  new Function("navigator", "document", snippet)({ userAgent, maxTouchPoints }, documentStub);
  return set;
}

type Row = { name: string; ua: string; touch: number; expect: StoreOs; server?: "ios" | "android" | null | "skip" };

// `server` is what lib/download-link's detectStoreOs should say (null = show
// the page); "skip" marks the rows the server can't decide because they need
// the touch-point count, which an HTTP request does not carry.
const ROWS: Row[] = [
  // iPhone — Safari, Chrome, Firefox, Edge, and the in-app browsers.
  { name: "iPhone Safari", ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", touch: 5, expect: "ios", server: "ios" },
  { name: "iPhone Chrome", ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1", touch: 5, expect: "ios", server: "ios" },
  { name: "iPhone Firefox", ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15", touch: 5, expect: "ios", server: "ios" },
  { name: "iPhone Edge", ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/125.0.2535.60 Mobile/15E148 Safari/605.1.15", touch: 5, expect: "ios", server: "ios" },
  { name: "Instagram in-app, iPhone", ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 334.0.0.28.90 (iPhone15,2; iOS 17_5; en_US; en; scale=3.00; 1179x2556; 598640424)", touch: 5, expect: "ios", server: "ios" },
  { name: "Facebook in-app, iPhone", ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/467.0.0.37.108;FBBV/598640424;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]", touch: 5, expect: "ios", server: "ios" },
  { name: "LinkedIn in-app, iPhone", ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.29.2838", touch: 5, expect: "ios", server: "ios" },
  { name: "TikTok in-app, iPhone", ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_34.5.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/en Region/US", touch: 5, expect: "ios", server: "ios" },
  // iPad — the old UA that still says iPad, and iPadOS Safari posing as a Mac.
  { name: "iPad (legacy UA)", ua: "Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1", touch: 5, expect: "ios", server: "ios" },
  { name: "iPadOS posing as a Mac", ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15", touch: 5, expect: "ios", server: "skip" },
  // A real Mac: the App Store, because the app is on the Mac App Store.
  { name: "Mac Safari", ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15", touch: 0, expect: "mac", server: null },
  { name: "Mac Chrome", ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36", touch: 0, expect: "mac", server: null },
  // Android — phone, tablet, Samsung Internet, Firefox, in-app browsers.
  { name: "Pixel Chrome", ua: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36", touch: 5, expect: "android", server: "android" },
  { name: "Android tablet (no Mobile token)", ua: "Mozilla/5.0 (Linux; Android 13; SM-X900) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36", touch: 10, expect: "android", server: "android" },
  { name: "Samsung Internet", ua: "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36", touch: 5, expect: "android", server: "android" },
  { name: "Firefox Android", ua: "Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0", touch: 5, expect: "android", server: "android" },
  { name: "Instagram in-app, Android", ua: "Mozilla/5.0 (Linux; Android 13; SM-S908B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36 Instagram 310.0.0.42.100 Android", touch: 5, expect: "android", server: "android" },
  { name: "Facebook in-app, Android", ua: "Mozilla/5.0 (Linux; Android 13; Pixel 6 Build/TQ3A.230805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/430.0.0.29.113;]", touch: 5, expect: "android", server: "android" },
  { name: "LinkedIn in-app, Android", ua: "Mozilla/5.0 (Linux; Android 13; SM-G991B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 [LinkedInApp]", touch: 5, expect: "android", server: "android" },
  // Android with "Request desktop site": the UA turns into a Linux computer,
  // the touch points do not. Server-side it IS a computer (shows the page).
  { name: "Android, desktop-site mode", ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36", touch: 5, expect: "android", server: "skip" },
  // Computers with no store of their own → "other" → the Get-the-app button.
  { name: "Linux desktop", ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36", touch: 0, expect: "other", server: null },
  { name: "Windows 10 Chrome", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36", touch: 0, expect: "other", server: null },
  { name: "Windows Edge, touchscreen (Surface)", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0", touch: 10, expect: "other", server: null },
  { name: "Windows Firefox", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0", touch: 0, expect: "other", server: null },
  { name: "Chromebook", ua: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36", touch: 10, expect: "other", server: null },
  // Windows Phone claimed to be Android AND iPhone at once. No store has it.
  { name: "Windows Phone (Lumia)", ua: "Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1; Microsoft; Lumia 950) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/52.0.2743.116 Mobile Safari/537.36 Edge/15.14977 like iPhone OS 7_0_3 Mac OS X", touch: 5, expect: "other", server: null },
  { name: "empty UA", ua: "", touch: 0, expect: "other", server: null },
  { name: "Googlebot", ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", touch: 0, expect: "other", server: null },
];

const BOTH = { apple: true, play: true };

describe("lib/store-os: the TypeScript rules", () => {
  it.each(ROWS)("$name → $expect", (row) => {
    expect(detectStoreOsClient(row.ua, row.touch)).toBe(row.expect);
  });

  it("treats a missing touch count as no touch", () => {
    expect(detectStoreOsClient("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15", undefined)).toBe("mac");
    expect(detectStoreOsClient(null, null)).toBe("other");
  });
});

describe("lib/store-os: the inline boot snippet says the same thing", () => {
  const snippet = storeOsBoot(BOTH);

  it("is plain ES5 that only writes data-sc-os", () => {
    expect(snippet).toMatch(/^var U=navigator\.userAgent/);
    expect(snippet).toContain("document.documentElement.setAttribute('data-sc-os',O);");
    expect(snippet).not.toContain("=>");
    expect(snippet).not.toContain("const ");
    expect(snippet).not.toContain("let ");
    expect(snippet).not.toContain("`");
    expect(snippet).not.toContain("MutationObserver");
  });

  it.each(ROWS)("$name → $expect", (row) => {
    expect(runBoot(snippet, row.ua, row.touch)).toBe(row.expect);
    expect(runBoot(snippet, row.ua, row.touch)).toBe(detectStoreOsClient(row.ua, row.touch));
  });

  it("always sets the attribute, so CSS never has to guess", () => {
    for (const row of ROWS) expect(runBoot(snippet, row.ua, row.touch)).not.toBeNull();
  });

  it("survives a navigator with no maxTouchPoints (old WebKit)", () => {
    let set: string | null = null;
    new Function("navigator", "document", snippet)(
      { userAgent: ROWS[0].ua },
      { documentElement: { setAttribute(_: string, v: string) { set = v; } } },
    );
    expect(set).toBe("ios");
  });
});

describe("lib/store-os agrees with the proxy's server-side copy (lib/download-link)", () => {
  it.each(ROWS.filter((r) => r.server !== "skip"))("$name", (row) => {
    const server = detectStoreOs(row.ua);
    expect(server).toBe(row.server);
    const client = detectStoreOsClient(row.ua, row.touch);
    // Where the server has an answer it must be the client's answer; where it
    // has none the client must have fallen through to a computer or a Mac.
    if (server) expect(client).toBe(server);
    else expect(["mac", "other"]).toContain(client);
  });

  it("looksLikeIpadAsMac is exactly 'a Macintosh the client calls iOS'", () => {
    for (const row of ROWS) {
      const viaRules = /Macintosh/.test(row.ua) && detectStoreOsClient(row.ua, row.touch) === "ios";
      expect(looksLikeIpadAsMac(row.ua, row.touch), row.name).toBe(viaRules);
    }
  });
});

describe("lib/store-os: only the stores that exist (self-activating contract)", () => {
  it("a device whose store has no listing is treated as a computer, never left with no badge", () => {
    expect(resolveStoreOs("android", { apple: true, play: false })).toBe("other");
    expect(resolveStoreOs("ios", { apple: false, play: true })).toBe("other");
    expect(resolveStoreOs("mac", { apple: false, play: true })).toBe("other");
    expect(resolveStoreOs("android", BOTH)).toBe("android");
    expect(resolveStoreOs("ios", BOTH)).toBe("ios");
    expect(resolveStoreOs("other", { apple: false, play: false })).toBe("other");
  });

  it.each(ROWS)("the snippet applies the same remap for $name", (row) => {
    for (const stores of [{ apple: true, play: false }, { apple: false, play: true }, { apple: false, play: false }]) {
      expect(runBoot(storeOsBoot(stores), row.ua, row.touch)).toBe(resolveStoreOs(row.expect, stores));
    }
  });

  it("with both stores live the snippet carries no remap at all", () => {
    expect(storeOsBoot(BOTH)).not.toContain("O='other';document");
    expect(storeOsBoot(BOTH)).not.toMatch(/if\(O===/);
  });
});

describe("the root layout inlines it, before paint, and nothing else decides", () => {
  const layout = read("src/app/layout.tsx");
  it("imports storeOsBoot with the real store switches", () => {
    expect(layout).toContain('import { storeOsBoot } from "@/lib/store-os"');
    expect(layout).toContain("storeOsBoot({ apple: APP_STORE_URL !== null, play: PLAY_STORE_URL !== null })");
  });
  it("inside the beforeInteractive sc-boot script", () => {
    const script = layout.slice(layout.indexOf('id="sc-boot"'), layout.indexOf("new MutationObserver"));
    expect(script).toContain('strategy="beforeInteractive"');
    expect(script).toContain("storeOsBoot(");
  });
  it("has no hand-written copy of the user-agent rules left", () => {
    expect(layout).not.toMatch(/iPhone\|iPad\|iPod/);
    expect(layout).not.toMatch(/data-sc-os','(ios|android|mac|other)'/);
  });
  it("lib/store-os imports nothing, so the layout stays static", () => {
    expect(read("src/lib/store-os.ts")).not.toMatch(/^import /m);
  });
});
