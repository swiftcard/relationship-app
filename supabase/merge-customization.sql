-- Atomic writes to profiles.customization (audit B-03, 2026-10-16).
--
-- customization is one JSONB column shared by unrelated state: billing
-- (_planSource, _everPaid, the trial and cancel mirrors, _paymentFailedAt),
-- the plan-chosen marker, the push switches, the monthly meters. Every writer
-- used to read the whole object, change a copy and write the whole copy back.
-- Two writers for one person at once (a checkout fires three Stripe events in
-- the same second) erased each other's keys: last writer wins.
--
-- merge_customization changes only the keys it is given, in one statement,
-- under the row's lock: `(customization - remove) || patch`. Keys another
-- writer set meanwhile survive. Returns the new customization, or NULL when
-- no row matched (the profile is gone, or the guard below didn't hold).
--
-- p_require_sub: write only while profiles.stripe_subscription_id is still
-- that subscription (the Stripe webhook's stale-retry guard), NULL to skip.
-- p_require_plan: write only while profiles.plan is still that plan (the
-- "Pro ended" prompt is only true while the account is on Free), NULL to skip.
--
-- Server-only: executable by the service role alone, so a signed-in browser
-- can never call it to rewrite its own billing state.
--
-- Applied to production 2026-10-16 (Supabase MCP apply_migration) WITHOUT
-- p_require_plan: production holds merge_customization(uuid, jsonb, text[],
-- text). Nothing in src/ passes p_require_plan yet, so the code works against
-- that version. Run this file when a caller needs the plan guard.

drop function if exists public.merge_customization(uuid, jsonb, text[], text);

create or replace function public.merge_customization(
  p_user uuid,
  p_set jsonb default '{}'::jsonb,
  p_remove text[] default '{}'::text[],
  p_require_sub text default null,
  p_require_plan text default null
) returns jsonb
language sql
security invoker
set search_path = public
as $$
  update public.profiles
     set customization = (coalesce(customization, '{}'::jsonb) - coalesce(p_remove, '{}'::text[]))
                         || coalesce(p_set, '{}'::jsonb)
   where id = p_user
     and (p_require_sub is null or stripe_subscription_id = p_require_sub)
     and (p_require_plan is null or plan = p_require_plan)
  returning customization;
$$;

revoke all on function public.merge_customization(uuid, jsonb, text[], text, text) from public;
revoke all on function public.merge_customization(uuid, jsonb, text[], text, text) from anon, authenticated;
grant execute on function public.merge_customization(uuid, jsonb, text[], text, text) to service_role;
