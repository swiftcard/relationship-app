-- ── Visit details: the device, how long the visit stayed, whose network ──────
-- APPLIED TO PRODUCTION 2026-10-18 (Supabase MCP, project grxmovpmlgmjncnyiyrt).
-- Idempotent (IF NOT EXISTS throughout), safe to re-run. Nothing in the app
-- REQUIRES it: the ingest route, the dwell endpoint and the dashboard all
-- degrade on 42703/PGRST204 exactly like record-view.ts does for device_key —
-- until it is applied, Android visits read "Android phone" and no visit shows a
-- duration.
--
-- Owner, 2026-10-18: every view should say what it was opened on, where it
-- came from, how long it stayed and what the visitor did. Most of that was
-- already on the viewed_card row (device_info is the User-Agent, referrer_url
-- the page that linked to it) and is only READ differently now
-- (lib/visit-device.ts). Three things were not:
--
--   device_model / device_os  The model and OS version a Chromium browser
--                             reports through Client Hints. Chrome on Android
--                             stopped putting them in the User-Agent ("Android
--                             10; K"), so without these every Android phone is
--                             just "Android phone". Bounded strings, display
--                             only, never an identity.
--   duration_s                How long the page was actually ON SCREEN, sent by
--                             the page when the visitor leaves
--                             (/api/card-events/dwell). Capped at 30 minutes and
--                             never longer than the time since the view was
--                             recorded, so it cannot be inflated from outside.
--
--   network_org               The organisation whose OWN network the visit came
--                             from ("Columbia University", lib/work-network.ts),
--                             from the same IP lookup the location already
--                             makes. Never an internet provider, carrier, cloud
--                             or VPN, never the IP itself. Pro-only to read.
--
-- Nullable, no defaults, no backfill: a visit from before this simply has no
-- duration, and the dashboard says nothing rather than a guess.

ALTER TABLE card_events ADD COLUMN IF NOT EXISTS device_model text;
ALTER TABLE card_events ADD COLUMN IF NOT EXISTS device_os text;
ALTER TABLE card_events ADD COLUMN IF NOT EXISTS duration_s integer;
ALTER TABLE card_events ADD COLUMN IF NOT EXISTS network_org text;

-- The dashboard's "Recent visits" reads one card's newest events in a window.
-- card_events_owner_idx alone makes that a sort of every event the card has.
CREATE INDEX IF NOT EXISTS idx_card_events_owner_created
  ON card_events (card_owner_username, created_at DESC);
