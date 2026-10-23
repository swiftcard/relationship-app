-- ── Crew: the office (doors, opening hours, pauses, the manager chat) ─────────
-- APPLIED TO PRODUCTION 2026-10-23 (Supabase MCP; verified: 6 crew_teams rows all open,
-- crew_chat, crew_agents.paused_until + pause_note, RLS on, no policies).
--
-- WHAT: the Agents tab becomes an office. Each team has a door the owner opens
-- or locks (optionally on opening hours, New York time), the team manager can
-- pause one of its agents from the team chat, and the chat itself is stored.
--   crew_teams    one row per team: the door, its hours, a one-tap override
--                 until the next scheduled change, the manager's standing focus
--   crew_agents   + paused_until, pause_note
--   crew_chat     owner ↔ manager messages and the system's "Done: …" lines
--
-- SAFE: new tables and two nullable columns only. Every door is seeded OPEN, so
-- nothing about which agents run changes until the owner taps a door. Running
-- it twice is a no-op. RLS is ON with no policies: only the service role
-- (routes behind requireAdmin, the tick behind CREW_TICK_SECRET) reads or
-- writes. Until it runs, the app reads every door as open and chat as empty.
--
-- ROLLBACK: drop table crew_chat; drop table crew_teams;
-- alter table crew_agents drop column paused_until, drop column pause_note;

create table if not exists crew_teams (
  team            text primary key,
  door_open       boolean not null default true,           -- the door when no hours are set
  hours           jsonb,                                   -- {"days":[1,2,3,4,5],"open":540,"close":1080} (NY minutes)
  override_open   boolean,                                 -- a tap while hours are set …
  override_until  timestamptz,                             -- … lasts until the next scheduled change
  focus           text,                                    -- the manager's standing order
  focus_until     timestamptz,
  focus_by        text,
  updated_at      timestamptz not null default now()
);
insert into crew_teams (team) values ('watchdog'), ('replies'), ('contact'), ('leads'), ('office'), ('marketing') on conflict (team) do nothing;
alter table crew_teams enable row level security;

alter table crew_agents add column if not exists paused_until timestamptz;
alter table crew_agents add column if not exists pause_note text;

create table if not exists crew_chat (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  team        text not null,
  author      text not null check (author in ('owner', 'manager', 'system')),
  body        text not null,
  status      text not null default 'done' check (status in ('pending', 'done', 'failed')),
  meta        jsonb not null default '{}'::jsonb           -- { orders, model, usd }
);
create index if not exists crew_chat_team_idx on crew_chat (team, created_at desc);
alter table crew_chat enable row level security;
