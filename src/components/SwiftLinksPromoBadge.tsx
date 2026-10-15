"use client";

import { useState } from "react";
import { useIsNativeApp } from "@/lib/platform";
import SwiftLinksPromoSheet from "@/components/SwiftLinksPromoSheet";

// Linktree-style corner badge for Swift Links pages: a small light chip with
// the lightning bolt at the top-left of the page (owner order 2026-09-02 —
// the bolt alone here, deliberately, unlike every other logo surface). It
// stays in that corner while the page scrolls (owner, 2026-10-15) —
// SwiftLinkProfile holds it in a sticky wrapper. Tapping it opens the promo
// sheet inviting the visitor to create their own Swift Links — the SAME sheet
// every other invite on a Swift Links page shows (components/
// SwiftLinksPromoSheet; owner, 2026-09-23).
//
// The badge is passive and always present for web visitors — unlike
// SignupNudgeHost it is the VISITOR's choice to open it, so it doesn't gate
// on account-exists or spend nudge slots. Native app: never rendered (the
// iOS shell is forbidden from selling — same rule as the signup nudge).

// Best-effort funnel events, same endpoint the signup nudge uses. Must never
// affect whether the sheet opens.
function track(username: string, eventType: string): void {
  fetch("/api/analytics/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, event_type: eventType, event_data: { source: "links_promo_badge" } }),
  }).catch(() => {});
}

export default function SwiftLinksPromoBadge({ username, appUrl }: { username: string; appUrl: string }) {
  const [open, setOpen] = useState(false);
  const native = useIsNativeApp();
  if (native) return null;

  return (
    <>
      {/* The corner chip — light frosted square so it reads on any hero
          (photo, logo gradient, initials), with the brand bolt inside. It
          sits above the sticky mini header, centred in it, and never scrolls
          away (SwiftLinkProfile's sticky z-40 wrapper). */}
      <button
        onClick={() => { setOpen(true); track(username, "links_badge_open"); }}
        aria-label="What is Swift Links?"
        className="absolute top-3.5 left-3.5 z-20 w-10 h-10 flex items-center justify-center rounded-[14px] bg-white/85 backdrop-blur-md border border-black/[0.06] shadow-[0_2px_10px_rgba(15,23,42,0.18)] transition-transform active:scale-95 hover:scale-105"
      >
        {/* The bolt GLINTS every 3s (owner, 2026-10-06: "a very clean subtle
            flash just to grab the attention" of whoever is looking at the
            page). Made a touch showier on 2026-10-15 (owner: "make the
            impulse a little larger … people can notice it a little more but
            still keep it a little subtle"): ~0.5s of brighter blue, a 28% pop
            with a stronger glow and a small rebound below full size, so it
            reads as a quick impulse rather than a swell — then still for the
            rest of the cycle. Bolt only; the chip never moves. Off under
            reduced motion. */}
        <style>{`
          @keyframes sc-bolt-flash {
            0%, 18%, 100% { transform: scale(1); filter: brightness(1) drop-shadow(0 0 0 rgba(59,130,246,0)); }
            6% { transform: scale(1.28); filter: brightness(1.45) drop-shadow(0 0 6px rgba(59,130,246,0.9)); }
            12% { transform: scale(0.96); filter: brightness(1.1) drop-shadow(0 0 2px rgba(59,130,246,0.35)); }
          }
          .sc-bolt-flash { transform-origin: 50% 50%; animation: sc-bolt-flash 3s ease-in-out 1s infinite; }
          @media (prefers-reduced-motion: reduce) { .sc-bolt-flash { animation: none; } }
        `}</style>
        <svg viewBox="0 0 24 24" className="sc-bolt-flash w-[22px] h-[22px]" aria-hidden="true">
          <path d="M13 2.5L4.5 13.5h6l-1.5 8 8.5-11h-6l1.5-8z" fill="#1d4ed8" stroke="#1d4ed8" strokeWidth="1" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <SwiftLinksPromoSheet
          onClose={() => setOpen(false)}
          ctaHref="/cards/new?src=links_promo_badge"
          onCta={() => track(username, "links_badge_cta_click")}
          exploreHref={`${appUrl}/?src=links_promo_badge`}
          onExplore={() => track(username, "links_badge_explore_click")}
        />
      )}
    </>
  );
}
