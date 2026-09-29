# TestFlight / Device Test Plan

_The shell has NEVER been built or run on a device. This plan is the mandatory
gate between "code ready" and "submit". Run on a real iPhone (not only
simulator — Wallet, push, camera, and universal links need hardware)._

## Device matrix

| Config | Required |
|---|---|
| Current iPhone (6.9-inch class), latest iOS | ✅ |
| Small iPhone (SE/mini class) | ✅ |
| iPad | Only if the app record enables iPad |
| Light + dark mode | ✅ both |
| Large text (Dynamic Type XL) | ✅ |
| Clean install + upgrade install | ✅ both |
| Airplane mode launch | ✅ |

## P0 — must pass before submission

Auth
- [ ] Email/password sign-in and sign-out; session survives force-quit + relaunch.
- [ ] Google sign-in: opens the SYSTEM browser sheet (not the webview),
      completes, returns via swiftcard:// and lands signed in. (Google blocks
      embedded webviews — if the sheet doesn't appear, stop and debug.)
- [ ] Apple sign-in: same round-trip (requires the Supabase provider — runbook §4).
- [ ] Apple sign-in with "Hide My Email": account created, relay email shown
      in settings; confirm a lead notification email actually arrives (needs
      the Apple email-relay domain registration).
- [ ] Cancel mid-OAuth (dismiss the sheet): app stays on login, no stuck spinner.
- [ ] Password reset from the login screen completes.
- [ ] Fresh account creation → onboarding → dashboard.
- [ ] Guest card creation (logged out) → sign up → draft attaches to the new account (consent prompt shown).

Selling suppression (walk EVERY one)
- [ ] Dashboard: no "Keep Pro", no upgrade CTA anywhere.
- [ ] Settings: no Plan & billing section.
- [ ] /pricing, /upgrade, /checkout typed via any in-app link: bounce to
      dashboard/login with NO price flash.
- [ ] Card wizard (new card as guest and as free user): free-only plan step.
- [ ] Office admin (owner account): team page shows no seat price, no
      proration, no "lower my bill" after removing a member.
- [ ] AI assistant: ask "how do I upgrade?" → in-app answer refuses pricing
      and does not link the website.
- [ ] No sales chat bubble anywhere.

Core product
- [ ] Card edit: photo upload (photo library permission prompt appears HERE,
      not at launch), logo upload, template change, social links, save.
- [ ] A public card link (tapped in Messages / Notes, or "View Live Link") opens
      in Safari, never inside the app.
- [ ] "Report this card" link at the bottom of the public card opens the
      contact form pre-filled with the card URL.
- [ ] Lead capture on own card → contact appears in Contacts.
- [ ] Push: enable in settings (permission prompt), capture a lead, receive
      the notification, tap it → contacts screen. (Needs APNs key envs.)
- [ ] Card scanner: camera prompt on first use; scanning a paper card creates
      a contact.
- [ ] QR renders; "Download QR (PNG)" opens the NATIVE SHARE SHEET on device
      (native falls back to sharing the card link — verify it's the share sheet,
      not a dead tap). "Download card image" likewise shares the card link.
- [ ] **Save Contact (.vcf) — HIGH PRIORITY, was the known WKWebView risk:**
      on the public card AND in Contacts, tapping Save Contact must open the
      system browser sheet showing iOS's "Add to Contacts" preview (native
      routes to the `/api/card/<slug>/vcard` and `/api/leads/vcard` endpoints,
      NOT a Blob). Confirm the contact actually adds to iOS Contacts. If the
      SFSafariViewController shows the vCard but no Add-to-Contacts affordance
      on the target iOS version, escalate (may need @capacitor/filesystem +
      share-file). This is the single most important download to verify.
- [ ] **CSV export (Contacts + Office analytics) — was ungated in front of the
      Pro demo:** tapping Export CSV opens the system browser where the CSV is
      viewable/shareable (native routes through @capacitor/browser). Not a dead
      tap.
- [ ] Apple Wallet: add pass, pass shows the right card + QR; pass opens on
      Apple Watch Wallet. (Configured + verified live 2026-08-10: the endpoint
      serves a signed .pkpass and the uptime cron alarms if it regresses.)
- [ ] Swift Links page renders and edits.
- [ ] Email signature builder: copy works in the webview.
- [ ] Analytics screens render.
- [ ] Widget (target now ships in the binary): add from gallery, shows QR after
      opening the app signed-in, tap opens the app on the dashboard.
- [ ] Someone else's card link (Messages/Notes) with the app installed and
      signed in: opens in Safari, NOT inside the app.
- [ ] Account deletion end-to-end: survey → DELETE → password → signed out →
      /account-deleted state; log back in within window → reopen works.
- [ ] Office: invite acceptance via emailed link (opens in Safari → sign in /
      create account → join; then sign in to the app), member card creation,
      admin views work; member CANNOT
      delete account (clear block message); owner deletion shows the
      team-consequence warning.

Resilience
- [ ] Airplane-mode cold launch: offline fallback page, not a white screen.
- [ ] Kill network mid-session: sane error, recovers when back online.
- [ ] Expired session: redirected to login, not a broken state.
- [ ] Background 10+ min → foreground: state restores.
- [ ] External links on a card (social/websites) open OUTSIDE the app;
      swiftcard.me links stay inside.
- [ ] Keyboard: inputs not obscured; safe areas respected on notch/Dynamic
      Island; status bar legible in both modes.

## P1 — should pass

- [ ] Dynamic Type XL: no clipped/overlapping text on dashboard, settings, card.
- [ ] VoiceOver: login, dashboard tabs, share actions are labeled and operable.
- [ ] Reduce Motion: no parallax/spring animations (glass layer respects it).
- [ ] Landscape (if enabled): no broken layouts — or lock portrait in Xcode.
- [ ] Low battery / low data mode: no crashes.

## Recording results

Copy this file per device run: `TESTFLIGHT_RESULTS_<device>_<date>.md`, mark
each box, attach screenshots of failures. All P0 boxes must be checked on at
least the two required iPhones before submitting.
