-- ── Agent Flow: the FACEBOOK BOT (owner order 2026-10-02) ────────────────────
-- The SwiftCard Facebook Page's version of "Comment CARD and we'll send you
-- one". The goal is signups, so the bot does three things and nothing else:
-- (1) sends the card link, privately, to people who commented the keyword on
-- one of the PAGE's posts; (2) answers questions people ask the Page in
-- comments and in Messenger; (3) keeps a per-post ledger so the admin can see
-- which post brought signups.
--
-- It only ever writes to people who wrote to the Page first. There is no
-- table, column or code path here for cold messages, likes, follows or groups.
--
-- Same rules as the rest of Agent Flow: RLS on with no policies (service-role
-- only); nothing here touches product tables or user data. Idempotent.

-- ── 1. Every comment / message the bot saw, and what it did about it ─────────
create table if not exists agent_fb_events (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,              -- comment | message
  external_id  text not null,              -- Facebook's comment id / message id
  post_id      text,                       -- the Page post it was left on (comments)
  user_id      text,                       -- who wrote it (Page-scoped id)
  username     text,                       -- their name, when Facebook shares it
  text         text,
  keyword      text,                       -- the keyword it matched, null = none
  action       text not null default 'none',   -- link (send the card link) | answer | none
  status       text not null default 'new',    -- new | sent | queued | skipped | failed
  reason       text,                       -- why it was skipped / queued / failed
  reply        text,                       -- what was sent (or drafted)
  code         text,                       -- the /go code inside the link (= signup source)
  item_id      uuid references agent_queue_items(id) on delete set null,
  created_at   timestamptz not null default now(),
  handled_at   timestamptz,
  unique (kind, external_id)
);
create index if not exists agent_fb_events_status_idx on agent_fb_events (status, created_at desc);
create index if not exists agent_fb_events_post_idx   on agent_fb_events (post_id, created_at desc);
create index if not exists agent_fb_events_user_idx   on agent_fb_events (user_id, post_id);

-- ── 2. The Page's own posts, with the code each one's link carries ───────────
-- code = 'fb_p_<id>' is what a signup from that post is recorded under
-- (profiles.signup_source), so post → comments → messages → signups joins on it.
create table if not exists agent_fb_posts (
  post_id        text primary key,
  code           text not null unique,
  permalink      text,
  message        text,
  posted_at      timestamptz,
  comments_count integer not null default 0,
  updated_at     timestamptz not null default now()
);

-- ── 3. The owner's settings, and the bot's own bookkeeping ───────────────────
-- facebook        = { enabled, auto_answers, keywords, message, public_replies,
--                     daily_cap, profession }  (null = defaults, OFF)
-- facebook_state  = { posts: {<id>: comments_count}, last_tick_at, last_error }
--                   — written by the bot only, kept apart so a Settings save can
--                   never be overwritten by a running tick.
alter table agent_system add column if not exists facebook jsonb;
alter table agent_system add column if not exists facebook_state jsonb;

alter table agent_fb_events enable row level security;
alter table agent_fb_posts  enable row level security;
