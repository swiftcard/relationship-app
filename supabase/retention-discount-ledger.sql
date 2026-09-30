-- The 50%-off retention offer is once per PERSON (owner, 2026-09-30).
--
-- APPLIED to production 2026-09-30 (Supabase MCP apply_migration
-- "retention_discount_ledger"; verified: the check lists all five kinds).
--
-- It was once per ACCOUNT (customization._retentionUsed): delete the account,
-- wait out the 30-day purge, sign up again with the same email and card, and
-- the delete flow offered half price again. Two more ledger kinds close that,
-- the same way 'email_retention' already does for the free-days gift:
--
--   'email_retention_discount'  sha256 of the normalised account email
--   'card_retention_discount'   sha256 of the Stripe card fingerprint
--
-- lib/account-purge.ts never touches trial_ledger, so these survive a purge.
-- The code fails OPEN if this migration is missing (ledgerHas → false), so it
-- must be applied BEFORE the code that writes these kinds ships.
--
-- Rollback: re-run the check from pro-trial-safeguards.sql (and delete the
-- rows of the two kinds first).

alter table public.trial_ledger drop constraint if exists trial_ledger_kind_check;
alter table public.trial_ledger
  add constraint trial_ledger_kind_check
  check (kind in ('card', 'email_trial', 'email_retention', 'email_retention_discount', 'card_retention_discount'));
