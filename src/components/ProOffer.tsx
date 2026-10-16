"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PLAN_PRICES, TRIAL_DAYS } from "@/lib/plan";
import { useIsAndroidApp, useIsNativeApp } from "@/lib/platform";
import { getIapPackages } from "@/lib/iap";
import dynamic from "next/dynamic";

// LAZY, AND CLIENT-ONLY ON PURPOSE.
//
// A plain `import IapSubscribeButton from "@/components/NativePaywall"` here
// broke a page this component does not even appear on: /welcome started
// throwing a hydration mismatch in production builds (React #418), and only in
// production — dev was clean, which is exactly how a bundling problem hides.
//
// The cause is the module graph, not the markup. Pulling NativePaywall in
// statically drags it (and lib/iap) into a chunk shared with other pages, where
// its module-level StoreKit-status cache is then evaluated at a different
// moment relative to hydration than it was before — so the server HTML and the
// first client render stop agreeing on a page that has its own paywall button.
//
// `ssr: false` keeps it out of the server render and out of everyone else's
// chunk. Nothing is lost: this button only ever renders inside the iOS shell,
// which is a client-only context by definition.
const IapSubscribeButton = dynamic(() => import("@/components/NativePaywall"), { ssr: false });

// ── One Pro offer, rendered the same everywhere ──────────────────────────────
//
// The owner's report, and it was right: the popup on the phone was not the
// popup on the computer. The web version showed a headline, a feature list, a
// price and a button; the shell showed a different component entirely (the
// shared PlanNotice) with different words and a different shape. Two surfaces
// selling the same thing, looking nothing like each other.
//
// So the offer lives in ONE place now. Both dialogs — the one behind Save
// Changes and the one behind Add card — render these two pieces, so the sheet a
// person sees on a phone is the sheet they saw on their laptop: same box, same
// headline, same sentence, same button in the same position.
//
// THE ONE THING THAT CANNOT BE IDENTICAL, AND WHY
//
// The dollar amount. On the web the price is ours: Stripe charges USD and
// PLAN_PRICES is the truth. Inside the iOS app the price is APPLE'S — it varies
// by storefront (a reader in Berlin is charged in euro, in London in pounds),
// and App Store rule 3.1.2 requires the price shown to be the price charged.
// Hardcoding "$4.99" in the shell would be both wrong for most of the world and
// a review risk, so on native the number comes from StoreKit and nowhere else.
// If StoreKit has not answered yet, the line renders without a figure rather
// than inventing one.
//
// Same reason the button differs under the hood: on iOS a subscription the app
// unlocks has to be bought through in-app purchase (3.1.3(b)), never by sending
// someone to a website. It looks and reads the same; it just goes to StoreKit.

/** StoreKit's own monthly price string, or null (web, or not loaded yet). */
function useIapMonthlyPrice(): string | null {
  const native = useIsNativeApp();
  const [price, setPrice] = useState<string | null>(null);

  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    (async () => {
      try {
        const pkgs = await getIapPackages();
        if (cancelled) return;
        setPrice(pkgs.find((p) => p.period === "monthly")?.priceString ?? null);
      } catch {
        /* no price rather than a wrong one */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [native]);

  return price;
}

/**
 * The bordered offer box: what it costs, and what it unlocks.
 *
 * `blurb` is the one thing each dialog supplies for itself, because "what you
 * get" reads differently when you have just tried a finish than when you have
 * just asked for a second card.
 */
export function ProOfferBlock({
  trialEligible,
  blurb,
}: {
  trialEligible: boolean;
  blurb: string;
}) {
  const native = useIsNativeApp();
  const android = useIsAndroidApp();
  const iapPrice = useIapMonthlyPrice();
  const webPrice = `$${(PLAN_PRICES.PRO_MONTHLY_CENTS / 100).toFixed(2)}`;
  const price = native ? iapPrice : webPrice;

  // ANDROID sells nothing (owner, 2026-10-08; Google Play payments policy): no
  // price, no trial, no "cancel anytime" — and nothing to tap. What the
  // dialog is about is still said by its heading and sentence; this box only
  // says why there is no button under it.
  if (android) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3.5">
        <p className="text-slate-300/85 text-[0.8125rem] leading-snug">Pro isn&apos;t sold in the Android app. Everything on Free keeps working.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-blue-400/25 bg-blue-500/[0.07] px-4 py-3.5">
      {trialEligible ? (
        <>
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="text-white font-extrabold text-[1.4375rem] leading-none">
              {TRIAL_DAYS}-day free trial
            </span>
            {price && (
              <span className="text-slate-300/80 text-[0.875rem] font-semibold">
                then {price} a month
              </span>
            )}
          </div>
          <p className="text-slate-300/85 text-[0.8125rem] leading-snug mt-2">
            {blurb} Cancel anytime before day {TRIAL_DAYS} and you are not charged.
          </p>
        </>
      ) : (
        <>
          <div className="flex items-baseline gap-1.5 flex-wrap">
            {price ? (
              <>
                <span className="text-white font-extrabold text-[1.4375rem] leading-none">{price}</span>
                <span className="text-slate-300/80 text-[0.875rem] font-semibold">a month</span>
              </>
            ) : (
              <span className="text-white font-extrabold text-[1.4375rem] leading-none">Pro</span>
            )}
          </div>
          <p className="text-slate-300/85 text-[0.8125rem] leading-snug mt-2">{blurb} Cancel anytime.</p>
        </>
      )}
    </div>
  );
}

/**
 * The primary button. Same size, same place, same words on both platforms —
 * the web one opens checkout, the native one opens StoreKit.
 */
export function ProOfferCta({ trialEligible }: { trialEligible: boolean }) {
  const native = useIsNativeApp();
  const android = useIsAndroidApp();
  const label = trialEligible ? `Start my ${TRIAL_DAYS}-day free trial` : "Upgrade to Pro";

  if (android) return null;

  if (native) {
    return (
      <IapSubscribeButton
        label={label}
        sublabel=""
        className="!w-full !rounded-full !py-3.5 !min-h-[46px] !text-[0.9375rem]"
      />
    );
  }

  return (
    <Link
      href={trialEligible ? "/checkout?plan=pro&interval=monthly" : "/checkout?plan=pro&interval=monthly&trial=0"}
      className="rd-btn rd-btn-aurora w-full !py-3.5 !min-h-[46px] text-center text-[0.9375rem] font-bold"
    >
      {label}
    </Link>
  );
}
