# CREW_NOTES: /api/link-icon 404 for coastlinehomes.com

No code changed.

`src/app/api/link-icon/route.ts` returns 404 on purpose when a site has no usable icon. That is documented in the file header. Google has no icon, the site's own icons are missing or under 16px, and the parent domain has none. Callers rely on the failed image load (`onError`) to paint the monogram or emoji. Returning 200 with a placeholder would bring back the grey-globe bug the route was written to fix. Returning 404 for a host with no icon is correct behaviour, not a product defect.

The failure comes from the nightly sweep (`scripts/qa-sweep`), which counts any 4xx on `/api/link-icon` as an error. The fix belongs there. It should ignore 404 on `/api/link-icon`, which is an expected "no icon" answer. Another option is to stop seeding `coastlinehomes.com` as a link host in the m-home fixture. I can't edit `scripts/`, so this needs the owner or a session allowed to touch it.

I could not reproduce this, since I can't run commands. Two things are still worth checking:
- Whether `coastlinehomes.com` has an icon at all. If it does and the route still 404s, the cause is on the fetch side (safeFetch, timeouts or the sharp decode), and the route needs a closer look.
- The `NONE` and `RETRY` cache headers. A transient failure answers 404 with `RETRY` rather than a 5xx, so the sweep can't tell the two cases apart.
