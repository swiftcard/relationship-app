"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const ACTIVE_CARD_KEY = "swiftcard_active_card";

// The Share page shows the Swift Links + Email Signature for ONE card — the
// currently selected one. When the page is opened without an explicit ?card=
// (e.g. from a nav link that didn't carry it), this reads the card the user
// last selected on the dashboard (persisted by CardSelectionPersist) and
// redirects so the page reflects that selection instead of defaulting to the
// first card. No-ops when the URL already names a card or the stored card
// matches what's shown.
export default function ShareCardResolver({ current }: { current: string }) {
  const router = useRouter();
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).has("card")) return;
      const active = localStorage.getItem(ACTIVE_CARD_KEY);
      if (active && active !== current) {
        // Keep the #hash: /share#signature names the Swift Signature side, and
        // dropping it here landed the person on Swift Links instead.
        router.replace(`/share?card=${encodeURIComponent(active)}${window.location.hash}`);
      }
    } catch {
      /* storage blocked — keep the server-rendered card */
    }
  }, [current, router]);
  return null;
}
