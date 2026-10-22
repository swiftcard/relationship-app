-- ── The clock: hourly and 15-minute jobs, run by the database (2026-10-21) ────
-- WHAT: pg_cron + pg_net call production on a schedule, in place of GitHub
-- Actions schedules. This repo is private, so GitHub-hosted minutes are
-- limited, and every scheduled run costs at least a minute: the 15-minute and
-- hourly jobs alone were ~7,000 of the 2,000 free minutes a month, and GitHub
-- stopped starting jobs at all. Supabase runs these for free. Vercel's Hobby
-- plan can't (two crons, once a day each; an hourly one breaks every deploy).
--
-- Jobs (same routes, same secrets the GitHub workflows used):
--   crew-tick      */15 * * * *  POST /api/crew/tick              crew_tick_secret
--   push-catchup   0 * * * *     GET  /api/push/catchup, /recap, /activation,
--                                     /api/account/purge-due      push_catchup_secret
--   trial-notice   17 * * * *    GET  /api/billing/trial-notice   push_catchup_secret
--   clock-collect  */15 * * * *  copies each call's HTTP status into clock_calls
--
-- SECRETS live in Supabase Vault, never in this file. Add one with:
--   select vault.create_secret('<value>', 'push_catchup_secret');
-- (the value of PUSH_CATCHUP_SECRET in Vercel → Settings → Environment
-- Variables). Until a secret exists, its jobs record "secret missing" and call
-- nothing.
--
-- WATCHED BY scripts/health-check.mjs (uptime.yml): it reads clock_status()
-- and opens the uptime incident on two failed calls in a row, or no success in
-- 12 hours, per job.
--
-- SAFE to re-run: IF NOT EXISTS, CREATE OR REPLACE, and cron.schedule updates
-- a job with the same name. Touches no existing table.
-- ROLLBACK: select cron.unschedule(j) for each job name above; drop function
-- clock_status(), clock_collect(), clock_call(text, text, text, text, int);
-- drop table clock_calls. Then put `schedule:` back in the three workflows.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists clock_calls (
  id          bigserial primary key,
  job         text not null,                 -- e.g. 'push-catchup:recap'
  request_id  bigint,                        -- net.http_* request id
  called_at   timestamptz not null default now(),
  status      int,                           -- HTTP status, filled by clock_collect()
  error       text                           -- pg_net error, timeout, or missing secret
);
create index if not exists clock_calls_job_idx on clock_calls (job, called_at desc);
create index if not exists clock_calls_open_idx on clock_calls (request_id) where status is null and error is null;
alter table clock_calls enable row level security;

-- One authenticated call to production, recorded so it can be checked later.
create or replace function clock_call(p_job text, p_url text, p_secret_name text, p_method text default 'GET', p_timeout_ms int default 90000)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_id bigint;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = p_secret_name;
  if v_secret is null or v_secret = '' then
    insert into clock_calls (job, error) values (p_job, 'secret ' || p_secret_name || ' is missing from Vault');
    return;
  end if;
  if p_method = 'POST' then
    v_id := net.http_post(url := p_url, body := '{}'::jsonb,
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
      timeout_milliseconds := p_timeout_ms);
  else
    v_id := net.http_get(url := p_url,
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
      timeout_milliseconds := p_timeout_ms);
  end if;
  insert into clock_calls (job, request_id) values (p_job, v_id);
end;
$$;

-- pg_net answers asynchronously and keeps responses for 6 hours, so copy each
-- status across while it is still there. A call with no response after 30
-- minutes is recorded as lost. Rows older than 14 days are dropped.
create or replace function clock_collect()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update clock_calls c
     set status = r.status_code,
         error  = case when r.timed_out then 'timed out' else r.error_msg end
    from net._http_response r
   where r.id = c.request_id and c.status is null and c.error is null;
  update clock_calls
     set error = 'no response recorded'
   where status is null and error is null and called_at < now() - interval '30 minutes';
  delete from clock_calls where called_at < now() - interval '14 days';
end;
$$;

-- Per job: when it last answered 200, and whether its last two finished calls
-- both failed. Read by scripts/health-check.mjs with the service role.
create or replace function clock_status()
returns table (job text, last_ok timestamptz, last_two_failed boolean, last_error text)
language sql
security definer
set search_path = public
stable
as $$
  with done as (
    select c.job, c.called_at, c.status, c.error,
           row_number() over (partition by c.job order by c.called_at desc) as n
      from clock_calls c
     where c.status is not null or c.error is not null
  )
  select d.job,
         max(d.called_at) filter (where d.status = 200),
         coalesce(bool_and(d.status is distinct from 200) filter (where d.n <= 2), false) and count(*) filter (where d.n <= 2) = 2,
         max(coalesce(d.error, 'HTTP ' || d.status)) filter (where d.n = 1 and d.status is distinct from 200)
    from done d
   group by d.job;
$$;

revoke all on function clock_call(text, text, text, text, int) from public, anon, authenticated;
revoke all on function clock_collect() from public, anon, authenticated;
revoke all on function clock_status() from public, anon, authenticated;
grant execute on function clock_status() to service_role;

select cron.schedule('crew-tick', '*/15 * * * *',
  $$select clock_call('crew-tick', 'https://swiftcard.me/api/crew/tick', 'crew_tick_secret', 'POST', 300000)$$);

select cron.schedule('push-catchup', '0 * * * *', $$
  select clock_call('push-catchup:catchup', 'https://swiftcard.me/api/push/catchup', 'push_catchup_secret');
  select clock_call('push-catchup:recap', 'https://swiftcard.me/api/push/recap', 'push_catchup_secret');
  select clock_call('push-catchup:activation', 'https://swiftcard.me/api/push/activation', 'push_catchup_secret');
  select clock_call('push-catchup:purge-due', 'https://swiftcard.me/api/account/purge-due', 'push_catchup_secret');
$$);

select cron.schedule('trial-notice', '17 * * * *',
  $$select clock_call('trial-notice', 'https://swiftcard.me/api/billing/trial-notice', 'push_catchup_secret')$$);

select cron.schedule('clock-collect', '*/15 * * * *', $$select clock_collect()$$);
