// ── Tour storage keys and event names ───────────────────────────────────────
//
// Split out of lib/tour.ts so a module can know WHETHER a tour is running
// without pulling in the machinery that runs one. lib/tour.ts imports both step
// lists (~650 lines), so importing a single string from it used to drag the
// whole tour into any bundle that touched it — which is how the tour engine
// ended up on every public card page, for visitors who can never start a tour.
//
// Nothing here imports anything. lib/tour.ts re-exports all of it, so every
// existing `from "@/lib/tour"` import keeps working unchanged.

// sessionStorage — per-tab, cleared when the tour ends.
export const TOUR_RUNNING = "sc_tour_running";
export const TOUR_INDEX = "sc_tour_index";
export const TOUR_CARD = "sc_tour_card"; // the card slug to keep selected across pages

// localStorage — the account's plan/role, written by the dashboard so the tour
// (mounted globally, with no server data of its own) can describe the RIGHT
// plan. Persists across the tour's page navigations and between visits.
export const TOUR_CTX_KEY = "sc_tour_ctx";

// localStorage — persists so we don't nag a returning user.
export const TOUR_DONE = "sc_tour_completed";

// Events let an already-mounted tour host react instantly (no reload) when the
// tour is started or ended on the current page.
export const TOUR_START_EVENT = "sc:tour-start";
export const TOUR_END_EVENT = "sc:tour-end";

// ── Office Admin guided tour: same mechanics, separate state ────────────────
export const ADMIN_TOUR_RUNNING = "sc_admin_tour_running";
export const ADMIN_TOUR_INDEX = "sc_admin_tour_index";
export const ADMIN_TOUR_DONE = "sc_admin_tour_completed";
// Separate from DONE: DONE is only set when the tour is FINISHED, so gating the
// first-visit auto-start on it alone would re-launch the tour on every visit for
// anyone who skipped it. This records that we've offered it once, so the
// auto-start fires exactly once either way. Replaying via the "Take a tour"
// button is unaffected.
export const ADMIN_TOUR_SEEN = "sc_admin_tour_seen";
export const ADMIN_TOUR_START_EVENT = "sc:admin-tour-start";
export const ADMIN_TOUR_END_EVENT = "sc:admin-tour-end";
