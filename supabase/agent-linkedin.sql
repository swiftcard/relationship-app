-- ── Agent Flow: the LINKEDIN DESK (owner order 2026-10-02) ───────────────────
-- "The main goal is to gain users." LinkedIn bans tools that search it or send
-- on a member's behalf, and restricts the accounts that use them — so the desk
-- does everything EXCEPT the click on LinkedIn: the owner pastes a post or a
-- profile, the desk writes the comment, the connection note, the message and
-- the follow-up, and keeps the ledger of who was contacted, who replied and
-- who signed up.
--
-- Each person gets their own tracked link (swiftcard.me/go/li_d_<id>), so the
-- signup is counted against the exact conversation that produced it.
--
-- Same rules as the rest of Agent Flow: RLS on with no policies (service-role
-- only); nothing here touches product tables or user data. Idempotent.

-- ── 1. One row per person we decided to contact ──────────────────────────────
create table if not exists agent_li_prospects (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,        -- li_d_<id> = the /go code = profiles.signup_source
  name             text,
  headline         text,
  company          text,
  profile_url      text,
  post_url         text,
  pasted           text,                        -- what the owner pasted (the post / the profile)
  hook             text,                        -- the one specific detail the drafts hang on
  trigger          text not null default 'other',  -- new_job | new_license | team | event | competitor | warm | other
  profession       text,                        -- a /for/ slug: which design the link opens on
  sender           text,                        -- whose LinkedIn profile sends it
  drafts           jsonb not null default '{}'::jsonb,  -- { comment[], note[], message[], followup[] }
  status           text not null default 'new', -- new | requested | connected | messaged | replied | signed_up | closed
  notes            text,
  requested_at     timestamptz,
  connected_at     timestamptz,
  messaged_at      timestamptz,
  followup_sent_at timestamptz,
  replied_at       timestamptz,
  signed_up_at     timestamptz,
  closed_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists agent_li_prospects_status_idx on agent_li_prospects (status, created_at desc);
-- Never the same person twice: one row per profile, whatever the capitalisation.
create unique index if not exists agent_li_prospects_profile_idx on agent_li_prospects (lower(profile_url)) where profile_url is not null;

-- ── 2. The owner's settings ──────────────────────────────────────────────────
-- linkedin = { senders, daily_target, followup_days }  (null = defaults)
alter table agent_system add column if not exists linkedin jsonb;

alter table agent_li_prospects enable row level security;
