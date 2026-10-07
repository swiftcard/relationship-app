import { APP_STORE_URL, PLAY_STORE_URL } from "@/lib/app-store";
import { isLikelyBot } from "@/lib/bot-detection";

// ── swiftcard.me/download — one link, the right store ────────────────────────
//
// The address that goes on a QR code, in a text, in an email signature or on
// a slide: it reads the device and lands on that device's store, so nobody is
// ever handed an App Store page on an Android phone. The decision is made in
// src/proxy.ts BEFORE any HTML is sent (a real 307), so a phone never paints
// the page and then jumps; a computer, a bot and anything unrecognised fall
// through to src/app/download/page.tsx, which shows both stores.
//
// Pure functions only, isomorphic on purpose: the proxy calls them server-side,
// and the fallback page's iPad fix (components/download/IpadStoreRedirect) calls
// the same ones in the browser, so there is exactly one notion of "which store"
// and one way of carrying attribution across.

export type StoreOs = "ios" | "android";

/**
 * Which store a User-Agent belongs to, or null when the string does not say.
 *
 *  • iPhone / iPad / iPod — every iOS browser keeps the device token (Chrome is
 *    "CriOS", Firefox "FxiOS", Edge "EdgiOS"), and so does every in-app
 *    browser (Instagram, Facebook "FBIOS", LinkedIn "LinkedInApp", TikTok,
 *    Snapchat, Gmail, Slack). One test covers all of them.
 *  • Android — phones ("Mobile"), tablets (no "Mobile"), Samsung Internet,
 *    Firefox, and every Android in-app browser ("Instagram", "FB_IAB",
 *    "LinkedInApp") all carry it.
 *  • Windows Phone is checked FIRST: its last browsers claimed to be Android
 *    AND iPhone in one string ("Android 6.0.1; ... Lumia 950 ... like iPhone
 *    OS 7_0_3"). Neither store has an app for it — the page is the only
 *    honest answer.
 *  • iPadOS Safari presents as a Mac ("Macintosh; Intel Mac OS X") and sends
 *    no client hints, so from the server it IS a desktop. The page handles it
 *    on the client with the one tell a Mac never has: navigator.maxTouchPoints
 *    > 1 (the same test sc-boot uses for data-sc-os).
 */
export function detectStoreOs(userAgent: string | null | undefined): StoreOs | null {
  const ua = userAgent ?? "";
  if (!ua) return null;
  if (/Windows Phone|IEMobile/i.test(ua)) return null;
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return null;
}

// Forwarded params: a sane key, a bounded value, and never more than the
// store's own URL can carry. Anything odd is dropped, not rejected — the
// person still reaches the store, just without that one tag.
const PARAM_KEY = /^[\w.-]{1,64}$/;
const PARAM_VALUE_MAX = 256;
const PARAMS_MAX = 24;

/**
 * The store URL with the visitor's query string carried across.
 *
 * Every incoming parameter is appended as-is (utm_*, gclid, fbclid, a `src`
 * campaign code — whatever the link was tagged with), EXCEPT one that the
 * listing URL already has: Play's `?id=<package>` names the app, and a stray
 * `?id=` on our link must not be allowed to point the redirect at someone
 * else's app.
 *
 * Google Play additionally reads campaign data from ONE parameter, `referrer`,
 * which the installed app receives through the Install Referrer API
 * (Play Campaign Measurement). So when utm_* tags arrive and the link did not
 * set `referrer` itself, the utm set is packed into it — that is what makes an
 * Android install attributable, not the loose utm_* params. Apple has no such
 * channel: utm_* is forwarded for App Store Connect's referrer reporting and
 * for anyone reading their own link clicks, and nothing is renamed.
 *
 * No incoming params → the base URL exactly, no trailing "?".
 */
export function storeUrlWithAttribution(storeUrl: string, search: string | URLSearchParams, store: StoreOs): string {
  const out = new URL(storeUrl);
  const incoming = typeof search === "string" ? new URLSearchParams(search) : search;
  let n = 0;
  const utm = new URLSearchParams();
  for (const [k, v] of incoming) {
    if (!PARAM_KEY.test(k) || v.length > PARAM_VALUE_MAX) continue;
    if (out.searchParams.has(k)) continue;
    if (++n > PARAMS_MAX) break;
    out.searchParams.append(k, v);
    if (k.startsWith("utm_")) utm.append(k, v);
  }
  if (store === "android" && !out.searchParams.has("referrer") && [...utm].length > 0) {
    out.searchParams.set("referrer", utm.toString());
  }
  return out.toString();
}

/**
 * Where /download should send this request, or null for "show the page".
 *
 * Null for: an unrecognised or missing User-Agent; a crawler, link unfurler or
 * HTTP client (lib/bot-detection — so Google indexes a page with both stores
 * on it and an iMessage preview shows OUR title, not Apple's); and a
 * recognised device whose store URL is not configured yet (lib/app-store's
 * self-activating contract: no listing, no link — the page then shows
 * whichever store exists).
 *
 * The result is always one of the two store origins, never a swiftcard.me
 * path, which is what makes a redirect loop impossible by construction; the
 * proxy checks that too, and tests/download-link.test.ts pins both.
 */
export function resolveDownloadTarget(
  userAgent: string | null | undefined,
  search: string | URLSearchParams,
  stores: { appStoreUrl: string | null; playStoreUrl: string | null } = { appStoreUrl: APP_STORE_URL, playStoreUrl: PLAY_STORE_URL },
): string | null {
  if (isLikelyBot(userAgent)) return null;
  const os = detectStoreOs(userAgent);
  if (!os) return null;
  const base = os === "ios" ? stores.appStoreUrl : stores.playStoreUrl;
  if (!base) return null;
  return storeUrlWithAttribution(base, search, os);
}

/** The iPadOS-as-Mac tell, for the page's client-side fix. Never true on a Mac. */
export function looksLikeIpadAsMac(userAgent: string, maxTouchPoints: number): boolean {
  return /Macintosh/.test(userAgent) && !/iPhone|iPad|iPod|Android/.test(userAgent) && maxTouchPoints > 1;
}
