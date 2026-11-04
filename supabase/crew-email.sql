-- ── Crew: approved emails sent from the SwiftCard mailbox ───────────────────
-- Run once in the Supabase SQL editor, after crew.sql and crew-sheets.sql.
-- Additive only: one new table, nothing existing changes.
--
-- One row per approved email draft (crew_approvals, kind dm, platform email).
-- The row is the send's lock and its record:
--   • approval_id is unique, so one draft can never become two emails;
--   • message_id_header is the RFC 822 Message-ID we put on the email before
--     Gmail sees it, so a send whose answer never came back (timeout, crash)
--     is looked up in the Sent folder before anyone may retry it;
--   • the partial unique index allows one live first email per address.
-- Statuses: sending (claimed, Gmail call in flight), sent, failed (Gmail said
-- no; safe to retry), unknown (no answer from Gmail; checked in Sent before a
-- retry), simulated (dry run; nothing left the building).
-- Service role only, like every crew_* table (RLS on, no policies).

create table if not exists crew_email_sends (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  approval_id        uuid not null unique references crew_approvals(id) on delete restrict,
  lead_id            uuid,
  to_email           text not null,
  from_email         text not null,
  subject            text not null,
  body_sha           text not null,
  message_id_header  text not null unique,
  status             text not null check (status in ('sending', 'sent', 'failed', 'unknown', 'simulated')),
  attempts           integer not null default 0,
  error              text,
  gmail_id           text,
  thread_id          text,
  approved_by        text not null,
  sent_at            timestamptz,
  reply_state        text check (reply_state in ('replied', 'bounced')),
  replied_at         timestamptz,
  last_checked_at    timestamptz
);

-- One live first email per address, ever (a retry reuses its own row).
create unique index if not exists crew_email_sends_one_per_address
  on crew_email_sends (lower(to_email))
  where status in ('sending', 'sent', 'unknown');

create index if not exists crew_email_sends_status_idx on crew_email_sends (status, updated_at desc);
create index if not exists crew_email_sends_replies_idx on crew_email_sends (sent_at desc) where status = 'sent' and reply_state is null;

alter table crew_email_sends enable row level security;
revoke all on table crew_email_sends from anon, authenticated;
