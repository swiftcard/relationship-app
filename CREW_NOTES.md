# Crew notes: Android "View live" new-tab-stays-in-app

No code changed. I couldn't find a safe, verifiable root-cause fix, and I can't run anything here.

## What the finding says
`scripts/qa-android-shell.mjs` (~line 216-226) clicks the dashboard's "View Live Link"
(`<a target="_blank" href="/api/self-view?to=…&t=…">`, `src/app/dashboard/page.tsx:1062`).
It then waits 2.5 s and expects at least one `ExternalPurchase.open` native call.
It got none. The finding was seen once, with no recurrence.

## How the hand-off works today
There is no click interceptor. `NativeAppBridge.tsx` has no click handler. The chain is:
1. `target=_blank` loads `/api/self-view` inside the webview. The capacitor allow-list makes this a same-webview navigation.
2. The route 303-redirects to the card page.
3. The card page carries the `PUBLIC_PAGE_META` marker. `bounceIfPublic` (`NativeAppBridge.tsx:128`) sees it and calls `openLinkInDefaultBrowser(dest)`. The webview then goes back to `/dashboard`.

So the native call depends on the redirect, the page render, the streamed `<meta>` marker and a dynamic import all finishing within the harness's fixed 2.5 s. A slow production render on one nightly run would explain a single miss. A real regression would more likely fail every night.

## Things worth checking (not changed)
- **Self-pass dropped on hand-off.** `bounceIfPublic` hands the browser `dest`, the card path alone. The `/api/self-view?…&t=` token never reaches the browser. The owner's own "View live" can therefore be counted as a view in the external browser. This is a product bug separate from the QA failure. A fix would hand the original self-view URL out (for example, intercept the click and call `openLinkInDefaultBrowser(href path+query)`), but that changes behavior on both iOS and Android, so it needs reproduction and a render/flow test first.
- **QA harness.** The check reads `nativeCalls(page, …)` from the original page after the click. If the harness context opens a popup for `target=_blank`, the call would land on the popup and not be seen. `scripts/` is off-limits for this job.

## Recommendation
If the failure recurs on later nights, reproduce with `npm run qa:android-shell` against a production build. If it stays at one occurrence, treat it as a flake. A deterministic fix, if wanted, is a click handler in `NativeAppBridge` for owner self-view links. It needs a test in `tests/` and a knowledge-base check.
