"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// ── The dashboard catches up when you come back to it ───────────────────────
//
// The analytics box (views, the chart, Recent visits, Link taps) is drawn once
// on the server. Nothing redrew it, so someone who opened the card while the
// owner had the app in the background was in the bell — which refetches on
// focus — and nowhere in the box until a manual reload (owner, 2026-11-05: "it
// doesn't show… sometimes"). Coming back to the app or the tab now re-renders
// the page's server data in place: no reload, no scroll jump, the open
// "Show more" and the chosen tab kept.
//
// At most once every 30 seconds, so flicking between apps never hammers the
// server; never while the page is hidden; nothing on first load.
const MIN_GAP_MS = 30_000;

export default function LiveRefresh() {
  const router = useRouter();
  // When the page was last drawn: set on mount (the server just drew it).
  const last = useRef(0);
  useEffect(() => {
    last.current = Date.now();
    const maybe = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - last.current < MIN_GAP_MS) return;
      last.current = Date.now();
      router.refresh();
    };
    document.addEventListener("visibilitychange", maybe);
    window.addEventListener("focus", maybe);
    return () => {
      document.removeEventListener("visibilitychange", maybe);
      window.removeEventListener("focus", maybe);
    };
  }, [router]);
  return null;
}
