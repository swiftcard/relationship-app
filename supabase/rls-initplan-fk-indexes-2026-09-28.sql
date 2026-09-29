-- Performance pass from the Supabase performance advisor, 2026-09-28.
--
-- ⚠️ NOT YET APPLIED. Written and reviewed against the live policy definitions
-- (pg_policies, 2026-09-28) but the production run was held for the owner:
-- paste this file into the Supabase SQL editor for project grxmovpmlgmjncnyiyrt
-- and run it once. Idempotent: safe to run again. Then re-run the performance
-- advisor — the 17 "auth_rls_initplan" and 15 "multiple_permissive_policies"
-- warnings on these tables disappear.
--
-- Nothing here changes WHO can read or write a row. Every ALTER POLICY keeps
-- the predicate's meaning exactly and only changes how Postgres evaluates it.
--
-- 1. `auth.uid()` → `(select auth.uid())` in every RLS policy.
--    Bare `auth.uid()` is re-evaluated for EVERY ROW the policy filters; wrapped
--    in a sub-select Postgres computes it once per statement (an InitPlan) and
--    compares against a constant. On `profiles`, which every signed-in request
--    touches, that is the difference between an index lookup and a scan.
--    https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
--
-- 2. email_preferences had FOUR permissive policies for the same rows:
--    `owner_prefs` (ALL) plus one each for insert / select / update with the
--    identical predicate. Postgres runs every permissive policy on every query
--    and ORs them; three of the four were pure overhead. `owner_prefs` (ALL)
--    is a strict superset of the three, so dropping them changes no answer.
--
-- 3. Covering indexes for foreign keys the app filters on. A foreign key
--    without an index makes the parent-side delete/update check a sequential
--    scan of the child table, and the app's own `where owner_id = …` lookups
--    the same.
--
-- Left alone on purpose: the duplicate unique index on push_subscriptions
-- (`uq_push_subscriptions_endpoint` beside the `_key` constraint). It is
-- created by supabase/view-visit-window.sql, which the view-visit-window
-- tripwire pins; a 2-row-per-user table gains nothing from dropping it.
-- The agent_* tables' unindexed keys are internal marketing-agent bookkeeping
-- written a few rows a day.

-- ── 1. RLS InitPlan ─────────────────────────────────────────────────────────

ALTER POLICY "Own insert"       ON public.profiles WITH CHECK ((select auth.uid()) = id);
ALTER POLICY "Own profile read" ON public.profiles USING ((select auth.uid()) = id);
ALTER POLICY "Own update"       ON public.profiles USING ((select auth.uid()) = id);

ALTER POLICY owner_offices ON public.offices
  USING (owner_id = (select auth.uid()))
  WITH CHECK (owner_id = (select auth.uid()));
ALTER POLICY member_read_office ON public.offices
  USING (id IN (
    SELECT office_members.office_id FROM public.office_members
    WHERE office_members.user_id = (select auth.uid()) AND office_members.status = 'active'
  ));

ALTER POLICY member_read_self ON public.office_members
  USING (user_id = (select auth.uid()));
ALTER POLICY owner_manages_members ON public.office_members
  USING (office_id IN (SELECT offices.id FROM public.offices WHERE offices.owner_id = (select auth.uid())))
  WITH CHECK (office_id IN (SELECT offices.id FROM public.offices WHERE offices.owner_id = (select auth.uid())));

ALTER POLICY "own push log"                 ON public.push_log           USING ((select auth.uid()) = user_id);
ALTER POLICY "own unsubscribe events: read" ON public.unsubscribe_events USING ((select auth.uid()) = user_id);

ALTER POLICY "own devices readable"   ON public.user_devices USING ((select auth.uid()) = user_id);
ALTER POLICY "own devices insertable" ON public.user_devices WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "own devices updatable"  ON public.user_devices USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "own devices deletable"  ON public.user_devices USING ((select auth.uid()) = user_id);

-- ── 2. One policy per row on email_preferences ──────────────────────────────

DROP POLICY IF EXISTS "own email preferences: insert" ON public.email_preferences;
DROP POLICY IF EXISTS "own email preferences: read"   ON public.email_preferences;
DROP POLICY IF EXISTS "own email preferences: update" ON public.email_preferences;
ALTER POLICY owner_prefs ON public.email_preferences USING ((select auth.uid()) = user_id);

-- ── 3. Foreign-key covering indexes ─────────────────────────────────────────

CREATE INDEX IF NOT EXISTS contact_links_owner_id_idx        ON public.contact_links (owner_id);
CREATE INDEX IF NOT EXISTS contact_links_lead_message_id_idx ON public.contact_links (lead_message_id);
CREATE INDEX IF NOT EXISTS contact_devices_link_id_idx       ON public.contact_devices (link_id);
CREATE INDEX IF NOT EXISTS profiles_free_live_card_id_idx    ON public.profiles (free_live_card_id);
