-- ── Card Builder on autopilot, and the database size autopilot (2026-11-16) ──
-- Run once, AFTER supabase/card-builder-imessage.sql.
--
-- WHAT:
--   card_builder_jobs        one row per prospect in a batch (plus one "find"
--                            row for a batch typed as a target). A scheduled
--                            worker on Vercel (/api/cron/card-builder/worker,
--                            every 5 minutes) walks each row through
--                            research → build_card → write_opener →
--                            ready_for_review, retrying a failed step with
--                            backoff (5, 10, 20 minutes) and then marking it
--                            failed with the reason, which Approve shows.
--   claim_card_builder_jobs  hands out due rows to ONE worker each
--                            (for update skip locked), so overlapping runs
--                            never work the same prospect twice.
--   prospect_batches.engine  'server' (the worker) or 'mac' (the old Mac
--                            agent run). New batches are 'server'.
--   prospect_outbox          + send_at and status 'scheduled': an approved
--                            opener waits for 9 AM in the recipient's time
--                            zone; /api/cron/card-builder/release moves it to
--                            'queued' (what the Mac sends) a few at a time.
--   prospect_previews        + followup_text / followup_at: the one follow-up
--                            text written 48 hours after an unopened send. It
--                            goes to the review queue; nothing sends it.
--   view_daily_summaries     site page views older than 90 days, one row per
--                            day and path, so the raw rows can go; and
--                            product events per day and name, written before
--                            the existing 90-day prune removes them.
--   rollup_view_events()     does both, nightly (/api/cron/db-autopilot).
--   admin_database_size()    the database's size in bytes (Supabase free = 500 MB).
--
-- NOT TOUCHED: card_views. Customers' lifetime view counts, milestones and
-- the "you'd lose N views" retention screen count those rows, so deleting old
-- ones would change numbers customers see. They are a few hundred rows.
--
-- SAFE: additive. IDEMPOTENT. ADMIN-ONLY: RLS on, nothing granted to anon or
-- authenticated; the functions run for the service role only.
--
-- ROLLBACK:
--   drop function if exists public.claim_card_builder_jobs(int, int);
--   drop function if exists public.rollup_view_events(int);
--   drop function if exists public.admin_database_size();
--   drop table if exists public.card_builder_jobs;
--   drop table if exists public.view_daily_summaries;
--   alter table public.prospect_batches drop column if exists engine;
--   alter table public.prospect_previews drop column if exists followup_text, drop column if exists followup_at;
--   alter table public.prospect_outbox drop column if exists send_at;  (after deleting 'scheduled' rows, restore the old status check)

-- ── Jobs ────────────────────────────────────────────────────────────────────

create table if not exists public.card_builder_jobs (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- The prospect (a row of prospect_queue). Null only on a batch's "find" job.
  prospect_id  uuid references public.prospect_queue (id) on delete cascade,
  batch_id     uuid references public.prospect_batches (id) on delete cascade,
  step         text not null check (step in ('find', 'research', 'build_card', 'write_opener', 'ready_for_review')),
  status       text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed', 'skipped')),
  -- Tries of the CURRENT step. Reset to 0 when a step succeeds.
  attempts     integer not null default 0,
  last_error   text,
  run_after    timestamptz not null default now(),
  locked_until timestamptz,
  preview_id   uuid references public.prospect_previews (id) on delete set null,
  -- What one step hands the next (the research), and what each step cost.
  data         jsonb not null default '{}'::jsonb,
  finished_at  timestamptz
);
create unique index if not exists card_builder_jobs_one_per_prospect on public.card_builder_jobs (prospect_id) where prospect_id is not null;
create unique index if not exists card_builder_jobs_one_find_per_batch on public.card_builder_jobs (batch_id) where prospect_id is null;
create index if not exists card_builder_jobs_due_idx on public.card_builder_jobs (status, run_after) where status in ('pending', 'running');
create index if not exists card_builder_jobs_batch_idx on public.card_builder_jobs (batch_id, status);
alter table public.card_builder_jobs enable row level security;
revoke all on public.card_builder_jobs from anon, authenticated;

-- Up to p_limit due jobs, each to exactly one caller. A job whose lease ran
-- out (its run died mid-step) is due again; every claim counts as a try, so a
-- step that keeps killing its run still stops after four.
create or replace function public.claim_card_builder_jobs(p_limit integer, p_lease_seconds integer)
returns setof public.card_builder_jobs
language sql
security definer
set search_path = public
as $$
  update public.card_builder_jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         locked_until = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
   where j.id in (
     select id from public.card_builder_jobs
      where attempts < 4
        and ((status = 'pending' and run_after <= now()) or (status = 'running' and locked_until < now()))
      order by run_after, created_at
      limit greatest(p_limit, 0)
      for update skip locked
   )
  returning j.*;
$$;
revoke execute on function public.claim_card_builder_jobs(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_card_builder_jobs(integer, integer) to service_role;

-- ── Batches: who runs them ──────────────────────────────────────────────────

alter table public.prospect_batches add column if not exists engine text not null default 'server';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'prospect_batches_engine_check') then
    alter table public.prospect_batches add constraint prospect_batches_engine_check check (engine in ('server', 'mac'));
  end if;
end $$;

-- ── The outbox: approved openers wait for 9 AM their time ───────────────────

alter table public.prospect_outbox add column if not exists send_at timestamptz;
alter table public.prospect_outbox drop constraint if exists prospect_outbox_status_check;
alter table public.prospect_outbox add constraint prospect_outbox_status_check
  check (status in ('scheduled', 'queued', 'sending', 'sent', 'failed', 'not_imessage', 'canceled'));
-- One live opener per prospect and per number now counts a scheduled one too.
drop index if exists public.prospect_outbox_one_per_prospect;
create unique index prospect_outbox_one_per_prospect on public.prospect_outbox (preview_id) where status in ('scheduled', 'queued', 'sending', 'sent');
drop index if exists public.prospect_outbox_one_per_phone;
create unique index prospect_outbox_one_per_phone on public.prospect_outbox (phone) where status in ('scheduled', 'queued', 'sending', 'sent');
create index if not exists prospect_outbox_due_idx on public.prospect_outbox (send_at) where status = 'scheduled';

-- ── The 48-hour follow-up ───────────────────────────────────────────────────

alter table public.prospect_previews add column if not exists followup_text text;
alter table public.prospect_previews add column if not exists followup_at   timestamptz;

-- ── Database size autopilot ─────────────────────────────────────────────────

create table if not exists public.view_daily_summaries (
  day          date not null,
  -- 'site_pageviews' (key = path) or 'product_events' (key = event name)
  source       text not null check (source in ('site_pageviews', 'product_events')),
  key          text not null,
  is_internal  boolean not null default false,
  views        integer not null default 0,
  visitors     integer not null default 0,
  sessions     integer not null default 0,
  created_at   timestamptz not null default now(),
  primary key (day, source, key, is_internal)
);
alter table public.view_daily_summaries enable row level security;
revoke all on public.view_daily_summaries from anon, authenticated;

-- Nightly. Days are UTC days. A day is summarised once (the primary key), and
-- only whole days older than the cutoff, so a rerun changes nothing.
--   site_pageviews: summarise, then DELETE the raw rows older than p_days.
--   product_events: summarise only; the existing prune_product_events()
--                   (90 days, run by the daily reminders clock) deletes them.
--                   Summarised from p_days - 2 so a day is in before it goes.
create or replace function public.rollup_view_events(p_days integer default 90)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff        date := (now() at time zone 'utc')::date - p_days;
  events_cutoff date := (now() at time zone 'utc')::date - (p_days - 2);
  site_rows     integer := 0;
  event_rows    integer := 0;
  deleted       integer := 0;
begin
  insert into public.view_daily_summaries (day, source, key, is_internal, views, visitors, sessions)
  select (created_at at time zone 'utc')::date, 'site_pageviews', coalesce(left(path, 300), ''), coalesce(is_internal, false),
         count(*), count(distinct visitor_id), count(distinct session_id)
    from public.site_pageviews
   where created_at < cutoff::timestamp at time zone 'utc'
   group by 1, 3, 4
  on conflict (day, source, key, is_internal) do nothing;
  get diagnostics site_rows = row_count;

  -- Only delete days that are summarised (all of them are, just above).
  delete from public.site_pageviews p
   where p.created_at < cutoff::timestamp at time zone 'utc'
     and exists (select 1 from public.view_daily_summaries s
                  where s.source = 'site_pageviews' and s.day = (p.created_at at time zone 'utc')::date);
  get diagnostics deleted = row_count;

  insert into public.view_daily_summaries (day, source, key, is_internal, views, visitors, sessions)
  select (created_at at time zone 'utc')::date, 'product_events', coalesce(left(name, 300), ''), coalesce(is_internal, false),
         count(*), 0, count(distinct session_key)
    from public.product_events
   where created_at < events_cutoff::timestamp at time zone 'utc'
     and not exists (select 1 from public.view_daily_summaries s
                      where s.source = 'product_events' and s.day = (product_events.created_at at time zone 'utc')::date)
   group by 1, 3, 4
  on conflict (day, source, key, is_internal) do nothing;
  get diagnostics event_rows = row_count;

  return jsonb_build_object('site_summary_rows', site_rows, 'site_rows_deleted', deleted, 'event_summary_rows', event_rows);
end;
$$;
revoke execute on function public.rollup_view_events(integer) from public, anon, authenticated;
grant execute on function public.rollup_view_events(integer) to service_role;

create or replace function public.admin_database_size()
returns bigint
language sql
stable
security definer
set search_path = public
as $$ select pg_database_size(current_database()); $$;
revoke execute on function public.admin_database_size() from public, anon, authenticated;
grant execute on function public.admin_database_size() to service_role;
