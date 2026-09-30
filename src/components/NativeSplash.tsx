import { cookies, headers } from "next/headers";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isNativeRequest } from "@/lib/native-request";

/**
 * The iOS shell's launch animation: a fork of lightning down the whole screen,
 * the logo emerging from the flash, then the logo's own bolt opening onto the
 * app. Owner-specified sequence, 2026-08-31.
 *
 * Why it is SERVER-rendered and shell-gated
 * -----------------------------------------
 * iOS shows a static launch image and cannot animate it, so this takes over the
 * instant the webview paints and its first frame is pixel-identical to that
 * image (#1A2342 with the icon at 20.351vmax, centred). To be identical on the
 * FIRST frame the markup has to be in the initial HTML — a mount effect would
 * paint a blank frame first, which is exactly the flash of nothing this
 * replaces. Both images are data URIs for the same reason: a network request
 * for the icon could not resolve before the first frame.
 *
 * It is emitted only for shell requests (UA token / sc_shell cookie), so the
 * website never downloads the inlined artwork.
 *
 * PLAYS ON EVERY LAUNCH, NEVER MID-SESSION
 * ----------------------------------------
 * This used to be gated on a 2-minute `sc_splash` cookie, which had it exactly
 * backwards: the cookie outlives the app, so quitting and reopening inside two
 * minutes — the single most common way anyone reopens an app — got NO launch
 * animation, while the guarantee it bought (no replay on in-app navigations)
 * is already provided precisely by the same-origin referrer check in the
 * markup. Launch detection is now stateless and correct:
 *
 *   `Sec-Fetch-Site: same-origin`  =>  a navigation from a page of ours, so
 *   this is not a launch: skip the payload entirely. A cold launch (or a
 *   universal link from another app) carries `none`, and iOS 15 — below the
 *   16.4 that added the header — omits it, in which case we still send the
 *   markup and the referrer guard suppresses the animation client-side.
 *
 * No cleanup script: React owns this subtree, so rather than removing the node
 * from under it the animation ends on `visibility:hidden`, and the root carries
 * `pointer-events:none` throughout — the overlay can never eat a tap, before or
 * after it finishes.
 *
 * The artwork is the shipped app icon, unmodified except for one repair: the
 * file is a solid square whose corners are filled with the same navy as the
 * splash, which showed as a dark box the moment light passed behind it. Those
 * corner pixels are transparent in the copy used here (scripts/build-splash-assets.mjs).
 */

// TWO VERSIONS, CHOSEN BY THE APP BUILD (owner, 2026-09-18).
//
// The animation's first frame has to be pixel-identical to the static launch
// image compiled INTO the installed app — and that image changes only with a
// new App Store build. v2 fills the whole screen with the logo's own gradient
// and shows only the logo's mark (no square); v1 is the navy field with the
// square icon. Builds that ship the v2 launch image add `SwiftCardSplash/2` to
// their user-agent (capacitor.config.ts); every build without it keeps v1, so
// no installed app ever sees a first frame that doesn't match its own launch
// image. v2's assets come from scripts/build-splash-v2.mjs.
export const SPLASH_V2_TOKEN = "SwiftCardSplash/2";
// v3 (owner, 2026-09-20): the reference image — a deeper blue field with the
// sheen across the top, and the mark bigger, brighter and DRAWN rather than
// lifted out of the app icon (scripts/build-splash-v3.mjs). Same rule as v2:
// only a build whose launch image IS this may be handed this animation, so it
// carries its own token and every older build keeps what it shipped with.
export const SPLASH_V3_TOKEN = "SwiftCardSplash/3";

/**
 * The Android shell announces itself with this instead of a SwiftCardSplash
 * token, and gets NO web splash overlay at all.
 *
 * Every markup file here exists to be pixel-identical to a compiled-in iOS
 * LAUNCH IMAGE at frame 0, so the handoff from native to web is invisible.
 * Android has no launch image: its launch screen is the system SplashScreen
 * API, a background colour with a centred icon, which none of this markup
 * resembles. Worse, the version ladder below falls through to v1 for any UA
 * with no token — so an Android build would be handed markup-v1to3.html, whose
 * frame 0 is the old navy square icon, and every cold open would visibly jump.
 *
 * Nothing is lost by bailing: NativeAppBridge calls SplashScreen.hide() on
 * mount regardless, which is the same backstop every page without this markup
 * already relies on. When an Android animation is built it gets its own token
 * and its own file, and never joins the iOS ladder.
 */
export const SPLASH_ANDROID_TOKEN = "SwiftCardAndroid/";

// Read once per server process, not once per request: this is ~52KB of inlined
// artwork and a synchronous disk read has no business in the request path.
// WHICH FILE EACH INSTALLED BUILD GETS.
//
// A build carrying the v3 launch image gets the v3 animation, whose frame 0 IS
// that image. Every build already on a phone carries an older image, and the
// owner did not want to wait for review to see the new screen (2026-09-22), so
// those get a TRANSITION file: the same v3 sequence, but starting on the launch
// image that build actually has and cross-fading to the new one at 110-320ms,
// under the charge and before the fork lands (build-splash-transition.mjs).
// The handoff from the static image stays pixel-identical either way — which is
// the one rule none of these may break.
const MARKUP: Record<SplashVersion, string> = {
  3: "markup-v3.html",
  2: "markup-v2to3.html",
  1: "markup-v1to3.html",
};
export type SplashVersion = 1 | 2 | 3;

const cachedMarkup: Record<string, string> = {};
function splashMarkup(version: SplashVersion): string {
  const file = MARKUP[version];
  return (cachedMarkup[file] ??= readFileSync(join(process.cwd(), "src/lib/splash", file), "utf8"));
}

export default async function NativeSplash() {
  const [h, c] = await Promise.all([headers(), cookies()]);
  if (!isNativeRequest(h.get("user-agent"), c.get("sc_shell")?.value ?? null)) return null;
  // A navigation from one of our own pages is not a launch — see above.
  if (h.get("sec-fetch-site") === "same-origin") return null;
  // That header is the ONLY server-side launch signal there is, and it is not
  // reliable: tapping the Home tab from Contacts or Links is a client-side
  // navigation whose router fetch reached here without it, so the markup rode
  // along in the RSC payload and React mounted it — WITHOUT running its inline
  // guard script (browsers never execute scripts inserted that way) — and the
  // lightning replayed mid-session ("splash comes back when I press Home",
  // 2026-09-03). Do not try to detect the router fetch here instead: Next
  // deliberately strips `rsc`, `next-router-prefetch` (request-store.ts) and
  // `next-url` (base-server.ts) before headers() sees them. The fix lives in
  // the markup: the overlay is display:none unless its own parse-time guard
  // armed it, so markup delivered any other way can never show. The cost of a
  // miss here is bandwidth (~52KB), never a replay.

  const ua = h.get("user-agent") ?? "";
  // Android: no overlay, and crucially BEFORE the version ladder below, which
  // would otherwise read "no splash token" as "the oldest iOS build".
  if (ua.includes(SPLASH_ANDROID_TOKEN)) return null;
  const version = ua.includes(SPLASH_V3_TOKEN) ? 3 : ua.includes(SPLASH_V2_TOKEN) ? 2 : 1;
  return <div suppressHydrationWarning dangerouslySetInnerHTML={{ __html: splashMarkup(version) }} />;
}
