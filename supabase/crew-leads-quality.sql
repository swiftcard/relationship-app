-- ── Crew: better leads (one per company, a score, why, hook and opener) ─────
-- NOT YET APPLIED TO PRODUCTION. Apply it BEFORE merging the code that uses it
-- (docs/plans/leads-quality-rollout.md), after the owner approves.
--
-- WHAT: six nullable columns on crew_leads, and a partial UNIQUE index that
-- makes the database refuse a second lead for the same company.
--   company_key   the company a lead belongs to (src/lib/crew/leads/quality.ts):
--                 the site's host, or host + team name on a shared brokerage host
--   email_status  Domain OK / No MX Record / No Mail Server / Unchecked / None.
--                 Domain OK means the domain names a mail server; never a verified mailbox
--   score         0 to 100, for sorting
--   why, hook     why they fit, and one specific detail from their own site
--   message       Web Leads: an email's opening line. Office: the call opener
--
-- ONE COMPANY, ENFORCED: recordLeads checks company keys before inserting,
-- but two runs at once (Web Leads and Office Prospects on the same business)
-- could both pass that check. The unique index decides the race: the second
-- insert fails with 23505, which the store counts as a rejected duplicate,
-- never a failed run. It covers only rows WITH a key (WHERE company_key IS NOT
-- NULL), so the 192 leads saved before this, which all have NULL and include
-- companies saved more than once, are never touched and never conflict.
-- A legacy lead can't race (it is never written again); new leads are checked
-- against legacy ones in code (companyKeysTaken works their key out from the
-- site and name).
--
-- SAFE: adds columns and an index only; no row is changed, and the leads
-- already saved keep NULL values (their Sheet rows stay exactly as they are).
-- The index builds instantly: every existing row is NULL, so nothing can
-- conflict. Running it twice is a no-op. Until it runs, the agents save leads
-- without these fields, and only the in-code check stops company duplicates.
--
-- VERIFY (read-only, after applying):
--   select count(*) from crew_leads;                                  -- unchanged (192 at the 2026-10-28 audit)
--   select count(*) from crew_leads where company_key is not null;    -- 0 until an agent runs
--   select column_name, data_type from information_schema.columns
--     where table_name = 'crew_leads' and column_name in ('company_key','email_status','score','why','hook','message');  -- 6 rows
--   select indexdef from pg_indexes where indexname = 'crew_leads_company_key_unique';  -- UNIQUE … WHERE (company_key IS NOT NULL)
--
-- ROLLBACK: drop index if exists crew_leads_company_key_unique;
-- alter table crew_leads drop column company_key, drop column email_status,
--   drop column score, drop column why, drop column hook, drop column message;

alter table crew_leads add column if not exists company_key  text;
alter table crew_leads add column if not exists email_status text;
alter table crew_leads add column if not exists score        smallint;
alter table crew_leads add column if not exists why          text;
alter table crew_leads add column if not exists hook         text;
alter table crew_leads add column if not exists message      text;

-- Unique among rows with a key: new leads, one per company. Legacy rows (NULL) are exempt.
create unique index if not exists crew_leads_company_key_unique on crew_leads (company_key) where company_key is not null;
