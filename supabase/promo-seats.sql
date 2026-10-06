-- Office promo codes that come with seats.
--
-- Applied to production 2026-10-06 (Supabase MCP migration "promo_seats").
-- Kept here so the schema is readable from the repo and a fresh project can be
-- brought to the same shape.
--
-- Why it exists (owner, 2026-10-06): the usual Office deal is "one month free
-- for the whole team" — an admin plus 14 teammates. Only the admin enters the
-- code, so the code itself has to carry the team's size. With `seats` set, an
-- Office-only code fixes the seat count of the order it is used on: the order
-- pages lock to it, /api/stripe/checkout refuses any other count, and a
-- free-Office ("grant") code provisions that many seats instead of 5.
--
-- NULL = the code says nothing about seats; the admin picks them as before.
-- The app only honours it on applies_to = 'office' codes (lib/promo promoSeats).
alter table public.promo_codes
  add column if not exists seats integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'promo_codes_seats_check') then
    alter table public.promo_codes
      add constraint promo_codes_seats_check check (seats is null or seats between 2 and 1000);
  end if;
end $$;
