# CREW_NOTES

Finding: nightly sweep `d-product-cards: http-404 GET /api/link-icon?host=coastlinehomes.com`

## What I found
- `src/app/api/link-icon/route.ts` returns 404 on purpose when neither Google, the site's own icon nor the parent domain has a real logo. Callers (`LinkMark`, `faviconFor` users) rely on that status to fall back to a monogram. `tests/link-preview-default.test.ts` ("a real 404 when a site has no logo") pins it, and the route comment documents it.
- coastlinehomes.com is the sweep's seeded demo account's website. It is a fake domain, so it has no icon and the 404 is the correct answer, not a product bug.
- The noise comes from `scripts/qa-sweep.mjs` (response listener, ~line 267-275). It reports every same-origin 4xx except 401/403 and document-type expected 404s, so a deliberate image 404 from `/api/link-icon` is flagged.

## Why no code change
- Changing the route to return 200 would break the monogram fallback and its pinned test.
- The right fix is a one-line exemption in `scripts/qa-sweep.mjs`, which I am not allowed to edit. Suggested edit, next to the existing 401/403 line:
  `if (r.status() === 404 && u.startsWith(BASE + "/api/link-icon")) return;  // "this site has no logo" is the designed answer; callers paint a monogram`
  `qa-prod-probe`/`qa-android-shell.mjs` may want the same.
- Owner action needed to apply that edit.
