-- Final analytics review, 2026-10-06. CREATE OR REPLACE / IF NOT EXISTS — safe
-- to re-run. Three independent pieces:
--
-- 1. Two DIFFERENT link buttons pointing at the same site ("Listings" and
--    "Sold homes", both zillow.com) are two taps. card_events.target is a bare
--    host, so the visit-bucket unique index merged them and the second tap was
--    lost. The label joins the key. Created BEFORE the old index is dropped, so
--    no instant goes unprotected; dropping a unique index destroys no data.
--
-- 2. A card rename now also moves the analytics ingest log and any open
--    notification visit keys, so in-flight activity under the old slug isn't
--    orphaned.
--
-- 3. card_location_counts(): the dashboard Locations tab, aggregated in the
--    database. The app read raw rows and stopped at 10k, so a busy card's
--    "all time" list was really its newest 10k views. Service role only.

-- ── 1 ────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_card_events_visitor_surface_target_bucket
  ON public.card_events (
    card_owner_username,
    visitor_id,
    event_type,
    coalesce(surface, 'card'),
    coalesce(target, ''),
    coalesce(target_label, ''),
    public.card_view_bucket(created_at)
  )
  WHERE visitor_id IS NOT NULL AND event_type IN ('viewed_card', 'downloaded_vcard', 'clicked_link')
    AND created_at >= '2026-08-14 00:00:00+00';

DROP INDEX IF EXISTS uq_card_events_visitor_surface_bucket;

-- ── 2 ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rename_card_slug(p_card_id uuid, p_user_id uuid, p_new_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old_slug text;
BEGIN
  IF p_new_slug IS NULL OR p_new_slug !~ '^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
  END IF;

  SELECT username INTO v_old_slug
  FROM cards WHERE id = p_card_id AND user_id = p_user_id
  FOR UPDATE;
  IF v_old_slug IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_old_slug = p_new_slug THEN
    RETURN jsonb_build_object('ok', true, 'unchanged', true);
  END IF;

  IF EXISTS (SELECT 1 FROM cards WHERE username = p_new_slug)
     OR EXISTS (SELECT 1 FROM profiles WHERE username = p_new_slug) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'taken');
  END IF;

  UPDATE cards SET username = p_new_slug WHERE id = p_card_id;
  UPDATE card_views SET username = p_new_slug WHERE username = v_old_slug;
  UPDATE card_views SET username = p_new_slug || '__links' WHERE username = v_old_slug || '__links';
  UPDATE card_events SET card_owner_username = p_new_slug WHERE card_owner_username = v_old_slug;
  UPDATE leads SET card_owner = p_new_slug WHERE card_owner = v_old_slug;

  IF to_regclass('public.analytics_events') IS NOT NULL THEN
    UPDATE analytics_events SET username = p_new_slug WHERE username = v_old_slug;
  END IF;
  BEGIN
    UPDATE notifications SET card_owner = p_new_slug WHERE card_owner = v_old_slug;
    -- Open visits are keyed "<slug>:<who>:<bucket>" (lib/visit-notify.ts); a
    -- visit straddling the rename must keep joining its own row.
    UPDATE notifications SET visit_key = p_new_slug || substr(visit_key, length(v_old_slug) + 1)
      WHERE visit_key LIKE v_old_slug || ':%';
  EXCEPTION WHEN undefined_column OR undefined_table THEN
    NULL;
  END;
  -- The ingest log explains every counted/declined request by its slug.
  IF to_regclass('public.analytics_ingest_log') IS NOT NULL THEN
    UPDATE analytics_ingest_log SET entity_key = p_new_slug WHERE entity_key = v_old_slug;
    UPDATE analytics_ingest_log SET entity_key = p_new_slug || '__links' WHERE entity_key = v_old_slug || '__links';
  END IF;

  RETURN jsonb_build_object('ok', true, 'old', v_old_slug, 'new', p_new_slug);
END;
$function$;

-- ── 3 ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.card_location_counts(p_usernames text[])
 RETURNS TABLE (username text, location text, geo_accuracy text, n bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT v.username, v.location, v.geo_accuracy, count(*)::bigint AS n
  FROM card_views v
  WHERE v.username = ANY (p_usernames)
    AND v.location IS NOT NULL
  GROUP BY v.username, v.location, v.geo_accuracy;
$function$;

REVOKE ALL ON FUNCTION public.card_location_counts(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.card_location_counts(text[]) TO service_role;
