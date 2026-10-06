"use client";
import { useEffect } from "react";
import { ACTIVE_CARD_KEY, ACTIVE_CARD_COOKIE, ACTIVE_CARD_COOKIE_MAX_AGE, ACTIVE_CARD_EVENT, SESSION_CARD_COOKIE, SESSION_CARD_FLAG } from "@/lib/active-card";

/**
 * Persists the currently-selected card so other pages can default to it.
 * It does NOT auto-select a card — after login you start with no card selected.
 *
 * Writes BOTH a localStorage key and a cookie. The cookie is what lets the
 * server know the selection at render time: with localStorage alone, every page
 * that needs the selected card had to render something first (the oldest card)
 * and then correct itself from a client effect — a visible flash of the wrong
 * card, a second navigation, and on the Share page a headshot that appeared and
 * then vanished, because headshots are per-card and the oldest card is the one
 * carrying the legacy account photo.
 *
 * Also writes the SESSION copy the dashboard reads (see SESSION_CARD_COOKIE),
 * so a fresh open of the app asks "Select a card" again. `restored` means the
 * dashboard opened this card from that session cookie rather than ?card=; if
 * this webview never wrote it (a relaunch that kept session cookies), it is a
 * previous launch's choice, so drop it and go to the picker.
 */
export default function CardSelectionPersist({ selectedCard, restored = false }: { selectedCard: string | null; restored?: boolean }) {
  useEffect(() => {
    if (!selectedCard) return;
    if (restored) {
      let fresh = false;
      try {
        fresh = !sessionStorage.getItem(SESSION_CARD_FLAG);
      } catch {
        /* storage blocked: trust the cookie */
      }
      if (fresh) {
        try {
          document.cookie = `${SESSION_CARD_COOKIE}=; path=/; max-age=0; samesite=lax`;
        } catch {
          /* ignore */
        }
        // ?pick=1 makes the dashboard ignore the session cookie, so this can
        // never loop even if the cookie could not be cleared.
        location.replace("/dashboard?pick=1");
        return;
      }
    }
    try {
      localStorage.setItem(ACTIVE_CARD_KEY, selectedCard);
    } catch {
      /* ignore */
    }
    try {
      document.cookie = `${ACTIVE_CARD_COOKIE}=${encodeURIComponent(selectedCard)}; path=/; max-age=${ACTIVE_CARD_COOKIE_MAX_AGE}; samesite=lax`;
    } catch {
      /* ignore */
    }
    try {
      document.cookie = `${SESSION_CARD_COOKIE}=${encodeURIComponent(selectedCard)}; path=/; samesite=lax`;
      sessionStorage.setItem(SESSION_CARD_FLAG, "1");
    } catch {
      /* ignore */
    }
    // Tell the native bridge (iOS widget + Apple Watch) the active card moved.
    // Same-document only: the `storage` event never fires in the tab that wrote.
    try {
      window.dispatchEvent(new Event(ACTIVE_CARD_EVENT));
    } catch {
      /* ignore */
    }
  }, [selectedCard, restored]);

  return null;
}
