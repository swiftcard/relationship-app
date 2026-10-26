# CREW_NOTES: /api/link-icon?host=coastlinehomes.com 404

No code changed.

**Finding.** The nightly sweep logged `d-home: http-404 GET /api/link-icon?host=coastlinehomes.com`. It was seen once, on 2026-10-23.

**Cause.** This is not a route bug. `src/app/api/link-icon/route.ts` returns 404 on purpose when a site has no usable icon. It tries Google, then the site's own icon, then Google for the parent domain. If all three fail, it returns 404 with `Cache-Control: NONE`. The callers (`faviconFor` in `lib/link-brand`) rely on that status. Their `onError` handler then paints the monogram, emoji or link glyph. The route's header comment explains this.

**Why I did not change the route.**
- Returning 200 with a placeholder would stop `onError` from firing. That brings back the grey-globe bug the route was written to fix.
- The 404 for coastlinehomes.com is probably legitimate: the site has no icon, or it blocked the fetch. I could not check this because I can't run commands.

**Likely fix.** The sweep (`scripts/qa-sweep*`) should treat a 404 from `/api/link-icon` as expected, the way it should for any "no icon" answer. Only a 5xx or a 400 would then count as a failure. `scripts/` is off-limits for this job, so the owner needs to make that change. If the sweep already ignores this route, check whether it is the 404 or the 429 rate-limit path that fires on the Home card list.
