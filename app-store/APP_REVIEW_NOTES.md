# App Review Notes (paste into App Store Connect → App Review Information → Notes)

_Also see REVIEWER_DEMO_ACCOUNT_TEMPLATE.md for the credentials block._

> **Why this was rewritten.** The previous version said, in consecutive
> sentences, "the app neither sells, prices, nor links to any purchase flow
> (Guideline 3.1.1 — nothing is unlocked in-app)" and "the demo account is
> pre-upgraded to the Pro tier so every feature is visible." The reviewer read
> the claim, signed into a Pro account, followed our own test script through
> Pro-only features, and rejected 1.0.0 (3) under 3.1.1. We supplied the
> evidence against ourselves. Keep this section honest and internally
> consistent — if the app changes, change these notes in the same commit.

```
SwiftCard is the iPhone app for SwiftCard (swiftcard.me), a digital business
card + lead-capture service. The app is for managing your own account: your
cards, the people who shared their details with you, follow-ups, and analytics.

WHAT CHANGED SINCE 1.0.0 (3)
This build responds to all three items in the previous review.

1) Guideline 3.1.1 — In-App Purchase
   You noted the app accesses paid content that isn't purchasable in-app. We
   have added the external purchase link your message described. Wherever a
   paid feature is gated, the app now shows a "Subscribe on swiftcard.me"
   button that opens the DEFAULT BROWSER (UIApplication.open — not an in-app
   web view) to our checkout. Per Guideline 3.1.1(a), no entitlement is
   required for this on the United States storefront.
   The app's availability has been changed to the United States only, so this
   purchase path is never offered in a storefront where it isn't permitted.
   To see it: sign in with the FREE demo account below and tap any locked
   feature — for example Contacts → Add contact → "Scan a business card".

2) Guideline 2.1 — you asked: "Will the contacts data be uploaded to any
   server?"
   The device's address book is never accessed, uploaded, or read. The app
   does not link the Contacts framework and Info.plist contains no
   NSContactsUsageDescription, so iOS would not permit it.
   "Contacts" inside SwiftCard means something different: they are leads the
   user collected through their own digital business card — people who chose
   to fill in the "Share your info" form on that card. Those records are
   created on our servers in the first place; they are the product. Nothing is
   copied from the phone.

3) Guidelines 5.1.1(i) and 5.1.2(i) — third-party AI
   Correct, and now fixed. Before any data reaches an AI service the app shows
   a notice that names the recipient (Google), itemises exactly what is sent
   (a photo of a business card when scanning; a contact's name, company, where
   you met and your notes when drafting a follow-up; messages typed to the
   in-app assistant), and offers "Allow" and "Don't allow".
   "Don't allow" is enforced on the server, not just in the UI: a declined
   account is refused by the scanner, follow-up drafts, sequence generation and
   design-rebuild endpoints before any payload is built. The privacy policy at
   swiftcard.me/privacy names Google and lists the same four data paths.
   To see it: sign in with either demo account and open Contacts.

PURCHASES
Subscriptions (Pro, and Office for teams) are sold on swiftcard.me and are
also reachable from the app via the external purchase link described above,
which opens the default browser. The app itself contains no in-app purchase
and no embedded checkout.

DEMO ACCOUNTS — please use the FREE one first
The free account shows the app in its normal, default state, including the
plan gates and the purchase link. The Pro account is provided so every feature
can be exercised without payment.

HOW TO TEST THE MAIN FLOWS
1. Sign in with a demo account below (or create a fresh free account —
   email/password, Google, and Apple all work).
2. Dashboard: the demo card is populated. Tap Share → QR / Wallet / share sheet.
3. Open the public card: visit the demo card's link from the share sheet —
   it opens inside the app via universal link. A "Report this card" link
   sits at the bottom of every public card (our UGC reporting mechanism;
   reports go to hello@swiftcard.me and are handled within one business day;
   our admin console can take any reported card offline).
4. Lead capture: on the public card, tap "Share your info back" and submit —
   the contact appears in the app's Contacts with tags/reminders, and (if
   push is enabled) a notification arrives.
5. AI notice + card scanner: Contacts → Add contact → "Scan a business card".
   On the FREE account this shows the plan gate and the purchase link; on the
   PRO account the camera opens (permission is requested only at that point).
   The AI notice appears once, before the first AI feature is used.
6. Analytics: Dashboard → Analytics shows views/sources for the demo card.
7. Account deletion: Settings → Advanced account settings → Delete account
   (survey → typed DELETE confirmation → password re-check). Data is held 30
   days for account recovery, then permanently purged, as disclosed in-app
   and in the privacy policy.

WHY IT'S MORE THAN A WEBSITE
- Sign in with Apple and Google run in the system browser sheet and return to
  the app; sessions persist natively.
- Push notifications: enable in Settings → Notifications; capturing a lead on
  your card produces a real APNs notification that deep-links to the contact.
- Apple Wallet: Dashboard → Share → "Add to Apple Wallet" produces a signed
  pass with your live QR code, which updates in place when the card changes.
- Native share sheet, camera-based paper-business-card scanning, home-screen
  QR widget (swiftcard.me links, including public cards, always open in
  Safari, never inside the app),
  offline launch fallback.

PERMISSIONS USED
Camera (scan paper business cards), Photo Library (choose a card photo/logo),
Notifications (lead alerts, opt-in via an in-app toggle). No Contacts access.
No tracking; no ATT prompt (we have no ad SDKs and do no cross-app tracking).

TEAMS ("Office") ACCOUNTS
Companies buy team plans on swiftcard.me. In the app, team members sign in and
use their organization-assigned cards. Seat management and team billing are
website-only — Apple subscriptions have no per-seat quantity, so that plan is
not offered through the app at all.
```

## Contact fields

- First name / Last name: Menash Harooni
- Email: menashharooni@gmail.com
- Phone: (owner fills in — required field)

## Demo account credentials (paste into App Review Information)

Created by `node scripts/create-apple-review-account.js`. Passwords are printed
once at creation and stored nowhere else — keep them in the password manager.

| Tier | Email | Persona |
|---|---|---|
| **Free** (give this one first) | `applereview-free@swiftcard.me` | Sam Okafor, Harbor & Oak Realty |
| Pro | `applereview@swiftcard.me` | Alex Chen, Northbeam Studio |

App Store Connect accepts one username/password pair. Put the **Free** account
in those fields and give the Pro credentials in the notes text, so the reviewer
starts in the app's default state.
