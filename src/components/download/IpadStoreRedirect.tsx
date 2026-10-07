"use client";

import { useEffect } from "react";
import { looksLikeIpadAsMac, storeUrlWithAttribution } from "@/lib/download-link";

// iPadOS Safari calls itself a Mac and sends no client hints, so the proxy
// cannot tell it from a desktop and serves /download's page. This is the one
// device the page can still route: a "Mac" with more than one touch point is an
// iPad (sc-boot uses the same tell for data-sc-os), and it goes to the App
// Store with the link's query tags intact — the same function the proxy used,
// so the two never disagree. On a real Mac, a phone or anything else it does
// nothing; the page stays up with both stores on it.
//
// `replace`, not `assign`: Back from the App Store should land where the
// person came from, not on a page that immediately leaves again.
export default function IpadStoreRedirect({ appStoreUrl }: { appStoreUrl: string }) {
  useEffect(() => {
    if (!looksLikeIpadAsMac(navigator.userAgent, navigator.maxTouchPoints ?? 0)) return;
    window.location.replace(storeUrlWithAttribution(appStoreUrl, window.location.search, "ios"));
  }, [appStoreUrl]);
  return null;
}
