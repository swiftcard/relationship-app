-- Office stats functions: pin search_path.  WRITTEN 2026-11-15, NOT YET APPLIED.
--
-- Supabase's security advisor flags these four functions ("Function Search
-- Path Mutable"): with no search_path of their own they resolve table names
-- through whatever search_path the CALLER has. They are plain SQL functions,
-- not SECURITY DEFINER, and only service_role may execute them, so nobody can
-- exploit this today. Pinning the path removes the warning and keeps it that
-- way if a grant ever changes.
--
-- Safe to run more than once. Changes no data and no function body, and the
-- signatures are the ones production reported on 2026-11-15.
--
-- To apply: Supabase dashboard -> SQL Editor -> paste -> Run.
-- To check: Advisors -> Security no longer lists the four functions, or
--   select proname, proconfig from pg_proc where proname like 'office\_%';
-- To undo:  alter function ... reset search_path;  (same four signatures)

alter function public.office_employee_view_stats(text[], timestamptz, timestamptz)
  set search_path = public, pg_temp;

alter function public.office_employee_lead_stats(text[], timestamptz, timestamptz)
  set search_path = public, pg_temp;

alter function public.office_unique_visitors(text[], timestamptz, timestamptz)
  set search_path = public, pg_temp;

alter function public.office_daily_views_tz(text[], timestamptz, timestamptz, text)
  set search_path = public, pg_temp;
