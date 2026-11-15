# CREW_NOTES

No code changed.

Finding: `m-home: http-404 GET /api/link-icon?host=coastlinehomes.com` (nightly sweep, seen once).

What I found:
- `coastlinehomes.com` is the fictional demo brand used on the marketing home page (`DashboardDemo.tsx`, `DemoSwiftLinks.tsx`, `TeamsDashboard.tsx`). It has no real icon.
- `src/app/api/link-icon/route.ts` is designed to answer 404 when a site has no icon: "none → 404, and the caller paints its monogram / emoji / link glyph". The 404 is cached for a day, and the UI falls back correctly.
- The report comes from `scripts/qa-sweep.mjs` (line ~274). It records every 4xx response as `http-<status>` and only exempts the `/this-route-does-not-exist` document route.

Root cause: the sweep treats the route's intended "no icon" 404 as a defect. The route itself is behaving correctly.

Suggested fix, which I can't make because `scripts/` is off limits:
- In `scripts/qa-sweep.mjs`, skip `http-404` for image sub-requests to `/api/link-icon`. `isExpected404` could also accept `r.request().resourceType() === "image"` with a pathname of `/api/link-icon`.
- Changing the route to return a 200 placeholder would break the monogram fallback, because `onError` would never fire. I don't recommend it.
- Alternatively, the demo components could avoid requesting an icon for the fictional host. That is a larger change and not clearly needed.
