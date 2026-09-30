"use client";

import { useState } from "react";
import Link from "next/link";
import { PLAN_LIMITS, PLAN_PRICES, TRIAL_DAYS } from "@/lib/plan";
import ProTrialPrice from "@/components/ProTrialPrice";
import { useIsNativeApp } from "@/lib/platform";
import { PLAN_FEATURES } from "@/lib/plan-content";
import IapSubscribeButton from "@/components/NativePaywall";
import { formatUsd, seatSubtotalCents, perMonthCents } from "@/lib/currency";
import { SwiftCardIcon } from "@/components/SwiftCardLogo";
import { useIsMobile } from "@/lib/use-is-mobile";
import MobilePlanTabs, { type PlanTier } from "@/components/MobilePlanTabs";

// Two plans, no Free column. The 14-day Pro trial is offered here exactly as
// on /pricing and in the wizard — but only when the server says this user is
// actually a FIRST-TIME subscriber (trialEligible, resolved by the page
// against Stripe's own subscription history). An ex-subscriber keeps the
// honest start-and-pay button and their route carries `trial=0`, so /checkout
// drops the trial copy and the session bills today — the promise on the
// button, the copy on /checkout and the session Stripe creates always agree.
// Office never has a trial (the checkout API grants trials for Pro only).

const OFFICE_MIN_SEATS = PLAN_LIMITS.OFFICE_MIN_SEATS;

function Check({ light }: { light?: boolean }) {
  return (
    <span className="w-4 h-4 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: light ? "rgba(255,255,255,0.22)" : "rgba(96,165,250,0.15)" }}>
      <svg viewBox="0 0 20 20" className="w-3 h-3" fill="none" stroke={light ? "#ffffff" : "#60a5fa"} strokeWidth={2.6}>
        <path d="M4 10.5l4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export default function UpgradeClient({ trialEligible }: { trialEligible: boolean }) {
  const [annual, setAnnual] = useState(false);
  const [seats, setSeats] = useState<number>(OFFICE_MIN_SEATS);
  const isMobile = useIsMobile();
  const [mobileTier, setMobileTier] = useState<PlanTier>("pro");

  // Native app (IAP live, 2026-08-27): /upgrade shows a REAL In-App Purchase
  // screen instead of bouncing to the dashboard. It renders no web price
  // anywhere — the only prices a shell user ever sees come from StoreKit
  // inside the paywall sheet (3.1.2).
  //
  // This used to redirect to /dashboard whenever canOfferIap() was false, on
  // the reasoning that an upgrade page with no way to upgrade is a dead end.
  // The redirect was the worse dead end: canOfferIap() is false for a missing
  // API key or a single failed chunk fetch as well as for an old shell, so a
  // transient failure silently removed the upgrade screen entirely. The
  // button decides for itself now, and the sheet says plainly when StoreKit
  // has nothing to sell.
  const native = useIsNativeApp();

  const interval = annual ? "annual" : "monthly";
  const proCents = annual ? PLAN_PRICES.PRO_ANNUAL_CENTS : PLAN_PRICES.PRO_MONTHLY_CENTS;
  const officePerSeat = annual ? PLAN_PRICES.OFFICE_ANNUAL_PER_SEAT_CENTS : PLAN_PRICES.OFFICE_MONTHLY_PER_SEAT_CENTS;
  const officeTotal = seatSubtotalCents(officePerSeat, seats);
  const per = annual ? "yr" : "mo";

  // Eligible first-timer → the standard trial checkout (same as /pricing).
  // Ex-subscriber → trial=0 keeps /checkout's copy and the session honest.
  const proHref = trialEligible
    ? `/checkout?plan=pro&interval=${interval}`
    : `/checkout?plan=pro&interval=${interval}&trial=0`;
  const officeHref = `/checkout?plan=office&interval=${interval}&seats=${seats}&trial=0`;

  if (native) {
    return (
      <div className="mx-auto max-w-sm">
        <div className="text-center mb-8">
          <span className="inline-block rounded-full bg-[#1D4ED8] px-3 py-1 text-[0.6875rem] font-bold uppercase tracking-wide text-white">SwiftCard Pro</span>
          <h1 className="mt-4 text-2xl font-bold text-white">Do more with every tap</h1>
          <p className="mt-2 text-sm text-gray-400">Unlock everything Pro includes — right here in the app.</p>
        </div>
        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
          <ul className="space-y-3">
            {PLAN_FEATURES.pro.map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-sm text-gray-200">
                <Check />
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <IapSubscribeButton className="mt-6 !w-full !py-3.5 !text-sm" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="text-center mb-8">
        <div className="flex items-center justify-center gap-2 mb-6">
          <SwiftCardIcon size={26} />
          <span className="text-white font-bold tracking-tight">SwiftCard</span>
        </div>
        <h1 className="text-white text-3xl font-bold tracking-tight mb-2">Upgrade your account</h1>
        <p className="text-gray-500 text-sm">Cancel anytime. No contracts.</p>

        <div className="mt-6 inline-flex items-center gap-3 rounded-full px-4 py-2 border border-gray-800 bg-gray-900">
          <span className={`text-xs font-medium transition-colors ${!annual ? "text-white" : "text-gray-500"}`}>Monthly</span>
          <button
            onClick={() => setAnnual(!annual)}
            aria-label="Toggle annual billing"
            aria-pressed={annual}
            className="relative w-10 h-5.5 rounded-full transition-colors duration-200"
            style={{ background: annual ? "#2563EB" : "#374151", width: 40, height: 22 }}
          >
            <div className="absolute top-0.5 w-[18px] h-[18px] bg-white rounded-full shadow transition-transform duration-200" style={{ transform: annual ? "translateX(20px)" : "translateX(2px)" }} />
          </button>
          <span className={`text-xs font-medium transition-colors ${annual ? "text-white" : "text-gray-500"}`}>
            Annual <span className="ml-1 text-[0.625rem] font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full">SAVE 10%</span>
          </span>
        </div>
      </div>

      <MobilePlanTabs active={mobileTier} onChangeAction={setMobileTier} tiers={["pro", "office"]} dark />

      <div className="grid md:grid-cols-2 gap-4 items-stretch">
        {/* Pro */}
        <div className={`${isMobile && mobileTier !== "pro" ? "hidden" : ""} relative rounded-[24px] p-7 flex flex-col overflow-hidden`} style={{ background: "linear-gradient(150deg,#2563EB,#4f46e5)", boxShadow: "0 40px 90px -30px rgba(37,99,235,0.6)" }}>
          <div className="absolute inset-0 opacity-25" style={{ background: "radial-gradient(120% 90% at 20% -10%, rgba(255,255,255,0.6), transparent 55%)" }} />
          <div className="absolute top-6 right-6 bg-white/25 text-white text-[0.625rem] font-bold px-2.5 py-1 rounded-full">MOST POPULAR</div>
          <div className="relative flex flex-col flex-1">
            <p className="text-[1.3rem] font-extrabold tracking-tight text-black mb-3">Pro</p>
            {/* "Free for your first 14 days, then $X" — owner-approved
                2026-08-19 — but ONLY for someone who will actually GET a
                trial. An ex-subscriber is billed immediately (proHref carries
                trial=0), so they see the plain price instead of a promise
                checkout then breaks. */}
            {trialEligible ? (
              <ProTrialPrice
                price={formatUsd(proCents)}
                period={annual ? "year" : "month"}
                note={annual ? `≈ ${formatUsd(perMonthCents(PLAN_PRICES.PRO_ANNUAL_CENTS))}/mo · Save 10%` : undefined}
              />
            ) : (
              <>
                <div className="flex items-end gap-1">
                  <span className="text-[2.4rem] font-bold text-white leading-none">{formatUsd(proCents)}</span>
                  <span className="text-white/75 text-sm mb-1">/ {annual ? "year" : "month"}</span>
                </div>
                {annual && <p className="text-white/85 text-xs font-semibold mt-1.5">≈ {formatUsd(perMonthCents(PLAN_PRICES.PRO_ANNUAL_CENTS))}/mo · Save 10%</p>}
              </>
            )}
            <p className={`text-white/80 text-sm mb-6 ${trialEligible ? "mt-4" : "mt-2"}`}>Everything, unlimited.</p>
            <ul className="space-y-2 mb-7 flex-1">
              {PLAN_FEATURES.pro.map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-[0.8125rem] text-white"><Check light />{f}</li>
              ))}
            </ul>
            <Link
              href={proHref}
              className="w-full text-center bg-white hover:bg-white/90 text-[#2450d8] font-bold py-3 rounded-full transition-colors text-sm shadow-lg"
            >
              {trialEligible ? `Start ${TRIAL_DAYS}-day free trial →` : <>Upgrade to Pro — {formatUsd(proCents)}/{per} →</>}
            </Link>
            <p className="text-white/70 text-[0.6875rem] text-center mt-2.5">
              {trialEligible
                ? `Card required · renews automatically at ${formatUsd(proCents)}/${per}`
                : "Billing starts today · Cancel anytime"}
            </p>
          </div>
        </div>

        {/* Office */}
        <div className={`${isMobile && mobileTier !== "office" ? "hidden" : ""} rounded-[24px] p-7 flex flex-col bg-gray-900 border border-gray-800`}>
          <div className="flex items-center gap-2 mb-3">
            <p className="text-[1.3rem] font-extrabold tracking-tight text-white">Office</p>
            <span className="text-[0.625rem] font-bold text-blue-300 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full">FOR TEAMS</span>
          </div>
          <div className="flex items-end gap-1">
            <span className="text-[2.4rem] font-bold text-white leading-none">{formatUsd(annual ? perMonthCents(PLAN_PRICES.OFFICE_ANNUAL_PER_SEAT_CENTS) : PLAN_PRICES.OFFICE_MONTHLY_PER_SEAT_CENTS)}</span>
            <span className="text-gray-500 text-sm mb-1">/ mo per person</span>
          </div>
          <p className="text-blue-400 text-xs font-semibold mt-1.5">
            Minimum {OFFICE_MIN_SEATS} people{annual ? " · billed yearly, save 10%" : ""}
          </p>
          <p className="text-white font-bold text-[0.8125rem] mt-1">{seats} people → {formatUsd(officeTotal)}/{per}</p>

          <div className="mt-4 mb-5">
            <label className="text-xs text-gray-500 font-medium block mb-2">How many people?</label>
            <div className="flex gap-2 flex-wrap">
              {[2, 5, 10, 25, 50].map((n) => (
                <button
                  key={n}
                  onClick={() => setSeats(n)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    seats === n ? "bg-blue-600 text-white" : "bg-gray-950 text-gray-400 border border-gray-800 hover:text-gray-200"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              {/* See the note on the same control in PlanCards. */}
              <label htmlFor="office-seats-upgrade" className="text-xs text-gray-600">Custom:</label>
              <input
                id="office-seats-upgrade"
                aria-label="Number of team seats"
                type="number"
                min={OFFICE_MIN_SEATS}
                value={seats}
                onChange={(e) => setSeats(Math.max(OFFICE_MIN_SEATS, Math.floor(Number(e.target.value) || OFFICE_MIN_SEATS)))}
                className="w-20 rounded-lg px-2.5 py-1.5 text-xs text-white bg-gray-950 border border-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
              <span className="text-xs text-gray-600">people</span>
            </div>
          </div>

          <ul className="space-y-2 mb-7 flex-1">
            {PLAN_FEATURES.office.map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-[0.8125rem] text-gray-400"><Check />{f}</li>
            ))}
          </ul>
          <Link
            href={officeHref}
            className="w-full text-center bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-full transition-colors text-sm"
          >
            Upgrade to Office — {formatUsd(officeTotal)}/{per} →
          </Link>
          <p className="text-gray-600 text-[0.6875rem] text-center mt-2">Billing starts today · Your card is seat 1</p>
        </div>
      </div>

      <div className="text-center mt-8">
        <Link href="/dashboard" className="text-gray-500 hover:text-gray-300 text-xs transition-colors">
          ← Back to my dashboard
        </Link>
      </div>
    </div>
  );
}
