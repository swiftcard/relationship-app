-- Which DEVICE a push registration belongs to (2026-10-02 notification audit).
--
-- Settings → Devices signs a phone out of the account (api/devices DELETE
-- removes its user_devices row), but push_subscriptions had no idea which
-- device a row belonged to — so that phone went on receiving the account's
-- notifications on its lock screen after being signed out. With the device id
-- on the row, the same DELETE removes the phone's push registration too.
--
-- device_id is the sc_device cookie (lib/device.ts), written by
-- api/push/subscribe. Nullable: rows registered before this column existed pick
-- it up on the app's next launch, which re-registers silently
-- (NativeAppBridge). Additive and idempotent — safe to run more than once.

alter table public.push_subscriptions
  add column if not exists device_id text;

create index if not exists push_subscriptions_user_device_idx
  on public.push_subscriptions (user_id, device_id);
