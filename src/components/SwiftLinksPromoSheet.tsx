"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// ── "Create your own Swift Links" — the ONE Swift Links invite ───────────────
//
// Owner, 2026-09-23: on a Swift Links page, whatever the visitor presses, the
// popup that comes up must be "the exact same pop-up as what's in the icon on
// the top left of the screen". It used to be two different things: the corner
// badge opened this sheet, while tapping a link (or Connect, or Save) opened
// the SwiftCard "create your free card" nudge with a card mockup on it.
//
// So the sheet lives here, once, and both doors render it:
//   • components/SwiftLinksPromoBadge — the corner bolt, the visitor's choice;
//   • components/SignupNudgeHost variant="links" — the moment-based invite on
//     a Swift Links page (its own once-per-moment rules and account check).
// Everything the visitor sees — mockup, words, button, link, motion — comes
// from this file, so the two cannot drift apart again. Only the attribution
// (`?src=`) and the funnel events differ, and neither is visible.
//
// Portaled to <body>: transformed/overflow ancestors on these pages would cage
// a fixed overlay to their own box. Bottom sheet on phones, centered dialog on
// md+. Escape, the ✕ and a tap outside all close it.

export default function SwiftLinksPromoSheet({
  onClose,
  ctaHref,
  onCta,
  exploreHref,
  onExplore,
}: {
  /** Called once the close animation has finished. */
  onClose: () => void;
  ctaHref: string;
  onCta?: () => void;
  exploreHref: string;
  onExplore?: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  function dismiss() {
    if (closeTimer.current) return;
    setClosing(true);
    closeTimer.current = setTimeout(() => onCloseRef.current(), 220);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
    // dismiss only reads refs and sets state, so one listener is enough.
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end md:items-center justify-center px-4 pb-[max(16px,env(safe-area-inset-bottom))] md:pb-4 bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label="Create your own Swift Links"
      onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
    >
      <div
        className={`w-full max-w-sm rounded-[28px] overflow-hidden bg-white ${closing ? "sc-lbp-out" : "sc-lbp-in"}`}
        style={{
          border: "1px solid rgba(148,163,184,0.25)",
          boxShadow: "0 30px 70px -12px rgba(15,23,42,0.4), 0 6px 20px rgba(15,23,42,0.1)",
        }}
      >
        {/* Hero — the Swift Links identity itself: the pages' indigo gradient
            with a floating mini links-page mockup, colorful link pills and all.
            The sheet SHOWS the product. Pure CSS, no assets. */}
        <div
          className="relative overflow-hidden px-6 pt-7 pb-5"
          style={{ background: "linear-gradient(160deg, #181538 0%, #2A2466 55%, #4338ca 100%)" }}
        >
          {/* Color bloom behind the mockup so the dark field feels lit */}
          <div aria-hidden className="absolute -top-10 left-1/2 -translate-x-1/2 w-64 h-40 rounded-full bg-gradient-to-r from-sky-400/30 via-fuchsia-400/25 to-amber-300/20 blur-3xl" />
          <button
            onClick={dismiss}
            aria-label="Dismiss"
            className="absolute top-3 right-3 z-20 w-9 h-9 flex items-center justify-center rounded-full bg-white/15 backdrop-blur text-white/80 hover:text-white hover:bg-white/25 transition-colors"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" /></svg>
          </button>

          {/* Twinkles */}
          <svg viewBox="0 0 24 24" className="absolute left-[14%] top-8 w-3 h-3 text-sky-300 sc-lbp-twinkle" aria-hidden="true"><path fill="currentColor" d="M12 0l2.4 9.6L24 12l-9.6 2.4L12 24l-2.4-9.6L0 12l9.6-2.4z"/></svg>
          <svg viewBox="0 0 24 24" className="absolute right-[15%] bottom-8 w-2.5 h-2.5 text-fuchsia-300 sc-lbp-twinkle" style={{ animationDelay: "0.8s" }} aria-hidden="true"><path fill="currentColor" d="M12 0l2.4 9.6L24 12l-9.6 2.4L12 24l-2.4-9.6L0 12l9.6-2.4z"/></svg>

          {/* Mini Swift Links page, floating */}
          <div className="relative flex justify-center" aria-hidden="true">
            <div className="sc-lbp-float relative w-[158px] -rotate-3">
              <div className="absolute inset-0 rotate-[5deg] rounded-[20px] bg-white/10" />
              <div className="relative rounded-[20px] bg-white overflow-hidden shadow-[0_18px_40px_-10px_rgba(8,8,20,0.55)]">
                <span className="sc-lbp-shine pointer-events-none absolute inset-0 z-10" />
                <div className="px-4 pt-4 pb-4 flex flex-col items-center">
                  {/* avatar with a colorful ring */}
                  <div className="w-11 h-11 rounded-full p-[2.5px] bg-gradient-to-tr from-blue-600 via-fuchsia-500 to-amber-400">
                    <div className="w-full h-full rounded-full bg-gradient-to-br from-indigo-900 to-indigo-600 flex items-center justify-center">
                      <span className="text-[0.5625rem] font-black text-white tracking-wide">YOU</span>
                    </div>
                  </div>
                  {/* name + subtitle bars */}
                  <div className="mt-2 h-[7px] w-16 rounded-full bg-slate-900" />
                  <div className="mt-1.5 h-[5px] w-11 rounded-full bg-slate-300" />
                  {/* social dots */}
                  <div className="mt-2.5 flex gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-[#0A66C2]" />
                    <span className="w-3 h-3 rounded-full bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600" />
                    <span className="w-3 h-3 rounded-full bg-slate-900" />
                    <span className="w-3 h-3 rounded-full bg-[#FF0000]" />
                  </div>
                  {/* colorful link pills */}
                  <div className="mt-3 w-full space-y-1.5">
                    <div className="h-[18px] rounded-full bg-gradient-to-r from-blue-700 to-sky-500" />
                    <div className="h-[18px] rounded-full bg-gradient-to-r from-fuchsia-500 to-pink-400" />
                    <div className="h-[18px] rounded-full bg-gradient-to-r from-amber-400 to-orange-400" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 pt-5 pb-6 text-center">
          <h2 className="text-slate-900 text-[1.4375rem] font-extrabold leading-tight tracking-tight">
            Create your own Swift Links
          </h2>
          <p className="text-slate-500 text-[0.84375rem] leading-snug mt-2 max-w-[300px] mx-auto">
            Comes with a SwiftCard and Swift Signature. Used by many business
            professionals. One link to share everything about you.
          </p>

          <a
            href={ctaHref}
            // No wipe on click: same as "Get started free" in the site header.
            // The builder asks "Continue your card / Start a new card" itself
            // when an unfinished card exists.
            onClick={onCta}
            className="relative overflow-hidden mt-5 flex items-center justify-center gap-2 w-full py-3.5 rounded-full text-[1rem] font-bold text-white bg-gradient-to-r from-blue-700 via-blue-600 to-sky-500 transition-all active:scale-[0.98] hover:brightness-110"
            style={{ boxShadow: "0 12px 28px -6px rgba(37,99,235,0.55)" }}
          >
            <span className="sc-lbp-shine pointer-events-none absolute inset-0" />
            See how yours looks for free
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 shrink-0" aria-hidden="true"><path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" /></svg>
          </a>
          <p className="text-slate-400 text-[0.71875rem] mt-2">No credit card · Live in 60 seconds</p>

          <div className="flex justify-center mt-3">
            <a
              href={exploreHref}
              onClick={onExplore}
              className="text-[0.8125rem] font-medium text-slate-500 hover:text-slate-800 underline underline-offset-2 transition-colors"
            >
              Explore more about SwiftCard
            </a>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes sc-lbp-in {
          0%   { transform: translateY(110%); opacity: 0; }
          60%  { transform: translateY(-8px); opacity: 1; }
          100% { transform: translateY(0); opacity: 1; }
        }
        @keyframes sc-lbp-out {
          from { transform: translateY(0); opacity: 1; }
          to   { transform: translateY(30px); opacity: 0; }
        }
        .sc-lbp-in  { animation: sc-lbp-in 0.5s cubic-bezier(0.22, 1, 0.36, 1); }
        .sc-lbp-out { animation: sc-lbp-out 0.22s ease-in forwards; }
        @keyframes sc-lbp-shine {
          0%, 55% { transform: translateX(-130%) skewX(-18deg); }
          85%, 100% { transform: translateX(230%) skewX(-18deg); }
        }
        .sc-lbp-shine {
          background: linear-gradient(105deg, transparent 38%, rgba(255,255,255,0.5) 50%, transparent 62%);
          width: 60%;
          animation: sc-lbp-shine 3.4s ease-in-out infinite;
        }
        /* The float and the twinkles were referenced by the mockup but never
           defined, so the "floating" page sat still. */
        @keyframes sc-lbp-float {
          0%, 100% { transform: translateY(0) rotate(-3deg); }
          50%      { transform: translateY(-5px) rotate(-3deg); }
        }
        .sc-lbp-float { animation: sc-lbp-float 3.2s ease-in-out infinite; }
        @keyframes sc-lbp-twinkle {
          0%, 100% { opacity: 0.25; transform: scale(0.8); }
          50%      { opacity: 1; transform: scale(1.15); }
        }
        .sc-lbp-twinkle { animation: sc-lbp-twinkle 2.2s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .sc-lbp-in, .sc-lbp-out, .sc-lbp-shine, .sc-lbp-float, .sc-lbp-twinkle { animation: none; }
        }
      `}</style>
    </div>,
    document.body,
  );
}
