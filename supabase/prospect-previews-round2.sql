-- ── Card Builder, round 2: queue, batches, warm paths, LinkedIn, learning (2026-11-13) ──
-- Run once in the Supabase SQL editor, after supabase/prospect-previews-outreach.sql.
--
-- WHAT:
--   prospect_previews      + linkedin_url (their public profile) and when the
--                            connection note went, was accepted, and the DM went;
--                          + warm_path (a connection of the owner's at that
--                            office, or a shared school or past employer);
--                          + batch_id (the batch that built it);
--                          + demo_booking_id (the setup call they booked from
--                            their preview page).
--   prospect_queue         names, links or notes the owner dropped in from
--                          their phone for the next run to build.
--   prospect_batches       one row per /build batch: what was asked for, each
--                          office's outcome, and whether its push has gone.
--   linkedin_connections   the owner's own LinkedIn connections export, parsed.
--                          The file itself is not kept.
--   card_builder_settings  small owner-level values (their schools and past
--                          employers, for "shared school" warm paths).
--   prospect_message_events  the owner's edits, which version they picked, and
--                          each message they sent: what future drafts learn from.
--   demo_bookings          + prospect_preview_id, so a setup call booked from
--                            a preview page is tied to its prospect.
--
-- SAFE: additive only. New nullable columns and new tables. No existing row changes.
-- IDEMPOTENT: every statement can be run again.
-- ADMIN-ONLY: every new table has RLS ON with no policies and nothing granted
-- to anon or authenticated; the server uses the service role behind requireAdmin().
--
-- ROLLBACK:
--   drop table if exists public.prospect_message_events, public.card_builder_settings,
--     public.linkedin_connections, public.prospect_batches, public.prospect_queue;
--   alter table public.prospect_previews drop column if exists linkedin_url,
--     drop column if exists linkedin_sent_at, drop column if exists linkedin_accepted_at,
--     drop column if exists linkedin_dm_at, drop column if exists warm_path,
--     drop column if exists batch_id, drop column if exists demo_booking_id;
--   alter table public.demo_bookings drop column if exists prospect_preview_id;

alter table public.prospect_previews add column if not exists linkedin_url         text;
alter table public.prospect_previews add column if not exists linkedin_sent_at     timestamptz;
alter table public.prospect_previews add column if not exists linkedin_accepted_at timestamptz;
alter table public.prospect_previews add column if not exists linkedin_dm_at       timestamptz;
alter table public.prospect_previews add column if not exists warm_path            jsonb;
alter table public.prospect_previews add column if not exists batch_id             uuid;
alter table public.prospect_previews add column if not exists demo_booking_id      uuid;

create table if not exists public.prospect_queue (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A name and city, a link, or the owner's own notes about one prospect.
  input      text not null check (char_length(input) between 2 and 4000),
  -- The owner typed this as notes about one prospect: its facts are confirmed by them.
  is_notes   boolean not null default false,
  status     text not null default 'queued' check (status in ('queued', 'built', 'skipped', 'failed')),
  note       text,
  preview_id uuid,
  batch_id   uuid
);
create index if not exists prospect_queue_status_idx on public.prospect_queue (status, created_at);

create table if not exists public.prospect_batches (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  -- What was asked for, as typed: "Brooklyn, independent brokerages, 25".
  label        text not null,
  kind         text not null default 'now' check (kind in ('now', 'tonight')),
  wanted       integer,
  status       text not null default 'running' check (status in ('running', 'finished')),
  finished_at  timestamptz,
  -- [{ "office", "outcome": "built" | "skipped" | "failed", "preview_id", "reason", "at" }]
  items        jsonb not null default '[]'::jsonb,
  -- The "batch ready" push has gone.
  announced_at timestamptz
);
create index if not exists prospect_batches_created_idx on public.prospect_batches (created_at desc);

create table if not exists public.linkedin_connections (
  id           bigint generated always as identity primary key,
  uploaded_at  timestamptz not null default now(),
  first_name   text not null default '',
  last_name    text not null default '',
  url          text,
  company      text,
  position     text,
  connected_on date,
  -- The company's name, reduced to what two spellings of it share.
  company_key  text
);
create index if not exists linkedin_connections_company_idx on public.linkedin_connections (company_key);

create table if not exists public.card_builder_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.prospect_message_events (
  id         uuid primary key default gen_random_uuid(),
  at         timestamptz not null default now(),
  preview_id uuid not null references public.prospect_previews (id) on delete cascade,
  kind       text not null check (kind in ('edit', 'pick', 'sent')),
  -- Which message: first_text, link_text, email_body, linkedin_note…
  message    text not null,
  -- The first text's version: a | b.
  variant    text,
  before     text,
  after      text
);
create index if not exists prospect_message_events_preview_idx on public.prospect_message_events (preview_id, at desc);
create index if not exists prospect_message_events_kind_idx on public.prospect_message_events (kind, at desc);

alter table public.prospect_queue enable row level security;
alter table public.prospect_batches enable row level security;
alter table public.linkedin_connections enable row level security;
alter table public.card_builder_settings enable row level security;
alter table public.prospect_message_events enable row level security;
revoke all on public.prospect_queue from anon, authenticated;
revoke all on public.prospect_batches from anon, authenticated;
revoke all on public.linkedin_connections from anon, authenticated;
revoke all on public.card_builder_settings from anon, authenticated;
revoke all on public.prospect_message_events from anon, authenticated;

-- A setup call booked from a preview page (lib/demo), tied to its prospect.
do $$
begin
  if to_regclass('public.demo_bookings') is not null then
    alter table public.demo_bookings add column if not exists prospect_preview_id uuid;
  end if;
end $$;
