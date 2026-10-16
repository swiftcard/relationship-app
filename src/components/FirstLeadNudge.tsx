"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { trackCta } from "@/lib/events";

// A one-time, dismissible "refer a friend" nudge at a happy moment — right after
// a free user captures their very first contact.
//
// It used to say "Refer a friend" in bold text with no link, and offer exactly
// one button: Dismiss. The header comment claimed "the full referral card with
// the link lives just below on the dashboard" — it does not, and never has;
// ReferAFriend renders only on /grow and /settings/flows. So the single best
// activation moment in the product asked for a referral and gave the user no way
// to make one. It's a link now.
export default function FirstLeadNudge({ leadCount, isPro }: { leadCount: number; isPro: boolean }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isPro || leadCount !== 1) return;
    try {
      if (localStorage.getItem("sc_firstlead_nudge")) return;
    } catch { /* private mode */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration read from localStorage
    setShow(true);
  }, [leadCount, isPro]);

  // In the app too (owner, 2026-10-07). It was hidden there as a referral
  // promo while the app had no purchase path; referrals came back to the app
  // with in-app purchase (2026-08-26) — Settings and /grow show them — so the
  // first-contact moment says the same thing on every device.
  if (!show) return null;

  function dismiss() {
    try { localStorage.setItem("sc_firstlead_nudge", "1"); } catch { /* ignore */ }
    setShow(false);
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl px-5 py-3.5 mb-5 bg-emerald-950/30 border border-emerald-800/40 flex-wrap">
      <div className="flex items-center gap-2.5 min-w-0">
        <p className="text-sm text-emerald-100/90 leading-snug">
          Your first contact! Know someone who&apos;d love this? They get a free month, and 3 signups earn you a month of Pro free.
        </p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <Link
          href="/grow"
          onClick={() => trackCta("refer_a_friend", "first_lead_nudge")}
          className="text-xs font-bold text-emerald-950 bg-emerald-400 hover:bg-emerald-300 px-3.5 py-1.5 rounded-full transition-colors"
        >
          Refer a friend →
        </Link>
        <button onClick={dismiss} className="text-emerald-300/60 hover:text-emerald-200 text-xs font-medium">
          Dismiss
        </button>
      </div>
    </div>
  );
}
