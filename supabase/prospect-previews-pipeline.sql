-- ── Card Builder: the pipeline and sending (2026-11-11) ────────────────────
-- Run once in the Supabase SQL editor, after supabase/prospect-previews-drafts.sql.
--
-- WHAT: when each preview was sent and how, and the outcome a call led to.
-- Most of a preview's stage is worked out from facts already stored (draft,
-- published, sent, viewed, called: lib/prospect-preview/pipeline.ts); `stage`
-- only holds what a person decides: meeting booked, won, lost.
--
-- SAFE: additive only. Four new nullable columns on prospect_previews. No
-- existing row's data changes.
-- IDEMPOTENT: every statement can be run again.

-- The first text, the one with no link ("want me to send it?").
alter table public.prospect_previews add column if not exists asked_at     timestamptz;
-- The link went out: when, and by text or email (the latest send).
alter table public.prospect_previews add column if not exists sent_at      timestamptz;
alter table public.prospect_previews add column if not exists sent_channel text;
alter table public.prospect_previews add column if not exists stage        text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'prospect_previews_sent_channel_check') then
    alter table public.prospect_previews add constraint prospect_previews_sent_channel_check
      check (sent_channel is null or sent_channel in ('text', 'email'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'prospect_previews_stage_check') then
    alter table public.prospect_previews add constraint prospect_previews_stage_check
      check (stage is null or stage in ('meeting_booked', 'won', 'lost'));
  end if;
end $$;
