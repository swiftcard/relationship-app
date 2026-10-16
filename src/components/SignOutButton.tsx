"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { releaseDevice } from "@/lib/device-sign-out";

type Variant = "text" | "danger";

// Sign out is CONFIRMED, never immediate (owner call 2026-09-09). It is a
// one-tap way to lose an unsaved draft and a logged-in session on a phone that
// may not remember the password, and it used to sit in the top-right corner
// where a mis-tap on the notification bell could reach it. The action itself is
// unchanged — the dialog only gates it.
export default function SignOutButton({ variant = "text" }: { variant?: Variant }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  // Esc closes the dialog, and the page behind it must not scroll while it is
  // open — on a phone the confirm card would otherwise drift off-screen.
  useEffect(() => {
    if (!confirming) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setConfirming(false);
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [confirming]);

  async function handleSignOut() {
    if (busy) return;
    setBusy(true);
    // The one shared release (lib/device-sign-out): push binding severed,
    // session ended, every person-scoped key and the visitor cookie cleared —
    // the same steps on every path that lets go of a person.
    await releaseDevice({ rememberPush: true });
    // HARD navigation to the marketing front page, REPLACING this entry — a
    // full reload leaves no client state or cached screen behind, and Back
    // can't bring the signed-out account's page up from history.
    window.location.replace("/");
  }

  const triggerClass =
    variant === "danger"
      ? "shrink-0 text-xs font-semibold text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/15 border border-transparent rounded-full px-4 py-2 transition-colors"
      : "text-sm text-gray-500 hover:text-white transition-colors";

  return (
    <>
      <button type="button" onClick={() => setConfirming(true)} className={triggerClass}>
        Sign out
      </button>

      {/* Portalled to <body>. On the dashboard (the "Select your card" screen)
          this button lives in the top bar, which has backdrop-blur — and a
          backdrop-filter makes an element the containing block for its FIXED
          descendants, so the "full-screen" dialog was pinned inside the 56px
          bar and cut off at the top of the screen (owner, 2026-09-16). */}
      {confirming && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center px-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sign-out-title"
        >
          <button
            type="button"
            aria-label="Cancel"
            onClick={() => setConfirming(false)}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          />

          <div className="relative w-full max-w-sm rounded-2xl border border-gray-800 bg-gray-900 p-6 shadow-2xl">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-600/15 border border-red-500/30">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-6 w-6 text-red-400">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M18.75 15L21.75 12m0 0l-3-3m3 3H9" />
              </svg>
            </div>

            <h2 id="sign-out-title" className="text-center text-lg font-bold text-white">
              Sign out of SwiftCard?
            </h2>
            <p className="mt-2 text-center text-sm leading-relaxed text-gray-400">
              You&apos;ll need to sign in again on this device to reach your cards and contacts.
            </p>

            <div className="mt-6 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="flex-1 rounded-full bg-gray-800/60 border border-transparent py-2.5 text-sm font-semibold text-gray-200 transition-colors hover:bg-gray-700 hover:text-white disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                disabled={busy}
                className="flex-1 rounded-full bg-red-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-60"
              >
                {busy ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
