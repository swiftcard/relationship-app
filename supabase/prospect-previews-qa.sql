-- ── Card Builder: a preview made by the automated test (2026-11-15) ─────────
-- APPLIED TO PRODUCTION 2026-11-15 (Supabase MCP).
--
-- WHY: the owner asked for Card Builder to be tested end to end on every
-- deploy (scripts/qa-card-builder.mjs): a preview is opened in a signed-out
-- browser, the view is counted, the alert fires, the button books a call.
-- Without this column that test would ring the owner's phone on every deploy.
--
-- alert_user_id   NULL on every real preview. When set, the "is viewing their
--                 card" and "meeting booked" pushes go to that ONE account
--                 instead of every admin (lib/prospect-preview/alert.ts). It
--                 can only narrow who is told, never widen it. Nothing in the
--                 app writes it: only the test, with the service key, on the
--                 throwaway preview it deletes afterwards.
--
-- ROLLBACK: alter table public.prospect_previews drop column if exists alert_user_id;

alter table public.prospect_previews add column if not exists alert_user_id uuid;
