-- ── Office demo booking (2026-11-03) ────────────────────────────────────────
-- APPLIED TO PRODUCTION 2026-11-04 (owner-approved, Supabase MCP): the tables
-- and the bell kind first; the demo-tick job once /api/demo/tick was live.
--
-- WHY: the owner asked for a "Book a demo" button on the pricing page's Office
-- card: the visitor gives their details, picks an open time, and everything
-- after that is automatic: a Google Calendar event with a Meet link and
-- Google's own invitation, a confirmation email, reminders halfway to the
-- demo, the night before and the day of, a text the morning of, and an email
-- plus an admin bell item for the owner. "If two people do it on Wednesday and
-- one person does it at 3:00, then 3:00 is already taken."
--
-- Written by the server only (service role). RLS is on with no policies, and
-- the anon and signed-in keys have no grants, so neither can read or write.
--
-- demo_bookings
--   demo_no_overlap  Postgres itself refuses a second CONFIRMED demo that
--                    overlaps one already held. Two people pressing Confirm
--                    for the same time at the same moment: one insert wins,
--                    the other fails with 23P01, which the API turns into
--                    "that time was just booked". A canceled demo leaves the
--                    rule, so its time opens again at once. Range types index
--                    natively in GiST, so no extension is needed.
--   manage_token_*   The reschedule/cancel link is swiftcard.me/demo/manage#<token>.
--                    The hash finds the booking; the encrypted copy (OAUTH_SECRET,
--                    lib/token-crypto) lets the clock put the link in reminders
--                    it builds later. The plain token is never stored.
--
-- demo_messages: the outbox. Every email and text is a row with a send_at;
-- the clock (pg_cron below → /api/demo/tick) claims due rows one by one, sends,
-- and stamps sent_at. A row that is no longer wanted (canceled, rescheduled,
-- opted out) gets skipped_reason instead and is never sent.
--
-- The clock: public.clock_call(job, url, vault_secret_name, method, timeout_ms)
-- already exists in production (pg_cron + pg_net, logging to clock_calls; it
-- drives crew-tick, push-catchup and trial-notice). Its source file
-- supabase/clock.sql was removed from the repo in 0639352a as "never applied",
-- but the function, the table and the jobs are live (checked 2026-11-03). The
-- secret lives in Supabase Vault as demo_tick_secret and in Vercel as
-- DEMO_TICK_SECRET; neither value is ever written here.

create table if not exists public.demo_bookings (
  id                  uuid primary key,
  status              text not null default 'confirmed' check (status in ('confirmed', 'canceled', 'completed', 'no_show')),
  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  name                text not null check (char_length(name) between 1 and 120),
  email               text not null check (char_length(email) between 3 and 254),
  phone               text not null check (char_length(phone) between 7 and 40),
  company             text not null check (char_length(company) between 1 and 160),
  team_size           text not null,
  role                text check (role is null or char_length(role) <= 120),
  crm                 text check (crm is null or char_length(crm) <= 60),
  notes               text check (notes is null or char_length(notes) <= 2000),
  timezone            text not null default 'America/New_York',
  sms_opt_in          boolean not null default false,
  source              text not null default 'pricing',
  manage_token_hash   text not null unique,
  manage_token_enc    text not null,
  google_event_id     text,
  meet_url            text,
  calendar_html_link  text,
  calendar_status     text not null default 'pending' check (calendar_status in ('pending', 'created', 'failed', 'not_connected')),
  calendar_attempts   int not null default 0,
  calendar_error      text,
  calendar_checked_at timestamptz,
  attendee_response   text,
  reconfirmed_at      timestamptz,
  canceled_at         timestamptz,
  canceled_by         text,
  cancel_reason       text check (cancel_reason is null or char_length(cancel_reason) <= 500),
  ip_hash             text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint demo_bookings_time check (ends_at > starts_at),
  constraint demo_no_overlap exclude using gist (tstzrange(starts_at, ends_at, '[)') with &&) where (status = 'confirmed')
);

create index if not exists demo_bookings_starts_idx on public.demo_bookings (starts_at);
create index if not exists demo_bookings_created_idx on public.demo_bookings (created_at desc);
create index if not exists demo_bookings_email_idx on public.demo_bookings (lower(email)) where status = 'confirmed';

create table if not exists public.demo_messages (
  id              bigint generated always as identity primary key,
  booking_id      uuid not null references public.demo_bookings (id) on delete cascade,
  kind            text not null check (kind in (
                    'confirmation', 'halfway', 'night_before', 'day_of', 'sms_day_of',
                    'rescheduled', 'canceled', 'meet_link',
                    'owner_new', 'owner_rescheduled', 'owner_canceled')),
  channel         text not null default 'email' check (channel in ('email', 'sms')),
  send_at         timestamptz not null,
  claimed_at      timestamptz,
  sent_at         timestamptz,
  attempts        int not null default 0,
  last_error      text,
  provider_id     text,
  skipped_reason  text,
  created_at      timestamptz not null default now()
);

-- One pending row per booking and kind: a retry or a second writer can't queue
-- the same reminder twice. Sent and skipped rows stay as the history.
create unique index if not exists demo_messages_pending_uniq on public.demo_messages (booking_id, kind)
  where sent_at is null and skipped_reason is null;
create index if not exists demo_messages_due_idx on public.demo_messages (send_at)
  where sent_at is null and skipped_reason is null;

alter table public.demo_bookings enable row level security;
alter table public.demo_messages enable row level security;
revoke all on public.demo_bookings from anon, authenticated;
revoke all on public.demo_messages from anon, authenticated;

-- The admin bell learns a fourth kind: demos booked, moved and canceled.
alter table public.admin_notifications drop constraint if exists admin_notifications_kind_check;
alter table public.admin_notifications add constraint admin_notifications_kind_check
  check (kind in ('money', 'leaving', 'agents', 'demos'));

-- Every 5 minutes: send what is due, retry calendar events, check Google for
-- changes the owner made in the calendar itself. Re-running this file replaces
-- the job instead of adding a second one.
select cron.unschedule('demo-tick') where exists (select 1 from cron.job where jobname = 'demo-tick');
select cron.schedule('demo-tick', '*/5 * * * *',
  $$select clock_call('demo-tick', 'https://swiftcard.me/api/demo/tick', 'demo_tick_secret', 'POST', 60000)$$);
