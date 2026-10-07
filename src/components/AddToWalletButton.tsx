"use client";

import { useEffect, useState } from "react";
import { MiniQR } from "@/components/card-templates/MiniQR";
import { detectNativeApp, useIsAndroidApp, useIsIosAppOnMac } from "@/lib/platform";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

// "Add to Apple Wallet" download button. On the web it's a plain link to the
// pass route — the browser hands the .pkpass to Apple Wallet on iPhone/Mac.
// Parents render this only when hasWalletConfig() is true, so it never shows a
// broken download.
//
// NATIVE (Capacitor shell): a raw WKWebView doesn't reliably hand a .pkpass
// download to Wallet. Opening the same URL in the system-browser sheet
// (@capacitor/browser → SFSafariViewController) does — Safari recognizes the
// pass MIME type and shows Apple's native "Add to Wallet" UI. Web behavior is
// byte-identical (the intercept only engages inside the shell).
// WHAT THIS DEVICE CAN DO WITH A PASS (owner, 2026-10-07: every feature has
// to make sense on the device it is on).
//   "button"   iPhone, iPad and Mac browsers, and the iPhone app — the pass
//              opens in Apple Wallet (a Mac's Safari sends it to the iPhone).
//   "qr"       any other computer (Windows, Linux, ChromeOS): a .pkpass there
//              is a file nothing can open, so it shows a code to scan with
//              the iPhone instead — the pass route is public, so the phone
//              needs no sign-in.
//   "none"     Android, web or app: no Apple Wallet at all. The whole Wallet
//              section goes, not just the button (MoreShareOptions).
// "button" on the server and the first client render, like every platform
// hook, then the real answer after mount.
export type WalletMode = "button" | "qr" | "none";

function detectWalletMode(): WalletMode {
  if (detectNativeApp()) return "button"; // the Android app is caught by useIsAndroidApp
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "none";
  // iPadOS reports itself as a Mac; both are Apple.
  if (/iPhone|iPad|iPod|Macintosh|Mac OS X/i.test(ua)) return "button";
  return "qr";
}

export function useWalletMode(): WalletMode {
  const androidApp = useIsAndroidApp();
  const [mode, setMode] = useState<WalletMode>("button");
  useEffect(() => {
    // Read from navigator, so only after mount — the same hydration reasoning
    // as useIsNativeApp.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe by design
    setMode(detectWalletMode());
  }, []);
  return androidApp ? "none" : mode;
}

export default function AddToWalletButton({ username, className = "" }: { username: string; className?: string }) {
  const href = `/api/wallet/pass?card=${encodeURIComponent(username)}`;
  const mode = useWalletMode();
  // ON A MAC there is no Apple Wallet for an iOS app to add a pass to: PassKit
  // is not part of the "Designed for iPhone" runtime, so the button opened a
  // sheet that could not finish — a dead end with no explanation. Say what is
  // true and point at the thing that DOES work, rather than hiding the feature
  // as if it never existed.
  const onMac = useIsIosAppOnMac();
  // IN THE ANDROID APP there is no Apple Wallet and no Google Wallet pass (the
  // knowledge base says so to anyone who asks). Left alone, this rendered "Add
  // to Apple Wallet" inside an Android app and handed Chrome a .pkpass, which
  // downloads as a file nothing on the device can open — a dead end dressed up
  // as a feature. Android BROWSERS have the same dead end, and since
  // 2026-10-07 useWalletMode answers "none" for them too.
  const androidApp = useIsAndroidApp();

  async function handleNativeOpen(e: React.MouseEvent<HTMLAnchorElement>) {
    if (!detectNativeApp()) return; // web: normal link navigation
    e.preventDefault();
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url: new URL(href, window.location.origin).toString() });
    } catch {
      // Plugin missing — fall back to webview navigation (may not open Wallet,
      // but never dead-ends silently).
      window.location.href = href;
    }
  }

  if (androidApp) return null;
  if (mode === "none") return null; // an Android browser: the same dead end

  if (onMac) {
    return (
      <p className={`w-full text-center text-[0.8125rem] text-slate-500 leading-snug ${className}`}>
        Apple Wallet passes are added on your iPhone or iPad. Open SwiftCard there,
        or tap Show QR.
      </p>
    );
  }

  if (mode === "qr") {
    return (
      <div className={`flex items-center gap-3 rounded-xl bg-gray-800/60 border border-gray-700/60 p-3 ${className}`}>
        <div className="shrink-0 rounded-lg bg-white p-1.5">
          {/* The site address, not this page's origin: the code is read by a
              phone, which cannot reach a computer's localhost or a page with
              no origin at all. */}
          <MiniQR size={84} url={`${APP_URL}${href}`} />
        </div>
        <p className="text-gray-300 text-[0.8125rem] leading-snug">
          Scan this with your iPhone&apos;s camera to add your card to Apple Wallet.
        </p>
      </div>
    );
  }

  return (
    <a
      href={href}
      onClick={handleNativeOpen}
      className={`w-full flex items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition-colors ${className}`}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" aria-hidden="true">
        <path d="M17.05 12.54c-.02-2.06 1.68-3.05 1.76-3.1-.96-1.4-2.46-1.6-2.99-1.62-1.27-.13-2.48.75-3.13.75-.64 0-1.64-.73-2.7-.71-1.39.02-2.67.81-3.38 2.05-1.44 2.5-.37 6.2 1.03 8.23.69.99 1.51 2.11 2.58 2.07 1.04-.04 1.43-.67 2.68-.67 1.25 0 1.6.67 2.7.65 1.11-.02 1.82-1.01 2.5-2.01.79-1.15 1.11-2.26 1.13-2.32-.02-.01-2.17-.83-2.19-3.29zM15.1 6.29c.57-.69.95-1.65.85-2.6-.82.03-1.81.54-2.39 1.23-.52.61-.98 1.58-.86 2.51.91.07 1.84-.46 2.4-1.14z" />
      </svg>
      Add to Apple Wallet
    </a>
  );
}
