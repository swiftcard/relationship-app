"use client";

// ── In-App Purchase, via RevenueCat ─────────────────────────────────────────
//
// The remedy for the Guideline 3.1.1 rejection of 1.0.0 (7). The previous
// posture — a link out to the default browser, per the US-storefront allowance
// in 3.1.1(a) — was implemented (see external-purchase.ts) and REJECTED anyway:
// App Review held that a subscription the app *unlocks* must also be
// purchasable in the app under 3.1.3(b), link-out or not. So Pro is now a real
// App Store subscription, and this module is the only way the web bundle
// touches StoreKit.
//
// Shape rules, all fail-closed like external-purchase.ts before it:
//   • Web and SSR: every entry point resolves to "unavailable" — the site
//     keeps its own Stripe checkout and never loads the plugin.
//   • Shell without the plugin (older build): unavailable, so callers render
//     the neutral notice rather than a dead button.
//   • No configured API key: unavailable. A paywall that cannot load real
//     StoreKit products must not render — hardcoded prices are how App Store
//     metadata drifts out of truth.
//
// Identity: RevenueCat's app_user_id is the Supabase user id, set at configure
// time. That is what lets the webhook (api/iap/revenuecat) map a purchase to a
// profile row, and what makes a purchase on iPhone unlock the same account on
// the web — the cross-platform access 3.1.3(b) is actually about.

import { detectNativeApp, detectNativePlatform } from "@/lib/platform";
import { APP_STORE_ID } from "@/lib/app-store";

import { IAP_ENTITLEMENT } from "@/lib/iap-shared";
export { IAP_ENTITLEMENT, IAP_PRODUCT_MONTHLY, IAP_PRODUCT_ANNUAL } from "@/lib/iap-shared";

export type IapPackage = {
  /** RevenueCat package identifier (e.g. "$rc_monthly"). */
  identifier: string;
  /** StoreKit product id. */
  productId: string;
  /** Localized price straight from StoreKit — never hardcode around this. */
  priceString: string;
  /** The same StoreKit price as a number, and its ISO currency. Used only to
   *  work out what the annual plan costs per month and how much it saves —
   *  arithmetic on Apple's own numbers, never a price typed here. */
  price: number;
  currencyCode: string;
  /** "monthly" | "annual" — resolved from the package type. */
  period: "monthly" | "annual";
  /** Localized intro-offer description when present (e.g. 14-day free trial). */
  introPriceString: string | null;
};

type PurchasesPlugin = typeof import("@revenuecat/purchases-capacitor").Purchases;

let configuredFor: string | null = null;

/**
 * A paywall that silently hides is a revenue outage nobody sees. Every
 * unexpected failure in the native chain reports through /api/client-error
 * (same pipeline as window.onerror) so it lands in the structured server
 * logs. Only fired when actually running in the shell — the web returning
 * "unavailable" is by design, not an error.
 */
function reportIapFailure(stage: string, e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e);
  fetch("/api/client-error", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: `[iap:${stage}] ${msg}`.slice(0, 480), level: "error" }),
  }).catch(() => {});
}

/**
 * Resolves to a WRAPPER around the plugin, never the plugin itself: resolving
 * a promise with a Capacitor plugin proxy makes the JS engine probe it for
 * `.then` (thenable check), which the bridge forwards as a native call named
 * "then" — and the whole chain dies with `"Purchases.then()" is not
 * implemented on ios`. That exact error hid the paywall in the first
 * simulator test.
 */
let pluginPromise: Promise<{ P: PurchasesPlugin } | null> | null = null;
async function plugin(): Promise<{ P: PurchasesPlugin } | null> {
  // Memoized: the dynamic import + env check run once per page, not once per
  // button mount — several gates on one screen used to race the same import.
  if (pluginPromise) return pluginPromise;
  pluginPromise = loadPlugin();
  const w = await pluginPromise;
  if (!w) pluginPromise = null; // let a later mount retry after a transient failure
  return w;
}
async function loadPlugin(): Promise<{ P: PurchasesPlugin } | null> {
  if (!detectNativeApp()) return null;
  // ANDROID SELLS NOTHING, AND THAT IS THE DESIGN, NOT A FAULT.
  //
  // There are no Play Billing products and no Google RevenueCat key, so the
  // paywall's neutral "not available here" state is the intended outcome and
  // must be reached SILENTLY. Without this branch the next line fires
  // reportIapFailure("env", ...) — a POST to /api/client-error — on every
  // paywall mount on every Android device, for ever, about a decision we made
  // on purpose. Returning before it also stops the SDK being configured with
  // an Apple key on a Google device, which is its own kind of wrong.
  //
  // When Play Billing is switched on this becomes a key selection rather than
  // a return: a NEXT_PUBLIC_RC_GOOGLE_API_KEY chosen by platform, Play
  // products in RevenueCat, and a "google" plan source alongside "apple" in
  // lib/iap-entitlement.ts. Pinned meanwhile by tests/android-no-selling.test.ts.
  if (detectNativePlatform() === "android") return null;
  if (!process.env.NEXT_PUBLIC_RC_APPLE_API_KEY) {
    reportIapFailure("env", "NEXT_PUBLIC_RC_APPLE_API_KEY missing from bundle");
    return null;
  }
  try {
    const mod = await import("@revenuecat/purchases-capacitor");
    return { P: mod.Purchases };
  } catch (e) {
    reportIapFailure("import", e);
    return null;
  }
}

/**
 * Configure the SDK for this signed-in user, once per user per launch.
 * Re-calling with a different uid re-identifies (account switch in the shell —
 * see AccountIsolationGuard for why that path is taken seriously).
 */
export async function ensureIapConfigured(userId: string): Promise<boolean> {
  // One configure at a time: the Subscribe button and the Pro card's price
  // both get here on the same mount, and two configure() calls racing each
  // other is undefined behaviour in the SDK.
  const prev = configuring;
  const run = (async () => { await prev; return configureNow(userId); })();
  configuring = run;
  return run;
}
let configuring: Promise<boolean> | null = null;

async function configureNow(userId: string): Promise<boolean> {
  if (configuredFor === userId) return true;
  const w = await plugin();
  if (!w) return false;
  try {
    if (configuredFor === null) {
      await w.P.configure({
        apiKey: process.env.NEXT_PUBLIC_RC_APPLE_API_KEY as string,
        appUserID: userId,
      });
    } else if (configuredFor !== userId) {
      await w.P.logIn({ appUserID: userId });
      // A different account: its trial history and offering are its own.
      accountTrialPromise = null;
      offeringsPromise = null;
    }
    configuredFor = userId;
    return true;
  } catch (e) {
    reportIapFailure("configure", e);
    return false;
  }
}

/** Whether a purchase can actually be offered right now (native + plugin +
 *  key). Callers MUST gate on this — same fail-closed contract as
 *  canOfferExternalPurchase had. */
export async function canOfferIap(): Promise<boolean> {
  return (await plugin()) !== null;
}

/**
 * The signed-in user's id, from the LOCAL session (no network).
 *
 * Loaded lazily: this module is reached from PlanGate, which every editor and
 * the homepage's mini builders render, so a static import shipped the whole
 * Supabase client (~65KB compressed) to every marketing visitor. Only the
 * iPhone shell ever gets past detectNativeApp(), so only it pays for it.
 */
export async function sessionUserId(): Promise<string | null> {
  if (!detectNativeApp()) return null;
  try {
    const { createBrowserClient } = await import("@supabase/ssr");
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Configure for whoever is signed in, before anything asks StoreKit.
 *
 * The Pro card's price (useIapOffer) used to fetch offerings on mount while
 * the Subscribe button was still reading the session to configure the SDK.
 * On a brand-new account's plan step the price won that race, asked an
 * UNCONFIGURED SDK, got nothing — and the card showed no price, no trial and
 * a bare "Get Pro →" (owner report 2026-10-02). Every StoreKit read now waits
 * for this first.
 */
async function configuredForSession(): Promise<boolean> {
  if (configuredFor) return true;
  const uid = await sessionUserId();
  return uid ? ensureIapConfigured(uid) : false;
}

/**
 * The current offering's monthly + annual packages with live StoreKit prices.
 * Returns [] when anything is missing, and the paywall then does not render a
 * purchase UI at all.
 */
type RawPackage = Awaited<ReturnType<PurchasesPlugin["getOfferings"]>>["current"] extends infer C
  ? C extends { availablePackages: infer A } ? (A extends (infer R)[] ? R : never) : never
  : never;

// One StoreKit/RevenueCat round trip per page. The Subscribe button calls
// prefetchIapPackages() as soon as it knows it can sell, so by the time the
// sheet opens the prices are already here — no "Loading plans…" beat. A
// failed or empty fetch is NOT cached, so the next open retries.
let offeringsPromise: Promise<RawPackage[]> | null = null;

/** The RevenueCat offering sold to an account that already had its free Pro
 *  period (a 14-day trial or a friend's referral month): the same Pro products
 *  WITHOUT an introductory offer. Apple decides intro eligibility per Apple ID,
 *  not per SwiftCard account, so without this an account that had its free
 *  month could still get Apple's trial on an unused Apple ID. */
export const NO_TRIAL_OFFERING = "no_trial";

// Whether THIS SwiftCard account may still get a free trial — the same rule
// the website's checkout enforces (lib/trial-eligibility). Fails open (true),
// like the server helper, so an outage never blocks a purchase.
let accountTrialPromise: Promise<boolean> | null = null;
function accountTrialEligible(): Promise<boolean> {
  if (!accountTrialPromise) {
    accountTrialPromise = fetch("/api/iap/trial-eligible", { method: "GET", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { eligible: true }))
      .then((d: { eligible?: unknown }) => d.eligible !== false)
      .catch(() => true);
  }
  return accountTrialPromise;
}

async function rawPackages(): Promise<RawPackage[]> {
  if (offeringsPromise) return offeringsPromise;
  const w = await plugin();
  if (!w) return [];
  const p = (async () => {
    try {
      // Empty (and so not cached) until someone is signed in and configured.
      if (!(await configuredForSession())) return [];
      const offerings = await w.P.getOfferings();
      const { current } = offerings;
      if (!(await accountTrialEligible())) {
        const all = (offerings as { all?: Record<string, { availablePackages?: unknown[] }> }).all ?? {};
        const noTrial = all[NO_TRIAL_OFFERING]?.availablePackages;
        if (noTrial?.length) return noTrial as RawPackage[];
      }
      return (current?.availablePackages ?? []) as RawPackage[];
    } catch (e) {
      reportIapFailure("offerings", e);
      return [];
    }
  })();
  offeringsPromise = p;
  const out = await p;
  if (out.length === 0) offeringsPromise = null;
  return out;
}

/** Warm the offerings cache; safe to call any number of times. */
export function prefetchIapPackages(): void {
  void rawPackages().catch(() => {});
}

export async function getIapPackages(): Promise<IapPackage[]> {
  const w = await plugin();
  if (!w) return [];
  try {
    const out: IapPackage[] = [];
    for (const pkg of await rawPackages()) {
      const period =
        pkg.packageType === "ANNUAL" ? "annual" :
        pkg.packageType === "MONTHLY" ? "monthly" : null;
      if (!period) continue;
      out.push({
        identifier: pkg.identifier,
        productId: pkg.product.identifier,
        priceString: pkg.product.priceString,
        price: pkg.product.price,
        currencyCode: pkg.product.currencyCode,
        period,
        introPriceString: pkg.product.introPrice?.priceString === "$0.00" || pkg.product.introPrice?.price === 0
          ? "free trial"
          : pkg.product.introPrice?.priceString ?? null,
      });
    }
    // Only promise an intro offer this Apple ID can actually get. Apple gives
    // the free trial once per subscription group; someone who already used it
    // saw "14 days free" and then was charged (2026-09-16 audit). Anything but
    // a definite ELIGIBLE (2) — including UNKNOWN, per RevenueCat's own advice —
    // shows the regular price instead.
    // The ACCOUNT rule first: an account that already had its free Pro period
    // is never promised a trial, whatever the Apple ID could get.
    if (!(await accountTrialEligible())) for (const p of out) p.introPriceString = null;
    try {
      const ids = out.filter((p) => p.introPriceString).map((p) => p.productId);
      if (ids.length) {
        const elig = await w.P.checkTrialOrIntroductoryPriceEligibility({ productIdentifiers: ids });
        for (const p of out) {
          if (p.introPriceString && (elig as Record<string, { status?: number }>)[p.productId]?.status !== 2) p.introPriceString = null;
        }
      }
    } catch {
      for (const p of out) p.introPriceString = null;
    }
    return out;
  } catch (e) {
    reportIapFailure("offerings", e);
    return [];
  }
}

export type PurchaseResult = "purchased" | "cancelled" | "failed";

/**
 * Run the StoreKit purchase sheet for a package. On success, nudge the server
 * to reflect the entitlement immediately (api/iap/sync) — the RevenueCat
 * webhook is the durable path, this is the "it unlocks before your thumb
 * leaves the button" path.
 */
export async function purchaseIap(identifier: string): Promise<PurchaseResult> {
  const w = await plugin();
  if (!w) return "failed";
  try {
    // Reuses the cached offerings — the sheet already fetched them.
    const pkg = (await rawPackages()).find((x) => x.identifier === identifier);
    if (!pkg) return "failed";
    const res = await w.P.purchasePackage({ aPackage: pkg });
    const active = !!res.customerInfo?.entitlements?.active?.[IAP_ENTITLEMENT];
    if (!active) return "failed";
    // Wait for the server to reflect it, briefly: the sync can come back
    // "skipped" while RevenueCat catches up. A few short retries mean the
    // dashboard sees Pro instead of the plan chooser; if it still isn't there
    // the sync has recorded the choice, so nobody is looped (see the route).
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await fetch("/api/iap/sync", { method: "POST" }).then((x) => x.json()).catch(() => null) as { applied?: string } | null;
      if (r?.applied === "grant") break;
      await new Promise((ok) => setTimeout(ok, 1500));
    }
    return "purchased";
  } catch (e) {
    const err = e as { code?: string; errorCode?: string; message?: string };
    const code = String(err?.code ?? err?.errorCode ?? "");
    const msg = String(err?.message ?? "");
    if (code === "1" || /cancel/i.test(code) || /cancel/i.test(msg)) return "cancelled";
    return "failed";
  }
}

/** Restore Purchases — required UI on any paywall (Guideline 3.1.2). */
export async function restoreIap(): Promise<boolean> {
  const w = await plugin();
  if (!w) return false;
  try {
    const res = await w.P.restorePurchases();
    const active = !!res.customerInfo?.entitlements?.active?.[IAP_ENTITLEMENT];
    if (active) await fetch("/api/iap/sync", { method: "POST" }).catch(() => {});
    return active;
  } catch {
    return false;
  }
}

// ── Promo codes, Apple's way ─────────────────────────────────────────────────
//
// Pro is billed by Apple in the app, and Apple takes no Stripe code — nor may
// the app switch a paid plan on with a code of its own (3.1.1). What Apple
// DOES take is its own offer code. Every SwiftCard free-time Pro code is
// mirrored as an Apple offer code with the SAME string (lib/apple-offer-codes,
// server side), so a code typed in the app is redeemed by Apple, on Apple's
// sheet, against the same Pro subscription — "2 months free, then $4.99/month"
// billed by Apple, exactly what the website gives through Stripe.

/** Apple's own redemption page, with the code already filled in. */
export function appleOfferCodeUrl(code: string): string | null {
  return APP_STORE_ID ? `https://apps.apple.com/redeem?ctx=offercodes&id=${APP_STORE_ID}&code=${encodeURIComponent(code)}` : null;
}

/**
 * Redeem a code through Apple. Opens Apple's redemption page with the code
 * filled in (the same native plugin as "Manage subscription" — apps.apple.com
 * is on its host allow-list); a shell without that plugin gets StoreKit's own
 * in-app redemption sheet, where the code is typed once more. False when
 * neither could be shown.
 */
export async function redeemAppleOfferCode(code: string): Promise<boolean> {
  if (!detectNativeApp() || detectNativePlatform() === "android") return false;
  if (!(await configuredForSession())) return false;
  const url = appleOfferCodeUrl(code);
  const ext = (window as unknown as {
    Capacitor?: { Plugins?: { ExternalPurchase?: { open: (o: { url: string }) => Promise<{ opened?: boolean }> } } };
  }).Capacitor?.Plugins?.ExternalPurchase;
  if (url && ext?.open) {
    try {
      const { opened } = await ext.open({ url });
      if (opened) return true;
    } catch (e) {
      reportIapFailure("offer-code-url", e);
    }
  }
  const w = await plugin();
  if (!w) return false;
  try {
    await w.P.presentCodeRedemptionSheet();
    return true;
  } catch (e) {
    reportIapFailure("offer-code-sheet", e);
    return false;
  }
}

/**
 * After an offer code was redeemed outside the purchase sheet: pull the new
 * transaction in, and if Pro is now active, have the server reflect it (the
 * same /api/iap/sync wait as purchaseIap). True when the account is on Pro.
 */
export async function syncIapAfterRedeem(): Promise<boolean> {
  const w = await plugin();
  if (!w || !(await configuredForSession())) return false;
  try {
    await w.P.syncPurchases().catch(() => {});
    await w.P.invalidateCustomerInfoCache().catch(() => {});
    const { customerInfo } = await w.P.getCustomerInfo();
    if (!customerInfo?.entitlements?.active?.[IAP_ENTITLEMENT]) return false;
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await fetch("/api/iap/sync", { method: "POST" }).then((x) => x.json()).catch(() => null) as { applied?: string } | null;
      if (r?.applied === "grant") break;
      await new Promise((ok) => setTimeout(ok, 1500));
    }
    return true;
  } catch (e) {
    reportIapFailure("offer-code-sync", e);
    return false;
  }
}

/**
 * Open the App Store's subscription-management page. Apple-billed subs are
 * canceled there, never in the Stripe portal. The Capacitor plugin has no
 * showManageSubscriptions, so this rides the same UIApplication.open native
 * plugin the external-purchase link used — iOS hands apps.apple.com's
 * subscriptions URL to the system sheet.
 */
export async function manageIapSubscription(): Promise<void> {
  if (!detectNativeApp()) return;
  // Nothing on Android was ever bought through a store, so there is no store
  // subscription page to send anyone to. An Android user's Pro came from the
  // website or from an iPhone, and is managed where it was bought. Sending
  // them to Apple's subscriptions page would be actively misleading.
  if (detectNativePlatform() === "android") return;
  const ext = (window as unknown as {
    Capacitor?: { Plugins?: { ExternalPurchase?: { open: (o: { url: string }) => Promise<unknown> } } };
  }).Capacitor?.Plugins?.ExternalPurchase;
  // Reported, not swallowed: this exact call was once a silently dead button
  // (apps.apple.com missing from the plugin's host allow-list — the rejection
  // vanished into an empty catch).
  const url = "https://apps.apple.com/account/subscriptions";
  // An older app build without the plugin used to short-circuit to nothing
  // (ext?.open) — a dead "Manage subscription" button. Capacitor hands an
  // external https navigation to the system, so that is the fallback.
  if (!ext?.open) { window.location.href = url; return; }
  await ext.open({ url }).catch((e) => reportIapFailure("manage", e));
}
