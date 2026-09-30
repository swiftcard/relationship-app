"use client";

import { useState } from "react";
import Link from "next/link";
import { PLAN_LIMITS, TRIAL_DAYS } from "@/lib/plan";
import { useIsNativeApp } from "@/lib/platform";
import { SwiftCardIcon } from "@/components/SwiftCardLogo";
import MobilePlanTabs, { type PlanTier } from "@/components/MobilePlanTabs";
import { NativeProUpgrade } from "@/components/PlanCards";
import {
  BillingToggle, ProPlanCard, ProWebPrice, OfficePlanCard, OfficeWebPrice, OfficeSeatPicker, officeTotalLabel,
  PRO_CTA_LINK_CLASS, OFFICE_CTA_LINK_CLASS, PRO_FINE_PRINT_CLASS,
} from "@/components/PlanTierCards";

// Two plans, no Free column. The cards are /pricing's own (PlanTierCards).
// The 14-day Pro trial is offered here exactly as on /pricing and in the
// wizard — but only when the server says this user is actually a FIRST-TIME
// subscriber (trialEligible, resolved by the page against Stripe's own
// subscription history). An ex-subscriber keeps the honest start-and-pay
// button and their route carries `trial=0`, so /checkout drops the trial copy
// and the session bills today — the promise on the button, the copy on
// /checkout and the session Stripe creates always agree.
// Office never has a trial (the checkout API grants trials for Pro only).

const OFFICE_MIN_SEATS = PLAN_LIMITS.OFFICE_MIN_SEATS;

export default function UpgradeClient({ trialEligible }: { trialEligible: boolean }) {
  const [annual, setAnnual] = useState(false);
  const [seats, setSeats] = useState<number>(OFFICE_MIN_SEATS);
  const [mobileTier, setMobileTier] = useState<PlanTier>("pro");

  // Native app (IAP live, 2026-08-27): /upgrade shows a REAL In-App Purchase
  // screen instead of bouncing to the dashboard. It renders no web price
  // anywhere — the only prices a shell user ever sees come from StoreKit
  // (3.1.2): the app's Pro card (NativeProUpgrade), the same card as the
  // app's plan step.
  //
  // This used to redirect to /dashboard whenever canOfferIap() was false, on
  // the reasoning that an upgrade page with no way to upgrade is a dead end.
  // The redirect was the worse dead end: canOfferIap() is false for a missing
  // API key or a single failed chunk fetch as well as for an old shell, so a
  // transient failure silently removed the upgrade screen entirely. The
  // button (IapSubscribeButton, inside the card) decides for itself now, and
  // the sheet says plainly when StoreKit has nothing to sell.
  const native = useIsNativeApp();

  const interval = annual ? "annual" : "monthly";

  // Eligible first-timer → the standard trial checkout (same as /pricing).
  // Ex-subscriber → trial=0 keeps /checkout's copy and the session honest.
  const proHref = trialEligible
    ? `/checkout?plan=pro&interval=${interval}`
    : `/checkout?plan=pro&interval=${interval}&trial=0`;
  const officeHref = `/checkout?plan=office&interval=${interval}&seats=${seats}&trial=0`;

  if (native) {
    return (
      <div className="mx-auto max-w-md">
        <div className="text-center mb-8">
          <span className="inline-block rounded-full bg-[#1D4ED8] px-3 py-1 text-[0.6875rem] font-bold uppercase tracking-wide text-white">SwiftCard Pro</span>
          <h1 className="mt-4 text-2xl font-bold text-white">Do more with every tap</h1>
          <p className="mt-2 text-sm text-gray-400">Unlock everything Pro includes — right here in the app.</p>
        </div>
        <NativeProUpgrade trialEligible={trialEligible} />
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

        <BillingToggle annual={annual} onToggle={() => setAnnual(!annual)} className="mt-6" />
      </div>

      <MobilePlanTabs active={mobileTier} onChangeAction={setMobileTier} tiers={["pro", "office"]} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-stretch md:pt-6">
        {/* "Free for your first 14 days, then $X" — owner-approved
            2026-08-19 — but ONLY for someone who will actually GET a
            trial. An ex-subscriber is billed immediately (proHref carries
            trial=0), so they see the plain price instead of a promise
            checkout then breaks. */}
        <ProPlanCard offTab={mobileTier !== "pro"} price={<ProWebPrice annual={annual} trial={trialEligible} />}>
          <Link href={proHref} className={PRO_CTA_LINK_CLASS}>
            {trialEligible ? `Try Pro free for ${TRIAL_DAYS} days →` : "Get Pro →"}
          </Link>
          <p className={PRO_FINE_PRINT_CLASS}>
            {trialEligible
              ? `${TRIAL_DAYS} days free for new customers · card required · renews automatically`
              : "Your account has had its free Pro period · billing starts today · renews automatically"}
          </p>
        </ProPlanCard>

        <OfficePlanCard
          offTab={mobileTier !== "office"}
          price={<OfficeWebPrice annual={annual} seats={seats} />}
          seatPicker={<OfficeSeatPicker seats={seats} onSeats={setSeats} />}
        >
          <Link href={officeHref} className={OFFICE_CTA_LINK_CLASS}>
            Get Office · {officeTotalLabel(annual, seats)} →
          </Link>
        </OfficePlanCard>
      </div>

      <div className="text-center mt-8">
        <Link href="/dashboard" className="text-gray-500 hover:text-gray-300 text-xs transition-colors">
          ← Back to my dashboard
        </Link>
      </div>
    </div>
  );
}
