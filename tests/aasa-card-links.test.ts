import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { AASA_PATHS, PUBLIC_PAGE_META, aasaComponents } from "@/lib/universal-links";
import { GET } from "@/app/.well-known/apple-app-site-association/route";

// ── No link ever opens the iPhone app ───────────────────────────────────────
// Owner, 2026-09-29: someone sends you their SwiftCard link, you have the app
// and are signed in, you tap it — and it opened the card INSIDE the app, with
// no way to leave. Then: "the same exact glitch for the SwiftLinks … SwiftLink,
// Swift Signature, and the SwiftCard link" and "We don't want links ever
// opening in that app. That glitch cannot happen."
//
// Three layers, each pinned here:
//   1. The AASA claims NOTHING, so iOS never routes a swiftcard.me link to the
//      app (both the iOS 13+ "components" form and the legacy "paths" form).
//   2. A link that still reaches the app (a phone holding Apple's cached copy
//      of an older file) is handed to the browser and never shown in the app.
//   3. If the app's webview lands on a public card / Swift Links page by ANY
//      route, it hides it, hands it to the browser and returns to the dashboard.

function glob(pattern: string, path: string): boolean {
  const re = new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
  return re.test(path);
}
// Apple: components are tried in order, first match wins, no match = browser.
function componentsOpenApp(components: { "/": string; exclude?: boolean }[], path: string): boolean {
  for (const c of components) {
    if (glob(c["/"], path)) return !c.exclude;
  }
  return false;
}
// Legacy paths: a "NOT " entry excludes; otherwise first match opens the app.
function pathsOpenApp(paths: string[], path: string): boolean {
  for (const p of paths) {
    if (p.startsWith("NOT ")) {
      if (glob(p.slice(4), path)) return false;
    } else if (glob(p, path)) return true;
  }
  return false;
}

const LINKS: [string, string][] = [
  ["SwiftCard link", "/danalee-meridianbank"],
  ["SwiftCard QR / NFC", "/danalee-meridianbank?source=qr"],
  ["Swift Links", "/links/danalee-meridianbank"],
  ["Swift Signature", "/danalee-meridianbank?source=email_signature"],
  ["legacy /card/ address", "/card/danalee-meridianbank"],
  ["home-screen widget QR", "/danalee-meridianbank?source=widget"],
  ["Office invite", "/join/abc123"],
  ["web OAuth return", "/auth/callback"],
  ["homepage", "/"],
  ["pricing", "/pricing"],
  ["dashboard", "/dashboard"],
  ["short link", "/r/ABC123"],
];

describe("1 · the association file claims no link at all", () => {
  it.each(LINKS)("%s (%s) never opens the app", async (_label, url) => {
    const path = url.split("?")[0];
    const detail = (await (await GET()).json()).applinks.details[0];
    expect(componentsOpenApp(detail.components, path)).toBe(false);
    expect(pathsOpenApp(detail.paths, path)).toBe(false);
  });

  it("excludes everything, in both forms", async () => {
    expect([...AASA_PATHS]).toEqual(["NOT /*"]);
    expect(aasaComponents()).toEqual([{ "/": "/*", exclude: true }]);
    const detail = (await (await GET()).json()).applinks.details[0];
    expect(detail.paths).toEqual(["NOT /*"]);
    expect(detail.components).toEqual([{ "/": "/*", exclude: true }]);
    // No include anywhere: every component excludes, every path is a NOT.
    expect(detail.components.every((c: { exclude?: boolean }) => c.exclude === true)).toBe(true);
    expect(detail.paths.every((p: string) => p.startsWith("NOT "))).toBe(true);
  });

  it("no sign-in return depends on a universal link (they use swiftcard://)", () => {
    expect(readFileSync("src/lib/native-auth.ts", "utf8")).toMatch(/NATIVE_OAUTH_REDIRECT = "swiftcard:\/\/auth-callback"/);
    expect(readFileSync("src/lib/native-google-login.ts", "utf8")).toMatch(/NATIVE_AUTH_CALLBACK = "swiftcard:\/\/auth-callback"/);
  });

  it("the Share page builds the Swift Signature and Swift Links addresses tested above", () => {
    const share = readFileSync("src/app/share/page.tsx", "utf8");
    expect(share).toMatch(/const cardUrl = `\$\{APP_URL\}\/\$\{activeUsername\}\?source=email_signature`/);
    expect(share).toMatch(/const swiftUrl = `\$\{APP_URL\}\/links\/\$\{activeUsername\}`/);
  });
});

describe("2 · a link that still reaches the app goes to the browser, never the webview", () => {
  const bridge = readFileSync("src/components/NativeAppBridge.tsx", "utf8");
  const purchase = readFileSync("src/lib/external-purchase.ts", "utf8");
  const handler = bridge.slice(bridge.indexOf('addListener("appUrlOpen"'), bridge.indexOf("pushNotificationActionPerformed"));

  it("hands it to the default browser, with a bounce guard, and no webview fallback", () => {
    expect(handler).toMatch(/openLinkInDefaultBrowser\(dest\)/);
    expect(handler).toMatch(/if \(bounced\) return;/);
    // The only webview navigations left in the https branch: the widget's
    // empty state "/" and a widget tap → dashboard.
    const https = handler.slice(handler.indexOf("const u = new URL(url);"));
    const navs = https.match(/window\.location\.(href\s*=|replace\()[^;]*/g) ?? [];
    expect(navs).toEqual([
      "window.location.href = dest",
      "window.location.replace(`/dashboard?card=${encodeURIComponent(card)}`)",
    ]);
    expect(https).toMatch(/if \(u\.pathname === "\/"\) \{\s*window\.location\.href = dest;/);
  });

  it("goes out via www, which the app does not claim, so iOS can't route it back", () => {
    expect(purchase).toMatch(/url: `https:\/\/www\.swiftcard\.me\$\{pathAndQuery\}`/);
    for (const f of ["ios/App/App/AppRelease.entitlements", "ios/App/App/App.entitlements"]) {
      expect(readFileSync(f, "utf8")).not.toContain("applinks:www.swiftcard.me");
    }
  });

  it("a widget tap opens the dashboard — only for THIS phone's widget card", () => {
    // The widget's QR encodes the same ?source=widget address, so someone
    // else's widget QR is a card link and must go to the browser.
    expect(bridge).toMatch(/u\.searchParams\.get\("source"\) === "widget" && widgetCard && card === widgetCard/);
    expect(bridge).toMatch(/localStorage\.setItem\(WIDGET_CARD_KEY, active\.username\)/);
    expect(bridge).toMatch(/localStorage\.removeItem\(WIDGET_CARD_KEY\)/);
  });
});

describe("3 · a public card / Swift Links page is never a screen in the app", () => {
  const bridge = readFileSync("src/components/NativeAppBridge.tsx", "utf8");

  it("both public pages carry the marker — including their not-found state", () => {
    for (const f of ["src/app/[username]/page.tsx", "src/app/links/[username]/page.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src.match(/other: \{ \[PUBLIC_PAGE_META\]: "(card|links)" \}/g)?.length, f).toBe(2);
    }
    expect(PUBLIC_PAGE_META).toBe("sc-public-page");
  });

  it("the bridge hides it, hands it to the browser and returns to the dashboard", () => {
    expect(bridge).toMatch(/document\.querySelector\(`meta\[name="\$\{PUBLIC_PAGE_META\}"\]`\)/);
    expect(bridge).toMatch(/window\.top === window/);
    expect(bridge).toMatch(/document\.documentElement\.style\.visibility = "hidden"/);
    expect(bridge).toMatch(/\.finally\(\(\) => window\.location\.replace\("\/dashboard"\)\)/);
  });

  // In the iOS shell a target="_blank" link goes to Capacitor's
  // createWebViewWith → UIApplication.open, i.e. Safari.
  it("the app's own open-my-card / Swift Links / signature buttons leave the app", () => {
    const share = readFileSync("src/app/share/page.tsx", "utf8");
    expect(share).toMatch(/<a href=\{ownLiveHref\(user\.id, swiftUrl, APP_URL\)\} target="_blank"/);
    const sig = readFileSync("src/components/EmailSignatureBox.tsx", "utf8");
    expect(sig.match(/<a href=\{previewHref \?\? cardUrl\} target="_blank"/g)?.length).toBe(2);
    const dash = readFileSync("src/app/dashboard/page.tsx", "utf8");
    expect(dash.match(/href=\{liveHref\}\s*target="_blank"/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
