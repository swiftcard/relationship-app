# CREW_NOTES: /api/link-icon 404 for coastlinehomes.com

No code changed.

`src/app/api/link-icon/route.ts` returns 404 on purpose when a host has no usable icon. It tries Google's favicon, then the site's own icon, then the parent domain's icon. A 404 tells callers to paint their monogram or glyph fallback. Its header comment says so, and `faviconFor` in `lib/link-brand` depends on it.

The nightly sweep (`scripts/qa-sweep*`) treats every 4xx as a failure. It has no exemption for `/api/link-icon`, since a grep of `scripts/` finds no mention of it. So a business site with no icon, coastlinehomes.com here, shows up as a bug when it is the designed fallback.

I did not change the route, because answering 200 or 204 would break the `onError` fallback in every surface that shows link icons. The right fix is in `scripts/`, which I may not edit. The sweep's "http-4xx" check should skip `GET /api/link-icon` 404s. The same applies to the other image-fallback routes, if the sweep flags them.

Alternatively, change the seeded test data so no card links to an icon-less host. I did not look at the seed data.

I did not reproduce the 404 against the live site, because I can't run commands here.
