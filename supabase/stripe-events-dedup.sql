-- Webhook idempotency: dedup Stripe event redeliveries.
-- Stripe guarantees at-least-once delivery, so the same event id can arrive
-- more than once. The webhook records each processed event id here and skips
-- anything it has already handled, so receipts aren't emailed twice and
-- cascades don't run twice. Old rows are pruned after 30 days.
--
-- Run this in the Supabase SQL editor. Until it exists, the webhook fails OPEN
-- (processes every event) — the handlers are largely idempotent by construction,
-- so this is a safety upgrade, not a prerequisite for correctness.

create table if not exists public.stripe_events (
  event_id   text primary key,
  type       text,
  created_at timestamptz not null default now()
);

-- Service-role only; never exposed to clients.
alter table public.stripe_events enable row level security;

-- Housekeeping: drop the index name collision guard is unnecessary (PK covers it).
create index if not exists stripe_events_created_at_idx on public.stripe_events (created_at);

-- Completion, not arrival (audit B-05, applied 2026-10-16). The webhook claims
-- an event as 'processing' and marks it 'done' when its handler finishes; a
-- 'processing' row older than a few minutes is a run that died, and Stripe's
-- retry takes it over (lib/stripe-idempotency). Defaults to 'done' so every
-- row written before this column existed — and anything still inserting
-- without it — keeps meaning "handled", exactly as it did.
alter table public.stripe_events
  add column if not exists state text not null default 'done'
  check (state in ('processing', 'done'));
