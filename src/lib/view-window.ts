// ── What counts as ONE visit ─────────────────────────────────────────────────
//
// The same visitor touching the same card again inside this window is the same
// visit: a reload, a back-navigation, a double-fired tracker, a retried fetch.
// Beyond it, a return is a GENUINE REPEAT VIEW and records (and notifies) as
// its own event — an owner watching for repeat interest must see it.
//
// This one constant is shared by every layer that dedupes a view — the client
// tracker's re-fire guard, lib/record-view's row dedup, /api/card-events' event dedup
// (which is also what gates the owner's notification) — so "one visit" means
// the same thing everywhere and the dashboard, the CRM timeline, and the push
// can never disagree about whether a view happened.
//
// The card_views race-backstop unique index buckets on this same width
// (supabase/view-visit-window.sql) — change one, change both.
export const VIEW_VISIT_WINDOW_MS = 30 * 60 * 1000;
