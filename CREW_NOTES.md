# CREW_NOTES

No code changed. I could not find a safe fix for this finding.

**Finding:** the nightly sweep (m-product-cards) logged `http-404 GET /api/link-icon?host=coastlinehomes.com`. It was seen once, on 2026-10-23.

**What I found:**
- `src/app/api/link-icon/route.ts` returns 404 on purpose when a site has no usable icon. The icon lookup tries Google, then the site's own icon, then the parent domain. If none of them gives a real logo, it returns 404.
- Callers rely on that 404 to show their monogram, emoji or link glyph instead. The header comment in the route explains why: Google's "no icon" answer is a 200-style globe image, and browsers load it without firing `onError`.
- I could not run a request, so I did not confirm that coastlinehomes.com has no icon. A 404 is the expected result if it doesn't, or if the lookup timed out. Timeouts are cached as `RETRY` (10 minutes).
- Changing the route to return 200 would break the monogram fallback.

**Likely root cause:** the sweep counts any 4xx on a subresource as a failure. It doesn't treat `/api/link-icon` 404s as expected. The sweep lives in `scripts/`, which I'm not allowed to edit.

**Suggested follow-up for the owner:** make the sweep ignore 404s on `/api/link-icon` (the other 4xx and 5xx statuses should still count). Alternatively, confirm that coastlinehomes.com really has no icon. Because this was seen only once, it may also have been a transient timeout.
