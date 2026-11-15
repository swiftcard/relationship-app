# CREW_NOTES: /api/link-icon?host=coastlinehomes.com 404 in the nightly sweep

No code changed. I found no safe fix inside the allowed paths.

## Findings
- `src/app/api/link-icon/route.ts` answers 404 on purpose when a host has no icon.
  Callers rely on that status so `onError` can paint the monogram or emoji
  (see the header comment in the route and `faviconFor` in `src/lib/link-brand.ts`).
- `coastlinehomes.com` is the fictional demo brokerage used in marketing demos
  (`DemoSwiftLinks.tsx`, `DashboardDemo.tsx`, `TeamsDashboard.tsx`, `card-templates/types.tsx`).
  It has no real site, so no icon exists. The 404 is the correct answer.
- The `m-product-cards` marketing page renders those demo links. The sweep sees an expected
  image 404 and records it as a failure.
- Nothing under `scripts/` mentions `link-icon`, so the sweep has no allowance for it.

## Why I did not fix it
- Returning 200 or a placeholder from the route would break the monogram fallback
  that the route and `link-brand` exist to provide.
- The sweep lives in `scripts/`, which I may not edit.
- Swapping the demo domain for a real one would be a content decision for the owner.

## Suggested fix (owner or a session allowed to edit scripts/)
Make the sweep's 4xx check ignore `GET /api/link-icon` 404s, since that is the documented
"no logo" signal. The alternative is to point the demo links at a host that really has an icon.
