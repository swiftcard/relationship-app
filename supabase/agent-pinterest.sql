-- ── Agent Flow: PINTEREST (owner order 2026-10-04) ───────────────────────────
-- "Every image links back to SwiftCard." Each pin is a real card design
-- rendered by the site (/pin/<slug>), posted once, with its own tracked link
-- (swiftcard.me/go/pin_<slug>). This table is the ledger of what was posted.
-- Service-role only (RLS on, no policies). Idempotent.

create table if not exists agent_pins (
  slug        text primary key,            -- lib/pinterest-pins.ts PIN_IDEAS slug
  board_id    text,
  board_name  text,
  pin_id      text,                        -- Pinterest's id once created
  pin_url     text,
  image_url   text,                        -- the rendered picture in storage
  code        text not null,               -- the signup source the link carries
  status      text not null default 'pending',   -- pending | posted | failed
  error       text,
  created_at  timestamptz not null default now(),
  posted_at   timestamptz
);
alter table agent_pins enable row level security;

-- The rendered pictures. Public read: Pinterest fetches the image by URL.
insert into storage.buckets (id, name, public)
  values ('pins', 'pins', true)
  on conflict (id) do update set public = true;
