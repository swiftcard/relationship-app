-- ── Card Builder: richer previews, drafts and sources (2026-11-11) ─────────
-- Run once in the Supabase SQL editor, after supabase/prospect-previews.sql.
--
-- WHAT: more of the prospect on their preview (headshot, address, website,
-- social links, a one-line specialty), a DRAFT status that the public link
-- never serves, and for every researched fact the page it came from.
--
-- SAFE: additive only. New nullable columns (or ones with a default) on
-- prospect_previews, and one more allowed value ('draft') for its status.
-- No existing row's data changes: every preview made before this stays live.
-- IDEMPOTENT: every statement can be run again.
--
-- ROLLBACK: the new columns can simply be left; nothing else reads them.

alter table public.prospect_previews add column if not exists headshot_url text;
alter table public.prospect_previews add column if not exists address      text;
alter table public.prospect_previews add column if not exists website      text;
-- { "linkedin": "https://…", "instagram": "https://…", … }
alter table public.prospect_previews add column if not exists social_links jsonb not null default '{}'::jsonb;
alter table public.prospect_previews add column if not exists specialty    text;
-- { "<fact>": { "url": "https://…", "uncertain": false, "note": "…" }, … }
alter table public.prospect_previews add column if not exists sources      jsonb not null default '{}'::jsonb;

-- team_members entries may now carry "headshot": "https://…" (jsonb, no change needed).

alter table public.prospect_previews drop constraint if exists prospect_previews_status_check;
alter table public.prospect_previews add constraint prospect_previews_status_check
  check (status in ('draft', 'live', 'paused'));
