// ── Which swiftcard.me links open the iPhone app ────────────────────────────
//
// Only the two links that exist to continue something IN the app:
//   /join/*        an Office invite — accepted while signed in to the app
//   /auth/callback the web OAuth return leg (safety net; see the AASA route)
//
// A card link does NOT. Owner, 2026-09-29: someone sends you their SwiftCard,
// you have the app, you tap it — and it opened INSIDE the app, a public card
// page with no app chrome and no way back out. Card links belong in the
// browser, always. From 2026-09-23 to 2026-09-29 this file claimed /card/*,
// /links/* and every top-level card path (swiftcard.me/<name>) so an owner's
// own opens happened where they were signed in; lib/self-pass (the "View live"
// pass, 2026-09-24) now covers that without hijacking everyone else's links.
//
// Apple matches "components" in order and a path that matches nothing is NOT
// opened in the app, so this list is only the includes. Never add a card path
// (/card/*, /links/*, or a catch-all "/*") back — tests/aasa-card-links.test.ts
// fails if one returns.
export const APP_PATHS = ["/join/*", "/auth/callback"] as const;

export function aasaComponents() {
  return APP_PATHS.map((p) => ({ "/": p }));
}

/**
 * Whether a swiftcard.me path is one the app handles itself. Anything else that
 * reaches the app as a universal link (an iPhone still holding the old AASA
 * from Apple's CDN cache) is handed to the browser by NativeAppBridge.
 */
export function opensInApp(pathname: string): boolean {
  return pathname === "/auth/callback" || pathname.startsWith("/join/");
}
