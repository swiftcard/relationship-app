# CREW_NOTES: Android `new-tab-stays-in-app` (pixel-8-pro-view-live)

No code changed. I could not find a root cause I can fix safely without running anything.

## What the finding says
- Source: nightly-app. Seen once, on 2026-10-26 at about 20:45 UTC.
- `scripts/qa-android-shell.mjs:225` clicked the dashboard's "View live" link. The link was `/api/self-view?to=/<slug>&t=<token>`.
- It then waited a fixed 2.5s and saw no `ExternalPurchase.open` call recorded by the Capacitor shim.

## How the hand-off works (read from source)
1. The click loads `/api/self-view`, which sends a 303 redirect to the public card page (`src/app/api/self-view/route.ts`).
2. The card page carries the `PUBLIC_PAGE_META` marker.
3. `NativeAppBridge.bounceIfPublic` (`src/components/NativeAppBridge.tsx:128`) sees the marker and calls `openLinkInDefaultBrowser(dest)`. That goes through the `ExternalPurchase.open` plugin.
4. The app is then sent back to `/dashboard`.

## Why I made no change
- The `href` in the report is well-formed. The route, the self-pass token and the redirect target are all behaving as designed.
- The marker is only streamed into the body after the page resolves, per the comment at `NativeAppBridge.tsx:122`. `bounceIfPublic` runs on a MutationObserver, so a slow card render on production can push the `open` call past the harness's 2.5s `waitForTimeout`. That would look like this finding.
- A failure that happened once, 3 days ago, fits a timing flake better than a regression. I have no repro and no second sighting.
- Both candidate fixes are guesses I can't check here:
  - Loosening the harness is a change to `scripts/`, which I may not edit.
  - Changing the bridge's timing risks the iOS loop-protection (`handedOff`) and the "links never open in the app" rule.

## Suggested next step
- If it recurs, check whether the failing runs line up with a slow `/<slug>` response (the `health-check` speed budget would show it).
- If it does recur, replace the fixed 2.5s wait in `qa-android-shell.mjs` with a poll, for example `waitForFunction` on the recorded `open` call with a 10s timeout.
