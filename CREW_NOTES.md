# CREW_NOTES

No code changed.

**Finding:** the nightly sweep flags `http-404 GET /api/link-icon?host=coastlinehomes.com` on the d-testimonials screen.

**What I found:** the 404 is deliberate. `src/app/api/link-icon/route.ts` returns 404 when a site has no usable icon. Google, the site's own icon and the parent domain are all tried first. The callers (`LinkMark`, `faviconFor`) then paint a monogram or link glyph. This is documented in the route header and pinned by `tests/link-preview-default.test.ts` ("a real 404 when a site has no logo"). Changing the status to 200 would bring back the grey-globe bug that route was written to fix.

**Root cause:** `scripts/qa-sweep.mjs` counts every 4xx as a failure. It has no allowance for `/api/link-icon`, which is an expected 404. `coastlinehomes.com` is a placeholder demo domain, so it will never have an icon.

**Suggested fix (needs a human, because `scripts/` is off-limits to me):** in `scripts/qa-sweep.mjs`, ignore 404 responses whose path is `/api/link-icon` when counting http errors. Keep 5xx failures.
