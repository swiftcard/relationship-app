"use client";

import { useEffect, useState } from "react";

// Every Pro price the app shows comes from here rather than PLAN_PRICES: the
// App Store price is the authority, and a hardcoded number would drift the
// moment a price changes or a storefront differs (3.1.2). Web has no
// StoreKit, so there everything stays null ("none").

export type IapOffer = {
  /** "loading" until StoreKit answers; "none" when it answered with nothing
   *  (or failed) — the caller then shows no price rather than guessing one. */
  status: "loading" | "ready" | "none";
  monthly: string | null;
  annual: string | null;
  trial: boolean | null;
  /** The annual plan per month, in the store's currency ("$4.50"), and what
   *  it saves against twelve monthly payments (10 for 10%). Both computed from
   *  StoreKit's own numbers; null when either product is missing. */
  annualPerMonth: string | null;
  annualSavePct: number | null;
};

const EMPTY: IapOffer = { status: "loading", monthly: null, annual: null, trial: null, annualPerMonth: null, annualSavePct: null };

/** Monthly + yearly StoreKit prices and whether THIS Apple ID gets the free
 *  trial (lib/iap checks eligibility). All null until known. */
export function useIapOffer(): IapOffer {
  const [offer, setOffer] = useState<IapOffer>(EMPTY);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getIapPackages } = await import("@/lib/iap");
        const pkgs = await getIapPackages();
        const monthly = pkgs.find((p) => p.period === "monthly");
        const annual = pkgs.find((p) => p.period === "annual");
        if (cancelled) return;
        if (!monthly && !annual) { setOffer({ ...EMPTY, status: "none" }); return; }
        let annualPerMonth: string | null = null;
        let annualSavePct: number | null = null;
        if (monthly && annual && monthly.price > 0 && annual.price > 0) {
          try {
            annualPerMonth = new Intl.NumberFormat(undefined, { style: "currency", currency: annual.currencyCode }).format(annual.price / 12);
          } catch { /* unknown currency code — no per-month line */ }
          const pct = Math.round((1 - annual.price / (monthly.price * 12)) * 100);
          annualSavePct = pct > 0 ? pct : null;
        }
        setOffer({
          status: "ready",
          monthly: monthly?.priceString ?? null,
          annual: annual?.priceString ?? null,
          trial: pkgs.some((p) => p.introPriceString === "free trial"),
          annualPerMonth,
          annualSavePct,
        });
      } catch {
        if (!cancelled) setOffer({ ...EMPTY, status: "none" });
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return offer;
}
