"use client";

import { useEffect, useState } from "react";
import { detectNativeApp } from "@/lib/platform";

// "Add to Google Wallet" — the Android twin of AddToWalletButton. The link
// goes to our route, which writes the card's pass on Google's side and
// redirects to Google's save page (lib/google-wallet.ts). Parents render this
// only when hasGoogleWalletConfig() is true, so it never shows a dead button.
//
// THE BADGE IS GOOGLE'S, UNCHANGED (public/wallet/google, from Google's brand
// guidelines): black only, never redrawn, recoloured or squashed, at least
// 48px tall. The full "Add to Google Wallet" button needs ~272px at that
// height; where its box is narrower the condensed badge Google ships for
// exactly that case is shown instead (a container query, so the mobile and
// desktop copies of the Share box each pick for their own width).
//
// IN THE ANDROID APP the save page opens in a Custom Tab (@capacitor/browser,
// already in the Android build), which hands the pass to Google Wallet —
// the same reason the Apple button opens a Safari sheet in the iPhone app.

/** True on an Android phone or tablet, in the browser or the app. */
export function useIsAndroidDevice(): boolean {
  const [android, setAndroid] = useState(false);
  useEffect(() => {
    // navigator only exists after mount — same hydration reasoning as
    // useWalletMode in AddToWalletButton.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe by design
    setAndroid(/Android/i.test(navigator.userAgent));
  }, []);
  return android;
}

export default function AddToGoogleWalletButton({ username, onPress, className = "" }: { username: string; onPress?: () => void; className?: string }) {
  const href = `/api/wallet/google?card=${encodeURIComponent(username)}`;

  async function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    onPress?.();
    if (!detectNativeApp()) return; // web: normal link navigation
    e.preventDefault();
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url: new URL(href, window.location.origin).toString() });
    } catch {
      window.location.href = href;
    }
  }

  return (
    <div className={`@container w-full ${className}`}>
      <a
        href={href}
        onClick={handleClick}
        aria-label="Add to Google Wallet"
        className="flex justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- Google's own SVG badge, shown as shipped */}
        <img src="/wallet/google/add-to-google-wallet.svg" alt="" width={272} height={48} className="hidden @[272px]:block h-12 w-[272px] max-w-none" />
        {/* eslint-disable-next-line @next/next/no-img-element -- Google's own SVG badge, shown as shipped */}
        <img src="/wallet/google/add-to-google-wallet-condensed.svg" alt="" width={174} height={48} className="block @[272px]:hidden h-12 w-[174px] max-w-none" />
      </a>
    </div>
  );
}
