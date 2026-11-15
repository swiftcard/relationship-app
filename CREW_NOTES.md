# Crew notes: `new-tab-stays-in-app` (Android shell, pixel-8 free, View live)

No code changed. I found no safe fix and could not run anything to reproduce it.

## What the finding says
`scripts/qa-android-shell.mjs` clicked the dashboard's "View live" link, waited 2.5 s, and saw no
`ExternalPurchase.open` call. The href was `/api/self-view?to=/qa-and-free-<n>&t=<token>`.
It was seen once, on the nightly run of 2026-10-20, and has not recurred in the data I was given.

## What I checked
- `/api/self-view` (`src/app/api/self-view/route.ts`) redirects with 303 to the card path.
  `selfViewTarget` accepts the slug `qa-and-free-<digits>`, so it does not fall back to `/`.
- The hand-off to the browser is in `src/components/NativeAppBridge.tsx` (`bounceIfPublic`). When the
  webview lands on a page carrying the public-page `<meta>`, it calls `openLinkInDefaultBrowser`, which
  calls `ExternalPurchase.open`. The Android plugin allows `swiftcard.me` and `www.swiftcard.me`.
- The `<meta>` is streamed into the body after the page resolves. Right after a deploy, a cold card
  page can take longer than the script's fixed 2.5 s wait, so a single miss looks like a timing flake.
  That is a guess; I have not confirmed it.

## Suggested next step
If it recurs on more than one night, replace the fixed `waitForTimeout(2500)` in
`scripts/qa-android-shell.mjs` (around line 223) with a poll for an `ExternalPurchase.open` call, about
10 s. I was told not to edit `scripts/`. If it keeps failing with a longer wait, the real bug is in the
redirect and meta path above.
