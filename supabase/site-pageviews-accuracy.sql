-- ── Website analytics: where a visit came from, and on what (2026-10-28) ────
-- APPLIED TO PRODUCTION 2026-10-28 (owner-approved plan, Supabase MCP).
--
-- WHY: the owner called the Website page "fake". Among the reasons: a visit's
-- source was counted once per PAGEVIEW (a 6-page visit from Google counted 6
-- times), campaign tags (?utm_…, ?src=badge) were thrown away, and there was
-- no way to say phone vs computer. These columns let the page count each of
-- those once per visit and say so plainly. Additive and nullable: old rows
-- keep working and simply have no campaign or device.
--
--   landing        true on the first pageview of a visit (the entry page) —
--                  sources and campaigns are counted on these rows only
--   utm_source / utm_medium / utm_campaign   from the landing URL's query
--   src            SwiftCard's own ?src= tag (the Swift Links badge, flyers)
--   device         phone | tablet | computer, from the browser's own report

alter table public.site_pageviews
  add column if not exists landing boolean not null default false,
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists src text,
  add column if not exists device text;

create index if not exists site_pageviews_landing_idx
  on public.site_pageviews (created_at desc)
  where landing = true;
