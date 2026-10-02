"use client";

import { useEffect, useRef, useState } from "react";
import { formatBillingDate, type FreePeriod } from "@/lib/billing-state";

type Props = {
  email: string;
  cardCount: number;
  plan: string;
  isPro: boolean;
  defaultOpen?: boolean;
  /** What to say about billing: "below" when this page has a Billing section,
   *  "team" for a team member whose seat their office pays for (there is no
   *  Billing section and nothing to manage), "none" otherwise. */
  billingNote?: "below" | "team" | "none";
  /** The free period running now (a trial, or free Pro/Office), or null. The
   *  days left are shown here — the dashboard announces them on the account's
   *  first day only. No price, no link: the same on the web and in the app. */
  freePeriod?: FreePeriod | null;
};

// Account basics (email, card count, current plan at a glance). Subscription
// management — Change Plan / Cancel / Keep / seats — lives in its own Billing
// section (BillingManager), so this stays a simple read-only summary.
export default function GeneralSettings({ email, cardCount, plan, isPro, defaultOpen = false, billingNote = "below", freePeriod = null }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const planLabel = plan === "enterprise" ? "Office" : isPro ? "Pro" : "Free";
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (defaultOpen) ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [defaultOpen]);

  return (
    <div ref={ref} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-gray-900/60 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-gray-800 flex items-center justify-center shrink-0">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-5 h-5 text-gray-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.272-.806.108-1.204-.165-.397-.506-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.108-1.204l-.526-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-white text-sm font-semibold">General</p>
            <p className="text-gray-500 text-xs truncate">Account details</p>
          </div>
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
          className={`w-4 h-4 text-gray-500 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-1.5 border-t border-gray-800 pt-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-gray-500 text-xs shrink-0">Email</span>
            <span className="text-white text-xs font-medium truncate">{email}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-gray-500 text-xs shrink-0">Cards</span>
            <span className="text-white text-xs font-medium truncate">{cardCount} card{cardCount === 1 ? "" : "s"}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-gray-500 text-xs shrink-0">Plan</span>
            <span className={`text-[0.6875rem] font-bold px-2 py-0.5 rounded-full ${plan === "enterprise" ? "bg-purple-600 text-white" : isPro ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400"}`}>
              {planLabel}
            </span>
          </div>
          {freePeriod && (
            <div className="flex items-start justify-between gap-3">
              <span className="text-gray-500 text-xs shrink-0">
                {freePeriod.isTrial ? "Free trial" : `Free ${freePeriod.planName}`}
              </span>
              {/* The date is formatted in the reader's own time zone, so the
                  server's and the browser's renders may differ by a day. */}
              <span
                suppressHydrationWarning
                className={`text-xs font-medium text-right ${freePeriod.daysLeft <= 3 ? "text-amber-300" : "text-white"}`}
              >
                {freePeriod.daysLeft === 1 ? "1 day left" : `${freePeriod.daysLeft} days left`}
                {freePeriod.canceled
                  ? " · cancelled, you won't be charged"
                  : ` · ends ${formatBillingDate(freePeriod.endsAt)}`}
              </span>
            </div>
          )}
          {/* Named as it is on screen — there is no "Billing" section — and
              true for Free too, which has no subscription to "manage". */}
          {billingNote === "below" && <p className="text-gray-600 text-[0.6875rem] pt-2">{isPro ? "Manage your subscription" : "See or change your plan"} under Plan and billing below.</p>}
          {billingNote === "team" && <p className="text-gray-600 text-[0.6875rem] pt-2">Your plan is provided by your team — nothing to manage or pay.</p>}
        </div>
      )}
    </div>
  );
}
