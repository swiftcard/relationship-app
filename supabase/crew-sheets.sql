-- ── Crew: the Google Sheets headquarters ─────────────────────────────────────
-- Run once in the Supabase SQL editor, after crew.sql (and crew-office.sql).
-- Plan: docs/plans/agent-system.md → "The Sheet (2026-10-26)".
--
-- The database stays the source of truth. The Sheet ("SwiftCard Leads") is a
-- projection of it that the owners also type into: a Status, a Note, an
-- edited message. These tables remember which Sheet row is which record,
-- what the owners typed, every outward action (the audit trail), the switches
-- on the Controls tab, and the owners' edits to drafts (writing examples).
-- Service role only, like every crew_* table (RLS on, no policies).

-- One row per cell-row in the workbook. row_key is the short id in the Key
-- column; the backend finds a row by it after any sort or filter.
create table if not exists crew_sheet_rows (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  tab             text not null,                            -- the tab's id (sheets/tabs), not its display name
  row_key         text not null unique,                     -- "A-1b2c3d4e" (approval) / "L-…" (lead) / "F-…" (finding)
  entity_kind     text not null,                            -- approval | lead | finding | custom
  entity_id       text not null,
  status          text not null default 'New',              -- the Status word in the Sheet
  owner_cols      jsonb not null default '{}'::jsonb,       -- what the owner typed, by column key
  shown_status    text,                                     -- the Status the sync last wrote into every copy (a copy still showing it is stale, not a decision)
  agent_hash      text not null default '',                 -- hash of the agent-owned cells last written
  synced_at       timestamptz,
  owner_edited_at timestamptz
);
create index if not exists crew_sheet_rows_tab_idx on crew_sheet_rows (tab, created_at desc);
create index if not exists crew_sheet_rows_entity_idx on crew_sheet_rows (entity_kind, entity_id);

-- The audit trail: every outward action, simulated or real, plus every
-- status change that came from the Sheet. The Activity Log tab shows the
-- last few hundred; this keeps all of them.
create table if not exists crew_activity (
  id          uuid primary key default gen_random_uuid(),
  at          timestamptz not null default now(),
  agent_id    text,
  platform    text,
  action      text not null,                                -- drafted | status | sent | posted | published | suppressed | control | sync | error
  target      text,                                         -- who or where (a URL, a handle, an email), never a secret
  message     text,                                         -- the exact text sent or posted, when there was one
  result      text not null default 'ok',                   -- ok | simulated | failed | skipped
  error       text,
  row_key     text,
  approved_by text,                                         -- the Sheet editor's email when the Sheet asked for it
  simulated   boolean not null default false
);
create index if not exists crew_activity_at_idx on crew_activity (at desc);
create index if not exists crew_activity_row_idx on crew_activity (row_key);

-- The Controls tab, validated and stored. The backend only honors keys it
-- knows (sheets/controls.ts) and values that pass its checks; a cell with a
-- bad value is written back with the last good one. dry_run starts true.
create table if not exists crew_controls (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  source      text not null default 'sheet'                 -- sheet | admin | system
);
insert into crew_controls (key, value, source) values ('dry_run', 'true'::jsonb, 'system') on conflict (key) do nothing;

-- The owners' edits to drafts (Message to Send changed in the Sheet). The
-- last 30 for an agent's kind are shown to the model as examples.
create table if not exists crew_edits (
  id          uuid primary key default gen_random_uuid(),
  at          timestamptz not null default now(),
  agent_id    text not null,
  kind        text not null,
  approval_id uuid not null,
  before      text not null,
  after       text not null
);
create index if not exists crew_edits_agent_idx on crew_edits (agent_id, at desc);

-- shown_status was added 2026-10-27: a database that ran an earlier copy of
-- this file gets it here (the whole file is safe to run again).
alter table crew_sheet_rows add column if not exists shown_status text;

-- Suppression gains where an entry came from and which channel it covers
-- (email, or a platform handle such as instagram:@name). Existing rows keep
-- working: value stays the key.
alter table crew_suppression add column if not exists source  text not null default 'manual';   -- manual | sheet | opt_out_feed | reply_handler
alter table crew_suppression add column if not exists channel text not null default 'email';    -- email | domain | <platform>

alter table crew_sheet_rows enable row level security;
alter table crew_activity   enable row level security;
alter table crew_controls   enable row level security;
alter table crew_edits      enable row level security;
