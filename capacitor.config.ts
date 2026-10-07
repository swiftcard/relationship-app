import type { CapacitorConfig } from "@capacitor/cli";

/**
 * SwiftCard native iOS shell — Capacitor configuration.
 *
 * Architecture: a REMOTE-URL shell. The WKWebView loads the production site
 * (https://swiftcard.me) directly; Capacitor injects `window.Capacitor` into
 * that content, which is exactly what `src/lib/platform.ts` keys native-mode
 * detection off (PlanGate, native login, selling suppression, etc.).
 *
 * webDir points at a tiny local stub (capacitor-shell/www) that satisfies the
 * CLI; it is NOT what users see — server.url replaces it. Keep the stub as the
 * emergency offline page only.
 *
 * allowNavigation: hosts allowed to load INSIDE the webview. Everything else
 * (social links on cards, external sites) opens in the system browser via
 * Capacitor's default navigation policy — which is what Apple expects.
 *  - supabase.co: the OAuth redirect flow's callback hop.
 *  - accounts.google.com / appleid.apple.com: provider login pages for the
 *    native OAuth-redirect flow. ⚠️ Google frequently blocks OAuth inside
 *    embedded webviews (403 disallowed_useragent). If that occurs in device
 *    testing, the fix is the @capacitor/browser (ASWebAuthenticationSession)
 *    or native-SDK sign-in path — see docs/ios-review/SHELL-RUNBOOK.md §Auth.
 *
 * appId must stay `me.swiftcard.app` — it is already baked into the served
 * AASA (apple-app-site-association) appID and the Apple sign-in scaffolding.
 */
const config: CapacitorConfig = {
  appId: "me.swiftcard.app",
  appName: "SwiftCard",
  webDir: "capacitor-shell/www",
  server: {
    // Open the product directly. "/" cost every cold open a server 307 (+ a
    // client redirect on older builds) before a single byte of the dashboard
    // arrived; the proxy still bounces a signed-out session to /login.
    url: "https://swiftcard.me/dashboard",
    // Attack-surface note: provider hosts (accounts.google.com /
    // appleid.apple.com) are deliberately NOT allowed in-webview — native
    // OAuth runs in the system browser sheet (src/lib/native-auth.ts), and
    // Google blocks embedded webview OAuth anyway (403 disallowed_useragent).
    allowNavigation: [
      "swiftcard.me",
      "www.swiftcard.me",
      "grxmovpmlgmjncnyiyrt.supabase.co",
    ],
  },
  ios: {
    // Match Safari's cookie/storage behavior for the remote origin so Supabase
    // auth sessions persist exactly like the website.
    limitsNavigationsToAppBoundDomains: false,
    // "never", NOT "automatic": the web design layer is built edge-to-edge —
    // viewport-fit=cover, body/status-bar padding from env(safe-area-inset-*),
    // glass chrome that hugs the notch. "automatic" DEFEATED all of it: it
    // pushed the page down below the status bar, env() read 0 inside the
    // webview, and the exposed native inset strip rendered WHITE above the app
    // on every screen (the "white bar under the clock" on device). Full-bleed
    // lets the page own the whole canvas the way the CSS expects.
    contentInset: "never",
    // The exact token src/proxy.ts already keys its server-side "/"→app
    // redirect on (that check shipped before any build carried the token, so
    // it was inert; installed builds are covered by the sc_shell cookie the
    // boot script plants instead). Takes effect on the next native build.
    // "SwiftCardSplash/3" = this build carries the v3 launch image (the owner's
    // reference field, with the mark drawn bigger and brighter in the centre).
    // The server sends the matching animation only to builds that say so — see
    // NativeSplash.tsx — so an installed v1 or v2 app keeps the animation whose
    // first frame matches ITS launch image. Bump this whenever the launch image
    // changes, or an app hands off from its own image to a different frame 0.
    appendUserAgent: "SwiftCardApp SwiftCardSplash/3",
    // The native canvas behind the webview — what rubber-band overscroll
    // reveals. White by default, which read as white bars at the top/bottom of
    // every scroll. globals.css also suppresses the bounce itself
    // (overscroll-behavior, iOS 16+); this covers any WebKit that bounces
    // anyway. App background dark (#030712): dark is the shell's default
    // theme, and a dark flash under a light theme is far less jarring than a
    // white flash under the dark one. Takes effect on the NEXT native build
    // (cap sync), unlike the CSS fix which ships with the site.
    backgroundColor: "#030712",
  },
  android: {
    // MUST contain the exact token "SwiftCardApp". src/lib/shell-request.ts,
    // src/lib/native-request.ts and src/proxy.ts all decide "is this the
    // shell?" server-side on that substring, and everything keyed off it —
    // the "/"→/dashboard redirect, the /pricing suppression, the stricter
    // AI-consent gate — is dead without it. Unlike every iOS build to date,
    // Android carries the token on its very FIRST request, so the server-side
    // redirect works before the sc_shell cookie is ever planted.
    //
    // Deliberately NO "SwiftCardSplash/N" token here. That token means "my
    // compiled-in launch image is frame 0 of web animation N", and it is only
    // true on iOS, where the launch image is a full-bleed PNG. Android's
    // launch screen is the system SplashScreen API — a background colour with
    // a centred icon — which no existing markup matches. Worse, NativeSplash's
    // version ladder falls through to markup-v1to3.html when it sees no token,
    // so an Android build would be served the iOS v1→v3 transition and jump
    // visibly at handoff. NativeSplash bails on SwiftCardAndroid/ instead.
    appendUserAgent: "SwiftCardApp SwiftCardAndroid/1",
    // The native canvas behind the webview, same reasoning as iOS: dark is the
    // shell's default theme, and a dark flash under a light theme is far less
    // jarring than a white one under the dark theme.
    backgroundColor: "#030712",
    // Below this the WebView predates the CSS and JS the app is built on, and
    // the failure mode is a blank white screen with no explanation. Chrome 100
    // is April 2022; anything older gets Capacitor's readable upgrade notice.
    minWebViewVersion: 100,
  },
  plugins: {
    // The cold-open screen. Without this the shell showed the bare webview
    // canvas (a black rectangle) from launch until the remote dashboard
    // painted — 1–3s of "is it broken?" on every open. Now the branded
    // launch image stays up until the web app says it has painted — the
    // splash markup calls SplashScreen.hide() the moment its frame 0 (which
    // is pixel-identical to the launch image) has decoded, and
    // NativeAppBridge's hide-on-mount backstops any page without the markup.
    //
    // launchShowDuration is the FAILSAFE only, not the normal path. At 4000
    // it raced real cold opens and LOST: a cold Vercel lambda is 1.7–2.4s of
    // TTFB before the webview even starts parsing, so first paint regularly
    // landed past 4s — iOS dropped the launch image on the timer and exposed
    // the webview canvas (#030712), which is the "logo → black screen →
    // logo + lightning" cold-open sequence. 15s comfortably covers the
    // slowest legitimate open (the web side's own error boundary fires at
    // 10s) while still guaranteeing a dead network can never leave the
    // splash stuck forever. Takes effect on the NEXT native build.
    SplashScreen: {
      launchShowDuration: 15000,
      launchAutoHide: true,
      launchFadeOutDuration: 180,
      // The v2 launch image's mid-tone (its gradient is the whole screen), for
      // any edge the plugin paints itself.
      backgroundColor: "#364278",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    // ⚠️ `group` here is NOT an iOS App Group — the Preferences plugin only
    // uses it as a key prefix on UserDefaults.standard, which a widget
    // extension cannot read. The home-screen QR widget is fed by the
    // WidgetBridge native plugin (ios/App/App/WidgetBridge.swift) writing the
    // real shared suite instead; both targets carry the matching
    // application-groups entitlement for that. This setting is kept only so
    // any future Preferences use stays namespaced.
    Preferences: {
      group: "group.me.swiftcard.app",
    },
    // SHOW THE BANNER WHILE THE APP IS OPEN. Without presentationOptions iOS
    // delivers a push to a FOREGROUND app silently — no banner, no sound — so
    // "a contact replied" arriving while the owner has SwiftCard on screen
    // simply never appeared (2026-09-18 notification audit). "badge" since
    // 2026-10-06: the server now sends the unread count (lib/push.ts) and the
    // app clears it as the bell is read (AppBadge.swift, lib/app-badge.ts).
    // Takes effect on the NEXT native build (`npx cap sync ios`).
    PushNotifications: {
      presentationOptions: ["badge", "alert", "sound"],
    },
  },
};

export default config;
