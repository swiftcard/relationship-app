-- Promo codes redeemable through Apple (lib/apple-offer-codes.ts).
--
-- Each free-time Pro code is mirrored as an Apple offer code with the same
-- string, so a code typed in the iPhone app is redeemed by Apple on the Apple-
-- billed subscription. These record whether that mirror exists (and Apple's
-- own message when it couldn't be made).
--
-- Run in Supabase → SQL Editor.

ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS apple_offer_code_id text;
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS apple_offer_error text;
