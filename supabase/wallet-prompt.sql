-- New-card Wallet prompt (owner, 2026-10-19).
--
-- A card made after the feature shipped opens on the dashboard with "Add to
-- Apple Wallet" (iPhone app) or "Add to Google Wallet" (Android) above Show QR,
-- until the owner presses it or its X. This column records that moment, so
-- the prompt is gone for that card on every device.
--
-- Written only by src/app/api/cards/[id]/wallet-prompt/route.ts (admin client,
-- scoped to the caller's own card). Read by src/app/dashboard/page.tsx, which
-- shows nothing when the column is missing — so this file can be applied
-- before or after the deploy without a stuck prompt.
--
-- Its own column rather than a cards.customization key: customization is
-- rewritten whole by every card save, with no atomic merge.
--
-- APPLIED 2026-10-19 via Supabase MCP.
--
-- Rollback: alter table public.cards drop column if exists wallet_prompt_done_at;

alter table public.cards add column if not exists wallet_prompt_done_at timestamptz;
