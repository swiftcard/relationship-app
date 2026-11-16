-- ── Card Builder: openers, batches of 100, and the Mac's iMessage outbox (2026-11-16) ──
-- Run once in the Supabase SQL editor, after supabase/prospect-previews-round2.sql.
--
-- WHAT:
--   prospect_previews   + openers (the five opening texts written for them,
--                         each scored, the best one the default),
--                       + phone_kind (mobile | office | unknown: only a mobile
--                         can get an iMessage),
--                       + not_imessage_at (the Mac found the number isn't on iMessage)
--   prospect_batches    + status 'requested' (made with "New batch" in the
--                         admin, waiting for the Mac), run_after, started_at,
--                         chunks, error, candidates (the offices found for it)
--   prospect_outbox     each approved opener the Mac sends from the owner's own
--                       number, one row per prospect, with what happened
--
-- SAFE: additive. New nullable columns, one new table, and the batch status
-- check widened to allow 'requested'. No existing row changes.
-- IDEMPOTENT: every statement can be run again.
-- ADMIN-ONLY: the new table has RLS ON with no policies and nothing granted to
-- anon or authenticated; the server and the Mac agent use the service role.
--
-- ROLLBACK:
--   drop table if exists public.prospect_outbox;
--   alter table public.prospect_previews drop column if exists openers,
--     drop column if exists phone_kind, drop column if exists not_imessage_at;
--   alter table public.prospect_batches drop column if exists run_after,
--     drop column if exists started_at, drop column if exists chunks,
--     drop column if exists error, drop column if exists candidates;
--   (then put back: check (status in ('running', 'finished')), after deleting
--    any 'requested' rows)

alter table public.prospect_previews add column if not exists openers         jsonb;
alter table public.prospect_previews add column if not exists phone_kind      text;
alter table public.prospect_previews add column if not exists not_imessage_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'prospect_previews_phone_kind_check') then
    alter table public.prospect_previews add constraint prospect_previews_phone_kind_check
      check (phone_kind is null or phone_kind in ('mobile', 'office', 'unknown'));
  end if;
end $$;

alter table public.prospect_batches add column if not exists run_after  timestamptz;
alter table public.prospect_batches add column if not exists started_at timestamptz;
alter table public.prospect_batches add column if not exists chunks     integer not null default 0;
alter table public.prospect_batches add column if not exists error      text;
alter table public.prospect_batches add column if not exists candidates jsonb not null default '[]'::jsonb;
alter table public.prospect_batches drop constraint if exists prospect_batches_status_check;
alter table public.prospect_batches add constraint prospect_batches_status_check
  check (status in ('requested', 'running', 'finished'));
create index if not exists prospect_batches_waiting_idx on public.prospect_batches (status, run_after) where status in ('requested', 'running');

create table if not exists public.prospect_outbox (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  preview_id  uuid not null references public.prospect_previews (id) on delete cascade,
  -- +1XXXXXXXXXX
  phone       text not null check (phone ~ '^\+1[2-9][0-9]{9}$'),
  -- The opener and, on its own last line, the link.
  body        text not null check (char_length(body) between 20 and 600),
  -- Which kind of opener it is (listing, team, reviews, niche, recent, warm), and the batch it came from: what open rates are counted by.
  hook        text,
  segment     text,
  status      text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'not_imessage', 'canceled')),
  claimed_at  timestamptz,
  sent_at     timestamptz,
  error       text
);
-- One live opener per prospect: queued, being sent, or sent. Canceled and failed rows don't block a retry.
create unique index if not exists prospect_outbox_one_per_prospect on public.prospect_outbox (preview_id) where status in ('queued', 'sending', 'sent');
-- And one per PERSON: the same number on two previews (built twice, in two
-- batches) never gets two openers.
create unique index if not exists prospect_outbox_one_per_phone on public.prospect_outbox (phone) where status in ('queued', 'sending', 'sent');
create index if not exists prospect_outbox_status_idx on public.prospect_outbox (status, created_at);
create index if not exists prospect_outbox_sent_idx on public.prospect_outbox (sent_at desc) where status = 'sent';

alter table public.prospect_outbox enable row level security;
revoke all on public.prospect_outbox from anon, authenticated;
