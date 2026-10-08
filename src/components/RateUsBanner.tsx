"use client";

import { useState } from "react";
import RateUsLink from "@/components/RateUsLink";
import AppStoreBadge from "@/components/AppStoreBadge";
import { useIsNativeApp } from "@/lib/platform";
import { shouldShowRateUsBanner } from "@/lib/rate-us";
import { appStoreReady } from "@/lib/app-store";

// A small dismissible "Rate us" banner at the top of the dashboard, shown only
// after a good moment (rules + why in lib/rate-us.ts). Dismissing OR clicking
// hides it for 60 days, recorded per user in Supabase via /api/profile/rate-us.
//
// Web only: inside the iPhone app Apple's own rating sheet already covers the
// happy moments (lib/app-review.ts) and /grow carries the permanent link.
export default function RateUsBanner({ leadCount, viewCount, dismissedAt }: { leadCount: number; viewCount: number; dismissedAt: string | null }) {
  const native = useIsNativeApp();
  const [hidden, setHidden] = useState(false);
  // No App Store listing configured → RateUsLink and the badge both render
  // nothing, and the banner asked for a review with only "Dismiss" to press.
  if (native || hidden || !appStoreReady() || !shouldShowRateUsBanner({ leadCount, viewCount, dismissedAt })) return null;

  function hide() {
    setHidden(true);
    // Fire-and-forget: a failed write only means the banner returns next load.
    void fetch("/api/profile/rate-us", { method: "POST", keepalive: true }).catch(() => {});
  }

  return (
    // sc-apple-only: the whole banner asks for an App Store review, so an
    // Android browser gets none of it (globals.css, data-sc-os) — not a banner
    // with its button missing.
    <div className="sc-apple-only flex items-center justify-between gap-4 rounded-2xl px-5 py-3.5 mb-5 bg-blue-950/30 border border-blue-800/40 flex-wrap">
      <p className="text-sm text-blue-200/90 leading-snug min-w-0">
        {leadCount >= 1 ? "Your card is bringing in contacts." : "People are viewing your card."} If SwiftCard is working for you, a quick App Store review helps others find it.
        <span className="hidden md:inline text-blue-300/70"> Best on iPhone.</span>
      </p>
      {/* Wraps, never forces its width: "Rate us on the App Store" + the App
          Store badge + Dismiss are ~380px on one line. With shrink-0 and no
          wrap they ran past a phone's edge, the phone zoomed the whole
          dashboard out to fit, and the fixed tab bar ended up below the
          screen — every tab "untappable" (nightly QA, 2026-09-29). */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 min-w-0">
        {/* The click bubbles up from the link: the link tracks, this hides. */}
        <span onClick={hide} className="contents">
          <RateUsLink
            placement="dashboard_banner"
            className="text-xs font-bold text-blue-950 bg-blue-300 hover:bg-blue-200 px-3.5 py-1.5 rounded-full transition-colors"
          />
        </span>
        <AppStoreBadge size="sm" />
        <button onClick={hide} className="text-blue-300/70 hover:text-blue-200 text-xs font-medium">
          Dismiss
        </button>
      </div>
    </div>
  );
}
