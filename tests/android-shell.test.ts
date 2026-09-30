import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isFcmEndpoint, buildFcmMessage, FCM_CHANNEL_ID, FCM_PREFIX } from "@/lib/fcm";

// ── The Android shell's decisions, pinned ───────────────────────────────────
//
// The Android app is the same remote-URL shell as the iPhone app: it loads
// swiftcard.me and the web code does the rest. That is what makes it cheap,
// and it is also what makes it dangerous — a great deal of shared code was
// written when "native" could only mean iOS, and every one of those places
// fails QUIETLY on Android rather than loudly.
//
// Every assertion below stands for something that produced no error message
// when it was wrong: a notification that never arrives, a link that vanishes,
// an error row filed on every paywall mount, a sign-in button missing.

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Source with its comments removed.
 *
 *  Every assertion here that says "this string must NOT appear" has to run on
 *  stripped source. On the first run of this file four of them failed against
 *  the comments that explain them — a test that greps prose is a test that
 *  lies in both directions. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/** XML with its comments removed, for the manifest. */
const xml = (src: string) => src.replace(/<!--[\s\S]*?-->/g, "");

const MANIFEST = "android/app/src/main/AndroidManifest.xml";

describe("no swiftcard.me link ever opens the Android app either", () => {
  // The Android mirror of tests/aasa-card-links.test.ts. Owner, 2026-09-29:
  // "We don't want links ever opening in that app. That glitch cannot happen."
  // iOS enforces it by shipping no Associated Domains entitlement and an
  // association file that excludes every path. Android has no "exclude"
  // concept — the enforcement is simply never claiming the domain, which means
  // the only thing to test is an absence, and absences rot silently.

  it("declares the swiftcard:// scheme, and it is not the app id", () => {
    // `npx cap add android` writes the APPLICATION ID into custom_url_scheme,
    // not the scheme. Left at its default, every swiftcard:// return leg — all
    // of native sign-in and every CRM connect — is unroutable, and the failure
    // is a browser sheet that just never comes back.
    expect(read("android/app/src/main/res/values/strings.xml"))
      .toMatch(/<string name="custom_url_scheme">swiftcard<\/string>/);
    expect(read(MANIFEST)).toMatch(/<data android:scheme="@string\/custom_url_scheme"\s*\/>/);
  });

  it("claims no https link, by autoVerify or otherwise", () => {
    const manifest = xml(read(MANIFEST));
    expect(manifest).not.toMatch(/android:autoVerify/);
    expect(manifest).not.toMatch(/android:host/);
    // An https <data> element inside an INTENT-FILTER is what would offer this
    // app as a handler for a card link. The <queries> block also names the
    // https scheme and must not be confused for one: that is Android 11+
    // package visibility, which is how we FIND a browser to hand links to.
    const filters = manifest.match(/<intent-filter>[\s\S]*?<\/intent-filter>/g) ?? [];
    expect(filters.length).toBeGreaterThan(0);
    for (const f of filters) expect(f).not.toMatch(/android:scheme\s*=\s*"https"/);
  });

  it("serves no assetlinks.json — the file that would grant App Links", () => {
    // Android verifies App Links against /.well-known/assetlinks.json on the
    // site. No file, no verification, no link opening the app — so this is a
    // second, independent lock on the same door.
    expect(existsSync(join(ROOT, "public/.well-known/assetlinks.json"))).toBe(false);
    expect(existsSync(join(ROOT, "src/app/.well-known/assetlinks.json"))).toBe(false);
    expect(existsSync(join(ROOT, "src/app/.well-known/assetlinks.json/route.ts"))).toBe(false);
  });
});

describe("the shell is recognised before the page paints", () => {
  it("both copies of the detection read androidBridge", () => {
    // window.Capacitor is created by Capacitor's own injected bundle, so on
    // Android it is a RACE against our boot script — there is no second early
    // signal to fall back on the way iOS has webkit.messageHandlers.bridge.
    // androidBridge is installed by the native side before any page script,
    // which is why @capacitor/core's own getPlatformId reads it first.
    // Losing this race on iOS flashed the marketing hero and leaked a login
    // sheet; the same gap on Android is the same bug.
    expect(read("src/lib/platform.ts")).toMatch(/androidBridge/);
    expect(read("src/app/layout.tsx")).toMatch(/window\.androidBridge/);
  });

  it("the boot script restores native-android after a hydration mismatch", () => {
    // React 19 strips every attribute off <html> when it client-renders the
    // root, which is how the light theme used to drop to dark "at random".
    // native-android carries the Android inset CSS and needs the same rescue.
    const layout = read("src/app/layout.tsx");
    expect(layout).toMatch(/native-android\(\\\\s\|\$\)/);
    expect(layout).toMatch(/classList\.add\('native-android'\)/);
  });

  it("platform.ts still imports no Capacitor package", () => {
    // 62 files import this module. A single import here pulled 55 kB of the
    // Capacitor runtime into every page of the WEBSITE, where the answer is
    // always false. The Android signals are raw globals for that reason.
    const src = read("src/lib/platform.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
    expect(src).not.toMatch(/from "@capacitor\//);
  });
});

describe("Android push is routed to Firebase, not to Apple", () => {
  it("the web-push branch excludes BOTH native prefixes", () => {
    // This is the whole bug in one line. The filter used to be
    // `!isApnsEndpoint(...)` alone, so an "fcm:<token>" row fell into the
    // web-push branch, which POSTs to the endpoint AS A URL. Not a crash —
    // one "blocked-endpoint" line in a failure list, and a notification that
    // never arrives. Android push would have looked fine and never worked.
    const push = read("src/lib/push.ts");
    expect(push).toMatch(/const webSubs = subs\.filter\(\(s\) => !isApnsEndpoint\(s\.endpoint\) && !isFcmEndpoint\(s\.endpoint\)\)/);
    expect(push).toMatch(/const fcmSubs = subs\.filter\(\(s\) => isFcmEndpoint\(s\.endpoint\)\)/);
    expect(push).toMatch(/sendFcmDetailed/);
  });

  it("isFcmEndpoint matches the prefix and nothing that merely mentions FCM", () => {
    expect(isFcmEndpoint("fcm:abc123")).toBe(true);
    expect(isFcmEndpoint("apns:abc123")).toBe(false);
    // A Google push URL is a web-push endpoint and must keep going to web-push.
    expect(isFcmEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isFcmEndpoint(null)).toBe(false);
    expect(isFcmEndpoint(undefined)).toBe(false);
  });

  it("the subscribe route accepts an fcm: token", () => {
    // isSafePushEndpoint exists to stop an unchecked https host becoming a
    // blind-SSRF primitive. A native token is never fetched, so both native
    // prefixes are allowed through on shape alone — but the Android one had
    // to be added, or every Android registration was rejected at the door.
    expect(read("src/app/api/push/subscribe/route.ts"))
      .toMatch(/endpoint\.startsWith\("apns:"\) \|\| endpoint\.startsWith\("fcm:"\)/);
  });

  it("a device that already has push on is not asked again", () => {
    expect(read("src/lib/push-ask.ts")).toMatch(/startsWith\("fcm:"\)/);
  });

  it("the client and the server name the same notification channel", () => {
    // Android 8+ DROPS a notification naming a channel that does not exist,
    // silently, while the send reports success. The client creates the channel
    // and the server puts its id on every message; they are one key in two
    // files, so they are pinned together here.
    expect(read("src/components/EnablePushButton.tsx")).toContain(`id: "${FCM_CHANNEL_ID}"`);
    const msg = buildFcmMessage({ title: "t", body: "b", url: "/x" }, "tok") as {
      message: { android: { notification: { channel_id: string } } };
    };
    expect(msg.message.android.notification.channel_id).toBe(FCM_CHANNEL_ID);
  });

  it("the tap target rides in data, where Capacitor reads it", () => {
    // pushNotificationActionPerformed hands the web layer notification.data.
    // A url anywhere else means tapping the notification opens the app on
    // whatever page it was last on, instead of the thing it is about.
    const msg = buildFcmMessage({ title: "t", body: "b", url: "/leads/7" }, "tok") as {
      message: { data: Record<string, string>; notification: Record<string, string> };
    };
    expect(msg.message.data.url).toBe("/leads/7");
    expect(msg.message.notification.url).toBeUndefined();
    // Every data value must be a string or FCM rejects the whole message.
    for (const v of Object.values(msg.message.data)) expect(typeof v).toBe("string");
  });

  it("the prefix is chosen by platform in one place", () => {
    const device = read("src/lib/push-device.ts");
    expect(device).toMatch(/export function nativePushPrefix\(\): "apns:" \| "fcm:"/);
    expect(device).toMatch(/detectNativePlatform\(\) === "android" \? "fcm:" : "apns:"/);
    expect(FCM_PREFIX).toBe("fcm:");
  });
});

describe("the Android app sells nothing, on purpose", () => {
  it("the purchase link is iOS-only", () => {
    // Guideline 3.1.1's link-out is an APPLE carve-out answering an APPLE
    // rejection. Google has no equivalent permission — an in-app link to a web
    // checkout is what Play calls steering.
    expect(read("src/lib/external-purchase.ts"))
      .toMatch(/return detectNativePlatform\(\) === "ios" && !!plugin\(\)/);
  });

  it("handing a link to the browser is NOT gated on that", () => {
    // These two shared a predicate once, and Android inherited "false" — so
    // NativeAppBridge hid the public card page, replaced to /dashboard and
    // opened nothing at all. The link was silently swallowed.
    const src = read("src/lib/external-purchase.ts");
    const fn = src.slice(src.indexOf("export function canOpenInDefaultBrowser"));
    expect(fn).toMatch(/return detectNativeApp\(\) && !!plugin\(\)/);
  });

  it("the paywall bows out on Android WITHOUT filing an error", () => {
    // reportIapFailure POSTs to /api/client-error. Without an early return the
    // missing Apple key would file one on every paywall mount on every Android
    // device, for ever, about a decision made on purpose.
    const iap = code(read("src/lib/iap.ts"));
    const loader = iap.slice(iap.indexOf("async function loadPlugin"), iap.indexOf("const mod = await import"));
    const androidReturn = loader.indexOf(`if (detectNativePlatform() === "android") return null;`);
    const firstReport = loader.indexOf("reportIapFailure");
    expect(androidReturn).toBeGreaterThan(-1);
    expect(androidReturn).toBeLessThan(firstReport);
  });

  it("no Google Play billing key has crept in while that stands", () => {
    // When Play Billing is switched on, this test is the reminder to revisit
    // everything above rather than bolt a key on beside an early return.
    expect(code(read("src/lib/iap.ts"))).not.toMatch(/RC_GOOGLE|GOOGLE_API_KEY/);
  });
});

describe("Apple-only surfaces stay off Android", () => {
  it("Apple Wallet is hidden in the Android app", () => {
    // There is no Apple Wallet on Android and no Google Wallet pass. Left
    // alone this rendered "Add to Apple Wallet" and handed Chrome a .pkpass,
    // which downloads as a file nothing on the device can open.
    const src = read("src/components/AddToWalletButton.tsx");
    expect(src).toMatch(/useIsAndroidApp/);
    expect(src).toMatch(/if \(androidApp\) return null;/);
  });

  it("the App Store review card is hidden in the Android app", () => {
    expect(read("src/components/RateUsCard.tsx")).toMatch(/if \(!href \|\| androidApp\) return null;/);
  });
});

describe("the shell announces itself correctly", () => {
  const config = code(read("capacitor.config.ts"));
  const android = config.slice(config.indexOf("android: {"), config.indexOf("plugins: {"));

  it("carries the SwiftCardApp token the server keys on", () => {
    // isShellRequest(), isNativeRequest() and three call sites in proxy.ts all
    // test for this exact substring. Without it the server never recognises
    // the app: no "/"→/dashboard redirect, no /pricing suppression, and the
    // stricter in-app AI-consent gate never engages.
    expect(android).toMatch(/appendUserAgent: "SwiftCardApp /);
  });

  it("carries NO SwiftCardSplash token, and the splash bails on Android", () => {
    // That token means "my compiled-in launch image is frame 0 of animation
    // N", which is only ever true on iOS. Android's launch screen is the
    // system SplashScreen API — a colour and an icon — so no markup matches,
    // and NativeSplash's version ladder would hand an untokened UA the OLDEST
    // iOS markup and jump visibly on every cold open.
    expect(android).not.toMatch(/SwiftCardSplash/);
    const splash = read("src/components/NativeSplash.tsx");
    expect(splash).toMatch(/SPLASH_ANDROID_TOKEN = "SwiftCardAndroid\/"/);
    // …and the bail must come BEFORE the version ladder, or it never runs.
    expect(splash.indexOf("SPLASH_ANDROID_TOKEN)) return null"))
      .toBeLessThan(splash.indexOf("ua.includes(SPLASH_V3_TOKEN)"));
  });
});

describe("the native half is wired up", () => {
  it("app-local plugins are registered by hand", () => {
    // Capacitor builds its registry from capacitor.plugins.json, which
    // `cap sync` generates from INSTALLED NPM PACKAGES only — an app-local
    // class is never discovered. iOS hits the same wall and answers it with
    // registerPluginInstance. Miss it and the plugin is simply undefined in
    // JS, with no error anywhere. It has already shipped unregistered once.
    const main = read("android/app/src/main/java/me/swiftcard/app/MainActivity.java");
    expect(main).toMatch(/registerPlugin\(ExternalPurchasePlugin\.class\);/);
    // …before super.onCreate, which is when Capacitor reads the registry.
    expect(main.indexOf("registerPlugin(ExternalPurchasePlugin.class);"))
      .toBeLessThan(main.indexOf("super.onCreate(savedInstanceState);"));
  });

  it("the session survives the app being killed", () => {
    // Android's WebView gives no guarantee cookies reach disk before the
    // process dies, and Android kills backgrounded processes routinely. The
    // Supabase session is a cookie, so without this an ordinary reclaim reads
    // as "SwiftCard logged me out again" with nothing in any log.
    expect(read("android/app/src/main/java/me/swiftcard/app/MainActivity.java"))
      .toMatch(/CookieManager\.getInstance\(\)\.flush\(\)/);
  });

  it("the page is told its safe-area insets, and told again on navigation", () => {
    // env(safe-area-inset-*) commonly computes to 0 in an Android WebView
    // while the page IS drawn under the status bar, and targetSdk 35+ forces
    // edge-to-edge. The inline style is per-DOCUMENT, and this is a remote-URL
    // shell that does real page loads, so every navigation throws it away.
    const main = read("android/app/src/main/java/me/swiftcard/app/MainActivity.java");
    expect(main).toMatch(/--sc-inset-top/);
    expect(main).toMatch(/onPageLoaded/);
    expect(main).toMatch(/requestApplyInsets/);
    // The CSS has to actually read them, with env() as the fallback so iOS and
    // the website compute exactly what they did before.
    expect(read("src/app/globals.css"))
      .toMatch(/--sc-inset-top: env\(safe-area-inset-top\)/);
  });

  it("other apps are visible, or the browser hand-off silently fails", () => {
    // Android 11+ hides other packages. Without <queries>, resolveActivity()
    // returns null even with Chrome installed, so ExternalPurchasePlugin
    // reports "no browser" and the card link opens nowhere.
    expect(read(MANIFEST)).toMatch(/<queries>[\s\S]*android\.intent\.action\.VIEW[\s\S]*<\/queries>/);
  });

  it("the hardware back button cannot trap anyone in the app", () => {
    // Registering a backButton listener turns OFF Capacitor's own handling
    // entirely — there is no "unhandled" to fall through to. A handler that
    // only called history.back() would make the app impossible to leave from
    // its first screen. minimizeApp, never exitApp: exiting kills the process
    // and the next open is a full cold start behind the splash.
    const src = read("src/components/NativeAppBridge.tsx");
    const handler = src.slice(src.indexOf('addListener("backButton"'), src.indexOf('addListener("appUrlOpen"'));
    expect(handler).toMatch(/minimizeApp/);
    expect(handler).not.toMatch(/exitApp/);
    expect(handler).toMatch(/window\.history\.back\(\)/);
  });
});
