"use client";

// "Rate us" on /grow — one plain link to the App Store, for everyone.
//
// In the iOS app it opens the write-review form in the App Store app; on the web
// it opens the listing (see APP_STORE_WRITE_REVIEW_URL / APP_STORE_LISTING_URL).
// No stars, no "how do you feel?" first, no routing unhappy people elsewhere:
// App Review guideline 1.1.7/5.6.1 forbids filtering who gets asked, and the old
// card here did exactly that (4–5★ → Trustpilot, 1–3★ → a private box).
//
// target=_blank is load-bearing in the app: Capacitor hands new-window links to
// UIApplication.open, which is what takes an apps.apple.com link into the App
// Store app instead of loading the web page inside our webview.
//
// Apple's automatic rating sheet is a different thing entirely and never starts
// from a tap — see lib/app-review.ts.

import { useIsAndroidApp, useIsNativeApp } from "@/lib/platform";
import { APP_STORE_LISTING_URL, APP_STORE_WRITE_REVIEW_URL } from "@/lib/app-store";

export default function RateUsCard() {
  const native = useIsNativeApp();
  // Both of these are apps.apple.com links. In the Android app they would send
  // someone to review an app they are not using and cannot have installed.
  // There is no Play listing to point at yet, so show nothing rather than
  // something wrong; this comes back when the app is on Play.
  const androidApp = useIsAndroidApp();
  const href = native ? APP_STORE_WRITE_REVIEW_URL : APP_STORE_LISTING_URL;
  if (!href || androidApp) return null;

  return (
    <div className="bg-gray-900 border border-gray-800/80 rounded-2xl p-5">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="#f59e0b" aria-hidden="true"><path d="M12 2l2.9 5.88 6.5.95-4.7 4.58 1.11 6.47L12 17.3 6.19 19.86 7.3 13.4 2.6 8.82l6.5-.95L12 2z" /></svg>
        </div>
        <div>
          <p className="text-gray-200 text-sm font-medium">Enjoying SwiftCard?</p>
          <p className="text-gray-500 text-xs leading-relaxed">An App Store rating helps other people find us.</p>
        </div>
      </div>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold py-2.5 rounded-full transition-colors"
      >
        Rate us on the App Store
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
      </a>
    </div>
  );
}
