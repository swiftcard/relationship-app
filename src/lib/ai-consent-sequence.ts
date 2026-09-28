// ── The AI permission question comes BEFORE the guided tour ─────────────────
//
// Owner, 2026-09-18: "For every single account with any type of plan that's
// created, the AI consent form should pop up only once they land in their
// dashboard. They press Allow and then after that the tour comes up."
// iPhone app only (owner, same day) — the website has never asked, and still
// does not.
//
// Before this, the two raced. A new account lands on /dashboard?welcome=1&
// tour=1; TourAutoStart started the tour 0.5s later, while GlobalAiConsent was
// still fetching whether to ask — so the permission sheet opened on top of the
// tour's first step (or the tour on top of the sheet), on every plan.
//
// One tiny shared state decides the order:
//   "pending"  — whether to ask is still being read (fetch in flight);
//   "asking"   — the permission sheet is open;
//   "settled"  — nothing about it is open on this screen: answered, already
//                answered before, no AI provider configured, or not askable.
// The reporters are GlobalAiConsent (pending / a failed read) and AiConsentGate
// (asking / settled, from whether it is open). The waiters are TourAutoStart,
// TourBanner and AdminTourAutoStart, through afterAiConsent().
//
// A module variable, not React state: the reporters live in the root layout
// and the waiters inside pages, and the answer has to survive between them for
// the whole app session. A fresh launch starts at "pending".

import { detectNativeApp } from "@/lib/platform";

export type AiAskPhase = "pending" | "asking" | "settled";

let phase: AiAskPhase = "pending";
const listeners = new Set<(p: AiAskPhase) => void>();

export function reportAiAsk(next: AiAskPhase): void {
  if (phase === next) return;
  phase = next;
  for (const l of [...listeners]) l(next);
}

/** Only a fetch that never answers can leave the phase at "pending" for good. */
export const AI_ASK_FALLBACK_MS = 15_000;
/** Lets the permission sheet finish closing before the tour's first step opens. */
export const AFTER_ANSWER_DELAY_MS = 350;

/**
 * Run `start` once the AI permission question is out of the way.
 *
 * On the web it runs straight away: the question is never asked there. In the
 * app it runs when the phase is "settled" — immediately if it already is, or
 * a beat after the sheet is answered ("Allow" or "Don't allow"; the tour must
 * not be lost on a no). A read that never comes back does not hold the tour
 * hostage: after AI_ASK_FALLBACK_MS it starts anyway — but NEVER while the
 * sheet is actually open, however long someone takes to read it.
 *
 * Returns a cancel for effect cleanups.
 */
export function afterAiConsent(start: () => void): () => void {
  if (!detectNativeApp()) {
    start();
    return () => {};
  }
  if (phase === "settled") {
    start();
    return () => {};
  }

  let done = false;
  let answered: ReturnType<typeof setTimeout> | null = null;
  const cleanup = () => {
    listeners.delete(onPhase);
    clearTimeout(fallback);
  };
  const fire = (delay: number) => {
    if (done) return;
    done = true;
    cleanup();
    if (delay > 0) answered = setTimeout(start, delay);
    else start();
  };
  function onPhase(p: AiAskPhase) {
    if (p === "settled") fire(AFTER_ANSWER_DELAY_MS);
  }
  const fallback = setTimeout(function check() {
    if (phase === "asking") return; // the sheet is up: keep waiting for the answer
    fire(0);
  }, AI_ASK_FALLBACK_MS);
  listeners.add(onPhase);

  return () => {
    done = true;
    cleanup();
    if (answered) clearTimeout(answered);
  };
}
