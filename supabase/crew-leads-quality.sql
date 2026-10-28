-- ── Crew: better leads (one per company, a score, why, hook and opener) ─────
-- NOT YET APPLIED TO PRODUCTION. Apply it by hand once the PR is merged.
--
-- WHAT: six nullable columns on crew_leads, and an index for the company check.
--   company_key   the company a lead belongs to (src/lib/crew/leads/quality.ts):
--                 the site's host, or host + team name on a shared brokerage host
--   email_status  Domain OK / No Mail Server / Unchecked / None. Domain OK means
--                 the domain has a mail server; it is never a verified mailbox
--   score         0 to 100, for sorting
--   why, hook     why they fit, and one specific detail from their own site
--   message       Web Leads: an email's opening line. Office: the call opener
--
-- SAFE: adds columns only; no row is changed, and the leads already saved keep
-- empty values (their Sheet rows stay exactly as they are). Running it twice
-- is a no-op. Until it runs, the agents save leads without these fields and
-- find company duplicates from each saved lead's site and name instead.
--
-- ROLLBACK: drop index if exists crew_leads_company_key;
-- alter table crew_leads drop column company_key, drop column email_status,
--   drop column score, drop column why, drop column hook, drop column message;

alter table crew_leads add column if not exists company_key  text;
alter table crew_leads add column if not exists email_status text;
alter table crew_leads add column if not exists score        smallint;
alter table crew_leads add column if not exists why          text;
alter table crew_leads add column if not exists hook         text;
alter table crew_leads add column if not exists message      text;

-- Not unique: leads saved before this change may share a company, and they stay.
create index if not exists crew_leads_company_key on crew_leads (company_key);
