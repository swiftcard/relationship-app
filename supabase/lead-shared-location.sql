-- ── REMOVED: a contact's visitor-shared exact location ───────────────────────
-- Added 2026-10-18 (e7a3087c) as an optional "Add my current location" switch
-- on the share-your-info forms; removed the same day on the owner's word — he
-- wanted location from what a visit already reveals, never by asking the
-- visitor. No contact ever used it (0 rows with a location), so the columns go
-- with it and nothing is lost.
--
-- Idempotent (IF EXISTS throughout), safe to re-run. Every reader and writer
-- that used these columns has been removed from the app.

ALTER TABLE leads DROP COLUMN IF EXISTS shared_lat;
ALTER TABLE leads DROP COLUMN IF EXISTS shared_lng;
ALTER TABLE leads DROP COLUMN IF EXISTS shared_accuracy_m;
ALTER TABLE leads DROP COLUMN IF EXISTS shared_location_at;
ALTER TABLE leads DROP COLUMN IF EXISTS shared_location_first_at;
