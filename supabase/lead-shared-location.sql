-- ── A contact's exact location, when THEY chose to share it ──────────────────
-- APPLIED TO PRODUCTION 2026-10-18 (Supabase MCP, project grxmovpmlgmjncnyiyrt).
-- Idempotent (IF NOT EXISTS throughout), safe to re-run.
--
-- Owner, 2026-10-18 (feature 4 of 4): the only exact location a card owner
-- can ever have is one the visitor hands over. The three share-your-info forms
-- carry an optional, off-by-default "Add my current location"
-- (components/ShareLocationToggle); tapping it is what makes the phone ask, and
-- a "no" still sends the form. These columns hold what was shared, on that one
-- contact only:
--
--   shared_lat / shared_lng   rounded to 6 places (~10 cm — finer than any
--                             phone actually knows; the accuracy says how sure)
--   shared_accuracy_m         the phone's own radius for it, in metres
--   shared_location_at        when the LATEST location was shared
--   shared_location_first_at  when the first one was — set once, at capture, so
--                             a later share from the same person (which
--                             replaces the point) cannot erase that the first
--                             visit shared one too (Recent visits)
-- Both are the moment on the visitor's phone: an offline share replayed later
-- carries its X-SC-Queued-At time, not the time it finally arrived.
--
-- Read only on Pro: the Contacts page withholds the coordinates from a Free
-- account on the server (app/contacts/page.tsx), exactly like `location`.
-- api/leads degrades without these columns — a lead is never lost to them.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS shared_lat double precision;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS shared_lng double precision;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS shared_accuracy_m integer;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS shared_location_at timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS shared_location_first_at timestamptz;
UPDATE leads SET shared_location_first_at = shared_location_at
  WHERE shared_location_at IS NOT NULL AND shared_location_first_at IS NULL;
