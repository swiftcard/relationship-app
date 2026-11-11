# 08 — Native shells audit (iOS / iOS-on-Mac / Android / Watch / widget / offline / push / IAP)

Audited: committed HEAD 655a4480 (2026-10-12 12:30 -0400) via `git show HEAD:`; in-flight uncommitted diff described separately (Appendix C).
Read-only audit; no device/Mac available. Findings appended incrementally.

## Findings

### NS-01 Capacitor 8.4.2 shells carry the critical GHSA-rvm3-566m-v7fv (remote content at app origin via internal HTTP proxy path)
- Severity: Critical
- Platform: iOS shell (live 1.0.6 build 17) and Android shell (unreleased 1.0.1/3)
- Account type/plan affected: every app user
- Feature/page: whole webview (app origin = https://swiftcard.me, so cookies + bridge)
- File/component/function: package.json:32-37 (`@capacitor/android`/`ios`/`core`/`cli` ^8.4.2), package-lock.json:348-430 (resolved 8.4.2), ios/App/CapApp-SPM/Package.swift:14 (`capacitor-swift-pm` exact "8.4.2"), ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved (pinned 8.4.2), capacitor.config.ts:34 (`server.url` remote), :41-45 (`allowNavigation` swiftcard.me + supabase)
- Problem: `npm audit` (run 2026-10-12) reports GHSA-rvm3-566m-v7fv, CVSS 9.3, affected range `>=8.3.5 <8.4.3`, fix available in 8.4.3 (non-major). The shell is a REMOTE-URL shell whose allowNavigation keeps every `swiftcard.me` URL inside the WKWebView/WebView. The internal HTTP proxy path is a same-origin path on that origin, so any navigation the webview is willing to perform to an attacker-chosen `https://swiftcard.me/<proxy-path>?…` loads attacker content with the app origin: access to the Supabase auth cookies, `sc_shell`, `localStorage` and the Capacitor bridge (ExternalPurchase.open allow-list, WidgetBridge.setCard, AppBadge, PushNotifications.register, RevenueCat Purchases). The App's own ExternalPurchase plugin trusts "same host" (ios/App/App/ExternalPurchase.swift:62) for the same reason.
- Expected behavior: shells built against @capacitor/ios + @capacitor/android >= 8.4.3 (and capacitor-swift-pm 8.4.3 in Package.swift/Package.resolved, which `npx cap sync ios` regenerates only after the npm bump).
- Actual behavior: 8.4.2 everywhere; the App Store 1.0.6 binary (released 2026-10-07) was built from this pin, so the live app is in the affected configuration. Fixing needs the Mac (new native build) — a web deploy cannot patch it.
- How to reproduce: `npm audit` in repo root; `grep exact ios/App/CapApp-SPM/Package.swift`.
- Likely cause: advisory published after the 1.0.6 archive; no dependabot/audit gate on native deps (ci.yml has no `npm audit` step — see tests/monitoring-wiring for what IS gated).
- User impact: any user who taps a crafted swiftcard.me link inside the app (a card's custom link, a Swift Links tile, a notification URL — all same-host links stay in-webview) can have their session and bridge hijacked. Exploitability depends on whether a non-shell-visible link can be made to resolve to the proxy path; treat as must-fix for the next native build regardless.
- Confidence: Confirmed (versions + configuration); exploit path Suspected

### NS-02 Render failures in tests/render/add-card-sheet.test.ts are caused by the IN-FLIGHT diff, not HEAD
- Severity: Medium (blocks the in-flight commit's CI `render` job; HEAD is green)
- Platform: test rig (Chromium) — affects nothing live
- Account type/plan affected: n/a
- Feature/page: Free dashboard "Add card" sheet (SecondCardSheet)
- File/component/function: tests/render/add-card-sheet.test.ts:33 (`vi.doMock("@/lib/platform", () => ({ useIsNativeApp, detectNativeApp, isNativeApp }))`) vs uncommitted src/components/AddCardButton.tsx:+7 (`import { useIsAndroidApp } from "@/lib/platform"`) and :+78 (`const android = useIsAndroidApp();`)
- Problem: the test replaces the whole `@/lib/platform` module with a 3-export mock. The in-flight AddCardButton.tsx now calls `useIsAndroidApp()` from that module; under the mock it is `undefined`, so `renderToStaticMarkup(SecondCardSheet)` throws `TypeError: useIsAndroidApp is not a function` inside `render()`, before `page.setContent`. Every `it` in `describe.each(WIDTHS)` ("sits inside the screen and never scrolls the page sideways", "shows every action, in view, with a real tap target", "cuts nothing off horizontally") fails for iPhone SE / 13 Mini / 13 / desktop, and the two later describes fail for the same reason. The identical pattern was already patched by the other session in tests/render/bell-plans.interactive.test.ts (in-flight diff adds `useIsAndroidApp` to that file's mock) but tests/render/add-card-sheet.test.ts was missed. Same risk for any other render test that mocks `@/lib/platform` and renders ProOffer / ProOfferCta / NativePaywall / TrialBanner / ProRequiredDialog / WelcomePlan / FreeDesignChoice / SeeWhoLink / GrowShare / FirstLeadNudge / ProEndedPanel / PlanCards / PlanTierCards / BillingManager / EmailSignatureBox (all touched by the diff).
- Expected behavior: the mock exports every hook the rendered component imports (`useIsAndroidApp: () => false`, or `vi.importActual` + override).
- Actual behavior: 12+ failures locally at 'iPhone SE' / 'iPhone 13 Mini' / 'iPhone 13' / 'desktop'.
- How to reproduce: `npm run test:render -- add-card-sheet` with the working tree as-is; `git stash` → passes.
- Likely cause: in-flight "Android sells nothing" diff added a platform hook to a component whose render test stubs the platform module.
- User impact: none at HEAD; the uncommitted commit would be held by the deploy gate (render job red).
- Confidence: Confirmed (by reading; not executed — audit is read-only)

### NS-03 Android shell: the business-card scanner's camera is auto-denied (CAMERA permission never declared)
- Severity: High (Android app is unreleased, so a pre-release blocker rather than a live outage)
- Platform: Android shell only (web, iOS unaffected)
- Account type/plan affected: every Android user; the scanner is a Pro feature so Pro/trial first
- Feature/page: Contacts → Add contact → Scan a card (src/components/CardScanCamera.tsx:117-119, `navigator.mediaDevices.getUserMedia`)
- File/component/function: android/app/src/main/AndroidManifest.xml:73-83 (only INTERNET + POST_NOTIFICATIONS declared; no `android.permission.CAMERA`); node_modules/@capacitor/android/.../BridgeWebChromeClient.java:102-121 (`onPermissionRequest`: VIDEO_CAPTURE → `permissionLauncher.launch([CAMERA])` → `request.deny()` when not granted)
- Problem: Capacitor answers a WebView getUserMedia request by launching a runtime permission request for CAMERA. Android refuses a runtime request for a permission the manifest never declares (the launcher result is immediately "not granted", no dialog), so the WebView request is denied and getUserMedia rejects with NotAllowedError. The `<input capture>` path is unaffected (`isMediaCaptureSupported()` passes when CAMERA is undefined, :307-313), but CardScanCamera deliberately moved off that path (its header comment, :15).
- Expected: scanner opens the rear camera after one Android permission prompt.
- Actual: scanner shows its "unsupported"/error state on every Android device; no dialog ever appears. iOS carries NSCameraUsageDescription (Info.plist) so the iPhone app works.
- Repro: Android build → Contacts → Scan a card. Or read the two files above; no device needed.
- Likely cause: manifest written for a remote shell "with no permissions beyond push"; nobody listed which web APIs the shell relies on.
- User impact: a headline Pro feature is dead on Android; the in-flight AndroidProInfo lists "Scan a paper business card" as something Pro adds, which the Android app cannot do.
- Confidence: Confirmed (by reading Capacitor's Java; not executed)

### NS-04 Every full page load in the shell paints the WEB selling UI for the hydration window (1–3 s), then swaps
- Severity: High (App Review 3.1.1 exposure on the screens a reviewer opens; "flash of upgrade" for users)
- Platform: iOS shell, iOS-on-Mac, Android shell
- Account type/plan affected: Free and trial accounts (the gates render for them)
- Feature/page: dashboard leads-cap block (src/app/dashboard/page.tsx:1086-1134: "Upgrade to Pro to unlock…", `<UpgradeButton />`, "Invite 3 friends… month of Pro free"); all 13 PlanGate consumers (CardEditForm, NewCardWizard, contacts/page, dashboard/page, share/page, AddContactModal, ContactsClient, CrmEventSettings, CustomDesignCard, IntegrationsSettings, ProfileForm, ZapierSettings, dashboard/MyCardsList); every NativeHidden consumer (SiteFooter Pricing link, AppStoreBadge, terms, compare rows, settings/flows); SiteNav "Pricing" (src/components/site/SiteNav.tsx:191, 316)
- File/component/function: src/components/PlanGate.tsx:59-73 (`useIsNativeApp()` → web branch on server + first client render); src/components/NativeHidden.tsx:15-19 (same); src/lib/platform.ts:87-98 (false until the mount effect); src/components/NativeAppBridge.tsx:94-96 ("This effect runs after hydration, which on a remote-URL shell is 1-3s in")
- Problem: the server already knows the request is the shell (src/lib/native-request.ts `isNativeRequest`; Android carries the UA token on its very first request, iOS from build 2 plus the sc_shell cookie) and uses it for NativeSplash, badge sync, AI consent, /pricing and /download — but no page body does. dashboard/page.tsx, contacts, settings etc. render the web `children` of every PlanGate into the HTML, so the shell shows explicit "Upgrade to Pro" CTAs and the referral-for-free-Pro promo until React mounts. Only the marketing nav/footer are hidden pre-paint (globals.css:1248-1249 `html.native-app .sc-site-nav, .sc-site-footer {display:none}` via sc-boot), which proves the pattern is available.
- Expected: for a shell request the server renders the native branch (or the gate's nativeContent) directly, so no frame of web selling copy exists; a CSS class (`html.native-app .sc-web-only {display:none}`) as belt-and-braces for client components.
- Actual: 1–3 s of the full web gate per cold load; longer on cellular; exactly the reviewer's screenshot window.
- Repro: production build, open /dashboard as a Free account with UA "…SwiftCardApp…" and CPU/network throttling in Chromium; screenshot before hydration completes. tests/render has no pre-hydration assertion for this.
- Likely cause: the hydration-safe hook was chosen for web byte-identity; the server signal came later and was wired to a few routes only.
- User impact: visible glitch every launch (platform.ts:5-7's own words: "a control gated on it renders, then vanishes, which reads as a glitch"), and the thing 1.0.0 (3)/(7) were rejected for is briefly on screen.
- Confidence: Confirmed (code); timing Suspected (their own measurement)

### NS-05 Push: the shell's token lifecycle severs the binding on every sign-out / re-login / eviction and never re-asks — the install base decays to ~0 rows
- Severity: High (push_subscriptions has ONE row system-wide; push_log no_subscription 132/230)
- Platform: iOS shell (apns:), Android shell (fcm:) — same code path
- Account type/plan affected: all
- Feature/page: Settings → Notifications switch; PushAskCallout/PushNudge reminders; launch-time silent refresh
- File/component/function:
  - Native hand-off: ios/App/App/AppDelegate.swift:32-38 forwards `didRegisterForRemoteNotificationsWithDeviceToken` → `.capacitorDidRegisterForRemoteNotifications` → @capacitor/push-notifications `registration` event → src/components/EnablePushButton.tsx:269-329 (`register()` → `POST /api/push/subscribe` with `endpoint: "apns:<token>"`, placeholders `p256dh/auth = "apns"`) → src/app/api/push/subscribe/route.ts:69-72 (upsert on endpoint, device_id from the sc_device cookie). Android: FCM via the same plugin + android/app/google-services.json (project swiftcard-2cc87); prefix from src/lib/push-device.ts:29-31. Entitlements: ios/App/App/AppRelease.entitlements aps-environment=production (App Store); App.entitlements development (Xcode); server tries both hosts (src/lib/apns.ts:373-394) so APPLE_PUSH_SANDBOX only picks the first attempt.
  - Severing: src/lib/push-device.ts:89-128 `unbindDevicePush()` DELETEs the row AND removes `swiftcard_push_uid`; called from SignOutButton and from src/components/AccountIsolationGuard.tsx:97-105 whenever `sc_last_uid !== session uid` — which includes the SAME account signing back in after any sign-out, because sign-out clears `sc_last_uid` (account-state.ts). src/app/api/devices DELETE (Settings → Devices, and the 2-device limit in src/proxy.ts:260-311) deletes by device_id.
  - Self-heal: NativeAppBridge.tsx:444-471 re-registers at launch ONLY if `swiftcard_push_uid` matches the session; EnablePushButton.tsx:197-205 "reconfirm" ONLY where the switch is mounted and with the same stamp. Both are disabled by the unbind above.
  - Re-ask: iOS shows the permission sheet once per install (EnablePushButton.tsx:247-250); after a severed binding the switch is "idle", not "denied", so the only road back is Settings → Notifications; the reminders have a lifetime budget (push-ask-client stopAsk, "two reminders per side") and /api/push/ask skips a device that "already has push on".
  - The 09-10→09-17 env-mismatch wipe (apns.ts:333-351) deleted every row; recovery relied on the same silent refresh.
- Problem: "an auth-user change severs the binding, the next account opts in itself" is right for a shared phone but is applied to the same person logging back in (lastUid null after sign-out). Every sign-out, every expired session that lands on /login, every device-limit bounce or eviction turns push off server-side with no prompt, no reminder budget left and a switch that merely reads "off". There is also a race on that first load: NativeAppBridge's refresh and AccountIsolationGuard's unbind both run in mount effects on the same document; whichever POST/DELETE lands last wins.
- Expected: same-uid re-login keeps the binding (compare the session uid to the uid stored WITH the token, `swiftcard_push_uid`, instead of to `sc_last_uid`); a severed binding on the same account triggers one re-ask outside the reminder budget; an evicted device whose account is still signed in should be told, not silently unsubscribed.
- Actual: one row in production; 57% of pushes die as no_subscription.
- Repro (code-level): shell → sign in → enable push (row exists) → sign out → sign in with the SAME account → reconcile(lastUid=null, uid) → unbindDevicePush → row gone, stamp gone → NativeAppBridge never re-registers → switch "idle".
- Likely cause: three audits (08-13 stamp, 09-18 reconfirm, 09-24 isolation) each added a correct rule; together they only ever delete. (Builds ≤10 could never register at all — ios-release.sh:110 — so every registered phone post-dates the stamp; the "legacy device without a stamp" gap is theoretical.)
- User impact: lead/view notifications — the retention hook — effectively off for everyone but the owner.
- Confidence: mechanism Confirmed; that it is THE cause of the one-row table Suspected (opt-in-only + N-11 contribute)

### NS-06 Chunk-load after a deploy: a warm shell has no recovery, and the lazy imports that die are the sign-in and push listeners
- Severity: High (observed: Vercel ChunkLoadError at /login right after the 2026-10-10 deploy)
- Platform: iOS shell first (apps stay warm for days); Android shell; web tabs left open
- Account type/plan affected: all
- Feature/page: /login (OAuth return leg), every page (push tap, splash hide, widget sync), ProOffer's `dynamic(() => import NativePaywall)` (src/components/ProOffer.tsx:26), lib/iap's `import("@revenuecat/purchases-capacitor")`
- File/component/function: no handler anywhere (`git grep -i "ChunkLoadError|Loading chunk"` → nothing); src/app/error.tsx:7-56 reports and offers "Try again" (re-renders the same dead chunk) with no `location.reload()`; next.config.ts has no deployment-id/skew setting (Vercel Skew Protection is a dashboard toggle — not verifiable from the repo); public/sw.js:90-93 serves a cached `_next/static` asset only on a network FAILURE (a 404 is a response) and only for saved cards — and the worker never runs in the iOS shell (capacitor.config.ts:50 `limitsNavigationsToAppBoundDomains: false` → WKWebView has no `navigator.serviceWorker`); src/components/NativeAppBridge.tsx:102, 252, 393 import `@capacitor/splash-screen`, `@capacitor/app`, `@capacitor/push-notifications` lazily inside `catch {}` blocks that swallow the failure (:311, :384, :481).
- Problem: when the deploy gate promotes a build, `/_next/static/chunks/<old-hash>.js` 404s. A shell backgrounded on the old /login (or any page) does its next lazy import against the new deployment. The `appUrlOpen` listener (Google/Apple sign-in return) is attached from such an import: with the chunk gone it is never attached, the user completes Google in the system sheet, comes back, and lands on the login form with no error. Push-tap navigation, SplashScreen.hide (Android: 15 s failsafe, capacitor.config.ts:125) and the widget sync die the same way. On a client-side navigation Next shows error.tsx; "Try again" cannot succeed.
- Expected: an error boundary / window `error` handler that reloads once on a chunk-load error (sessionStorage guard); Vercel Skew Protection on; a shell-side `visibilitychange` check that reloads when `/api/health` reports a newer sha after N minutes in background.
- Actual: dead taps and dead sign-in until the user force-quits the app.
- Repro: open the shell on /login, background it, deploy, foreground, tap "Continue with Google", complete → back on login. Or Chromium with the old HTML, flip the server.
- Likely cause: remote-URL shell + immutable hashed chunks + no skew handling.
- User impact: every deploy (several per day) breaks sign-in and notifications for every warm shell until relaunch.
- Confidence: missing handler Confirmed; attribution of the 10-10 Vercel error Suspected

### NS-07 iOS-on-Mac: the only Mac signal is written by evaluateJavaScript on a URL KVO and can land in the wrong document
- Severity: Medium
- Platform: iPhone app on Apple Silicon Mac
- Account type/plan affected: all Mac users
- Feature/page: AddToWalletButton — the ONLY consumer of `useIsIosAppOnMac` (src/components/AddToWalletButton.tsx:62). NFC and the scanner are NOT gated on it although src/lib/platform.ts:110-115 says they are (NFCWriter self-detects via NDEFReader, absent in every WKWebView, so that is fine; CardScanCamera uses the Mac webcam, acceptable).
- File/component/function: ios/App/App/MainViewController.swift:90-97, 161-165 (`applyPlatformFlags` on capacitorDidLoad and on every `webView.url` change); src/lib/platform.ts:119-135; sc-boot MutationObserver in src/app/layout.tsx:175 (restores data-sc-mac only if it was previously set on THIS document)
- Problem: WKWebView's `url` KVO fires at navigation start/commit; `document.documentElement.dataset.scMac = '1'` then runs against whichever document is current at that instant — the outgoing one, or a new document whose `<html>` the parser has not created yet (`documentElement` null → TypeError, completion handler nil, silently dropped). The flag is then absent for the life of the new page; `detectIosAppOnMac()` returns false; the Wallet button renders and fails at the point of use. Client-side (pushState) navigations are fine (same document).
- Expected: set the flag from a `WKUserScript` at `.atDocumentStart` (per-document, like Capacitor's own bridge injection), or expose it as a plugin method the web layer awaits.
- Actual: non-deterministic per full navigation.
- Repro: needs a Mac (none available); code path confirmed.
- Likely cause: pattern copied from `applyTextScale`, where a missed frame is harmless.
- User impact: Wallet button appears on Mac and does nothing / errors.
- Confidence: Suspected (timing); Confirmed (single consumer, no at-document-start injection)

### NS-08 Android shell never sets a status-bar style; system dark mode over the app's light theme = invisible clock and icons
- Severity: Medium
- Platform: Android shell
- Account type/plan affected: all
- Feature/page: every screen (the production sweep flagged `status-bar-style-unset` at pixel-8 and 360px)
- File/component/function: android/app/src/main/res/values/styles.xml:12 (`AppTheme.NoActionBar` parent `Theme.AppCompat.DayNight.NoActionBar`, no windowLightStatusBar/windowLightNavigationBar); android/app/src/main/java/me/swiftcard/app/MainActivity.java (insets only; no icon-colour handling); android/app/capacitor.build.gradle:11-19 (no @capacitor/status-bar); src/app/layout.tsx:149 (web defaults to LIGHT unless sc_theme=dark)
- Problem: targetSdk 36 (android/variables.gradle:3-4) forces edge-to-edge; the status bar is transparent over the page's light header; its icon colour follows the system DayNight theme, not the page's. Phone in dark mode → light icons on the cream/white header = unreadable; phone in light mode with a saved dark theme → dark icons on #030712.
- Expected: @capacitor/status-bar (or `WindowInsetsControllerCompat.setAppearanceLightStatusBars`) driven from `data-sc-theme` on every navigation/theme toggle, the way MainActivity already re-sends insets.
- Actual: unset; wrong half the time.
- Repro: the sweep result (given); any Android emulator in dark mode.
- Likely cause: iOS handles it via UIViewControllerBasedStatusBarAppearance + black-translucent; nothing mirrors it on Android.
- User impact: cosmetic, on every screen; a Play reviewer's first impression.
- Confidence: Confirmed (config); rendering Suspected

### NS-09 Android keyboard: no IME inset handling and no windowSoftInputMode under forced edge-to-edge
- Severity: Medium
- Platform: Android shell
- Account type/plan affected: all (card editor, login, contact forms, AI chat)
- Feature/page: every form; the fixed bottom tab bar (src/components/MobileNav.tsx:134 `fixed bottom-0`, padding from env(safe-area-inset-bottom) → `--sc-inset-bottom` on Android)
- File/component/function: android/app/src/main/AndroidManifest.xml:13-19 (no `android:windowSoftInputMode`); MainActivity.java:98-119 (`insets.getInsets(systemBars() | displayCutout())` — `Type.ime()` excluded; listener returns insets unconsumed); node_modules/@capacitor/android 8.4.2 has no edge-to-edge/IME handling (`grep -ri edgetoedge|ime()` → nothing); no @capacitor/keyboard
- Problem: with targetSdk ≥35 the window is edge-to-edge and the decor no longer fits system windows; the WebView is not resized for the keyboard unless the IME inset is applied (the known Capacitor-on-Android-15 "keyboard covers input" class). The focused field under the keyboard is not scrolled into view and the tab bar keeps its pre-keyboard inset.
- Expected: `windowSoftInputMode="adjustResize"` plus `Type.ime()` in the inset listener (fed to `--sc-inset-bottom` or used to pad the WebView), verified by the in-flight qa-android-shell sweep with a focused field.
- Actual: unverified on device; by code nothing handles the IME.
- Repro: Android emulator → card editor → tap a lower field.
- Likely cause: insets copied from the iOS mental model (iOS resizes for the keyboard natively).
- User impact: typing blind in the editor/login on Android.
- Confidence: Suspected (no device)

### NS-10 iOS: the external-browser purchase link is still live beside IAP (billing page, Office seats, promo path); US-only availability is a Connect checkbox, not code
- Severity: Medium (policy risk; it is what 1.0.0 (7) was rejected for)
- Platform: iOS shell
- Account type/plan affected: Free (promo path), Pro on Stripe, Office admins
- Feature/page: Settings → Plan and billing (src/components/BillingManager.tsx:126, 276 → `openExternalPurchase("/settings/flows?billing=1#billing")`); Office → Add a seat (src/components/office/TeamActions.tsx:95, 337); plan cards (src/components/PlanCards.tsx:419 `/welcome?promo=…`, :515 NATIVE_OFFICE_PATH); via ios/App/App/ExternalPurchase.swift (UIApplication.open) and src/lib/external-purchase.ts:54-63 (`canOfferExternalPurchase` = iOS + plugin present; no storefront check)
- Problem: lib/iap.ts:5-11 says the link-out "was REJECTED anyway" and IAP replaced it, yet three surfaces still hand the user to swiftcard.me checkout/billing in Safari. ExternalPurchase.swift:30-35 says the app "must ship US-only while this is the purchase path" and that widening availability needs a storefront gate — none exists (no `Storefront.current` / `SKStorefront` check). docs/ios-review/APP-STORE-METADATA.md:29 confirms US-only is a Connect setting.
- Expected: either keep the link-out and document the 2025 US ruling as its basis plus a StoreKit storefront guard so a later availability change cannot ship it elsewhere, or remove the three call sites.
- Actual: both purchase stories coexist, one guarded by a checkbox.
- Repro: iOS shell, Office admin → Team → Add a seat → "Add on swiftcard.me" opens Safari.
- Likely cause: Office/Stripe-only plans have no IAP product.
- User impact: none for users; a rejection on the next submission holds every native fix (NS-01, NS-03, NS-07…).
- Confidence: Confirmed (code); risk Suspected

### NS-11 /compare FAQ answers and their JSON-LD carry SwiftCard prices ungated in the shell
- Severity: Low (not linked from any in-app screen; reachable only by URL)
- Platform: iOS/Android shells
- Feature/page: /compare/[slug] (src/app/compare/[slug]/page.tsx:126, 163, 165, 201, 240, 242, 279, 281 — "$4.99/month", "$3.99/seat"); only table rows with `pricing: true` are wrapped (:389); `<FaqAccordion items={c.faq}>` (:437) and the FAQPage JSON-LD (:328) are not; /compare/page.tsx:31, 36 rows are wrapped
- Problem/Expected/Actual: the file's own rule (:25 "Rows quoting OUR price are wrapped in NativeHidden") is applied to rows only. Expected: FAQ entries flagged and dropped for shell requests server-side (these are server components; `isNativeRequest` is available). Actual: prices render in-app.
- Repro: shell → https://swiftcard.me/compare/popl → expand "How does pricing compare?".
- Likely cause: FAQ copy added after the row rule.
- User impact: negligible; review risk only if a reviewer types the URL.
- Confidence: Confirmed

### NS-12 Apple Watch / widget: docs say "not shipping", the binary ships it; /api/watch/card and watch-contract.ts are orphans; widget, watch and the offline QR go stale after an edit
- Severity: Low
- Platform: iOS (watchOS 10+, widget iOS 17+)
- Feature/page: SwiftCardWatch, SwiftCardWidget, OfflineCard
- File/component/function: ios/App/App.xcodeproj/project.pbxproj:277-278, 483-495 (App target depends on SwiftCardWidgetExtension and SwiftCardWatch → embedded; ExportOptions.plist carries both watch profiles); docs/ios-review/APP-STORE-METADATA.md:210-215 (1.0.5 "New: SwiftCard for Apple Watch", shipped without --no-watch); docs/APPLE_WATCH.md:3-6 ("NOT a shipping feature… zero Swift/watchOS code in this repository"); src/app/api/watch/card/route.ts + src/lib/watch-contract.ts (no consumer: `git grep api/watch -- ios` → nothing; the watch gets its card over WatchConnectivity from ios/App/App/WatchSessionBridge.swift:75-109); src/components/NativeAppBridge.tsx:165-246 (`syncWidgetCard` runs on mount and on ACTIVE_CARD_EVENT only)
- Problem: (a) a stale doc contradicts the live listing; (b) an authenticated endpoint returning phone/email/photo URLs exists for nothing (audit rule: orphan features); (c) editing the card's name/company/photo does not fire ACTIVE_CARD_EVENT, so the home-screen widget, the watch and the native offline QR (OfflineCard.swift:119-135 reads the same `widget_card` slot, name/company/vcard included) keep old values until a page that mounts NativeAppBridge does a full document load, or a relaunch.
- Expected: delete or rewrite docs/APPLE_WATCH.md; remove /api/watch/card (or make the watch use it); dispatch ACTIVE_CARD_EVENT (or a card-saved event) from the editor's save path.
- Confidence: Confirmed (a, b); (c) Confirmed by reading, not run

### NS-13 Offline: the service worker never runs in the iOS shell, so OfflineCardSaver / offline.html / sw.js are inert there; Android does run it
- Severity: Low (iOS is covered by the native OfflineCard; Android by the web SW)
- Platform: iOS shell (inert), Android shell (active)
- File/component/function: capacitor.config.ts:50 `limitsNavigationsToAppBoundDomains: false` (WKWebView exposes Service Workers only to app-bound domains); src/components/ServiceWorkerRegistrar.tsx:7 (`"serviceWorker" in navigator` → false in the shell, silently skipped); public/sw.js; src/components/OfflineCardSaver.tsx, OfflineOwnerSnapshot.tsx (write localStorage for an offline.html the iOS shell can never serve); OfflineOutbox (localStorage-based, works everywhere); capacitor-shell/www/index.html (never shown: server.url replaces it and no server.errorPath is set, by design per OfflineCard.swift:26-33)
- Problem: the iOS app carries two offline systems, one of which cannot execute. A prospect's card opened in-app is not saved for offline; the owner's offline.html snapshot is dead weight. On Android the SW is live, so offline.html (marketing-styled; contains "Pro" at public/offline.html:180 — verify the wording) can render inside the app.
- Expected: either enable app-bound domains (swiftcard.me + the supabase host; ≤10 allowed) so the SW runs in-app and the native OfflineCard becomes the cold-start fallback only, or gate OfflineCardSaver/OfflineOwnerSnapshot on `!detectNativeApp()`.
- Confidence: Confirmed (WebKit behaviour + config)

### NS-14 Versions and plugin inventory: HEAD native code references 1.0.7 but still carries 1.0.6 (17); the release script never bumps; the Play listing doc is stale; unused native SDKs are compiled in
- Severity: Low
- Platform: iOS, Android
- File/component/function: ios/App/App.xcodeproj/project.pbxproj:636-644, 664-673 (`CURRENT_PROJECT_VERSION = 17`, `MARKETING_VERSION = 1.0.6` on all 8 configs — matches live 1.0.6); ios/App/App/OfflineCard.swift:112-113, WidgetBridge.swift:68-70, src/components/NativeAppBridge.tsx:220 ("since 1.0.7" / "Builds before 1.0.7 ignore the extra key") while the last native commits (956aeaaf, 082924ba, 2026-10-06) precede the "1.0.6 (17) submitted" commit (297549c5) — so either the vcard key IS in build 17 and the comments are wrong, or 17 was archived from an earlier tree; scripts/ios-release.sh has no agvtool / CURRENT_PROJECT_VERSION bump (grep → nothing), so the next `npm run ios:release` uploads build 17 again and App Store Connect rejects the duplicate; android/app/build.gradle:10-11 `versionCode 3`, `versionName "1.0.1"` vs docs/play-store/PLAY-STORE-LISTING.md:4 "1.0.0 (versionCode 1)" — never submitted ("Nothing here is submitted"); android/app/capacitor.build.gradle:18 compiles `revenuecat-purchases-capacitor` into an Android app that sells nothing (BILLING permission stripped at AndroidManifest.xml:79, the SDK still in the APK); `@capacitor/preferences` is used only by src/lib/app-review.ts:77; Package.resolved pins purchases-ios 5.84.0 / hybrid-common 18.31.0 behind @revenuecat/purchases-capacitor 13.4.1; IPHONEOS_DEPLOYMENT_TARGET 15.0 (app) vs 17.0 (widget) vs WATCHOS 10.0 — consistent with "min iOS 15" (widget simply absent below 17); android/app/google-services.json is committed with its Firebase API key (public by design; restrict it in GCP to the package + SHA-1).
- Expected: a version bump (or a pre-flight check against ASC's latest build) in ios-release.sh; Play doc updated to versionCode 3; RevenueCat excluded from the Android build or wired to Play Billing; comments reconciled.
- Confidence: Confirmed

### NS-15 Detection consistency notes (no single bug; the gaps)
- Severity: Low / Info
- Platform: all shells
- Signals: (1) UA token `SwiftCardApp` (iOS build ≥2, Android build 1; capacitor.config.ts:69, 97); (2) `sc_shell=1` cookie planted by sc-boot on ANY page where the bridge is seen (src/app/layout.tsx:206; max-age 31536000, re-planted on every full load, samesite=lax, no Secure/HttpOnly — harmless, it is a hint, and it lives in the WKWebView/WebView cookie jar, never Safari's); (3) runtime bridge (`webkit.messageHandlers.bridge` / `androidBridge` / `window.Capacitor`, src/lib/platform.ts:41-61).
- Consistent by construction: src/proxy.ts:31-35, 53-59, 166-179; shell-request.ts; native-request.ts; NativeSplash all test (1)||(2). Gaps: (a) proxy.ts:283 passes `isNative` to `deviceLabel` from the COOKIE only, so a shell's first-ever request (UA token present, no cookie yet — always true on Android) labels the device row as a browser; (b) /api/ai/help takes `native` from the client body (src/components/HelpWidget.tsx:74 `useIsNativeApp`) while /api/ai/sales uses server `isShellRequest` (src/app/api/ai/sales/route.ts:57) — help should OR the two; (c) SFSafariViewController / ASWebAuthenticationSession sheets carry none of the three (external-purchase.ts:103-121) — today's sheets (native-auth.ts:97, IntegrationsSettings.tsx:42, ProfilePhotoSuggest.tsx:51, AddToWalletButton.tsx:75, native-file.ts:32) open only /api/* and provider URLs, so nothing sellable is reachable from them; (d) Android WebView UA variants ("; wv)", Chrome version) do not matter because the appended token is substring-matched; storeOsBoot / resolveDownloadTarget fall back to the OS from the UA, correct in-shell since /download is redirected first; (e) the first-ever iOS launch (no cookie yet) is the one request that renders web variants server-side — the trade-off native-request.ts:18-21 documents, and the reason NS-04 matters more on iOS.
- Confidence: Confirmed

### NS-16 Review accounts and scripts: no secrets in the repo
- Severity: Info
- scripts/verify-review-logins.mjs:10-13 reads FREE_PW/PRO_PW from env; scripts/create-apple-review-account.js:133 and scripts/reset-review-pro-password.mjs:16 generate `SwiftReview!<8 hex>` at run time and print once; the service-role key comes from .env.local only. Hardcoded: the two review emails and iap-test@swiftcard.me in src/lib/iap-entitlement.ts:50-54 (sandbox grant allow-list) — fine, they are identifiers on a domain the owner controls. Nothing to fix.
- Confidence: Confirmed

## Appendix A — Feature parity (committed HEAD 655a4480)

| Feature | Web (Safari/Chrome) | iOS shell 1.0.6 | iOS-on-Mac | Android shell (unreleased, 1.0.1/3) | Notes |
|---|---|---|---|---|---|
| Sign in (email/password) | yes | yes | yes | yes | `method="post"` pinned by credentials-never-in-url test |
| Google / Apple sign-in | popup/redirect | system sheet (ASWebAuthenticationSession) → swiftcard://auth-callback | same | Custom Tab → swiftcard:// intent filter | return leg needs the lazily-imported `@capacitor/app` listener — dies mid-deploy (NS-06) |
| Marketing home "/" | yes | redirected to /login or /dashboard (sc-boot + proxy) | same | same, from first request (UA token) | first-ever iOS launch still fetches "/" once |
| /pricing, /download, /checkout, Stripe portal | yes | redirect/403 server-side | same | same | /pricing & /download in proxy.ts; checkout/portal APIs 403 |
| /upgrade | Stripe ProOffer | IAP ProOffer (client-gated; web branch painted first — NS-04) | same | at HEAD: the iPhone IAP card, sheet says "Plans aren't available right now" | in-flight: server-gated AndroidProInfo (App. C) |
| Pro purchase | Stripe | RevenueCat/StoreKit paywall (NativePaywall) + Restore + offer codes via apps.apple.com/redeem | same (StoreKit on Mac works) | none at HEAD (paywall renders "unavailable" sheet) | Android must sell nothing (Play policy) |
| Office / seats purchase | Stripe | link-out to swiftcard.me in Safari (ExternalPurchase.swift) | same | plugin exists but `canOfferExternalPurchase` is iOS-only → nothing | NS-10 policy risk |
| Plan gates (13 PlanGate sites) | upgrade CTAs | PlanNotice + IAP button after mount | same | PlanNotice + IAP button that cannot sell (HEAD); plain badge (in-flight) | NS-04 pre-hydration paint on all three shells |
| Help assistant | full corpus | commerce docs dropped, nativeAnswer swapped (client `native` flag) | same | same | sales chat hidden via NativeHidden + server 403 |
| Push notifications | web push (Chrome/Android, iOS home-screen PWA) | APNs via plugin, opt-in switch | APNs works on Mac for iPhone apps | FCM via plugin + google-services.json, channel `swiftcard-alerts` | binding severed on every re-login (NS-05); 1 row live |
| App icon badge | n/a | AppBadge.swift (1.0.6+) + `aps.badge` | yes | not implemented (Android badges are launcher-dependent; FCM payload carries none) | — |
| Push tap deep link | SW notificationclick | `pushNotificationActionPerformed` → in-webview nav | same | same | lazily imported (NS-06) |
| Links/Universal links open the app | n/a | never (no associated-domains; AASA exclude-all) | never | never (no https intent filter) | by owner decision; cached AASA on old installs handed to Safari |
| Public card / Swift Links page inside the app | n/a | bounced to default browser, webview → /dashboard | same | same via ACTION_VIEW | — |
| Home-screen widget (QR) | n/a | yes (iOS 17+, WidgetBridge → App Group) | n/a (no iPhone widgets on Mac) | no | stale after card edit until relaunch (NS-12) |
| Apple Watch app + complication | n/a | shipped since 1.0.5 (WatchConnectivity) | n/a | n/a | docs say "not shipping" (NS-12) |
| Offline: owner's QR with no signal | offline.html via SW (Chrome/Android; Safari PWA) | native OfflineCard overlay (card link + Contact vCard QR) | same | web SW + offline.html inside the WebView | iOS SW inert (NS-13) |
| Offline: saved prospect cards | SW cache | NOT available (no SW in WKWebView) | same | SW cache | NS-13 |
| Offline outbox (shares/views) | localStorage, works | works | works | works | — |
| Business-card scanner (getUserMedia) | yes (secure context) | yes (NSCameraUsageDescription) | Mac webcam | BROKEN — CAMERA undeclared (NS-03) | — |
| Photo/logo upload (file input) | yes | yes (NSPhotoLibraryUsageDescription) | yes | yes (FileProvider + file_paths.xml) | — |
| NFC write (Web NFC) | Chrome on Android only | no (WKWebView has no NDEFReader) | no | no (Android WebView has no Web NFC) | NFCWriter self-detects; no native NFC plugin on either shell |
| Apple Wallet pass | Safari | yes (Browser sheet) | hidden by data-sc-mac (NS-07 race) | hidden (`useIsAndroidApp`) | — |
| Native share sheet | navigator.share where present | @capacitor/share | yes | @capacitor/share | — |
| Clipboard | navigator.clipboard (15 call sites) | works | works | works (secure origin, user gesture) | — |
| Rate-us prompt | n/a | AppReview.swift (StoreKit) | yes | hidden (test "App Store review card is hidden in the Android app") | — |
| Open notification settings | n/a | `app-settings:` URL | yes | AppSettingsPlugin | — |
| Hardware back | n/a | n/a | n/a | NativeAppBridge listener: close dialog → history.back → minimize | replaces Capacitor default entirely |
| Status bar style | n/a | black-translucent | n/a | UNSET (NS-08) | — |
| Keyboard avoidance | browser | WKWebView native | n/a | no IME insets, no windowSoftInputMode (NS-09) | — |
| Safe areas | n/a | env(safe-area-inset-*) scoped to html.native-app (31 files) | same | `--sc-inset-*` from MainActivity, re-sent on every page load | 71 h-screen/100vh vs 14 dvh uses — fine in-shell (no browser chrome), watch Android keyboard resize |
| Zoom | pinch allowed | pinned to 1.0 natively (MainViewController) | same | WebView default (viewport meta) | — |
| Dynamic Type | browser text size | `--sc-text-scale` from UIContentSizeCategory | yes | not mirrored (Android font scale is applied by WebView automatically) | — |
| Launch splash | n/a | NativeSplash v1/v2/v3 ladder by UA token | same | system splash; web overlay bails on `SwiftCardAndroid/`; hide() after hydration, 15 s failsafe | — |
| 2-device limit | yes | yes (labelled via sc_shell cookie) | yes | yes | first request mislabelled (NS-15a) |

## Appendix B — Commerce-leak checklist vs App Review 3.1.1 (iOS shell, HEAD)

| # | Surface | Status | Where |
|---|---|---|---|
| 1 | /pricing | OK — server redirect to /dashboard | src/proxy.ts:31-35 |
| 2 | /download | OK — server redirect | src/proxy.ts:53-59 |
| 3 | /checkout, /checkout/success | OK (client) — `router.replace("/dashboard")` after mount; order summary can paint first | src/app/checkout/CheckoutClient.tsx:79-83 (NS-04 class) |
| 4 | Stripe checkout / portal APIs | OK — 403 in shell | src/app/api/stripe/checkout/route.ts:47, portal/route.ts:26 |
| 5 | /upgrade | OK — ProOffer swaps to IAP after mount; web branch painted first | src/app/upgrade/page.tsx (no server gate at HEAD), ProOffer.tsx:26 |
| 6 | PlanGate × 13 sites | OK after mount; web "Upgrade to Pro" + referral promo painted for 1–3 s | PlanGate.tsx:59-73; dashboard/page.tsx:1086-1134 (NS-04) |
| 7 | PlanGate `nativeContent` overrides (no IAP button) | OK by design — plain PRO badge | PlanGate.tsx:76, 82-88 |
| 8 | NativePaywall sheet copy | OK — StoreKit prices only, Restore, auto-renew sentence, Terms/Privacy links | NativePaywall.tsx:19-28, 455-488 |
| 9 | Trial copy ("14-day free trial") | OK — only when StoreKit confirms eligibility; account rule first | iap.ts:300-317, NativePaywall.tsx:210-214 |
| 10 | TrialBanner "Keep Pro →" | hidden in app at HEAD (`!native`) | TrialBanner.tsx:62 (in-flight re-enables it to /upgrade for Pro) |
| 11 | SiteNav / SiteFooter / SalesChat | OK pre-paint — CSS `html.native-app .sc-site-nav/.sc-site-footer {display:none}`; Pricing links also JS-gated | globals.css:1248-1249, SiteNav.tsx:191,316, SiteFooter.tsx:77,130 |
| 12 | 404 page | OK — logo, "make your own SwiftCard" CTA to /cards/new, no price | src/app/not-found.tsx |
| 13 | Error boundary | OK — no commerce | src/app/error.tsx |
| 14 | /terms, /privacy (linked from the paywall) | OK — 2 NativeHidden blocks in terms; nav/footer CSS-hidden | src/app/terms/page.tsx |
| 15 | /compare, /compare/[slug] | PARTIAL — rows wrapped, FAQ answers + JSON-LD carry $4.99 / $3.99 | compare/[slug]/page.tsx:126-281, 389, 437 (NS-11) |
| 16 | /for/[slug], /products/[slug], marketing pages | OK — NativeHidden on "See pricing" CTAs; not linked in-app | 3–5 NativeHidden uses each |
| 17 | Blog | not audited line-by-line (markdown content); not linked in-app; nav/footer hidden | src/app/blog |
| 18 | Email signature footer ("Made with SwiftCard") | OK — link to swiftcard.me/cards/new, no price | EmailSignatureBox.tsx (in-flight changes Android wording) |
| 19 | Help assistant | OK — commerce docs dropped from context; nativeAnswer on instant path; 15 commerce docs all carry nativeAnswer (type-enforced); derivedFacts(commerce:false) | retrieval.ts:91,116,166; types.ts:60-66; docs/account.ts ×10, getting-started ×1, marketing-site ×3, product ×1 |
| 20 | Help `native` flag source | WEAK — client-decided only | HelpWidget.tsx:74 vs sales/route.ts:57 (NS-15b) |
| 21 | Notification bell copy | OK — NATIVE_BODY_REMAP (sequence_paused, pro_ended, lead_cap_reached, plan_downgraded), personal_sub_reminder + referral_claim hidden | native-notification-copy.ts:10-29, NotificationBell.tsx:99-103 |
| 22 | Push payloads | OK — destinations are /dashboard, /share, /settings/flows?billing=1, office paths; bodies from push-policy (no prices) | api/push/*, stripe/webhook/route.ts:236, team-alerts.ts:136 |
| 23 | Stripe webhook push → /settings/flows?billing=1 in-app | OK — BillingManager shows IAP/Apple manage; Stripe-billed users get the link-out | BillingManager.tsx:181-276 |
| 24 | External purchase link-out (Billing, Office seats, promo) | RISK — live beside IAP, no storefront guard | BillingManager.tsx:276, TeamActions.tsx:337, PlanCards.tsx:419,515 (NS-10) |
| 25 | AppStoreBadge / AppStorePopup / GetTheApp cards | OK after mount (NativeHidden inside the badge; popup `native` guard) | AppStoreBadge.tsx (8), AppStorePopup.tsx:38 |
| 26 | Welcome / plan step for a new account | OK — PlanCards native renders free continue + IAP card | PlanCards.tsx:548 |
| 27 | Apple offer-code redemption | OK — Apple's sheet/page; server mirrors codes via ASC_KEY_ID/ASC_ISSUER_ID/ASC_PRIVATE_KEY | iap.ts:386-422, apple-offer-codes.ts:48-62 |
| 28 | Sandbox purchases grant Pro | OK — allow-listed review emails only | iap-entitlement.ts:50-59, api/iap/sync:65, revenuecat:57-59 |
| 29 | Entitlement sync lag UI | OK-ish — 4×1.5 s polls, then `_planChosen: "pro_pending"` stops the plan-chooser loop; gates stay locked until the webhook lands and a reload happens | iap.ts:347-352, api/iap/sync:34-45,78 |
| 30 | Restore on another SwiftCard account | OK — TRANSFER handled both ways with rcProActive re-check | api/iap/revenuecat:163-175 |

## Appendix C — In-flight (uncommitted) "Android app sells nothing" diff, summarised

Scope: 40 modified files (+354/−101) + 7 untracked (scripts/lib/android-shell.mjs, scripts/qa-android-shell.mjs, src/components/AndroidProInfo.tsx, src/lib/capture-exact.ts, tests/render/android-sells-nothing.interactive.test.ts, tests/render/card-capture-exact.test.ts, qa-offline-out/). Two unrelated work streams are mixed in the same tree: the Android selling pass and a share-capture/card-template pass (ShareCardCapture, card-png.ts, capture-exact.ts, CustomCard/LogoFirst, share-capture-version.ts, link-anything.ts) — stage them as separate commits.

What it changes (Android):
- src/lib/native-request.ts +`isAndroidAppRequest(ua)` (substring `SwiftCardAndroid/`) — the first SERVER-side per-platform signal.
- src/app/upgrade/page.tsx: server-gated branch → `<AndroidProInfo from=…>` (Pro feature list from PLAN_FEATURES, "Pro isn't sold in the Android app", back to dashboard; no price, no button). Correct pattern — it is the one NS-04 asks for everywhere.
- src/components/NativePaywall.tsx: `resolveStatus()` returns "unavailable" on Android → IapSubscribeButton/IapProPill/IapProLock render nothing / a static badge instead of a sheet that cannot sell.
- 15 components gain `useIsAndroidApp()` branches (AddCardButton, BillingManager, EmailSignatureBox, FirstLeadNudge, FreeDesignChoice, GrowShare, PlanCards, PlanTierCards, ProEndedPanel, ProOffer, ProRequiredDialog, SeeWhoLink, TrialBanner, WelcomePlan, NewCardWizard, dashboard/page, grow/page): Apple wording ("App Store", "iPhone Settings", "Save to Photos") and purchase CTAs swapped or dropped on Android.
- TrialBanner: "Keep Pro →" re-enabled INSIDE the iOS app (→ /upgrade = IAP) for Pro trials; still hidden for Office/Stripe-billed. Changes iOS behaviour, not only Android — note for the commit message.
- NotificationBell / native-notification-copy.ts: `referral_claim` is now SHOWN in the app with a remapped body ("You've earned a free month of Pro. Tap here to claim it.") instead of hidden; tests/native-suppression.test.ts updated accordingly. The remapped body still says "free month of Pro" — acceptable (no price/upgrade), but it is a new in-app surface to keep an eye on.
- Knowledge docs (account.ts, product.ts) adjusted; nightly-qa.yml + qa-nightly-summary.mjs + package.json add the `qa:android-shell` sweep (pixel-8, 360px; checks insets, Apple wording, selling words, JS errors, back key, new-tab links, splash hide, status-bar theme).
- tests: android-shell.test.ts +31 lines, monitoring-wiring, notification-matrix, free-notification-hooks, render/bell-plans (mock gains `useIsAndroidApp`), render/offline-sw.

Risks in the diff: (1) NS-02 — tests/render/add-card-sheet.test.ts still mocks `@/lib/platform` without `useIsAndroidApp` → render job red; (2) AndroidProInfo advertises "Scan a paper business card" while NS-03 makes the scanner impossible on Android; (3) the diff does not touch android/ (no CAMERA permission, no status-bar plugin, no IME insets) — the native gaps NS-03/08/09 remain; (4) in-flight native-notification-copy change alters iOS bell content and should be called out as such.
