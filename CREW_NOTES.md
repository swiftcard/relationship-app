# CREW_NOTES

Finding: `profile-save-speed: save took 5271ms (budget 4000)`, from nightly-flows.

I changed no code. The finding was seen once, on 2026-10-20, and I couldn't reproduce it or point to a root cause.

- `scripts/qa-flows.mjs` already notes that cold production functions have been slow here before (2026-09-11). A single 5.2s sample against a 4s budget fits a cold start or a slow Supabase round trip.
- `PATCH /api/profile` (`src/app/api/profile/route.ts`) makes about 5 sequential awaits: `getUser`, the plan row select, `getOfficeSubUserContext`, `getMemberBrandForUser` and the admin update. That is a possible speedup. Parallelising them risks changing the auth and plan-gating order, and nothing shows it caused this slow save.
- Recommendation: wait for a second occurrence. If it repeats, time each step inside the handler to find the slow one. Don't change the handler without that evidence.
