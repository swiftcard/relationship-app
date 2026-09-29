import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { APP_PATHS, aasaComponents, opensInApp } from "@/lib/universal-links";
import { GET } from "@/app/.well-known/apple-app-site-association/route";

// ── Card links open in the BROWSER, never inside the app ────────────────────
// Owner, 2026-09-29: someone sends you their SwiftCard link, you have the app
// and are signed in, you tap it — and it opened the card INSIDE the app, with
// no way to leave. Card links belong in the browser. Only an Office invite and
// the OAuth safety net may open the app. Apple's rule: components are tried in
// order, first match wins, and a path that matches nothing stays in Safari.

function glob(pattern: string, path: string): boolean {
  const re = new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
  return re.test(path);
}
function aasaOpensApp(components: { "/": string; exclude?: boolean }[], path: string): boolean {
  for (const c of components) {
    if (glob(c["/"], path)) return !c.exclude;
  }
  return false;
}
function legacyPathsOpenApp(paths: string[], path: string): boolean {
  return paths.some((p) => glob(p, path));
}

const CASES: [string, boolean][] = [
  // Cards and Swift Links — every form of the address — stay in the browser.
  ["/aaronlavi-swiftcardinc", false],
  ["/danalee-meridianbank", false],
  ["/links/danalee-meridianbank", false],
  ["/card/danalee-meridianbank", false],
  // The site stays in the browser too.
  ["/", false],
  ["/pricing", false],
  ["/dashboard", false],
  ["/api/self-view", false],
  ["/r/ABC123", false],
  // Only these continue something in the app.
  ["/join/abc", true],
  ["/auth/callback", true],
];

describe("which links open the app (served AASA, both forms)", () => {
  it.each(CASES)("%s → app: %s", async (path, app) => {
    const body = await (await GET()).json();
    const detail = body.applinks.details[0];
    // iOS 13+ reads components; older iOS reads paths. Both must agree.
    expect(aasaOpensApp(detail.components, path)).toBe(app);
    expect(legacyPathsOpenApp(detail.paths, path)).toBe(app);
    // And the bridge's own check matches what the file claims.
    expect(opensInApp(path)).toBe(app);
  });

  it("claims nothing but the invite and the OAuth return", () => {
    expect([...APP_PATHS]).toEqual(["/join/*", "/auth/callback"]);
    expect(aasaComponents()).toEqual([{ "/": "/join/*" }, { "/": "/auth/callback" }]);
  });

  it("never claims a card path or a catch-all again", async () => {
    const served = JSON.stringify(await (await GET()).json());
    expect(served).not.toMatch(/"\/card\/\*"|"\/links\/\*"|"\/\*"/);
  });
});

describe("a card link that still reaches the app goes on to the browser", () => {
  // Phones keep Apple's cached copy of the old file for a while, so a card
  // link can still arrive through appUrlOpen after the AASA is fixed.
  const bridge = readFileSync("src/components/NativeAppBridge.tsx", "utf8");
  const purchase = readFileSync("src/lib/external-purchase.ts", "utf8");

  it("only /join, /auth/callback (and the widget's empty-state /) navigate the webview directly", () => {
    expect(bridge).toMatch(/if \(opensInApp\(u\.pathname\) \|\| u\.pathname === "\/"\) \{\s*window\.location\.href = dest;/);
  });

  it("a home-screen widget tap opens the dashboard, not the public card", () => {
    expect(bridge).toMatch(/u\.searchParams\.get\("source"\) === "widget"/);
    expect(bridge).toMatch(/`\/dashboard\?card=\$\{encodeURIComponent\(card\)\}`/);
  });

  it("everything else is handed to the default browser, with a bounce guard", () => {
    expect(bridge).toMatch(/openLinkInDefaultBrowser\(dest\)/);
    expect(bridge).toMatch(/handedOff\?\.dest === dest/);
  });

  it("the hand-off goes out via www, which the app does not claim, so iOS can't route it back", () => {
    expect(purchase).toMatch(/url: `https:\/\/www\.swiftcard\.me\$\{pathAndQuery\}`/);
    const ent = readFileSync("ios/App/App/AppRelease.entitlements", "utf8");
    expect(ent).toContain("applinks:swiftcard.me");
    expect(ent).not.toContain("applinks:www.swiftcard.me");
  });

  it("the last-resort in-app view is never a dead end", () => {
    expect(bridge).toMatch(/sessionStorage\.setItem\(CARD_ESCAPE_KEY, u\.pathname\)/);
    expect(bridge).toMatch(/showCardEscape\(\)/);
    expect(bridge).toMatch(/btn\.textContent = "Done"/);
  });
});
