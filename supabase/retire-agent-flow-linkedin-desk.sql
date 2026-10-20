-- ── Retire the Agent Flow LinkedIn desk (2026-10-19) ─────────────────────────
-- NOT APPLIED. The owner applies this by hand.
--
-- The admin Agent Flow tab and its LinkedIn desk were removed. This drops the
-- one table that only the desk used AND that holds no data (0 rows when
-- checked read-only on 2026-10-19). Its indexes go with it; it never had
-- policies beyond "RLS on", triggers or functions, and nothing references it.
--
-- Deliberately NOT dropped, because they hold rows or kept code still reads
-- them: agent_blog_posts (public /blog), agent_connections, agent_system,
-- agent_action_history (90), agent_blog_topics (5), agent_competitor_snapshots
-- (19), agent_competitors, agent_chat*, agent_messages, agent_queue_items,
-- agent_radar_*, agent_runs, agent_settings, agent_playbooks, agent_requests,
-- agent_page_snapshots, agent_ig_*, agent_fb_*, agent_pins, media_assets.
-- agent_system.linkedin (jsonb) stays too: dropping a column is not needed.

drop table if exists agent_li_prospects;
