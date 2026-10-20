-- ── Crew: the agent system (2026-10-20) ──────────────────────────────────────
-- APPLIED TO PRODUCTION 2026-10-20 (owner-approved, via the Supabase MCP; verified:
-- 17 tables with RLS on, settings row, crew_claim_dm executable by service_role
-- only, crew-media bucket).
--
-- WHAT: every table the new agent system ("Crew", admin tab "Agents") uses.
-- Plan: docs/plans/agent-system.md. Namespace crew_* so nothing collides with
-- the old agent_* tables, which Crew never reads or writes.
--
-- SAFE: creates new tables and one function only. IF NOT EXISTS everywhere, so
-- running it twice is a no-op. Touches no existing table. RLS is ON with no
-- policies on every table: only the service role (server routes behind
-- requireAdmin, and the tick route behind CREW_TICK_SECRET) can read or write.
--
-- ROLLBACK: drop function crew_claim_dm(uuid, uuid); then drop each crew_*
-- table below (nothing else references them).
--
-- Until this runs, /admin/crew says "Run supabase/crew.sql" and every crew
-- route answers "not set up". Nothing else on the site changes.

-- Singleton settings row (id = 1).
create table if not exists crew_settings (
  id              int primary key default 1 check (id = 1),
  kill_all        boolean not null default false,
  daily_usd_cap   numeric(10,2) not null default 2.00,     -- was 8.00; see crew-economy.sql
  team_caps       jsonb not null default '{}'::jsonb,     -- { "replies": {"usd": 3}, ... }
  disclosure_on   boolean not null default true,
  disclosure      text not null default '(I work on SwiftCard, so I''m biased.)',
  updated_at      timestamptz not null default now()
);
insert into crew_settings (id) values (1) on conflict (id) do nothing;

-- One row per agent in src/lib/crew/registry.ts. Created lazily by the app.
create table if not exists crew_agents (
  id              text primary key,
  enabled         boolean not null default false,
  model_override  text,                                    -- 'sonnet' | 'opus' | 'fable' | null
  daily_usd_cap   numeric(10,2),                           -- null = registry default
  config          jsonb not null default '{}'::jsonb,      -- focus keywords, subreddits, cursors
  last_run_at     timestamptz,
  next_run_at     timestamptz,
  lease_until     timestamptz,
  status_note     text,
  updated_at      timestamptz not null default now()
);

create table if not exists crew_runs (
  id          uuid primary key default gen_random_uuid(),
  agent_id    text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running',             -- running | ok | budget | error | skipped
  summary     text,
  stats       jsonb not null default '{}'::jsonb,
  error       text
);
create index if not exists crew_runs_agent_idx on crew_runs (agent_id, started_at desc);

create table if not exists crew_usage (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  run_id        uuid,
  agent_id      text not null,
  team          text not null,
  provider      text not null,                             -- anthropic | openai
  model         text not null,
  purpose       text not null,                             -- draft | critique | tiebreak | report | score | ...
  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  cache_read    int not null default 0,
  cache_write   int not null default 0,
  web_searches  int not null default 0,
  batch         boolean not null default false,
  cost_usd      numeric(12,6) not null default 0
);
create index if not exists crew_usage_day_idx on crew_usage (created_at desc, agent_id);

create table if not exists crew_batches (
  id            text primary key,                          -- Anthropic batch id
  agent_id      text not null,
  purpose       text not null,
  status        text not null default 'submitted',         -- submitted | collected | failed
  meta          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  collected_at  timestamptz
);

create table if not exists crew_approvals (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  agent_id      text not null,
  team          text not null,
  kind          text not null,                             -- reply | comment | dm | connect_note | post | blog_post | code_fix | email_list_export | spend | ask
  status        text not null default 'pending',           -- pending | approved | rejected | expired | done
  title         text not null,
  summary       text not null,                             -- plain, fifth-grade words
  body          text not null default '',                  -- the draft itself (editable)
  platform      text,
  target_url    text,
  person_id     uuid,
  debate        jsonb,
  model_used    text,
  meta          jsonb not null default '{}'::jsonb,
  decided_at    timestamptz,
  decided_by    text,
  reject_reason text,
  done_at       timestamptz,
  expires_at    timestamptz not null default now() + interval '7 days'
);
create index if not exists crew_approvals_status_idx on crew_approvals (status, created_at desc);
create index if not exists crew_approvals_agent_idx on crew_approvals (agent_id, created_at desc);
-- A thread is answered once: one live reply/comment per (platform, url).
create unique index if not exists crew_approvals_one_reply_per_thread
  on crew_approvals (platform, target_url)
  where kind in ('reply', 'comment') and status in ('pending', 'approved', 'done') and target_url is not null;

-- ── De-dup ledger ───────────────────────────────────────────────────────────
create table if not exists crew_people (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  display_name  text,
  notes         text,
  possible_match uuid                                      -- fuzzy match flagged for the owner, never auto-merged
);

create table if not exists crew_identities (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references crew_people(id) on delete cascade,
  platform    text not null,
  handle_norm text not null,
  created_at  timestamptz not null default now(),
  unique (platform, handle_norm)
);
create index if not exists crew_identities_person_idx on crew_identities (person_id);

create table if not exists crew_touches (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references crew_people(id) on delete cascade,
  platform    text not null,
  kind        text not null,                               -- replied | commented | dm_drafted | dm_sent | connect_sent | emailed | called | lead_listed
  approval_id uuid,
  at          timestamptz not null default now()
);
create index if not exists crew_touches_person_idx on crew_touches (person_id);
create index if not exists crew_touches_approval_idx on crew_touches (approval_id);

-- The hard rule: never DM (or draft a DM to) anyone we have replied to or
-- contacted, on any platform, by any team. One person at a time (advisory
-- lock), so two agents racing for the same person cannot both win.
-- 'lead_listed' does not count as contact: being on a list is not a message.
create or replace function crew_claim_dm(p_person uuid, p_approval uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('crew_dm:' || p_person::text));
  if exists (
    select 1 from crew_touches
    where person_id = p_person and kind <> 'lead_listed'
  ) then
    return false;
  end if;
  insert into crew_touches (person_id, platform, kind, approval_id)
  select p_person, coalesce(a.platform, 'unknown'), 'dm_drafted', p_approval
  from crew_approvals a where a.id = p_approval;
  if not found then
    insert into crew_touches (person_id, platform, kind, approval_id)
    values (p_person, 'unknown', 'dm_drafted', p_approval);
  end if;
  return true;
end;
$$;
revoke all on function crew_claim_dm(uuid, uuid) from public, anon, authenticated;
-- Revoking from PUBLIC also removes the service role's inherited EXECUTE.
grant execute on function crew_claim_dm(uuid, uuid) to service_role;

-- ── Findings, reports, inputs, limits, leads ────────────────────────────────
create table if not exists crew_findings (
  id           uuid primary key default gen_random_uuid(),
  fingerprint  text not null unique,
  agent_id     text not null,
  kind         text not null,                              -- bug | speed | security | ui | flow | payment | app
  source       text not null,
  title        text not null,
  detail       jsonb not null default '{}'::jsonb,
  count        int not null default 1,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  status       text not null default 'open',               -- open | proposed | fixed | ignored
  approval_id  uuid
);
create index if not exists crew_findings_status_idx on crew_findings (status, last_seen desc);

create table if not exists crew_reports (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  agent_id    text not null,
  team        text not null,
  day         date not null,
  body        text not null,
  stats       jsonb not null default '{}'::jsonb,
  emailed_at  timestamptz,
  unique (agent_id, day)
);

-- Things the owner pastes in (a Facebook group post, an Alignable profile, ...)
-- for the paste-driven agents, which have no API to read from.
create table if not exists crew_inputs (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  platform    text not null,
  kind        text not null default 'post',                -- post | profile | page
  url         text,
  text        text not null,
  status      text not null default 'new',                 -- new | used | skipped
  used_by     text
);
create index if not exists crew_inputs_new_idx on crew_inputs (status, platform, created_at);

create table if not exists crew_rate_limits (
  platform      text not null,
  action        text not null,                             -- reply | comment | dm | connect | follow
  ceiling       int not null,
  warmup_start  date not null default current_date,
  primary key (platform, action)
);

create table if not exists crew_kv (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

create table if not exists crew_leads (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  list              text not null default 'cold',          -- cold | office
  person_id         uuid,
  name              text,
  email             text,
  phone             text,
  company           text,
  title             text,
  business_type     text,
  city              text,
  region            text,
  country           text,
  region_restricted boolean not null default false,        -- GDPR-style jurisdiction: excluded from exports
  source_platform   text not null,
  source_url        text not null,
  found_at          timestamptz not null default now(),
  notes             text,
  sheet_synced_at   timestamptz
);
create unique index if not exists crew_leads_email_list on crew_leads (list, lower(email)) where email is not null;
create index if not exists crew_leads_sync_idx on crew_leads (sheet_synced_at nulls first, created_at);

create table if not exists crew_suppression (
  value     text primary key,                              -- lowercased email or @domain
  reason    text not null,
  added_at  timestamptz not null default now()
);

create table if not exists crew_competitor_facts (
  id          uuid primary key default gen_random_uuid(),
  competitor  text not null,                               -- hihello | blinq | popl | linkme | linktree | hoobe
  fact        text not null,                               -- e.g. 'pro_monthly_price'
  value       text not null,
  source_url  text not null,
  seen_at     timestamptz not null default now(),
  unique (competitor, fact)
);

alter table crew_settings          enable row level security;
alter table crew_agents            enable row level security;
alter table crew_runs              enable row level security;
alter table crew_usage             enable row level security;
alter table crew_batches           enable row level security;
alter table crew_approvals         enable row level security;
alter table crew_people            enable row level security;
alter table crew_identities        enable row level security;
alter table crew_touches           enable row level security;
alter table crew_findings          enable row level security;
alter table crew_reports           enable row level security;
alter table crew_inputs            enable row level security;
alter table crew_rate_limits       enable row level security;
alter table crew_kv                enable row level security;
alter table crew_leads             enable row level security;
alter table crew_suppression       enable row level security;
alter table crew_competitor_facts  enable row level security;

-- Public bucket for the social media manager's rendered pictures
-- (.github/workflows/crew-render.yml uploads with the service role). Public
-- READ only, so the owner can open and download them; nobody else can write.
insert into storage.buckets (id, name, public)
values ('crew-media', 'crew-media', true)
on conflict (id) do nothing;
