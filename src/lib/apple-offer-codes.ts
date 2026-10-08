import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminSupabase } from "@/lib/supabase-admin";
import type { PromoRow } from "@/lib/promo";
import { claimPromoUse } from "@/lib/promo-claim";
import { appleOfferPlan, appleCodeCount, promoUsedUp, type AppleOfferPlan } from "@/lib/apple-offer-plan";

export { appleOfferPlan, appleCodeStatus, appleWebOnlyReason, type AppleOfferPlan } from "@/lib/apple-offer-plan";

// ── Every SwiftCard promo code, redeemable through Apple too ────────────────
//
// Owner, 2026-10-02: a new account in the iPhone app typed a "two months free"
// code, was told it applied, tapped Pro — and Apple's sheet sold the plain
// subscription. "Any time a promo code is added it has to work, even if it's
// billed through Apple."
//
// Apple takes no Stripe code, and the app may not switch Pro on with a code of
// its own (3.1.1). What Apple does take is an OFFER CODE on the subscription
// itself. So each free-time Pro code is mirrored, under the SAME string, as an
// Apple offer code on the matching App Store product: typed in the app, it
// goes to Apple's redemption page already filled in (lib/iap
// redeemAppleOfferCode) and Apple bills "2 months free, then $4.99/month" —
// the offer the website gives through Stripe.
//
// Created when the admin creates the code (api/admin/promo-codes), and retried
// by the daily cron (api/reminders) for anything still missing — so a code
// made before App Store Connect was connected, or while Apple was down, gets
// there on its own. Needs the App Store Connect API key in the environment
// (ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY — the same key the release
// scripts read from ~/.swiftcard/asc). Without it nothing is created and the
// app sends the code to swiftcard.me instead, as before.
//
// Only FREE TIME maps cleanly. Apple's offer durations are fixed steps, money
// off would need a price point per territory, and a grant (tester) code
// switches a plan on with no subscription at all — those stay on the website.
//
// Redemptions are counted ONCE, across both platforms: the website claims a
// use at checkout, and the RevenueCat webhook claims one for every Apple
// redemption (recordAppleRedemption). When the cap is reached the Apple copy
// is turned off — Apple itself can't be told a cap under 500
// (lib/apple-offer-plan APPLE_CODES_MIN).
//
// 2026-10-08: first run with a real key. Two things only Apple could tell us:
// inline price ids must be written "${local-id}", and the redemption count
// has bounds. Both are pinned in tests/apple-offer-codes-asc.test.ts.

const API = "https://api.appstoreconnect.apple.com/v1";
const APP_ID = process.env.ASC_APP_ID?.trim() || process.env.NEXT_PUBLIC_APP_STORE_ID?.trim() || "6798875872";

export function ascConfigured(): boolean {
  return !!(process.env.ASC_KEY_ID && process.env.ASC_ISSUER_ID && process.env.ASC_PRIVATE_KEY);
}

/** What the admin is told when the key is missing — the exact fix, not a hint. */
export const ASC_NOT_CONNECTED =
  "App Store Connect isn't connected: add ASC_KEY_ID, ASC_ISSUER_ID and ASC_PRIVATE_KEY (an App Store Connect API key with the App Manager role) to the Vercel project's Production environment and redeploy.";

function ascToken(): string {
  const kid = process.env.ASC_KEY_ID!.trim();
  const iss = process.env.ASC_ISSUER_ID!.trim();
  // Pasted into an env var the newlines often arrive as literal "\n".
  const key = process.env.ASC_PRIVATE_KEY!.replace(/\\n/g, "\n").trim();
  const b64 = (b: string | Buffer) => Buffer.from(b).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: "ES256", kid, typ: "JWT" }));
  const p = b64(JSON.stringify({ iss, iat: now, exp: now + 900, aud: "appstoreconnect-v1" }));
  const sig = b64(crypto.sign("sha256", Buffer.from(`${h}.${p}`), { key, dsaEncoding: "ieee-p1363" }));
  return `${h}.${p}.${sig}`;
}

async function asc<T = { data?: unknown }>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${ascToken()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const e = json.errors?.[0];
    throw new Error(`${res.status} ${e?.title ?? ""} — ${e?.detail ?? text.slice(0, 300)}`.trim());
  }
  return json as T;
}

type AscItem = { id: string; attributes?: Record<string, unknown> };

/** The App Store subscription (ASC id) behind a product id. */
async function subscriptionId(productId: string): Promise<string> {
  const groups = await asc<{ data: AscItem[] }>("GET", `/apps/${APP_ID}/subscriptionGroups?limit=20`);
  for (const g of groups.data ?? []) {
    const subs = await asc<{ data: AscItem[] }>("GET", `/subscriptionGroups/${g.id}/subscriptions?limit=50`);
    const hit = (subs.data ?? []).find((s) => s.attributes?.productId === productId);
    if (hit) return hit.id;
  }
  throw new Error(`No App Store subscription ${productId}`);
}

/** The territories the subscription is sold in (the app is US-only today). */
async function territories(subId: string): Promise<string[]> {
  try {
    const avail = await asc<{ data: AscItem }>("GET", `/subscriptions/${subId}/subscriptionAvailability`);
    const r = await asc<{ data: AscItem[] }>("GET", `/subscriptionAvailabilities/${avail.data.id}/availableTerritories?limit=200`);
    const ids = (r.data ?? []).map((t) => t.id).filter(Boolean);
    if (ids.length) return ids;
  } catch { /* fall through to the storefront the app ships in */ }
  return ["USA"];
}

type PromoForApple = PromoRow & { id: string; active?: boolean | null; uses_count?: number | null };

/**
 * Create the Apple offer code for one SwiftCard code and record the result on
 * its row. Never throws: the outcome is written to promo_codes
 * (apple_offer_code_id, or apple_offer_error with Apple's own message) and
 * returned.
 */
export async function mirrorPromoToApple(promo: PromoForApple): Promise<{ ok: boolean; error?: string }> {
  const plan = appleOfferPlan(promo);
  if (!plan) return { ok: false, error: "Not a code Apple can take." };
  if (!ascConfigured()) return { ok: false, error: ASC_NOT_CONNECTED };
  // A code whose redemptions are used up stays off Apple — Apple would
  // otherwise hand out uses the website no longer has.
  if (promoUsedUp(promo)) return { ok: false, error: "This code has no redemptions left." };
  const admin = getAdminSupabase();
  const name = `SwiftCard ${promo.code}`.slice(0, 64);
  try {
    const subId = await subscriptionId(plan.productId);
    // FIND before CREATE. A run that made the offer but failed on its custom
    // code would otherwise make a second offer on the daily retry, and
    // another every day after.
    const existing = await asc<{ data: AscItem[] }>("GET", `/subscriptions/${subId}/offerCodes?limit=200`).catch(() => ({ data: [] as AscItem[] }));
    const found = (existing.data ?? []).find((o) => o.attributes?.name === name);
    const offerId = found ? found.id : await createOffer(subId, name, plan);
    // An offer found switched off (deactivated here, or by hand in App Store
    // Connect) is switched back on: the SwiftCard code is active, so its
    // Apple copy must be too.
    if (found && found.attributes?.active === false) await setOfferActive(offerId, true);
    const codes = await asc<{ data: AscItem[] }>("GET", `/subscriptionOfferCodes/${offerId}/customCodes?limit=50`).catch(() => ({ data: [] as AscItem[] }));
    if (!(codes.data ?? []).some((c) => String(c.attributes?.customCode ?? "").toUpperCase() === promo.code)) {
      await createCustomCode(offerId, promo);
    }
    await admin.from("promo_codes").update({ apple_offer_code_id: offerId, apple_offer_error: null }).eq("id", promo.id);
    return { ok: true };
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await admin.from("promo_codes").update({ apple_offer_error: error }).eq("id", promo.id);
    return { ok: false, error };
  }
}

async function createOffer(subId: string, name: string, plan: AppleOfferPlan): Promise<string> {
    const terrs = await territories(subId);
    // A free trial has no price, only the territories it runs in. The price
    // rows are created inline, and Apple only takes an inline id written as
    // "${local-id}" — a plain "price-USA" is refused with 409 (seen live
    // 2026-10-08, the first time this ran with a real key).
    const localId = (t: string) => `\${price-${t}}`;
    const made = await asc<{ data: AscItem }>("POST", "/subscriptionOfferCodes", {
      data: {
        type: "subscriptionOfferCodes",
        attributes: {
          name,
          customerEligibilities: plan.customerEligibilities,
          offerEligibility: "REPLACE_INTRO_OFFERS",
          offerMode: "FREE_TRIAL",
          duration: plan.duration,
          numberOfPeriods: 1,
          autoRenewEnabled: true,
        },
        relationships: {
          subscription: { data: { type: "subscriptions", id: subId } },
          prices: { data: terrs.map((t) => ({ type: "subscriptionOfferCodePrices", id: localId(t) })) },
        },
      },
      included: terrs.map((t) => ({
        type: "subscriptionOfferCodePrices",
        id: localId(t),
        relationships: { territory: { data: { type: "territories", id: t } } },
      })),
    });
    return made.data.id;
}

/**
 * The code people type, on Apple's offer — with the same expiry, and the
 * remaining uses inside Apple's 500–25,000 bounds (lib/apple-offer-plan).
 */
async function createCustomCode(offerId: string, promo: PromoForApple): Promise<void> {
  await asc("POST", "/subscriptionOfferCodeCustomCodes", {
    data: {
      type: "subscriptionOfferCodeCustomCodes",
      attributes: {
        customCode: promo.code,
        numberOfCodes: appleCodeCount(promo),
        ...(promo.expires_at ? { expirationDate: new Date(promo.expires_at).toISOString().slice(0, 10) } : {}),
      },
      relationships: { offerCode: { data: { type: "subscriptionOfferCodes", id: offerId } } },
    },
  });
}

async function setOfferActive(offerId: string, active: boolean): Promise<void> {
  await asc("PATCH", `/subscriptionOfferCodes/${offerId}`, {
    data: { type: "subscriptionOfferCodes", id: offerId, attributes: { active } },
  });
}

/**
 * Turn a code off on Apple too (api/admin/promo-codes DELETE, and the cap).
 * Without this a deactivated SwiftCard code stayed redeemable in the App
 * Store for ever. Returns an error message, or null when Apple has it off (or
 * never had it).
 */
export async function deactivateAppleOffer(offerId: string | null | undefined): Promise<string | null> {
  if (!offerId) return null;
  if (!ascConfigured()) return "App Store Connect isn't connected — turn this code off in App Store Connect → Subscriptions → Offer Codes.";
  try {
    await setOfferActive(offerId, false);
    return null;
  } catch (e) {
    return (e instanceof Error ? e.message : String(e)).slice(0, 300);
  }
}

/**
 * One Apple redemption, counted against the SwiftCard code (api/iap/
 * revenuecat, from the event's offer_code). Idempotent per account: a second
 * event for the same person and code counts nothing. Once the cap is reached
 * the Apple copy is turned off, since Apple can't hold a cap under 500 itself.
 * Returns what happened, for the webhook's response.
 */
export async function recordAppleRedemption(
  admin: SupabaseClient,
  input: { code: string; userId: string },
): Promise<"counted" | "already_counted" | "unknown_code" | "cap_reached"> {
  const code = input.code.toUpperCase().trim();
  const { data: promo } = await admin
    .from("promo_codes")
    .select("id, code, max_uses, uses_count, apple_offer_code_id")
    .eq("code", code)
    .maybeSingle();
  if (!promo) return "unknown_code";
  // The redemption row is the per-account guard (UNIQUE code_id + user_id).
  const { error } = await admin
    .from("promo_code_redemptions")
    .insert({ code_id: promo.id, user_id: input.userId, consumed_at: new Date().toISOString() });
  if (error) {
    if (error.code !== "23505") throw new Error(`redemption_insert_failed: ${error.message}`);
    // Claimed on the website first (typed on /pricing, then redeemed in the
    // app): mark it spent and count nothing twice.
    await admin.from("promo_code_redemptions")
      .update({ consumed_at: new Date().toISOString() })
      .eq("code_id", promo.id).eq("user_id", input.userId).is("consumed_at", null);
    return "already_counted";
  }
  const claimed = await claimPromoUse(admin, promo.id as string);
  // Apple handed out a use the cap no longer had (the webhook lags Apple's
  // sheet): the person keeps what Apple gave them, and the code is shut on
  // Apple now so it stops there.
  const usedUp = !claimed || (promo.max_uses != null && Number(promo.max_uses) - (Number(promo.uses_count ?? 0) + 1) <= 0);
  if (usedUp && promo.apple_offer_code_id) {
    await deactivateAppleOffer(promo.apple_offer_code_id as string);
    return "cap_reached";
  }
  return "counted";
}

/**
 * Daily catch-up (api/reminders): every active code Apple can take that isn't
 * on Apple yet. Returns how many were created.
 */
export async function mirrorPendingPromosToApple(): Promise<number> {
  if (!ascConfigured()) return 0;
  const { data } = await getAdminSupabase()
    .from("promo_codes")
    .select("*")
    .eq("active", true)
    .eq("discount_type", "free_time")
    .is("apple_offer_code_id", null);
  let made = 0;
  for (const row of (data ?? []) as PromoForApple[]) {
    if (!appleOfferPlan(row)) continue;
    if ((await mirrorPromoToApple(row)).ok) made++;
  }
  return made;
}

/**
 * Daily (api/reminders): any code on Apple whose redemptions ran out on the
 * website is turned off on Apple, so the two never drift apart. Returns how
 * many were turned off.
 */
export async function turnOffUsedUpAppleOffers(): Promise<number> {
  if (!ascConfigured()) return 0;
  const { data } = await getAdminSupabase()
    .from("promo_codes")
    .select("id, code, max_uses, uses_count, apple_offer_code_id, apple_offer_error")
    .not("apple_offer_code_id", "is", null)
    .not("max_uses", "is", null);
  let off = 0;
  for (const row of data ?? []) {
    if (!promoUsedUp(row) || row.apple_offer_error) continue;
    if (await deactivateAppleOffer(row.apple_offer_code_id as string)) continue;
    await getAdminSupabase().from("promo_codes").update({ apple_offer_error: "All redemptions used — turned off on Apple." }).eq("id", row.id);
    off++;
  }
  return off;
}

/** Whether a code checked in the app can be redeemed through Apple right now. */
export function appleRedeemable(promo: PromoRow & { apple_offer_code_id?: unknown; active?: boolean | null; uses_count?: number | null }): boolean {
  return typeof promo.apple_offer_code_id === "string" && !!promo.apple_offer_code_id && appleOfferPlan(promo) !== null && !promoUsedUp(promo);
}
