-- CRM / Zapier delivery you can see and rely on (2026-10-14).
--
-- 1. crm_links — which CRM record each contact was written to, per
--    destination. An edit updates THAT record (even after the email it was
--    first matched on changed), and Google's lagging search cache can no longer
--    turn a quick edit into a duplicate.
-- 2. crm_sync_outbox — contacts a CRM or Zapier couldn't take when they
--    arrived (busy, down, no answer). The daily /api/reminders job sends them
--    again (lib/crm-outbox-drain) for up to five days.
-- 3. integrations.last_synced_at, profiles.zapier_error,
--    profiles.zapier_last_sent_at — what Settings shows: "Last contact sent …"
--    and why a Zap isn't receiving.
--
-- Server-only tables: every read and write is the service role. RLS on with no
-- policies, and the browser roles' grants revoked, so nothing reaches them from
-- a signed-in client.
--
-- Applied to production 2026-10-14 (Supabase MCP apply_migration).

create table if not exists public.crm_links (
  lead_id     uuid        not null references public.leads(id) on delete cascade,
  provider    text        not null,
  owner_id    uuid        not null,
  record_id   text        not null,
  record_kind text,
  updated_at  timestamptz not null default now(),
  primary key (lead_id, provider, owner_id)
);

create table if not exists public.crm_sync_outbox (
  id              uuid        primary key default gen_random_uuid(),
  lead_id         uuid        not null references public.leads(id) on delete cascade,
  provider        text        not null,
  user_id         uuid        not null,
  owner_id        uuid        not null,
  mode            text        not null default 'capture',
  attempts        integer     not null default 0,
  last_error      text,
  next_attempt_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (lead_id, provider)
);

create index if not exists crm_sync_outbox_due_idx on public.crm_sync_outbox (next_attempt_at);
create index if not exists crm_sync_outbox_owner_idx on public.crm_sync_outbox (owner_id);

alter table public.crm_links enable row level security;
alter table public.crm_sync_outbox enable row level security;
revoke all on public.crm_links from anon, authenticated;
revoke all on public.crm_sync_outbox from anon, authenticated;

alter table public.integrations add column if not exists last_synced_at timestamptz;
alter table public.profiles add column if not exists zapier_error text;
alter table public.profiles add column if not exists zapier_last_sent_at timestamptz;
