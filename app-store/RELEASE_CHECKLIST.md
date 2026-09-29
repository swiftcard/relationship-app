# Release Checklist — SwiftCard iOS 1.0

_Work top to bottom. Do not skip sections. Submission is gated on EVERY box._

**Build status (2026-08-07): the shell compiles.** Xcode 26.6 + the iOS 26.5
platform are installed, and both Debug and Release build clean with zero
warnings for `-destination 'generic/platform=iOS Simulator'`. Verified on an
iPhone 17 Pro simulator: the app boots, loads https://swiftcard.me, and the
live site detects native mode (the console shows the page calling
`To Native -> App addListener` / `PushNotifications addListener`, which only
runs behind `detectNativeApp()`). The `SwiftCardWidgetExtension` target now
exists, builds, embeds into `App.app/PlugIns/`, and iOS registers it
(`pluginkit -p com.apple.widgetkit-extension` lists it). App and widget both
resolve the `group.me.swiftcard.app` App Group and its container provisions.

Two silent-failure bugs were found and fixed while getting there — see
§"Fixed during first build" at the bottom.

**BUILD 1 IS UPLOADED. 2026-08-10: SwiftCard 1.0.0 (1) validated ("VERIFY
SUCCEEDED"), uploaded, and shows `processingState: VALID` on app 6798875872.**

The pipeline is `npm run ios:release` (`--dry` to validate without uploading).
Fully headless — no Apple ID in Xcode: `scripts/asc-provision.mjs` mints the
Apple Distribution cert + App Store profiles via the ASC API (key
`~/.swiftcard/asc/`, id `4T9CJ9M8CA`), the identity lives in the dedicated
`swiftcard-release` keychain, archives are deliberately unsigned (dev profiles
need a device; the team has none) and distribution signing happens at export.
Apple Wallet went live the same night: `pass.me.swiftcard.card`, endpoint
verified serving a signed `.pkpass`, guarded by the uptime health check.

**What remains is App Store Connect housekeeping, then Submit:**
1. In ASC → App Store → 1.0.0: attach build 1, paste metadata from
   `docs/ios-review/APP-STORE-METADATA.md`, upload screenshots
   (`app-store/screenshots/6.9-inch/` has 2; `npm run ios:screenshots` after
   one manual sim sign-in captures the rest).
2. App Review Information: paste `app-store/APP_REVIEW_NOTES.md` + the demo
   account (`applereview@swiftcard.me`, password in
   `~/.swiftcard/apple-review-account.txt`).
3. TestFlight the build on a real phone first (`TESTFLIGHT_TEST_PLAN.md` P0s —
   push and Wallet want hardware confirmation).
4. Submit.

## A. Apple Developer portal (developer.apple.com)

- [x] Apple Developer Program membership active — team **Swift Card Inc. —
      NHK8FA2RR2**, account Aaron Lavi.
- [x] App ID `me.swiftcard.app` ("SwiftCard iOS") registered. Verified
      2026-08-07: Associated Domains ✓, Push Notifications ✓, Sign in with
      Apple ✓, App Groups ✓.
- [x] **App Group `group.me.swiftcard.app` assigned to the App ID.** It
      existed as an identifier but was attached to nothing ("Enabled App
      Groups (0)"), which would have failed device provisioning for the
      widget's entitlement. Now (1).
- [x] **Services ID `me.swiftcard.web`** ("SwiftCard Sign in with Apple")
      created with Sign in with Apple enabled, primary App ID
      `NHK8FA2RR2.me.swiftcard.app`, domain
      `grxmovpmlgmjncnyiyrt.supabase.co`, return URL
      `https://grxmovpmlgmjncnyiyrt.supabase.co/auth/v1/callback`.
      Apple validated both URLs.
- [x] **Auth key created — "SwiftCard Auth and Push", Key ID `C8TWRXCNKA`**,
      carrying BOTH services: Apple Push Notifications service and Sign in
      with Apple (primary App ID `me.swiftcard.app`).
      - APNs environment is **Sandbox & Production**. That choice is
        permanent — Apple's own dialog says environment and restriction
        "can't be changed once saved" — and the form defaults to Sandbox
        only, which would have left production push dead with no way to fix
        it short of a new key. Key Restriction: Team Scoped (All Topics).
      - One key covers both services, so revoking it would take down push
        AND Sign in with Apple together. Acceptable for launch; split them
        if that coupling ever bites.
      - **The .p8 downloads exactly once.** It is stored at
        `~/.swiftcard/keys/AuthKey_C8TWRXCNKA.p8` (mode 600, in a 700
        directory, deliberately outside the iCloud-synced Desktop). It is
        NOT in the repo and must never be. **Back it up somewhere durable —
        if that file is lost the key cannot be re-downloaded, only revoked
        and replaced.**
- [x] **Verified against Apple, not assumed.** Posting the generated client
      secret to `https://appleid.apple.com/auth/token` with a deliberately
      invalid code returns `invalid_grant` ("The code has expired or has been
      revoked") rather than `invalid_client`. Apple accepted the Services ID,
      the key, and the signature — so the only thing between here and working
      Apple sign-in is the Supabase toggle in §B.
- [x] **Private email relay registered** (2026-08-07). Sign in with Apple →
      Email Sources now has domains `swiftcard.me` and `send.swiftcard.me`
      plus address `hello@swiftcard.me`. Apple accepted them ("2 Domains and
      Subdomains, 1 Email address") because SPF and DKIM are already in place
      — `swiftcard.me` publishes `v=spf1 include:_spf.google.com
      include:amazonses.com ~all`, Resend's envelope domain
      `send.swiftcard.me` publishes its own SPF, and `resend._domainkey`
      resolves. Without this, every Hide-My-Email user would silently receive
      nothing from the product.
- [ ] **APNs key** (.p8) created — note Key ID. (SHELL-RUNBOOK §6.)
- [ ] **Apple Wallet is NOT configured** and the submission copy no longer
      claims it. `/api/wallet/pass` returns 501 `not_configured`, no
      `APPLE_PASS_*` / `APPLE_WWDR` vars exist, and `hasWalletConfig()` gates
      the button off — so nothing is broken, but nothing is offered either.
      To turn it on (all optional, Wallet is not required to ship):
      1. A 2048-bit key and CSR are already generated and waiting at
         `~/.swiftcard/wallet/` (`pass-key.pem`, `pass.csr`) — no Keychain
         needed, they were made with openssl.
      2. Portal → Identifiers → Pass Type IDs → register `pass.me.swiftcard.card`,
         then create its certificate and upload `pass.csr`.
      3. Download the `.cer` and convert:
         `openssl x509 -inform DER -in pass.cer -out pass-cert.pem`
      4. Get Apple's WWDR G4 intermediate and convert it the same way.
      5. Set in Vercel Production: `APPLE_PASS_TYPE_ID=pass.me.swiftcard.card`,
         `APPLE_PASS_CERT_PEM`, `APPLE_PASS_KEY_PEM`, `APPLE_WWDR_PEM`
         (`APPLE_TEAM_ID` is already set), redeploy, and confirm
         `/api/wallet/pass?card=<username>` returns a `.pkpass` not a 501.
      6. Only then restore the Wallet claims in APP_REVIEW_NOTES.md, the App
         Store description, and TESTFLIGHT_TEST_PLAN.md.

## B. Supabase dashboard — DONE (2026-08-07)

- [x] Auth → Providers → **Apple enabled**, client id `me.swiftcard.web`,
      secret = an Apple-signed ES256 JWT.
- [x] Auth → URL Configuration → Redirect URLs now includes
      `swiftcard://auth-callback` (the return leg of native OAuth).
- [x] **Verified live, not just accepted.** `/auth/v1/authorize?provider=apple`
      now returns `302 → https://appleid.apple.com/auth/authorize` with
      `client_id=me.swiftcard.web`, the Supabase callback as `redirect_uri`,
      and `scope=email name`. It answered "provider is not enabled" for a few
      seconds after the PATCH — GoTrue reload lag, so re-probe before
      concluding anything is wrong.

Done with:

```bash
node scripts/supabase-enable-apple.mjs ~/.swiftcard/keys/AuthKey_C8TWRXCNKA.p8
```

The token is read from `~/.swiftcard/supabase-token` (or
`SUPABASE_ACCESS_TOKEN`). Note `supabase login` cannot be scripted — it is an
interactive TUI that refuses non-TTY, refuses again in JSON mode, and may keep
its token in the macOS Keychain rather than on disk. Use a personal access
token from supabase.com/dashboard/account/tokens instead.

⚠️ **The Apple client secret expires ~2027-02-05.** Sign in with Apple will
start failing on that date with no warning. Re-run the exact command above to
refresh it — it regenerates the JWT and re-verifies. Put it in a calendar.

## C. Vercel env + deploy

- [x] Env vars (Production) — all six Apple vars are now set:
      `APPLE_TEAM_ID`, `APPLE_SIGN_IN_CLIENT_ID` (`me.swiftcard.web`),
      `APPLE_SIGN_IN_KEY_ID` + `APPLE_SIGN_IN_PRIVATE_KEY`,
      `APPLE_PUSH_KEY_ID` + `APPLE_PUSH_PRIVATE_KEY` (all `C8TWRXCNKA`).
      `APPLE_SIGN_IN_*` is what lets `src/lib/apple-revoke.ts` revoke Apple
      tokens at account deletion — App Store requirement 6.2, separate from
      the Supabase provider, and a silent no-op without them.
      `APPLE_PUSH_SANDBOX` is deliberately **not** set: the key is
      Sandbox & Production, so production APNs is the correct default. Set
      it to `1` only for local Xcode dev builds, and never for TestFlight.
      ⚠️ These are stored as Sensitive in Vercel, so `vercel env pull` shows
      them as `""`. That is expected — it is not evidence they are empty.
- [x] **`NEXT_PUBLIC_APPLE_SIGNIN_ENABLED=1`** set in Production after §B went
      green, and deployed. The Apple button in `LoginForm.tsx` is gated on it
      precisely so the button cannot exist while the provider is off; a
      sign-in control that always errors is a 2.1 rejection by itself. It is a
      `NEXT_PUBLIC_` var, so it is baked in at build time — changing it
      without a redeploy does nothing. **Set it back to 0 and redeploy if the
      Apple client secret ever lapses.**
- [x] **AASA is live and correct** (verified 2026-08-07):
      `curl https://swiftcard.me/.well-known/apple-app-site-association`
      returns `"appID":"NHK8FA2RR2.me.swiftcard.app"` with paths
      `NOT /*` and a single excluding component — since 2026-09-29 no
      swiftcard.me link opens the app; they all open in Safari — the real Team ID,
      not `TEAMID_PLACEHOLDER`. So `APPLE_TEAM_ID` is already set in Vercel
      Production and Universal Links are activated server-side.
- [x] Audit commits are on origin/main; nothing is local-only any more.

## D. Xcode (SHELL-RUNBOOK §1–2, §6b)

- [x] Xcode 26.6 installed; iOS 26.5 platform + simulator runtime downloaded
      (`xcodebuild -downloadPlatform iOS` — Xcode ships only stub SDKs).
- [x] `npx cap sync ios` clean; 5 plugins resolved via SPM.
- [x] **SwiftCardWidgetExtension** target created in the pbxproj with
      `SwiftCardWidget.swift`, its `Info.plist`, `PrivacyInfo.xcprivacy` and
      entitlements; embedded into the app via an "Embed Foundation
      Extensions" copy phase. Deployment target 17.0 (the view uses
      `.containerBackground(for: .widget)`); the App target stays on 15.0.
- [x] App Groups (`group.me.swiftcard.app`) resolve on BOTH targets —
      confirmed from the generated `Entitlements-Simulated.plist` for each,
      and the shared container provisions on install.
- [x] `PrivacyInfo.xcprivacy` in the App target's Copy Bundle Resources, and
      the widget's own manifest in the extension's.
- [x] iPhone-only: `TARGETED_DEVICE_FAMILY = 1` on both targets. This is the
      one-line decision that keeps the 13-inch iPad screenshot set out of
      scope — flip to `"1,2"` if you ever want iPad.
- [x] Debug + Release both build clean (zero warnings) for the simulator, and
      the app boots to the live site in native mode there.
- [ ] **Sign in to Xcode** (Settings → Accounts) with the Apple ID on team
      NHK8FA2RR2. Nothing device-side works until this is done.
- [ ] Signing: confirm Associated Domains + Push + App Groups resolve against
      the real team once signed in.
      **Do NOT add a Sign in with Apple capability.** SIWA here runs through
      Supabase's OAuth flow in the system browser (`src/lib/native-auth.ts`),
      not `ASAuthorizationAppleIDProvider`, so the
      `com.apple.developer.applesignin` entitlement is not required — adding
      it only creates a provisioning dependency that can fail signing. The
      App ID work in §A is still required for the *web* SIWA leg.
- [ ] Debug build on a real device boots to the live site in native mode.

## E. Device test round

- [ ] ALL P0 items in `TESTFLIGHT_TEST_PLAN.md` pass on two iPhones.
- [ ] Archive → **Validate App** passes (privacy manifest + required-reason
      checks happen here).
- [ ] Xcode Organizer → generate the **privacy report** from the archive;
      confirm it matches `APP_PRIVACY_DISCLOSURE_MATRIX.md`.

## F. App Store Connect

- [ ] Everything in `APP_STORE_CONNECT_CHECKLIST.md`.
- [ ] Demo account created (`node scripts/create-apple-review-account.js`),
      verified against `REVIEWER_DEMO_ACCOUNT_TEMPLATE.md`, credentials in
      ASC only.

## G. Final consistency sweep (day of submission)

- [ ] Live site /privacy, /terms, /contact reachable logged-out.
- [ ] Reviewer notes match reality (widget exists? push works? Apple login
      works?) — update `APP_REVIEW_NOTES.md` if anything shifted.
- [ ] `KNOWN_LIMITATIONS.md` re-read; still accurate.
- [ ] No new selling surfaces shipped to the site since the audit
      (`npm test` — the guard tests catch code-side regressions).
- [ ] Screenshots taken from the ACTUAL submitted build.

## Submit

- [ ] Submit for review. Expect 1–2 rounds (4.2 webview-shell scrutiny is the
      known structural risk — the reviewer-notes "why it's more than a
      website" section is the prepared answer).

## Fixed during first build (2026-08-07)

Both of these compiled fine and would have shipped as features that quietly
did nothing. Neither was visible until the project was actually built.

1. **Push notifications could never register.** `AppDelegate.swift` was
   missing `didRegisterForRemoteNotificationsWithDeviceToken` and
   `didFailToRegisterForRemoteNotificationsWithError`. The
   `@capacitor/push-notifications` plugin listens for those as
   `NotificationCenter` posts, not as delegate calls, so
   `PushNotifications.register()` never resolved — `EnablePushButton` would
   have hit its timeout every time and no APNs token would ever have reached
   `lib/apns.ts`. Both forwards added; locked by a test.

2. **The home-screen widget could never see a card.** The card was written
   with `@capacitor/preferences` configured with
   `group: "group.me.swiftcard.app"`. That option is **not** an iOS App
   Group — the plugin's iOS code always writes `UserDefaults.standard` and
   uses `group` only as a key prefix. `UserDefaults.standard` lives in the
   app's own container, which a widget extension cannot read, so the widget
   would have sat on "Open SwiftCard to set up your QR" forever. Replaced
   with a `WidgetBridge` native plugin (`ios/App/App/WidgetBridge.swift`)
   that writes the real `UserDefaults(suiteName:)` shared suite and calls
   `WidgetCenter.shared.reloadTimelines(ofKind: "SwiftCardQR")` — without
   that reload the widget would also have kept a stale snapshot for up to
   6 hours. Locked by tests, including a regression guard that fails if the
   Preferences route ever comes back.

   Note this is also why the old test suite passed: it asserted that both
   sides used the same group and key *strings*, which was true and
   irrelevant. The tests now assert the mechanism.

Still unverified end-to-end (needs a signed-in device — it is already a P0 in
`TESTFLIGHT_TEST_PLAN.md`): a real card populating the widget, and a real
APNs token round-trip.

## Day the listing goes live (one switch)

Set `NEXT_PUBLIC_APP_STORE_URL` in Vercel (production) to the real listing —
`https://apps.apple.com/app/id6798875872` — and redeploy. That single env var
self-activates EVERY download surface at once; nothing else to edit:

- Homepage hero badge + marketing footer badge
- Safari Smart App Banner site-wide (root layout `itunes` metadata, derived id)
- "Continue on the web / Download the app" popup on every new account's first
  dashboard load (office sub-users included) — the guided tour waits for it
- Settings → Help: "Get the iPhone app" row (web only, all plans)
- Welcome email: App Store badge block
- Office invite email to sub-users: "carry it in the SwiftCard iPhone app" +
  badge (emails sent before the switch simply don't have it)

Until the var is set, all of the above render nothing — no dead links.
