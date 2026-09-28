// ── Guided tour: shared state + control helpers ─────────────────────────────
// The tour spans three pages (Dashboard → Contacts → Settings). Because moving
// between them remounts everything, the "is a tour running / which step" state
// lives in sessionStorage so it survives navigation, and "have they seen it"
// lives in localStorage so the first-run banner only shows once.

import { TOUR_STEPS, resolveTourPath, type TourContext } from "./tour-steps";

// The bare key/event strings live in ./tour-keys, which imports nothing — so a
// module can check whether a tour is running without pulling in both step
// lists. Re-exported here so every existing `from "@/lib/tour"` import is
// unchanged.
export {
  TOUR_RUNNING, TOUR_INDEX, TOUR_CARD, TOUR_CTX_KEY, TOUR_DONE,
  TOUR_START_EVENT, TOUR_END_EVENT,
  ADMIN_TOUR_RUNNING, ADMIN_TOUR_INDEX, ADMIN_TOUR_DONE, ADMIN_TOUR_SEEN,
  ADMIN_TOUR_START_EVENT, ADMIN_TOUR_END_EVENT,
} from "./tour-keys";
import {
  TOUR_RUNNING, TOUR_INDEX, TOUR_CARD, TOUR_CTX_KEY, TOUR_DONE,
  TOUR_START_EVENT, TOUR_END_EVENT,
  ADMIN_TOUR_RUNNING, ADMIN_TOUR_INDEX, ADMIN_TOUR_DONE, ADMIN_TOUR_SEEN,
  ADMIN_TOUR_START_EVENT, ADMIN_TOUR_END_EVENT,
} from "./tour-keys";

// Read the persisted plan context. Defaults to the free shape when nothing is
// stored yet (brand-new tab that hasn't loaded the dashboard) — the safest,
// least-overclaiming tour.
export function readTourContext(): TourContext {
  // hasCards defaults TRUE and isNative is detected live rather than trusted
  // from storage: an unknown context should behave like an ordinary established
  // account (full tour), and the shell/web split is a property of where the
  // code is running right now, not of whatever was persisted last time.
  const detectNative = () => {
    if (typeof window === "undefined") return false;
    const w = window as unknown as {
      webkit?: { messageHandlers?: { bridge?: unknown } };
      Capacitor?: { isNativePlatform?: () => boolean; isNative?: boolean };
    };
    if (w.webkit?.messageHandlers?.bridge) return true;
    const c = w.Capacitor;
    return !!(c && (c.isNativePlatform ? c.isNativePlatform() : c.isNative));
  };

  const base: TourContext = {
    tier: "free",
    isOfficeMember: false,
    hasCards: true,
    isNative: detectNative(),
  };
  if (typeof window === "undefined") return { ...base, isNative: false };
  try {
    const raw = localStorage.getItem(TOUR_CTX_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<TourContext>;
      const tier = p.tier === "pro" || p.tier === "office" ? p.tier : "free";
      return {
        ...base,
        tier,
        isOfficeMember: !!p.isOfficeMember,
        hasCards: p.hasCards !== false,
      };
    }
  } catch { /* ignore */ }
  return base;
}

// The active card slug, so Dashboard/Contacts steps stay on the same card.
function currentCard(): string | null {
  if (typeof window === "undefined") return null;
  const fromUrl = new URLSearchParams(window.location.search).get("card");
  if (fromUrl) return fromUrl;
  try {
    return localStorage.getItem("swiftcard_active_card");
  } catch {
    return null;
  }
}

// Begin the tour from step 0. If we're already on the first step's page, fire an
// event so the mounted host starts immediately; otherwise navigate there and let
// the host on that page resume from sessionStorage.
export function startTour(): void {
  if (typeof window === "undefined") return;
  const card = currentCard();
  try {
    sessionStorage.setItem(TOUR_RUNNING, "1");
    sessionStorage.setItem(TOUR_INDEX, "0");
    if (card) sessionStorage.setItem(TOUR_CARD, card);
    else sessionStorage.removeItem(TOUR_CARD);
  } catch { /* private mode — the event path below still works this session */ }

  const first = TOUR_STEPS[0];
  if (window.location.pathname === first.path) {
    window.dispatchEvent(new CustomEvent(TOUR_START_EVENT));
  } else {
    window.location.assign(resolveTourPath(first, card));
  }
}

// Clear all running state. `completed` marks it done so the banner won't return.
export function endTour(completed: boolean): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(TOUR_RUNNING);
    sessionStorage.removeItem(TOUR_INDEX);
    sessionStorage.removeItem(TOUR_CARD);
    if (completed) localStorage.setItem(TOUR_DONE, "1");
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(TOUR_END_EVENT));
}

// Has the visitor already finished or skipped the tour before?
export function tourCompleted(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return !!localStorage.getItem(TOUR_DONE);
  } catch {
    return false;
  }
}

// ── Office Admin guided tour: same mechanics, separate state ────────────────
// Its own storage keys so it can run, be skipped, or be replayed independently
// of the main dashboard tour — no shared "card" concept, since every step
// lives inside the Office admin console.
import { ADMIN_TOUR_STEPS } from "./admin-tour-steps";

export function startAdminTour(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(ADMIN_TOUR_RUNNING, "1");
    sessionStorage.setItem(ADMIN_TOUR_INDEX, "0");
  } catch { /* private mode — the event path below still works this session */ }

  const first = ADMIN_TOUR_STEPS[0];
  if (window.location.pathname === first.path) {
    window.dispatchEvent(new CustomEvent(ADMIN_TOUR_START_EVENT));
  } else {
    window.location.assign(first.path);
  }
}

// Should the admin console auto-launch its tour right now? True only on the
// FIRST visit for someone who hasn't already finished it. Marks itself as
// offered, so this returns true at most once per browser.
export function claimAdminTourAutoStart(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (localStorage.getItem(ADMIN_TOUR_DONE)) return false;
    if (localStorage.getItem(ADMIN_TOUR_SEEN)) return false;
    // The MAIN tour is still mid-flight — creating an office sends the owner to
    // /dashboard?tour=1, so this is the normal path, not an edge case. Two tours
    // running at once would fight over the screen. Return false WITHOUT marking
    // it seen, so the one-shot isn't burned and the admin tour still gets its
    // turn on the next visit, once the dashboard tour is done or dismissed.
    try {
      if (sessionStorage.getItem(ADMIN_TOUR_RUNNING) === null && sessionStorage.getItem(TOUR_RUNNING)) return false;
    } catch { /* private mode — fall through and offer the tour */ }
    localStorage.setItem(ADMIN_TOUR_SEEN, "1");
    return true;
  } catch {
    // Private mode / storage blocked: don't auto-start, since we couldn't record
    // that we did and would otherwise relaunch on every single page view.
    return false;
  }
}

export function endAdminTour(completed: boolean): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(ADMIN_TOUR_RUNNING);
    sessionStorage.removeItem(ADMIN_TOUR_INDEX);
    if (completed) localStorage.setItem(ADMIN_TOUR_DONE, "1");
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(ADMIN_TOUR_END_EVENT));
}
