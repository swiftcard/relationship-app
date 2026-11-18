-- ── Card Builder: openers sent from Google Voice, by hand (2026-11-17) ──────
-- Run once in the Supabase SQL editor, after supabase/card-builder-imessage.sql
-- and supabase/card-builder-autopilot.sql.
--
-- WHAT:
--   prospect_previews        sent_channel may now be 'google_voice' (the
--                            opener went from the owner's Google Voice number,
--                            pasted by hand), + send_with (this one prospect's
--                            choice: imessage | google_voice; null = their batch's)
--   prospect_batches         + send_with ('imessage' default | 'google_voice'):
--                            a Google Voice batch's openers never go into
--                            prospect_outbox; they wait in the owner's list
--   prospect_message_events  + channel (text | email | google_voice) on a
--                            send, so open rates can be split by channel
--
-- SAFE: additive. Two nullable columns, one column with a default, and the
-- sent_channel check widened. No existing row changes.
-- IDEMPOTENT: every statement can be run again.
-- Nothing is granted: these tables stay RLS-on with no policies (service role only).
--
-- ROLLBACK:
--   update public.prospect_previews set sent_channel = 'text' where sent_channel = 'google_voice';
--   alter table public.prospect_previews drop constraint if exists prospect_previews_sent_channel_check;
--   alter table public.prospect_previews add constraint prospect_previews_sent_channel_check
--     check (sent_channel is null or sent_channel in ('text', 'email'));
--   alter table public.prospect_previews drop column if exists send_with;
--   alter table public.prospect_batches drop column if exists send_with;
--   alter table public.prospect_message_events drop column if exists channel;

alter table public.prospect_previews drop constraint if exists prospect_previews_sent_channel_check;
alter table public.prospect_previews add constraint prospect_previews_sent_channel_check
  check (sent_channel is null or sent_channel in ('text', 'email', 'google_voice'));

alter table public.prospect_previews add column if not exists send_with text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'prospect_previews_send_with_check') then
    alter table public.prospect_previews add constraint prospect_previews_send_with_check
      check (send_with is null or send_with in ('imessage', 'google_voice'));
  end if;
end $$;

alter table public.prospect_batches add column if not exists send_with text not null default 'imessage';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'prospect_batches_send_with_check') then
    alter table public.prospect_batches add constraint prospect_batches_send_with_check
      check (send_with in ('imessage', 'google_voice'));
  end if;
end $$;

alter table public.prospect_message_events add column if not exists channel text;
