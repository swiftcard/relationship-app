# Google Play listing: SwiftCard for Android

Everything Play Console asks for before "Send for review", ready to paste.
Package `me.swiftcard.app`, version 1.0.0 (versionCode 1). The Android app is a
Capacitor shell over swiftcard.me, like the iPhone app (see
`tests/android-shell.test.ts` for the rules it must keep).

**Nothing here is submitted.** Sending the release for review is Menash's call.

## Build

```
npm run android:release          # signed .aab → android/build/release/
npm run android:release -- --apk # plus a signed .apk to sideload on a phone
```

Signed with the UPLOAD key in `~/.swiftcard/android/` (created 2026-09-30).
Enrol in **Play App Signing** on the first upload (the default), so Google holds
the app signing key and a lost upload key can be reset. Back up
`~/.swiftcard/android/` anyway.

## Assets (`android/store/`, plus the phone screenshots)

| Play Console field | File |
|---|---|
| App icon, 512 × 512 | `android/store/play-icon-512.png` |
| Feature graphic, 1024 × 500 | `android/store/feature-graphic-1024x500.png` |
| Phone screenshots, 1080 × 2160 | `app-store/screenshots/play-phone-v1/` (`scripts/playstore-compose.mjs`) |

The launcher icon and splash in the app are the same SwiftCard tile and the same
launch image as the iPhone app.

## Store listing

**App name** (30): `SwiftCard: Business Card` (same as the App Store; "SwiftCard: Digital Business Card" is 32 and Play refuses it)

**Short description** (80):
```
Share your business card by QR, NFC or link. Capture every contact you meet.
```

**Full description** (4000). Deliberately different from the App Store text:
- nothing iPhone-only (Apple Wallet, the home-screen widget, the Apple Watch),
- no prices, no Pro plan and no purchase wording, because the Android app sells
  nothing and Play's payments policy forbids pointing to outside payment, and
- push notifications are live on Android since 2026-10-01 (FCM configured in production), so the card-view notification is claimed; "verified delivery on a real device" is still not claimed anywhere.

```
SwiftCard turns your business card into a link. Share it with a QR code, an NFC card or a text. The other person opens it on their phone and saves you in one tap. No app needed on their end.

Everything you need to meet people and follow up, in one place:

YOUR DIGITAL BUSINESS CARD
Build a card with your photo, logo, title, phone, email and website. Pick a design or customize the colors and fonts. Share it by link, QR code or NFC tag. Edit it any time. Every QR code and NFC card you've already handed out keeps working, because they point to your link, not a copy.

SWIFT LINKS: YOUR LINK-IN-BIO PAGE
Every card comes with a Swift Links page: your photo, bio, social icons, video previews and custom buttons on one page. Put it in your Instagram, TikTok or LinkedIn bio.

SWIFT SIGNATURE: YOUR CARD IN EVERY EMAIL
Turn your card into an email signature for Gmail and Outlook in two taps.

CAPTURE EVERY CONTACT
When someone opens your card, they can share their name, email and phone back to you. Everyone lands in your Contacts with notes, tags and follow-up status. A simple CRM built for real-world networking.

SEE WHO'S LOOKING
Get a notification the moment someone views your card. See how many people opened it, where they were, and which day was your best.

WORKS WITH YOUR CRM
Send every new contact to HubSpot, Salesforce, HighLevel, Pipedrive or Google Contacts automatically, or connect anything else with Zapier.

FOR TEAMS
SwiftCard Office gives every employee an on-brand card, with shared contacts and team-wide analytics.

Free to start with one card, your Swift Links page, Swift Signature, and your first contacts.

Terms of Use: https://swiftcard.me/terms
Privacy Policy: https://swiftcard.me/privacy
```

**Category:** Business. **Tags:** Business cards, Contacts, Networking.
**Contact email:** hello@swiftcard.me. **Website:** https://swiftcard.me.
**Privacy policy URL:** https://swiftcard.me/privacy.

## App content (the Policy → App content forms)

- **Privacy policy:** https://swiftcard.me/privacy
- **Ads:** No, the app contains no ads.
- **App access:** Restricted. Give the same demo account as App Review
  (`docs/ios-review/APP-STORE-METADATA.md` → App Review Information). Paste
  the account into Play Console yourself; it is never written into this repo.
- **Content rating (IARC questionnaire):** category *Utility, Productivity,
  Communication or other*. Answer No to violence, sexuality, language,
  controlled substances, gambling and horror. User interaction: users can share
  their contact details with each other (Yes to "shares user-provided
  information"), no open chat, no location sharing, no digital purchases in the
  app. Expected result: Everyone / PEGI 3.
- **Target audience:** 18 and over (a business tool; not designed for children).
- **News app:** No. **COVID-19 app:** No. **Government app:** No.
- **Financial features:** None.
- **Health:** None.
- **Data safety:** see the next section.

## Data safety

Source of truth: `app-store/APP_PRIVACY_DISCLOSURE_MATRIX.md`. Play's categories
differ from Apple's, so this is the translation.

- Does the app collect or share user data? **Yes, collects.**
- Is all data encrypted in transit? **Yes** (HTTPS only).
- Can users request deletion? **Yes**: in the app (Settings → delete account)
  and at https://swiftcard.me/privacy. Deletion page URL for the web form:
  https://swiftcard.me/privacy.
- **Shared** with third parties: **No.** Every processor (Supabase, Vercel,
  Resend, Twilio, Stripe on the web only) acts on SwiftCard's behalf, which
  Play's definition excludes from "sharing".

| Play data type | Collected | Optional? | Purpose |
|---|---|---|---|
| Personal info → Name | Yes | Required | App functionality, Account management |
| Personal info → Email address | Yes | Required | App functionality, Account management |
| Personal info → Phone number | Yes | Optional | App functionality |
| Personal info → Address | Yes | Optional | App functionality |
| Personal info → User IDs | Yes | Required | App functionality, Account management |
| Photos and videos → Photos | Yes | Optional | App functionality |
| Contacts (people who share their details on your card) | Yes | Optional | App functionality |
| App activity → App interactions (card-view analytics) | Yes | Required | Analytics, App functionality |
| App info and performance | **No** (no crash SDK; Firebase Analytics is OFF) | | |
| Location | **No.** Card-view places come from IP geolocation on the server, never the device | | |
| Device or other IDs (FCM push token) | Yes | Required | App functionality (delivering notifications) |
| Financial info | **No** (no purchases in the Android app) | | |

Do **not** declare Analytics under Firebase: the Firebase project
(swiftcard-2cc87) has Google Analytics switched off.

## Review notes (Play Console → App access instructions box)

```
SwiftCard is a digital business card app. Sign in with the demo account above.
From the dashboard: open "Share" to show the card's QR code or send it through
the Android share sheet; open "Edit card" to change details; open "Contacts" to
see people who shared their details back. Card and link-in-bio pages open in
the device browser by design, so the person you meet never needs the app.
The app contains no purchases.
```

The Play reviewer may test for policy 4.3-style "webview wrapper" rejection.
The native parts to name if asked: the native splash, the Android share sheet,
the hand-off of card links to the browser, and push notifications (FCM, live since 2026-10-01).
live.

## Open items (Menash's)

1. **Play developer account.** $25 one-time at play.google.com/console under
   hello@swiftcard.me, as an **Organization** (Swift Card Inc.). Needs a D-U-N-S
   number. A personal account would first have to run a 12-tester, 14-day
   closed test before production.
2. ~~**FCM server credential.**~~ DONE 2026-10-01 (key for swiftcard-2cc87 only; org policy overridden per-project). The swiftcard.me Google Cloud org blocks
   service-account key creation, so `FIREBASE_PROJECT_ID`,
   `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` don't exist on Vercel and
   Android push sends nothing (`src/lib/fcm.ts` returns not_configured). Lift
   the org policy `iam.disableServiceAccountKeyCreation` for this project, or
   use Workload Identity. Until then the listing makes no push claim.
3. **After the listing is live:** set `NEXT_PUBLIC_PLAY_STORE_URL` on Vercel to
   `https://play.google.com/store/apps/details?id=me.swiftcard.app` and
   redeploy. Every Google Play badge on the site turns on by itself. Then
   update the knowledge base (`src/lib/knowledge/docs/marketing-site.ts`
   "Is there an iOS/Android app?", and product.ts's "no Android version").
