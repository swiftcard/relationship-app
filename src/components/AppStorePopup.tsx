"use client";

// Shown once, right after someone creates their account, inviting them to
// download the iOS app. Dismissable ("Continue on the web"). Only ever appears
// once per browser (localStorage guard) so it never nags on later visits.

import { useEffect, useState } from "react";
import { APP_STORE_URL } from "@/lib/app-store";
import { useIsNativeApp } from "@/lib/platform";
import { AppleGlyph, StoreBadges } from "@/components/AppStoreBadge";

export default function AppStorePopup({ trigger }: { trigger: boolean }) {
  const [open, setOpen] = useState(false);
  const native = useIsNativeApp();

  useEffect(() => {
    if (!trigger) return;
    let seen = false;
    try { seen = localStorage.getItem("sc_appstore_seen") === "1"; } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration read from localStorage
    if (!seen) setOpen(true);
  }, [trigger]);

  function close() {
    setOpen(false);
    try { localStorage.setItem("sc_appstore_seen", "1"); } catch { /* ignore */ }
    // Let the guided tour know this screen is dismissed so it can start now
    // (the tour waits for "Continue on the web" / "Download on the App Store").
    try { window.dispatchEvent(new CustomEvent("sc:appstore-done")); } catch { /* ignore */ }
  }

  // An app already running natively should never be told to download itself —
  // and neither should anyone, while the app is still in App Review. Without
  // APP_STORE_URL this modal was greeting every new account with a download
  // button that opened the App Store's front page. Hidden until the listing is
  // live; TourAutoStart reads the same appStoreReady() so the tour does not sit
  // waiting for a dismissal that can never come.
  if (!open || native || !APP_STORE_URL) return null;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="appstore-popup-title" className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4 pb-[max(1rem,calc(env(safe-area-inset-bottom)+0.5rem))] sm:pb-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="w-full max-w-sm rounded-3xl bg-gray-900 border border-gray-800 shadow-2xl p-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center mx-auto mb-4">
          <AppleGlyph className="w-7 h-7" color="#60a5fa" />
        </div>
        <h2 id="appstore-popup-title" className="text-white font-bold text-lg mb-1.5">Your account is ready!</h2>
        <p className="text-gray-400 text-sm mb-6 leading-relaxed">
          Get the SwiftCard app to build cards, capture leads, and send follow-ups on the go — with instant notifications the moment someone connects.
        </p>

        {/* The shared badge — the header's look, white words on dark glass,
            with its shine (owner, 2026-09-18). It used to be a hand-made white
            pill, the one App Store button on the site that looked different. */}
        <div className="flex flex-wrap justify-center gap-2.5 mb-2.5">
          <StoreBadges onClick={close} />
        </div>
        <button onClick={close} className="w-full text-gray-500 hover:text-gray-300 text-sm py-2 transition-colors">
          Continue on the web
        </button>
      </div>
    </div>
  );
}
