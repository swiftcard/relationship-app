-- ── The database clock's hourly push and trial-notice jobs ─────────────────
--
-- pg_cron + pg_net run these on the hour through public.clock_call(job, url,
-- vault_secret_name, method, timeout_ms), which logs every call to
-- public.clock_calls. clock_call itself lives in production only (its file was
-- removed by 0639352a; see demo-bookings.sql's header).
--
-- Until 2026-11-04 both jobs named the Vault secret push_catchup_secret, which
-- was never created: PUSH_CATCHUP_SECRET is write-only ("sensitive") in Vercel,
-- so its value could not be copied. Every call logged "secret
-- push_catchup_secret is missing from Vault" and the work only happened when
-- GitHub's best-effort schedule fired (a few times a day). The clock now has its
-- own key: CLOCK_SECRET in Vercel = Vault clock_secret. The routes accept it
-- next to PUSH_CATCHUP_SECRET, so the GitHub workflows are unchanged and either
-- caller can run them. Every route is idempotent (push_log marks, Resend
-- idempotency keys, purge only what is due), so both firing is harmless.
--
-- The secret value is never in this file. Create it once:
--   select vault.create_secret('<same value as Vercel CLOCK_SECRET>', 'clock_secret',
--     'Bearer secret for the hourly push-catchup and trial-notice clock jobs');
--
-- Re-running this file replaces the jobs instead of adding second ones.

select cron.unschedule('push-catchup') where exists (select 1 from cron.job where jobname = 'push-catchup');
select cron.schedule('push-catchup', '0 * * * *', $$
  select clock_call('push-catchup:catchup', 'https://swiftcard.me/api/push/catchup', 'clock_secret');
  select clock_call('push-catchup:recap', 'https://swiftcard.me/api/push/recap', 'clock_secret');
  select clock_call('push-catchup:activation', 'https://swiftcard.me/api/push/activation', 'clock_secret');
  select clock_call('push-catchup:purge-due', 'https://swiftcard.me/api/account/purge-due', 'clock_secret');
$$);

select cron.unschedule('trial-notice') where exists (select 1 from cron.job where jobname = 'trial-notice');
select cron.schedule('trial-notice', '17 * * * *',
  $$select clock_call('trial-notice', 'https://swiftcard.me/api/billing/trial-notice', 'clock_secret')$$);

-- Card Builder's "3 follow-ups due today" push to staff (2026-11-13,
-- lib/prospect-preview/digest.ts). Its own job, so the three above are
-- untouched. The route decides whether it is morning in New York and whether
-- today's has gone, so the hourly call sends at most one push a day.
select cron.unschedule('prospect-follow-ups') where exists (select 1 from cron.job where jobname = 'prospect-follow-ups');
select cron.schedule('prospect-follow-ups', '7 * * * *',
  $$select clock_call('prospect-follow-ups', 'https://swiftcard.me/api/push/prospect-follow-ups', 'clock_secret')$$);
