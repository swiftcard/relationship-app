// ── Which store badge this visitor should see ───────────────────────────────
//
// ONE place decides it. Every download surface on the site shows exactly one
// badge — Google Play on Android, the App Store on iPhone / iPad / Mac, and a
// "Get the app" button (to swiftcard.me/download, which has the QR code and
// both stores) on a Windows, Linux or Chromebook computer that has no store
// of its own. Never two badges on one device, never a flash of the wrong one:
// the decision is written to <html data-sc-os> by the sc-boot inline script
// in src/app/layout.tsx BEFORE first paint, and one CSS rule in globals.css
// hides the badges that do not belong (.sc-store-apple / .sc-store-play /
// .sc-store-get).
//
// Two functions, one set of rules:
//   • detectStoreOsClient — the TypeScript version, for tests and for any
//     client component that wants to branch on the same answer.
//   • storeOsBoot — the SAME rules as an ES5 string, because an inline script
//     cannot import anything. tests/store-os.test.ts evaluates that string
//     against the same user-agent matrix as the function, so the two cannot
//     drift apart without a red test.
// The proxy's /download redirect (lib/download-link detectStoreOs) is the
// server-side third copy — it cannot see touch points and must filter bots —
// and the same test pins it to these wherever both have an answer.
//
// No imports, on purpose: the root layout pulls this in, and anything that
// drags a request-time API into the layout makes the whole marketing site
// dynamic again (see tests/native-splash.test.ts).

export type StoreOs = "ios" | "android" | "mac" | "other";

/**
 * The visitor's store, from the user agent and the touch-point count.
 *
 *  • Windows Phone is checked FIRST: its last browsers claimed to be Android
 *    AND iPhone in one string. No store has an app for it → "other".
 *  • iPhone / iPad / iPod — every iOS browser keeps the device token (Chrome
 *    "CriOS", Firefox "FxiOS", Edge "EdgiOS"), and so does every in-app
 *    browser (Instagram, Facebook "FBIOS", LinkedIn, TikTok, Gmail, Slack).
 *  • Android — phones ("Mobile"), tablets (no "Mobile"), Samsung Internet,
 *    Firefox, and every Android in-app browser ("Instagram", "FB_IAB").
 *  • Macintosh — iPadOS Safari presents as a Mac and sends no client hints.
 *    The one tell a real Mac never has: more than one touch point → iOS.
 *    Otherwise a Mac, which has the App Store too (the iPhone app is on the
 *    Mac App Store), so it keeps the App Store badge.
 *  • Linux with touch — Chrome's and Firefox's "Request desktop site" on an
 *    Android phone rewrites the UA to "X11; Linux x86_64" but the hardware
 *    still reports its touch points. A touchscreen Linux laptop is the
 *    accepted false positive; Chromebooks ("CrOS") are excluded and fall to
 *    "other" with the rest of the computers.
 *  • Everything else — Windows, Linux, ChromeOS, bots, an empty UA → "other".
 */
export function detectStoreOsClient(userAgent: string | null | undefined, maxTouchPoints: number | null | undefined): StoreOs {
  const ua = userAgent ?? "";
  const touch = maxTouchPoints ?? 0;
  if (/Windows Phone|IEMobile/i.test(ua)) return "other";
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Macintosh/.test(ua)) return touch > 1 ? "ios" : "mac";
  if (/Linux/.test(ua) && !/CrOS/.test(ua) && touch > 1) return "android";
  return "other";
}

/** Which stores actually exist (lib/app-store's self-activating contract). */
export type StoreAvailability = { apple: boolean; play: boolean };

/**
 * The detected OS, remapped for the stores that are configured: a device
 * whose own store has no listing yet is treated as a computer, so it gets the
 * "Get the app" button to swiftcard.me/download (which shows whatever store
 * exists) rather than no badge at all.
 */
export function resolveStoreOs(os: StoreOs, stores: StoreAvailability): StoreOs {
  if (os === "android" && !stores.play) return "other";
  if ((os === "ios" || os === "mac") && !stores.apple) return "other";
  return os;
}

/**
 * The inline boot snippet: the rules above as ES5, writing the answer to
 * `<html data-sc-os>`. Concatenated into the sc-boot script in the root
 * layout; runs before paint so the CSS has its answer on the first frame.
 * Only the detection — the MutationObserver that puts the attribute back
 * after a React root re-render stays in layout.tsx with the other attributes
 * it guards.
 */
export function storeOsBoot(stores: StoreAvailability): string {
  return (
    "var U=navigator.userAgent||'',T=navigator.maxTouchPoints||0,O='other';" +
    "if(/Windows Phone|IEMobile/i.test(U))O='other';" +
    "else if(/iPhone|iPad|iPod/.test(U))O='ios';" +
    "else if(/Android/.test(U))O='android';" +
    "else if(/Macintosh/.test(U))O=T>1?'ios':'mac';" +
    "else if(/Linux/.test(U)&&!/CrOS/.test(U)&&T>1)O='android';" +
    (stores.play ? "" : "if(O==='android')O='other';") +
    (stores.apple ? "" : "if(O==='ios'||O==='mac')O='other';") +
    "document.documentElement.setAttribute('data-sc-os',O);"
  );
}
