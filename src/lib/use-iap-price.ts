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
  /** The monthly plan's price — what the app's Pro card shows. Annual is
   *  offered in Apple's sheet, with its own StoreKit price. */
  monthly: string | null;
  /** The annual plan's price — shown only for an annual-only promo code. */
  annual: string | null;
  trial: boolean | null;
};

const EMPTY: IapOffer = { status: "loading", monthly: null, annual: null, trial: null };

/** The monthly StoreKit price and whether THIS Apple ID gets the free trial
 *  (lib/iap checks eligibility). All null until known. */
export function useIapOffer(): IapOffer {
  const [offer, setOffer] = useState<IapOffer>(EMPTY);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getIapPackages } = await import("@/lib/iap");
        const pkgs = await getIapPackages();
        if (cancelled) return;
        if (!pkgs.length) { setOffer({ ...EMPTY, status: "none" }); return; }
        setOffer({
          status: "ready",
          monthly: pkgs.find((p) => p.period === "monthly")?.priceString ?? null,
          annual: pkgs.find((p) => p.period === "annual")?.priceString ?? null,
          trial: pkgs.some((p) => p.introPriceString === "free trial"),
        });
      } catch {
        if (!cancelled) setOffer({ ...EMPTY, status: "none" });
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return offer;
}
