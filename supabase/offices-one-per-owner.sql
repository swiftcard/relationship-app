-- One office per owner (audit B-07).
--
-- provisionOfficeForOwner can run twice at once for the same owner: a new
-- Office checkout fires checkout.session.completed and
-- customer.subscription.updated together, and an in-app Pro→Office swap runs
-- the route and the webhook. Both used to see no office and both insert, and
-- with two rows every `.eq("owner_id").maybeSingle()` errors — the owner loses
-- the console, invites fail, seat changes silently do nothing.
--
-- The code already settles a race on its own (lib/office-billing-sync
-- settleOneOffice: the oldest office wins, a racer deletes only the row it just
-- made). This makes it impossible rather than repaired: the second insert fails.
--
-- Safe to run: production had no owner with two offices on 2026-10-16
-- (`select owner_id from offices group by 1 having count(*) > 1` → none).
-- If it ever refuses to build, run that query and remove the newer duplicate.
--
-- Run in the Supabase SQL editor.

create unique index if not exists offices_owner_uidx on public.offices (owner_id);
