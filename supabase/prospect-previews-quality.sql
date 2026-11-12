-- ── Card Builder: personalization and the "too generic" gate (2026-11-12) ───
-- Run once in the Supabase SQL editor, after supabase/prospect-previews-call.sql.
--
-- WHAT: what makes a preview about THIS office and nobody else: the verified
-- specifics we found (a listing, a sale, an award, each with its source and
-- date), the hook built on one of them, the licence line and type feel of
-- their own card, what they use today to share contact details, and the
-- owner's override of the quality gate.
--
-- SAFE: additive only. Nine new columns on prospect_previews, nullable or
-- with a default. No existing row's data changes.
-- IDEMPOTENT: every statement can be run again.

alter table public.prospect_previews add column if not exists license             text;
alter table public.prospect_previews add column if not exists type_feel           text;
alter table public.prospect_previews add column if not exists current_tool        text;
alter table public.prospect_previews add column if not exists specifics           jsonb not null default '[]'::jsonb;
alter table public.prospect_previews add column if not exists hook_specific       smallint;
alter table public.prospect_previews add column if not exists hook_angle          text;
alter table public.prospect_previews add column if not exists hook_why            text;
alter table public.prospect_previews add column if not exists quality_override    boolean not null default false;
alter table public.prospect_previews add column if not exists quality_override_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'prospect_previews_type_feel_check') then
    alter table public.prospect_previews add constraint prospect_previews_type_feel_check
      check (type_feel is null or type_feel in ('sans', 'serif'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'prospect_previews_current_tool_check') then
    alter table public.prospect_previews add constraint prospect_previews_current_tool_check
      check (current_tool is null or current_tool in ('paper', 'link_in_bio', 'popl', 'linq', 'blinq', 'hihello', 'dot', 'other_digital'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'prospect_previews_hook_angle_check') then
    alter table public.prospect_previews add constraint prospect_previews_hook_angle_check
      check (hook_angle is null or hook_angle in ('views', 'departures', 'open_house'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'prospect_previews_hook_specific_check') then
    alter table public.prospect_previews add constraint prospect_previews_hook_specific_check
      check (hook_specific is null or (hook_specific between 0 and 5));
  end if;
end $$;
