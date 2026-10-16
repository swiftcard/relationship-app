"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TRIAL_DAYS } from "@/lib/plan";
import { ProOfferBlock, ProOfferCta } from "@/components/ProOffer";
import { useIsAndroidApp } from "@/lib/platform";

// ── "Add card", for everyone ─────────────────────────────────────────────────
//
// A Free account at the card limit used to see no button at all. In its place,
// permanently parked under My Cards, sat a dashed box reading "Ready for a
// second card? Go unlimited with Pro." — a piece of furniture that was there
// every single time they opened the dashboard, whether or not they had any
// intention of making another card.
//
// Owner call 2026-09-11: give Free the same button Pro has, and move the pitch
// to the moment it is actually relevant — when they press it. Nothing is
// hidden, nothing nags. Someone who never wants a second card never sees the
// offer; someone who does gets it at the exact second they ask.
//
// The sheet deliberately mirrors ProRequiredDialog: same bottom-sheet chrome,
// same `sc-dark-sheet` class — which is what carries the light-theme exemption
// in globals.css, so a dark panel inside the light-themed app keeps its own
// colours instead of being flipped to white-on-white — and the same ProOffer,
// so the price, the trial wording and the button are one implementation and the
// phone cannot drift away from the laptop again.

function AddCardIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 sm:w-3.5 sm:h-3.5" aria-hidden="true">
      <path d="M10 4a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5h-4.5a.75.75 0 010-1.5h4.5v-4.5A.75.75 0 0110 4z" />
    </svg>
  );
}

export default function AddCardButton({
  locked,
  trialEligible = false,
  className,
}: {
  /** Free account already at its card limit → the button opens the offer. */
  locked: boolean;
  /** First-time subscriber → the offer is the free trial. Resolved server-side. */
  trialEligible?: boolean;
  className: string;
}) {
  const [open, setOpen] = useState(false);

  if (!locked) {
    return (
      <Link href="/cards/new?add=1" className={className}>
        <AddCardIcon />
        Add card
      </Link>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        <AddCardIcon />
        Add card
      </button>
      {open && <SecondCardSheet trialEligible={trialEligible} onClose={() => setOpen(false)} />}
    </>
  );
}

export function SecondCardSheet({
  trialEligible,
  onClose,
}: {
  trialEligible: boolean;
  onClose: () => void;
}) {
  // No trial is offered in the Android app — it sells nothing (owner, 2026-10-08).
  const android = useIsAndroidApp();
  const offerTrial = trialEligible && !android;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="second-card-title"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-slate-950/70 backdrop-blur-[2px]"
        onClick={onClose}
      />

      <div
        className="sc-dark-sheet relative w-full sm:max-w-[26rem] sm:mx-4 max-h-[88vh] flex flex-col rounded-t-3xl sm:rounded-3xl shadow-2xl"
        style={{
          background: "linear-gradient(180deg, #101728 0%, #0B1120 46%)",
          border: "1px solid rgba(148,163,184,0.16)",
          paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))",
        }}
      >
        <div className="sm:hidden flex justify-center pt-2.5 pb-1">
          <span className="w-9 h-1 rounded-full bg-white/20" />
        </div>

        {/* The reading half scrolls; the actions below do not. */}
        <div className="px-5 pt-4 sm:pt-6 overflow-y-auto">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/15 border border-blue-400/25 px-2.5 py-1 text-[0.6875rem] font-bold tracking-wide text-blue-300">
            <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor" aria-hidden="true">
              <path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.3 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8L12 2z" />
            </svg>
            PRO
          </span>

          <h2 id="second-card-title" className="text-white font-bold text-[1.3125rem] leading-tight mt-3">
            More than one card is part of Pro
          </h2>
          {/* ONE sentence, both platforms. */}
          <p className="text-slate-300/90 text-[0.875rem] leading-snug mt-1.5">
            {offerTrial
              ? `Keep a card for each role, company or language — each with its own link, design and contacts. Try Pro free for ${TRIAL_DAYS} days.`
              : "Keep a card for each role, company or language — each with its own link, design and contacts."}
          </p>

          <div className="mt-5">
            <ProOfferBlock
              trialEligible={offerTrial}
              blurb="Unlimited cards, every finish and colour, photo and video backgrounds, unlimited links, and no SwiftCard branding on your Swift Links page."
            />
          </div>
        </div>

        <div className="px-5 pt-4 mt-auto shrink-0 flex flex-col gap-2 border-t border-white/[0.07]">
          <ProOfferCta trialEligible={offerTrial} />
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 rounded-full text-[0.875rem] font-semibold text-slate-200 bg-white/[0.06] border border-white/10 hover:bg-white/[0.1] transition-colors"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
