-- ── Retire the old Agent Flow system's empty tables (2026-10-19) ─────────────
-- NOT APPLIED. The owner applies this by hand.
--
-- The admin Agent Flow tab, its marketing team, the monitoring agents, the
-- Instagram/Facebook comment bots and the LinkedIn desk were removed from the
-- code. This drops only the tables that nothing reads any more AND that held
-- no rows when counted read-only on 2026-10-19. Indexes, RLS and constraints
-- go with each table; none has policies, triggers or functions, and no view or
-- foreign key references them.
--
-- Deliberately NOT dropped (they hold data, or kept code still reads them):
--   agent_blog_posts (4, public /blog), agent_connections (2, connect plumbing),
--   agent_system (1, /api/agent-email), agent_pins (0, Pinterest kept),
--   agent_action_history (90), agent_blog_topics (5), agent_competitor_snapshots (19),
--   agent_competitors (7), agent_chat (160), agent_chat_orders (87), agent_messages (811),
--   agent_playbooks (15), agent_queue_items (126), agent_radar_signals (1167),
--   agent_radar_sources (40), agent_requests (2), agent_runs (252), agent_settings (46).
-- Decide on those when the new agent system is designed.
-- agent_system.linkedin (jsonb) stays: dropping a column is not needed.

drop table if exists agent_li_prospects;
drop table if exists agent_ig_events;
drop table if exists agent_ig_posts;
drop table if exists agent_fb_events;
drop table if exists agent_fb_posts;
drop table if exists agent_page_snapshots;
drop table if exists media_assets;
