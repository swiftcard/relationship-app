// ── No swiftcard.me link ever opens the iPhone app ──────────────────────────
//
// Owner, 2026-09-29: someone sends you their SwiftCard, you have the app, you
// tap it — and it opened INSIDE the app, a public card page with no app chrome
// and no way back out. Then, the same day: "We don't want links ever opening
// in that app. That glitch cannot happen." So the association file claims
// NOTHING: SwiftCard links, Swift Links, Swift Signature links, QR codes, NFC
// taps, Office invites — every https link opens in the browser.
//
// Nothing needs a web link to reach the app: every sign-in and integration
// return leg uses the app's own swiftcard:// scheme (lib/native-auth,
// lib/native-google-login, the */callback routes), never a universal link.
//
// History: 2026-09-23 to 2026-09-29 this claimed /card/*, /links/* and every
// top-level card path so an owner's own opens happened where they were signed
// in; lib/self-pass (the "View live" pass) covers that now. Before that it
// claimed /card/*, /links/*, /join/*, /auth/callback.
//
// The file still names the app (Apple requires a well-formed file for the
// entitlement) but EXCLUDES every path, in both forms: "components" for iOS
// 13+, "NOT /*" in "paths" for older iOS. Never add an include back —
// tests/aasa-card-links.test.ts fails if one returns.

/**
 * <meta name> the public card and Swift Links pages carry. If the app's webview
 * ever lands on one — by any route — NativeAppBridge hides it, hands it to the
 * browser and puts the app back on the dashboard.
 */
export const PUBLIC_PAGE_META = "sc-public-page";

/** Legacy (pre-iOS 13) form: exclude everything. */
export const AASA_PATHS = ["NOT /*"] as const;

export function aasaComponents() {
  return [{ "/": "/*", exclude: true }];
}
