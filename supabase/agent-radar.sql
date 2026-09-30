-- ── Agent Flow: the RADAR (owner order 2026-09-30) ───────────────────────────
-- "All our agents and bots work for us in terms of marketing when we scan
-- Reddit, Telegram and all relevant websites."
--
-- The Radar is the listening layer. Code scans the public web (Reddit,
-- Telegram channels + any group a SwiftCard bot sits in, Hacker News, news
-- feeds, competitors' App Store reviews, YouTube) for real posts that matter
-- to SwiftCard, spends no tokens doing it, files each hit as a SIGNAL routed
-- to the agent whose job it is, and wakes that agent. The agent reads the
-- actual thread and hands the owner two finished replies, as always.
--
-- Same rules as the rest of Agent Flow: RLS on with no policies (service-role
-- only); nothing here touches product tables or user data. Idempotent.

-- ── 1. Sources: what the Radar listens to ────────────────────────────────────
-- Seeded from marketing-agents/config.json `radar` on the first scan; the
-- owner adds and removes sources from Agent Flow → Settings → Radar.
create table if not exists agent_radar_sources (
  id              text primary key,        -- 'reddit:search' | 'reddit:r/realtors' | 'telegram:@channel' | 'telegram:bot' | 'hn:search' | 'rss:<hash>' | 'appstore:blinq' | 'youtube:search'
  kind            text not null,           -- reddit_search | reddit_sub | telegram_channel | telegram_bot | hn | rss | appstore_reviews | youtube
  target          text not null,           -- subreddit / channel handle / feed URL / app id / query
  label           text,
  active          boolean not null default true,
  state           jsonb not null default '{}'::jsonb,   -- cursors (telegram offset), auth mode, etc.
  last_scanned_at timestamptz,
  last_error      text,
  found_total     integer not null default 0,
  created_at      timestamptz not null default now()
);

-- ── 2. Signals: the posts worth an agent's attention ─────────────────────────
create table if not exists agent_radar_signals (
  id             uuid primary key default gen_random_uuid(),
  source_id      text references agent_radar_sources(id) on delete set null,
  platform       text not null,            -- reddit | telegram | hn | news | appstore | youtube | web
  external_id    text not null,            -- the platform's own id (t3_xxx, chat:msg, objectID, url hash…)
  url            text,
  title          text,
  body           text,                     -- first ~1500 chars of the post
  author         text,
  community      text,                     -- r/realtors, the Telegram group title, the news outlet…
  posted_at      timestamptz,
  found_at       timestamptz not null default now(),
  intent         text not null,            -- brand | competitor_complaint | ask | competitor | topic | press | creator
  matched        jsonb not null default '[]'::jsonb,   -- the keywords that hit
  score          integer not null default 0,           -- 0-100; >= 50 wakes the agent
  engagement     jsonb not null default '{}'::jsonb,   -- {ups, comments, points, views}
  assigned_agent text,                     -- mentions | forums | outreach | influencer | pr | competitors
  status         text not null default 'new',          -- new | queued | handled | dismissed | noted | expired
  item_id        uuid references agent_queue_items(id) on delete set null,   -- the two-option item written for it
  unique (platform, external_id)
);
create index if not exists agent_radar_signals_status_idx on agent_radar_signals (status, score desc, found_at desc);
create index if not exists agent_radar_signals_agent_idx  on agent_radar_signals (assigned_agent, status, score desc);
create index if not exists agent_radar_signals_found_idx  on agent_radar_signals (found_at desc);

-- ── 3. The owner's listening list ────────────────────────────────────────────
-- Overrides for config.json `radar` ({keywords, brand, competitors,
-- complaint_words, subreddits, telegram_channels, feeds}); null = defaults.
alter table agent_system add column if not exists radar jsonb;

alter table agent_radar_sources enable row level security;
alter table agent_radar_signals enable row level security;
