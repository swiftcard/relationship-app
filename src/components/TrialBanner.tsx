"use client";

import Link from "next/link";
import { useIsNativeApp } from "@/lib/platform";

// Dashboard banner for a free period (a Stripe trial, or free Pro/Office with
// nothing billing it). Presentational only — the dashboard decides when to
// render it, which is the account's first day only (lib/billing-state
// showsTrialBubble); after that the days left are in Settings → Profile.
//
// NATIVE (App Store 3.1.1): the status line is neutral information and stays,
// but the "Keep Pro →" /pricing CTA is a selling surface and must never render
// inside the Capacitor shell. Web is byte-identical (native is false on SSR and
// first paint).
export default function TrialBanner({ daysLeft, isTrial, planName = "Pro", billedFrom, canceled = false }: {
  daysLeft: number;
  isTrial: boolean;
  /** "Office" for a granted Office — it was called "Pro". */
  planName?: "Pro" | "Office";
  /** A Stripe trial: the subscription STARTS on this date (it does not fall
   *  back to Free), so the banner says so and points at billing, not /upgrade. */
  billedFrom?: string;
  /** A Stripe trial the person has cancelled: nothing will be charged, so the
   *  banner must not keep saying the subscription starts on that date. */
  canceled?: boolean;
}) {
  const native = useIsNativeApp();
  const urgent = daysLeft <= 3;
  const label = isTrial ? `You're on a free ${planName} trial` : `You're on free ${planName}`;
  const days = daysLeft === 1 ? "1 day left" : `${daysLeft} days left`;

  return (
    <div
      className="flex items-center justify-between gap-3 rounded-2xl px-5 py-3.5 mb-5 border flex-wrap"
      style={
        urgent
          ? { background: "rgba(180,83,9,0.12)", borderColor: "rgba(180,83,9,0.4)" }
          : { background: "rgba(37,99,235,0.10)", borderColor: "rgba(37,99,235,0.35)" }
      }
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <p className={`text-sm font-medium ${urgent ? "text-amber-300" : "text-blue-200"}`}>
          {label} — <span className="font-bold">{days}</span>
          <span className={`${billedFrom ? "block sm:inline" : "hidden sm:inline"} text-gray-400 font-normal`}>
            {billedFrom && canceled
              ? ` · you cancelled, so you won’t be charged. You move to Free on ${billedFrom}. Nothing gets deleted.`
              : billedFrom
              ? ` · your subscription starts ${billedFrom}. Cancel anytime before then.`
              : " · then you move to Free. Nothing gets deleted."}
          </span>
        </p>
      </div>
      {!native && billedFrom && (
        <Link
          href="/settings/flows?billing=1"
          className="shrink-0 text-xs font-semibold px-4 py-2 rounded-full text-gray-200 border border-gray-700 hover:border-gray-500 transition-colors"
        >
          Manage plan
        </Link>
      )}
      {!native && !billedFrom && (
        <Link
          href="/upgrade"
          className={`shrink-0 text-xs font-bold px-4 py-2 rounded-full text-white transition-colors ${
            urgent ? "bg-amber-600 hover:bg-amber-500" : "bg-blue-600 hover:bg-blue-500"
          }`}
        >
          Keep {planName} →
        </Link>
      )}
    </div>
  );
}
