import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── The offline QR screen (iOS 1.0.6+) ──────────────────────────────────────
//
// With no signal the shell used to show a blank screen: it is a remote-URL
// webview, the load fails, and nothing local was ever wired to replace it.
// OfflineCard.swift now draws the saved card's QR natively over the webview.
//
// Source guards, not behaviour tests — CI has no Xcode. The behaviour was
// verified 2026-10-02 in the simulator against an unreachable server: the
// card appeared within seconds (above the 15s launch-splash failsafe), the
// on-screen QR decoded to the card URL with ?source=qr_code, a signed-out
// device showed only "You're offline", and a normal online launch was
// untouched.

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const swift = read("ios/App/App/OfflineCard.swift");
const main = read("ios/App/App/MainViewController.swift");
const proj = read("ios/App/App.xcodeproj/project.pbxproj");
const config = read("capacitor.config.ts");

describe("offline QR screen", () => {
  it("is compiled into the app target", () => {
    // A Swift file on disk but not in the Sources phase compiles nothing —
    // the home-screen widget once shipped missing for exactly that reason.
    expect(proj).toMatch(/OfflineCard\.swift in Sources \*\/ = \{isa = PBXBuildFile/);
    expect(proj).toMatch(/\/\* OfflineCard\.swift in Sources \*\/,/);
  });

  it("is installed by the bridge view controller", () => {
    expect(code(main)).toMatch(/offlineCard = OfflineCardController\(webView:/);
  });

  it("only reacts to connectivity errors, never to cancelled navigations", () => {
    // Every external link Capacitor hands to Safari arrives as a cancelled
    // navigation. Reacting to those would cover the app with the offline
    // screen whenever someone tapped a social link — the reason this is not
    // Capacitor's server.errorPath.
    const body = code(swift);
    expect(body).toMatch(/guard e\.domain == NSURLErrorDomain else \{ return false \}/);
    expect(body).toContain("NSURLErrorNotConnectedToInternet");
    expect(body).not.toContain("NSURLErrorCancelled");
    expect(config).not.toMatch(/errorPath/);
  });

  it("forwards everything else to Capacitor's own navigation delegate", () => {
    const body = code(swift);
    expect(body).toMatch(/override func forwardingTarget\(for aSelector: Selector!\) -> Any\?/);
    expect(body).toMatch(/override func responds\(to aSelector: Selector!\) -> Bool/);
    for (const cb of ["didFinish:", "didFail:", "didFailProvisionalNavigation:"]) {
      expect(body, cb).toContain(`inner?.webView?(webView, ${cb}`);
    }
  });

  it("reads the same saved card as the widget and the watch", () => {
    expect(swift).toContain('"group.me.swiftcard.app"');
    expect(swift).toContain('"widget_card"');
    // Same encoder settings as the widget and watch: one code everywhere.
    expect(code(swift)).toContain('filter.correctionLevel = "M"');
  });

  it("tags a scan of the offline screen as a QR code scan", () => {
    expect(code(swift)).toMatch(/URLQueryItem\(name: "source", value: "qr_code"\)/);
  });

  it("is in the help assistant's knowledge", () => {
    const kb = read("src/lib/knowledge/docs/product.ts");
    expect(kb).toContain('id: "offline"');
    expect(kb).toContain("You're offline");
  });
});
