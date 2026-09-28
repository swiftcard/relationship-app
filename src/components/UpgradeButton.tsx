"use client";

import { useState } from "react";
import { PLAN_PRICES } from "@/lib/plan";
import { formatUsd } from "@/lib/currency";
import { track, trackCta } from "@/lib/events";
import { useIsNativeApp } from "@/lib/platform";

// The price is read from PLAN_PRICES — the same constant the checkout route
// validates the real Stripe price against — rather than typed into the label.
// It was hardcoded as "$5/mo" while checkout charges $4.99: a rounded-UP price
// in the CTA is the one direction you cannot round, and it turned every one of
// these buttons into a small broken promise.
const PRO_PRICE = `${formatUsd(PLAN_PRICES.PRO_MONTHLY_CENTS)}/mo`;

export default function UpgradeButton({ variant = "banner", placement = "unknown" }: {
  variant?: "banner" | "inline";
  placement?: string;
}) {
  const [loading, setLoading] = useState(false);
  const native = useIsNativeApp();

  // Native app: never show price/upgrade CTAs (no in-app selling).
  if (native) return null;

  // Route through /upgrade rather than POSTing straight to Stripe. Jumping
  // directly to a checkout session skipped the order summary and the Terms /
  // auto-renew consent that every other point of sale shows — and it silently
  // forced Pro monthly, with no way to pick annual or Office.
  function handleUpgrade() {
    if (loading) return;
    setLoading(true);
    trackCta("upgrade_to_pro", placement, { plan: "pro" });
    // This is a <button> that navigates, not an <a href="/upgrade">, so the
    // delegated anchor listener in AnalyticsProvider cannot see it. Fired here
    // so the funnel step counts every route to /upgrade, not most of them.
    track("upgrade_started", { placement, plan: "pro" });
    window.location.href = "/upgrade";
  }

  if (variant === "inline") {
    return (
      <div className="rounded-2xl p-5 mt-2" style={{ background: "linear-gradient(135deg, #1e3a5f 0%, #1a2744 100%)", border: "1px solid #2d4a7a" }}>
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-xl bg-blue-600/30 flex items-center justify-center shrink-0">
            <svg viewBox="0 0 20 20" fill="#60a5fa" className="w-4 h-4" aria-hidden="true">
              <path fillRule="evenodd" d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zm7-10a1 1 0 01.707.293l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L14.586 8l-3.293-3.293A1 1 0 0112 2z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-sm">Unlock unlimited leads</p>
            <p className="text-blue-300 text-xs mt-0.5 leading-relaxed">
              You&apos;ve hit the free limit. Go Pro for {PRO_PRICE} — unlimited leads, analytics, no branding.
            </p>
          </div>
        </div>
        <button
          onClick={handleUpgrade}
          disabled={loading}
          className="mt-4 w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-sm transition-colors"
        >
          {loading ? "Loading…" : `Upgrade to Pro · ${PRO_PRICE} →`}
        </button>
        <p className="text-center text-blue-400/60 text-[0.625rem] mt-2">Cancel anytime · No contracts</p>
      </div>
    );
  }

  return (
    <span className="inline-flex flex-col items-center">
      <button
        onClick={handleUpgrade}
        disabled={loading}
        className="bg-[#1D4ED8] hover:bg-[#1740C4] disabled:opacity-50 text-white font-semibold px-4 py-1.5 rounded-full text-xs transition-colors whitespace-nowrap"
      >
        {loading ? "…" : `Upgrade · ${PRO_PRICE} →`}
      </button>
    </span>
  );
}
