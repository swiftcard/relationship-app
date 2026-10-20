-- ── Crew: economy mode, the second-opinion switch, a $2/day cap (2026-10-20) ─
-- APPLIED TO PRODUCTION 2026-10-20 (owner-approved, Supabase MCP); verified: cap
-- 2.00, economy on, second opinion off.
--
-- WHAT: two switches on the Agents tab's Settings, and a lower default daily
-- limit while SwiftCard has no users yet.
--   economy        on  → Haiku sorts and writes short comments, the Watchdog
--                        and the daily reports run with no AI, tie-breaks on
--                        Sonnet. Off → the original setup.
--   second_opinion off → drafts skip the ChatGPT check (the owner approves
--                        everything anyway). On → the original debate.
--
-- SAFE: adds two columns with defaults to crew_settings (one row) and lowers
-- the daily cap from the old $8 default to $2 only if nobody changed it.
-- Running it twice is a no-op.
--
-- ROLLBACK: alter table crew_settings drop column economy, drop column
-- second_opinion; update crew_settings set daily_usd_cap = 8;

alter table crew_settings add column if not exists economy boolean not null default true;
alter table crew_settings add column if not exists second_opinion boolean not null default false;
alter table crew_settings alter column daily_usd_cap set default 2.00;
update crew_settings set daily_usd_cap = 2.00 where id = 1 and daily_usd_cap = 8.00;
