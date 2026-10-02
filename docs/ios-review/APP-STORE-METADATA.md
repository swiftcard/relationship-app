# App Store Connect — Copy-Paste Metadata Pack

_Every field pre-written. Fill App Store Connect top-to-bottom from this file._

**This file mirrors what is in App Store Connect.** The listing is written
through the API (`scripts/lib/asc.mjs`), and the copy below is the same copy
that was PATCHed there on 2026-09-05 and verified by re-reading — change one
and change the other in the same commit. Field limits: name 30, subtitle 30,
promotional text 170, keywords 100, description 4000, review notes 4000.

## App Information

| Field | Value |
|---|---|
| Name | **SwiftCard: Business Card** (bare "SwiftCard" is already taken on the store; "SwiftCard: Digital Business Card" is 32 chars and cannot fit) |
| Subtitle (30 chars) | `Digital business card & links` |
| Bundle ID | `me.swiftcard.app` |
| Primary category | Business |
| Secondary category | Productivity |
| Content rights | Does not contain third-party content |
| Age rating | Use the 2025 questionnaire (mandatory since Jan 31 2026) — answer the UGC questions truthfully (public user cards + report/takedown exist); accept the computed rating. See app-store/APP_STORE_CONNECT_CHECKLIST.md §4 |

## Pricing & Availability
- Price: **Free**, with two auto-renewable In-App Purchases in the group
  "SwiftCard Pro": `me.swiftcard.app.pro.monthly` ($4.99) and
  `me.swiftcard.app.pro.annual` ($53.99), each with a 14-day free trial.
  In-App Purchase is the app's ONLY purchase path (guideline 3.1.1); web
  subscribers also get Pro in the app (3.1.3(b)).
- Availability: United States.

## Promotional Text (170 chars, editable without review)
```
Your business card as a link. Share it by QR, NFC or Apple Wallet, collect every contact you meet, and let SwiftCard write the follow-up. Free to start.
```

## Description
```
SwiftCard turns your business card into a link. Share it with a QR code, an NFC card, or Apple Wallet. The other person opens it on their phone and saves you in one tap. No app needed on their end.

Everything you need to meet people and follow up, in one place:

YOUR DIGITAL BUSINESS CARD
Build a card with your photo, logo, title, phone, email and website. Pick a design or customize the colors and fonts. Share it by link, QR code or NFC tag, or add it to Apple Wallet so it's always one tap away. Edit it any time. Every QR code and NFC card you've already handed out keeps working, because they point to your link, not a copy.

SWIFT LINKS: YOUR LINK-IN-BIO PAGE
Every card comes with a Swift Links page: your photo, bio, social icons, video previews and custom buttons on one page. Put it in your Instagram, TikTok or LinkedIn bio.

SWIFT SIGNATURE: YOUR CARD IN EVERY EMAIL
Turn your card into an email signature for Gmail, Outlook and Apple Mail in two taps.

CAPTURE EVERY CONTACT
When someone opens your card, they can share their name, email and phone back to you. Everyone lands in your Contacts with notes, tags and follow-up status. A simple CRM built for real-world networking.

SCAN PAPER BUSINESS CARDS
Point your camera at a paper card and SwiftCard turns it into a saved contact.

AUTOMATIC FOLLOW-UPS
Pick a cadence and SwiftCard writes and sends personalized follow-up emails and texts for you, so nobody you meet is forgotten.

SEE WHO'S LOOKING
Get a notification the moment someone views your card. See how many people opened it, where they were, and which day was your best.

WORKS WITH YOUR CRM
Send every new contact to HubSpot, Salesforce, HighLevel, Pipedrive or Google Contacts automatically, or connect anything else with Zapier.

HOME-SCREEN WIDGET
Your card's QR code on your home screen, ready to scan.

FOR TEAMS
SwiftCard Office gives every employee an on-brand card, with shared contacts and team-wide analytics.

Free to start with one card, your Swift Links page, Swift Signature, and up to 5 new contacts a month.

SWIFTCARD PRO
Unlimited cards and contacts, unlimited AI follow-up drafts, the business-card scanner, the full card designer, detailed analytics, and no SwiftCard branding on your messages.

- SwiftCard Pro Monthly: $4.99 per month
- SwiftCard Pro Annual: $53.99 per year
Both start with a 14-day free trial.

Payment is charged to your Apple Account at confirmation of purchase. The subscription renews automatically unless it is canceled at least 24 hours before the end of the current period, and your Apple Account is charged for renewal within 24 hours before the current period ends. You can manage or cancel your subscription in your Apple Account settings after purchase. Any unused portion of a free trial is forfeited when you purchase a subscription.

Terms of Use: https://swiftcard.me/terms
Privacy Policy: https://swiftcard.me/privacy
```

## Keywords (100 chars)
Do not repeat words already in the name or subtitle — Apple indexes those
for free, so "business card", "digital" and "links" would be wasted characters.
```
nfc,qr,networking,crm,leads,contacts,linktree,vcard,follow up,sales,scanner,wallet,link in bio,ecard
```

## What's New (1.0.1)
```
Push notifications now work. Turn them on in Settings and get an alert the moment someone views your card or shares their details with you.

Also fixed: tapping a swiftcard.me link now opens in the app, and the home-screen widget shows your card's QR code.
```

## URLs
| Field | Value |
|---|---|
| Support URL | https://swiftcard.me/contact |
| Marketing URL | https://swiftcard.me |
| Privacy Policy URL | https://swiftcard.me/privacy |

## App Privacy (nutrition labels)

Data types collected — declare exactly these:

| Data type | Linked to user? | Tracking? | Purpose |
|---|---|---|---|
| Contact Info → Name | Yes | No | App Functionality |
| Contact Info → Email Address | Yes | No | App Functionality |
| Contact Info → Phone Number | Yes | No | App Functionality |
| User Content → Photos or Videos (card photo/logo uploads) | Yes | No | App Functionality |
| User Content → Other (leads/contacts the user saves) | Yes | No | App Functionality |
| Identifiers → User ID | Yes | No | App Functionality |
| Usage Data → Product Interaction (card-view analytics) | No (visitor analytics are pseudonymous) | No | Analytics |

- "Data used to track you": **None** (no cross-app tracking, no ad SDKs).
- Card VISITORS are not app users; their view analytics use a random
  device-scoped id, no account, no IP stored — that's why Usage Data is
  "not linked."

## App Review Information

- Sign-in required: **Yes** — two demo accounts, same password (set by
  `node scripts/create-apple-review-account.js`; the password lives only in
  the ASC review-detail field, never in this repo):
  - `applereview-free@swiftcard.me` — seeded Free account. It WILL drift to
    `pro` (RevenueCat re-grants App Review's own sandbox purchase on every
    renewal, `_planSource: apple`) and resetting the row does not hold. The
    notes therefore no longer rely on it being Free: the reviewer is told to
    create a fresh in-app account for the purchase test.
  - `applereview@swiftcard.me` — Pro, set from our admin, no subscription
    attached anywhere.
  - Both: clear `customization._aiConsent` before every submission so the
    5.1.1 consent dialog appears for the reviewer.
- Contact: Menash Harooni, menashharooni@gmail.com, +1 917 905 7335
- **Notes for the reviewer** (paste verbatim):
```
SwiftCard is the iPhone app for SwiftCard (swiftcard.me), a digital business card and contact-capture service. The app manages your own account: your cards, the people who shared their details with you, follow-ups, and analytics.

WHAT IS IN 1.0.2
An accessibility release. The app now follows the system text size (Dynamic Type) right up to the largest accessibility sizes, VoiceOver labels and reading order were reworked throughout, contrast was raised, and Reduce Motion is respected across the app. It also adds Apple's system rating prompt and a new launch screen. No new features, no change to purchasing, no change to data handling.

IN-APP PURCHASE (3.1.1)
Pro is sold only through In-App Purchase: two auto-renewable subscriptions in the group "SwiftCard Pro", each with a 14-day free trial.
  - me.swiftcard.app.pro.monthly
  - me.swiftcard.app.pro.annual
There is no external purchase link and no price anywhere in the app except the StoreKit paywall. Reach it at Settings > Plan and billing > "Upgrade to Pro", from any locked Pro feature, or from the plan step when creating a first card. The paywall shows StoreKit prices only and includes Restore Purchases, Terms of Use, Privacy Policy and the auto-renewal disclosure. Per 3.1.3(b), customers who subscribed on our website can also use Pro in the app, because Pro is purchasable in the app.

THIRD-PARTY AI (5.1.1 / 5.1.2)
Before any personal data reaches the AI service, a dialog names the recipient (Google), itemises exactly what is sent (the photo taken when scanning a business card; a contact's name, company, where you met and notes when AI drafts a follow-up; messages typed to the assistant), and offers equal Allow / Don't allow choices. This is enforced on our servers: until an account has explicitly allowed, every AI endpoint refuses requests from the app. Our privacy policy at swiftcard.me/privacy names Google (the Gemini API), lists each category of data sent and its purpose, and states that inputs are not used to train models. Both demo accounts have had their choice reset, so the dialog appears the first time an AI feature is used.

DEMO ACCOUNTS (both use the password in the field below)
  1. applereview-free@swiftcard.me: seeded with sample contacts and card views.
  2. applereview@swiftcard.me: set to Pro by us from our own admin so the Pro feature set is visible without a purchase. No subscription of any kind is attached to it, through Apple or otherwise.

Either demo account may already show Pro when you sign in. App Review's own sandbox purchases from the previous review remain attached to these accounts, and a sandbox subscription re-grants on each renewal. That is expected and is not a purchase outside the app.

TO EXERCISE THE IN-APP PURCHASE
Please create a fresh account inside the app: on the sign-in screen, choose the "Create account" tab. It takes a few seconds, starts on the Free plan, and every plan gate and the paywall are reachable from it. Then Settings > Plan and billing > "Upgrade to Pro" (or any locked Pro feature) opens the StoreKit paywall, where the two subscriptions above can be purchased with a sandbox Apple ID.

PUSH NOTIFICATIONS
Turn them on in Settings, then open that account's card link (shown on its dashboard under Share) from another device or browser. A notification arrives within a few seconds of the card being viewed.
```

## Screenshots
One 6.9-inch iPhone set at 1320 × 2868 px, ten frames. Newest is
`app-store/screenshots/6.9-inch-v7` (2026-09-24: the v5 device frame — whole
phone at real iPhone 16 Pro Max proportions, titanium rail, side-edge pop-outs,
sampled status-bar colour — over a fresh capture of the warm editorial card and
linen links page, taken after Hot/Warm scoring, "Copy personal link" and the
per-contact alert switch left the app). Search results show the first three,
so the story lands there: your card → they save you → every lead in your pocket.

**What is actually on the listing:** the live 1.0.2 shows **v4**; the pending
1.0.3 holds **v7** (uploaded 2026-09-24, replacing v6 which showed the removed
UI). v3, v5 and v6 were never live. Never replace a staged set without Menash's
explicit go.

The pipeline is three steps, and only the last one touches Apple:

1. `node scripts/appstore-capture.mjs` → `app-store/screenshots/_raw`. Drives a
   real browser through a real login against production, so it needs
   `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SUPABASE_URL` in `.env.local`;
   it creates a throwaway account, seeds it, and deletes every row in a
   `finally`. Without the service-role key it cannot run at all.
2. `OUT=app-store/screenshots/6.9-inch-v<N> node scripts/appstore-compose-v5.mjs`
   (`ONLY=01,06` for a subset). Re-check the typed pop-out values in frames 06
   and 07 against the new `_raw/dashboard*.png` — the seed draws fresh numbers
   every run, and they are typed into the script.
3. `node scripts/asc-upload-screenshots.mjs <dir>` targeting the pending
   version's localization id; it deletes and recreates the set so the listing
   mirrors the directory exactly.

`_raw` is the 2026-09-24 capture (warm editorial card, linen links page); v7 is
composed from it. A listing refresh means steps 1–3 in order, on a machine that
has the service-role key.

## Version
- 1.0.6, build 17. "What's New": `Your QR code now works with no signal. Open
  SwiftCard without a connection and your card's QR code fills the screen,
  ready to scan. The app reloads by itself when you're back online.` Native
  change: ios/App/App/OfflineCard.swift (offline QR over the webview on a
  connectivity failure). Prepared 2026-10-02; NOT uploaded or submitted —
  Menash submits.
- 1.0.5, build 16 (LIVE 2026-10-01). "What's New": `New: SwiftCard for Apple Watch. Your card's
  QR code on your wrist, with a watch-face complication that opens it in one
  tap. It follows the card you choose on your iPhone and works without your
  phone nearby. Links to SwiftCards and Swift Links now always open in your
  web browser, never inside the app.` (Two paragraphs in ASC.) Build 16 is the FIRST build that
  embeds the Apple Watch app (`npm run ios:release`, no `--no-watch`; build 15
  had it stripped and was never submitted). (The app no longer
  carries the Associated Domains entitlement — `ios/App/App/App.entitlements`
  and `AppRelease.entitlements` — so iOS never offers it a swiftcard.me link.
  Owner, 2026-09-29: a card or Swift Links link opened from a text or an
  Instagram bio must open in Safari/Chrome and "not be connected at all" to
  the app. The served AASA already excluded every path, but 1.0.4 was
  released at 12:14 ET that day, before the exclude-all file went live at
  13:47, so phones that updated in between cached the old rules for days.
  `scripts/ios-release.sh` now REFUSES a build that carries the entitlement.
  Pinned by `tests/aasa-card-links.test.ts` and
  `tests/native-capabilities.test.ts`. Build on the Mac with
  `npm run ios:release -- --no-watch`, wait for build 15 to show VALID, then
  `node scripts/asc-submit.mjs --go` (one script for every release: it
  reads the version and build from the Xcode project and the What's New from
  `scripts/lib/whats-new.mjs`).)
- 1.0.4, build 14. "What's New": `Fixes the app closing right after opening on
  iOS 27.` (The iOS 27 launch crash: build 13 still used the pre-iOS-13
  app-delegate window with no UIApplicationSceneManifest, which iOS 27 turns
  from a runtime warning into a kill at scene creation — a black frame, then
  gone, before any of our code runs; crash log `App-2026-09-28-114750.ips`,
  `___UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`. Build 14
  adopts the UIScene lifecycle: `ios/App/App/SceneDelegate.swift`, the scene
  manifest in Info.plist, URL opens / Universal Links / the Apple Watch
  re-publish moved to the scene delegate. Pinned by
  `tests/ios-scene-lifecycle.test.ts`. Build on the Mac with
  `npm run ios:release -- --no-watch`, wait for build 14 to show VALID, then
  `node scripts/asc-submit-104.mjs --go` (since folded into
  `scripts/asc-submit.mjs`) — it creates 1.0.4 (release
  AFTER_APPROVAL), attaches the build, writes What's New and submits. Then
  request an expedited review. The launch screen is unchanged from 1.0.3 —
  the v3 screen from the owner's 2026-09-20 reference is already in the
  binary and stays.)
- 1.0.3, build 13. "What's New": `A new launch screen, and notifications now
  show as banners while you're using the app. Also fixed: the app no longer
  quietly stops receiving notifications after the first one.`
  (1.0.3 = build 13, uploaded 2026-09-24: build 12 plus the v3 launch screen —
  the owner's field and mark with the lightning drawn into it,
  `scripts/build-splash-v3.mjs`, the launch images in `Splash.imageset`, and
  `SwiftCardSplash/3` in the user agent so the server serves the matching
  animation — plus `presentationOptions` in capacitor.config.ts so a push shows
  as a banner while the app is in the foreground. The APNs "phone deleted after
  its first push" fix (00f477f9) is server-side and already live, but the
  symptom was in the app, so the note names it. Ships with the v7 screenshot
  set, recaptured 2026-09-24 after Hot/Warm scoring, "Copy personal link" and
  the per-contact alert switch were removed from the app. Build 13 was
  originally staged as a 1.0.2 re-upload and never uploaded; 1.0.2 went live as
  build 12. The "What's New" text (now `scripts/lib/whats-new.mjs`) tracks the
  CURRENT in-flight version, so it carries the 1.0.3 copy.)
- 1.0.2, build 12 shipped 2026-09-11 and is live. "What's New": `This update is
  all about accessibility. • Larger Text: SwiftCard now follows your iPhone's
  text size, right up to the largest accessibility sizes. • VoiceOver and Voice
  Control: clearer labels and a more predictable reading order throughout. •
  Better contrast, and Reduce Motion is now respected across the app.`
  (The ACCESSIBILITY release: Dynamic Type in MainViewController's web view,
  the VoiceOver/contrast/reduced-motion pass, and the system rating prompt.
  Build 11 predated all of it.)
- 1.0.1, build 11 shipped 2026-09-03 and is live. "What's New": `Push
  notifications now work — get alerted the moment someone views your card or
  saves their details. Also fixes Universal Links and the home-screen widget.`
  (Build 11 is the ENTITLEMENTS FIX. Every build up to and including build 10 —
  the one live on the App Store — shipped with an empty entitlement set: the
  archive was created with CODE_SIGNING_ALLOWED=NO, which skips the step that
  compiles CODE_SIGN_ENTITLEMENTS into a .xcent, and exportArchive then signed
  the app with only application-identifier + team-identifier. The provisioning
  profile granted aps-environment=production, the app group and the associated
  domain; the binary carried none of them. Push registration therefore failed
  on every device with "no valid aps-environment entitlement string found",
  Universal Links fell through to Safari, and the widget could not read the
  shared App Group container. scripts/ios-release.sh now signs the archive with
  the distribution profile and REFUSES to upload an .ipa whose real, embedded
  entitlements are missing any of the three.)
- 1.0.0, build 10 shipped 2026-09-02 (superseded by 1.0.1).
  (Build 9 is the IAP-era binary: RevenueCat SDK + the NativePaywall sell Pro
  in-app per the 4th rejection's 3.1.1/3.1.3(b) demand, and apps.apple.com is
  allow-listed in the ExternalPurchase plugin so "Manage subscription" opens
  the App Store's subscription page — in build 8 that button was silently
  dead. Build 8 was uploaded but never submitted; build 7 was the rejected
  external-link-only attempt. Availability remains United States only.)
