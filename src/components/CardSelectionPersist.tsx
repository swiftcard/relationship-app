"use client";
import { useEffect } from "react";
import { ACTIVE_CARD_KEY, ACTIVE_CARD_COOKIE, ACTIVE_CARD_COOKIE_MAX_AGE, ACTIVE_CARD_EVENT } from "@/lib/active-card";

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
 */
export default function CardSelectionPersist({ selectedCard }: { selectedCard: string | null }) {
  useEffect(() => {
    if (!selectedCard) return;
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
    // Tell the native bridge (iOS widget + Apple Watch) the active card moved.
    // Same-document only: the `storage` event never fires in the tab that wrote.
    try {
      window.dispatchEvent(new Event(ACTIVE_CARD_EVENT));
    } catch {
      /* ignore */
    }
  }, [selectedCard]);

  return null;
}
