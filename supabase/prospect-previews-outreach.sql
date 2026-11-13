-- ── Card Builder: outreach written per prospect, and the approval queue (2026-11-13) ──
-- Run once in the Supabase SQL editor, after supabase/prospect-previews-quality.sql.
--
-- WHAT:
--   outreach           the messages written for THIS prospect when the card was
--                      built (/build-card): first text, text with the link,
--                      email, call opener, voicemail script and two nudges.
--                      Null = none written; the screens fall back to the
--                      templates (lib/prospect-preview/messages.ts).
--   skipped_at         the owner pressed Skip in the Approve queue: the draft
--                      stays a draft and leaves the queue.
--   nudge_no_view_at   the "no view after 2 days" nudge went out (by hand).
--   nudge_viewed_at    the "viewed but didn't pick up" nudge went out (by hand).
--
-- "Confirmed by the owner" needs no column: it is a flag inside the existing
-- sources and specifics jsonb ({ "owner": true }).
--
-- SAFE: additive only. Four new nullable columns on prospect_previews. No
-- existing row's data changes.
-- IDEMPOTENT: every statement can be run again.
--
-- ROLLBACK:
--   alter table public.prospect_previews
--     drop column if exists outreach, drop column if exists skipped_at,
--     drop column if exists nudge_no_view_at, drop column if exists nudge_viewed_at;

alter table public.prospect_previews add column if not exists outreach         jsonb;
alter table public.prospect_previews add column if not exists skipped_at       timestamptz;
alter table public.prospect_previews add column if not exists nudge_no_view_at timestamptz;
alter table public.prospect_previews add column if not exists nudge_viewed_at  timestamptz;
