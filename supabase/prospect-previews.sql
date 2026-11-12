-- ── Card Builder: preview cards for sales prospects (2026-11-11) ───────────
-- NOT APPLIED. Run this once in the Supabase SQL editor; until then
-- /admin/card-builder says so and /p/<slug> answers 404.
--
-- WHAT: staff build a preview card for a prospect's office in /admin/card-builder,
-- send them the unlisted link (swiftcard.me/p/<slug>), and are told the moment
-- the prospect really looks at it.
--
--   prospect_previews        one row per preview card
--   prospect_preview_views   one row per REAL view (never a page request, a
--                            bot, a link-preview fetch or a staff device)
--
-- SAFE: additive only. Two new tables, and one more allowed value ('prospects')
-- on admin_notifications.kind so the alert also lands in the admin's
-- notification center. No existing row or column changes.
-- IDEMPOTENT: every statement can be run again.
--
-- ADMIN-ONLY: RLS is ON with no policies on both tables, so the anon and
-- signed-in keys can neither read nor write them. The server reads and writes
-- with the service role, behind requireAdmin() (lib/admin.ts) for everything
-- except the public page's own lookup by slug and the view beacon's insert.
--
-- ROLLBACK:
--   drop table if exists public.prospect_preview_views;
--   drop table if exists public.prospect_previews;
--   (the extra 'prospects' kind on admin_notifications is harmless to leave)

create table if not exists public.prospect_previews (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '14 days'),
  status          text not null default 'live' check (status in ('live', 'paused')),
  slug            text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
  office_name     text not null,
  owner_name      text not null,
  owner_title     text,
  phone           text not null,
  email           text,
  logo_url        text,
  brand_primary   text not null default '#2C3A52' check (brand_primary ~ '^#[0-9a-fA-F]{6}$'),
  brand_secondary text not null default '#FFFFFF' check (brand_secondary ~ '^#[0-9a-fA-F]{6}$'),
  -- [{ "name": "…", "title": "…" }, …]
  team_members    jsonb not null default '[]'::jsonb,
  called          boolean not null default false,
  called_at       timestamptz,
  notes           text,
  -- The lead this preview was made for, when it came from the agents' leads.
  crew_lead_id    uuid
);

create index if not exists prospect_previews_created_idx on public.prospect_previews (created_at desc);

-- The link to crew_leads is a real foreign key only where that table exists
-- (supabase/crew.sql may not have been run yet). Deleting the lead keeps the
-- preview and clears the link.
do $$
begin
  if to_regclass('public.crew_leads') is not null
     and not exists (select 1 from pg_constraint where conname = 'prospect_previews_crew_lead_fk') then
    alter table public.prospect_previews
      add constraint prospect_previews_crew_lead_fk
      foreign key (crew_lead_id) references public.crew_leads (id) on delete set null;
  end if;
end $$;

create table if not exists public.prospect_preview_views (
  id                  uuid primary key default gen_random_uuid(),
  preview_id          uuid not null references public.prospect_previews (id) on delete cascade,
  viewed_at           timestamptz not null default now(),
  -- The browser's own visitor id (the sc_vid cookie). Not a person.
  device_id           text not null,
  device_type         text not null default 'desktop' check (device_type in ('phone', 'tablet', 'desktop')),
  -- "iPhone 16 Pro · iOS 27", "Mac"…
  device_label        text,
  team_strip_scrolled boolean not null default false,
  -- This is the first view this device ever made of this preview.
  first_from_device   boolean not null default false,
  -- The admins were told about this view.
  alerted             boolean not null default false
);

create index if not exists prospect_preview_views_preview_idx on public.prospect_preview_views (preview_id, viewed_at desc);
create index if not exists prospect_preview_views_alerted_idx on public.prospect_preview_views (viewed_at desc) where alerted;
-- One "first view" per device per preview, whatever two requests race: the
-- loser gets 23505 and is stored as an ordinary repeat view, with no alert.
create unique index if not exists prospect_preview_views_first_device
  on public.prospect_preview_views (preview_id, device_id) where first_from_device;

alter table public.prospect_previews enable row level security;
alter table public.prospect_preview_views enable row level security;
revoke all on public.prospect_previews from anon, authenticated;
revoke all on public.prospect_preview_views from anon, authenticated;

-- The alert's row in the admin's notification center (lib/admin-notify.ts).
alter table public.admin_notifications drop constraint if exists admin_notifications_kind_check;
alter table public.admin_notifications add constraint admin_notifications_kind_check
  check (kind in ('money', 'leaving', 'agents', 'demos', 'prospects'));
