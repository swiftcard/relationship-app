import crypto from "node:crypto";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { IAP_PRODUCT_ANNUAL, IAP_PRODUCT_MONTHLY } from "@/lib/iap-shared";
import { TRIAL_DAYS } from "@/lib/plan";
import type { PromoRow } from "@/lib/promo";

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

const API = "https://api.appstoreconnect.apple.com/v1";
const APP_ID = process.env.ASC_APP_ID?.trim() || process.env.NEXT_PUBLIC_APP_STORE_ID?.trim() || "6798875872";

/** Apple's free-trial steps, by the day count SwiftCard stores. */
const APPLE_DURATIONS: Record<number, string> = {
  14: "TWO_WEEKS",
  30: "ONE_MONTH",
  60: "TWO_MONTHS",
  90: "THREE_MONTHS",
  180: "SIX_MONTHS",
  365: "ONE_YEAR",
};

/** Apple took the code's place for at most this many redemptions. */
const DEFAULT_APPLE_CODES = 10000;

export type AppleOfferPlan = {
  productId: string;
  duration: string;
  customerEligibilities: string[];
};

/**
 * Can this code exist on Apple, and as what? Null when it can't — the app
 * then hands the code to swiftcard.me.
 *
 * Under 14 days is left out on purpose: Apple REPLACES the 14-day trial with
 * the code's offer, and the website never lets a code shorten the trial
 * (checkout takes the longer of the two). The plain Pro button already gives
 * more than a one-week code would.
 */
export function appleOfferPlan(promo: PromoRow & { active?: boolean | null }): AppleOfferPlan | null {
  if (promo.active === false) return null;
  if (promo.discount_type !== "free_time") return null;
  const applies = promo.applies_to ?? "any";
  if (applies !== "any" && applies !== "pro") return null;
  const days = Number(promo.free_days);
  if (!(days >= TRIAL_DAYS)) return null;
  const duration = APPLE_DURATIONS[days];
  if (!duration) return null;
  if (promo.expires_at && new Date(promo.expires_at) <= new Date()) return null;
  // Apple custom codes are letters and numbers only.
  if (!/^[A-Z0-9]{1,64}$/.test(String(promo.code ?? ""))) return null;
  const productId = promo.interval_target === "annual" ? IAP_PRODUCT_ANNUAL : IAP_PRODUCT_MONTHLY;
  // Who may redeem, in Apple's terms. "New accounts" are people not paying:
  // never subscribed (NEW) or no longer subscribed (EXPIRED).
  const target = promo.plan_target ?? "free";
  const customerEligibilities =
    target === "pro" ? ["EXISTING"] : target === "all" ? ["NEW", "EXISTING", "EXPIRED"] : ["NEW", "EXPIRED"];
  return { productId, duration, customerEligibilities };
}

export function ascConfigured(): boolean {
  return !!(process.env.ASC_KEY_ID && process.env.ASC_ISSUER_ID && process.env.ASC_PRIVATE_KEY);
}

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

type PromoForApple = PromoRow & { id: string; active?: boolean | null };

/**
 * Create the Apple offer code for one SwiftCard code and record the result on
 * its row. Never throws: the outcome is written to promo_codes
 * (apple_offer_code_id, or apple_offer_error with Apple's own message) and
 * returned.
 */
export async function mirrorPromoToApple(promo: PromoForApple): Promise<{ ok: boolean; error?: string }> {
  const plan = appleOfferPlan(promo);
  if (!plan) return { ok: false, error: "Not a code Apple can take." };
  if (!ascConfigured()) return { ok: false, error: "App Store Connect isn't connected (ASC_* env vars)." };
  const admin = getAdminSupabase();
  try {
    const subId = await subscriptionId(plan.productId);
    const terrs = await territories(subId);
    // A free trial has no price, only the territories it runs in.
    const made = await asc<{ data: AscItem }>("POST", "/subscriptionOfferCodes", {
      data: {
        type: "subscriptionOfferCodes",
        attributes: {
          name: `SwiftCard ${promo.code}`.slice(0, 64),
          customerEligibilities: plan.customerEligibilities,
          offerEligibility: "REPLACE_INTRO_OFFERS",
          offerMode: "FREE_TRIAL",
          duration: plan.duration,
          numberOfPeriods: 1,
          autoRenewEnabled: true,
        },
        relationships: {
          subscription: { data: { type: "subscriptions", id: subId } },
          prices: { data: terrs.map((t) => ({ type: "subscriptionOfferCodePrices", id: `price-${t}` })) },
        },
      },
      included: terrs.map((t) => ({
        type: "subscriptionOfferCodePrices",
        id: `price-${t}`,
        relationships: { territory: { data: { type: "territories", id: t } } },
      })),
    });
    const offerId = made.data.id;
    const remaining = promo.max_uses != null ? Math.max(1, Number(promo.max_uses) - Number((promo as { uses_count?: number }).uses_count ?? 0)) : DEFAULT_APPLE_CODES;
    await asc("POST", "/subscriptionOfferCodeCustomCodes", {
      data: {
        type: "subscriptionOfferCodeCustomCodes",
        attributes: {
          customCode: promo.code,
          numberOfCodes: remaining,
          ...(promo.expires_at ? { expirationDate: new Date(promo.expires_at).toISOString().slice(0, 10) } : {}),
        },
        relationships: { offerCode: { data: { type: "subscriptionOfferCodes", id: offerId } } },
      },
    });
    await admin.from("promo_codes").update({ apple_offer_code_id: offerId, apple_offer_error: null }).eq("id", promo.id);
    return { ok: true };
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await admin.from("promo_codes").update({ apple_offer_error: error }).eq("id", promo.id);
    return { ok: false, error };
  }
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

/** Whether a code checked in the app can be redeemed through Apple right now. */
export function appleRedeemable(promo: PromoRow & { apple_offer_code_id?: unknown; active?: boolean | null }): boolean {
  return typeof promo.apple_offer_code_id === "string" && !!promo.apple_offer_code_id && appleOfferPlan(promo) !== null;
}
