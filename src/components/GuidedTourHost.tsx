"use client";

// ── Lazy mount for the guided tour ──────────────────────────────────────────
//
// GuidedTour is mounted in the ROOT layout so a tour can span Dashboard →
// Contacts → Settings. But the root layout is also every public card page, and
// the engine plus its step lists is ~1,100 lines of JavaScript that a visitor
// scanning a QR code downloads and never uses — they have no account and no way
// to start a tour.
//
// So the engine is fetched only once a tour is actually running. This host is a
// few lines and keeps the exact same mount point.
//
// Why there is no missed-event race: startTour() writes the running flag to
// sessionStorage BEFORE dispatching the start event, and GuidedTour's own
// boot() reads that flag on mount — not the event. So the engine starts itself
// whenever it arrives, before the event or after it. (Verified against the
// eagerly-mounted version in a real browser: start-on-this-page, resume-after-
// navigation, idle and private-mode all behave identically. Private mode does
// not run a tour either way, because boot() cannot read the flag.)

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import { TOUR_RUNNING, TOUR_START_EVENT } from "@/lib/tour-keys";

// ssr: false — the engine measures real DOM to position its spotlight, so it
// has nothing to render on the server anyway.
const GuidedTour = dynamic(() => import("@/components/GuidedTour"), { ssr: false });

// Module-level, because there is exactly one host (the root layout) and the
// answer must survive the re-render the event triggers. It only ever latches
// ON: once a tour has run on this page load, the engine stays mounted and goes
// dormant by itself, exactly as it did when it was mounted eagerly.
let armed = false;

function readArmed(): boolean {
  if (armed) return true;
  try {
    if (sessionStorage.getItem(TOUR_RUNNING) === "1") armed = true;
  } catch { /* private mode — subscribe() below still arms on the event */ }
  return armed;
}

function subscribe(onChange: () => void): () => void {
  const onStart = () => { armed = true; onChange(); };
  window.addEventListener(TOUR_START_EVENT, onStart);
  return () => window.removeEventListener(TOUR_START_EVENT, onStart);
}

export default function GuidedTourHost({ pausePathPrefix }: { pausePathPrefix?: string }) {
  // useSyncExternalStore rather than an effect: the answer is external state
  // (sessionStorage + a window event), and this reads it without a mount-time
  // setState and without a server/client mismatch — the server always says no.
  const isArmed = useSyncExternalStore(subscribe, readArmed, () => false);

  if (!isArmed) return null;
  return <GuidedTour pausePathPrefix={pausePathPrefix} />;
}
