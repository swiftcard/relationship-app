-- ── Card Builder: the Call screen's brief (2026-11-11) ─────────────────────
-- Run once in the Supabase SQL editor, after supabase/prospect-previews-pipeline.sql.
--
-- WHAT: who the buyer is and why (a preview is only ever built for the person
-- who runs the team or office), how big the team is, the one specific thing
-- we found about them, and how the last call went.
--
-- SAFE: additive only. Six new nullable columns on prospect_previews. No
-- existing row's data changes.
-- IDEMPOTENT: every statement can be run again.

alter table public.prospect_previews add column if not exists buyer_role      text;
alter table public.prospect_previews add column if not exists buyer_reason    text;
alter table public.prospect_previews add column if not exists team_size       integer;
alter table public.prospect_previews add column if not exists detail          text;
alter table public.prospect_previews add column if not exists call_outcome    text;
alter table public.prospect_previews add column if not exists call_outcome_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'prospect_previews_buyer_role_check') then
    alter table public.prospect_previews add constraint prospect_previews_buyer_role_check
      check (buyer_role is null or buyer_role in ('broker_owner', 'managing_broker', 'team_lead', 'branch_manager'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'prospect_previews_call_outcome_check') then
    alter table public.prospect_previews add constraint prospect_previews_call_outcome_check
      check (call_outcome is null or call_outcome in ('no_answer', 'voicemail', 'reached', 'meeting_booked', 'won', 'lost'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'prospect_previews_team_size_check') then
    alter table public.prospect_previews add constraint prospect_previews_team_size_check
      check (team_size is null or (team_size between 1 and 10000));
  end if;
end $$;
