-- ── The site admin's notification center (2026-10-28) ─────────────────────
-- APPLIED TO PRODUCTION 2026-10-28 (owner-approved plan, Supabase MCP).
--
-- WHY: the owner asked for "a notification center in our admin page … for
-- really important things": money (a first payment, a failed payment, a
-- cancellation, a refund or dispute), customers leaving (closed accounts and
-- the reason, people kept by an offer), and the agents (the Sheet sync
-- failing, an agent failing, Pause all left on). Shown only inside /admin —
-- no email, no push (owner, 2026-10-28).
--
-- Written by the server only (service role). RLS is on with no policies, so
-- the anon and signed-in keys can neither read nor write it.
--
--   kind        money | leaving | agents
--   severity    urgent | important
--   dedupe_key  one row per real-world event: a Stripe event id, an account
--               id + day, an agent + the run it failed on. A retry or a second
--               writer for the same event is a no-op.

create table if not exists public.admin_notifications (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  kind        text not null check (kind in ('money', 'leaving', 'agents')),
  severity    text not null default 'important' check (severity in ('urgent', 'important')),
  title       text not null,
  body        text,
  href        text,
  dedupe_key  text not null unique,
  meta        jsonb not null default '{}'::jsonb,
  read_at     timestamptz
);

create index if not exists admin_notifications_created_idx on public.admin_notifications (created_at desc);
create index if not exists admin_notifications_unread_idx on public.admin_notifications (created_at desc) where read_at is null;

alter table public.admin_notifications enable row level security;
