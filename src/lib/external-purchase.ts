"use client";

// ── The US-storefront external purchase link ────────────────────────────────
//
// App Review rejected 1.0.0 (3) under Guideline 3.1.1: a paying customer signs
// into the app and uses features they bought on swiftcard.me, and that content
// "isn't available to purchase using In-App Purchase". The rejection itself
// named the remedy:
//
//   "Apps on the United States storefront may link out to the default browser,
//    using buttons, external links, or other calls to action, for payment
//    mechanisms other than in-app purchase."
//
// Guideline 3.1.1(a) confirms no entitlement is needed for that on the US
// storefront. So the compliant purchase path is a button that leaves the app.
//
// TWO THINGS THIS MODULE EXISTS TO GUARANTEE
//
// 1. It really leaves the app. `swiftcard.me` is allow-listed in
//    capacitor.config.ts (the shell IS that origin), so an <a>, a target=_blank
//    or a window.open all stay inside the WKWebView, and @capacitor/browser
//    opens an in-app SFSafariViewController that merely looks like Safari.
//    Only UIApplication.open reaches the default browser, which is what Apple
//    asked for — hence the native plugin in ios/App/App/ExternalPurchase.swift.
//
// 2. It fails CLOSED. If the plugin is missing — an older shell build, or a
//    non-US storefront if availability is ever widened — this returns false and
//    the caller renders NO button. A silent fallback to an in-webview link
//    would look compliant while being exactly the violation that got us
//    rejected, and it would ship to storefronts where the link is not allowed.

import { detectNativeApp } from "@/lib/platform";

type ExternalPurchasePlugin = {
  open: (options: { url: string }) => Promise<{ opened: boolean }>;
};

function plugin(): ExternalPurchasePlugin | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    window as unknown as {
      Capacitor?: { Plugins?: { ExternalPurchase?: ExternalPurchasePlugin } };
    }
  ).Capacitor?.Plugins?.ExternalPurchase;
}

/**
 * Whether a compliant external purchase link can actually be offered right now.
 *
 * False on web (the site has its own checkout) and false in any shell build
 * whose native half predates the plugin. Callers MUST gate on this rather than
 * rendering a button and hoping — see the fail-closed note above.
 */
export function canOfferExternalPurchase(): boolean {
  return detectNativeApp() && !!plugin();
}

/**
 * Where the link goes. `src` is for acquisition attribution, nothing more.
 *
 * The query goes BEFORE any fragment. Appending it blindly produced
 * "/settings/flows#billing?src=ios_link", where the whole "billing?src=ios_link"
 * is the fragment — so a deep link to a settings section silently landed on the
 * default section instead.
 */
export function externalPurchaseUrl(path = "/upgrade"): string {
  const hashAt = path.indexOf("#");
  const base = hashAt === -1 ? path : path.slice(0, hashAt);
  const fragment = hashAt === -1 ? "" : path.slice(hashAt);
  return `https://swiftcard.me${base}${base.includes("?") ? "&" : "?"}src=ios_link${fragment}`;
}

/** The one call that actually leaves the app. Everything else delegates here. */
async function openViaPlugin(path?: string): Promise<boolean> {
  const p = plugin();
  if (!p) return false;
  try {
    const { opened } = await p.open({ url: externalPurchaseUrl(path) });
    return !!opened;
  } catch {
    return false;
  }
}

/**
 * Open the subscribe page in the default browser.
 *
 * Resolves false when the plugin is absent or the system declined, so a caller
 * can surface a real failure instead of leaving the user staring at a button
 * that did nothing.
 */
export async function openExternalPurchase(path?: string): Promise<boolean> {
  return openViaPlugin(path);
}

// ── Any swiftcard.me page you can reach checkout FROM ────────────────────────
//
// 1.0.0 (7) was rejected under 3.1.1 a second time, and the screenshot Apple
// attached was the marketing pricing page — $4.99/month, "Start free trial" —
// inside an SFSafariViewController sheet opened from the app's own sign-in
// screen (LoginForm's "SwiftCard.me" link, then @capacitor/browser).
//
// The trap: `detectNativeApp()` reads `webkit.messageHandlers.bridge`, which
// does NOT exist inside that sheet. So every native guard we rely on silently
// switched OFF in there — /pricing and /upgrade render their full selling
// surface instead of bouncing to /dashboard — and Stripe checkout sat two taps
// from the login screen, *inside the app*. That is the violation, not the
// external link itself: Apple's US-storefront allowance is specifically for
// linking out to the DEFAULT BROWSER.
//
// So the rule is broader than "purchase buttons": **any** link that lands on a
// swiftcard.me page from which checkout is reachable must go through the same
// native plugin. In-app browser sheets are reserved for /api/* round trips
// (OAuth, file downloads) where there is no navigation to a selling surface.

/**
 * Whether a swiftcard.me page can be opened in the DEFAULT browser right now.
 *
 * Callers must render NO tappable link when this is false — see the fail-closed
 * note at the top. A fallback to an in-webview link or an in-app browser sheet
 * would look compliant while being the exact thing that got 1.0.0 (7) rejected.
 */
export function canOpenInDefaultBrowser(): boolean {
  return canOfferExternalPurchase();
}

/** Open a swiftcard.me page in the default browser. False = nothing happened. */
export async function openInDefaultBrowser(path = "/"): Promise<boolean> {
  return openViaPlugin(path);
}

/**
 * Hand a card link that reached the app back to the default browser, exactly
 * as it was sent (no ?src — it is someone's card, not a purchase link).
 *
 * Owner, 2026-09-29: a SwiftCard link someone sent you must open in the
 * browser, never inside the app. It goes out through www.swiftcard.me, which
 * no build of the app has ever claimed (1.0.4 on claims no domain at all), so
 * iOS cannot route it straight back into the app while a phone still holds an
 * old association file; the site's www → apex 308 then lands Safari on the
 * real address.
 */
export async function openLinkInDefaultBrowser(pathAndQuery: string): Promise<boolean> {
  const p = plugin();
  if (!p || !pathAndQuery.startsWith("/") || pathAndQuery.startsWith("//")) return false;
  try {
    const { opened } = await p.open({ url: `https://www.swiftcard.me${pathAndQuery}` });
    return !!opened;
  } catch {
    return false;
  }
}
