"use client";

import Link from "next/link";
import { useEffect, useState, useRef } from "react";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import { GUEST_GATE_EVENT, markClaimConsent } from "@/lib/guest-draft";

// The auth gate a guest hits when they try to Publish / Save / Share / QR /
// download their signature / open analytics / open leads. Fully self-contained:
// it listens for the GUEST_GATE_EVENT that requireAuth() dispatches, so the
// editor only has to render <GuestGateModal /> once. The draft is already
// persisted (requireAuth flushed it) by the time this opens.
export default function GuestGateModal() {
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState("/cards/new");

  useEffect(() => {
    function onGate() {
      // Capture the exact editor URL so the user returns to where they left off
      // after authenticating. Stamp `claim=1` on it: the editor only claims the
      // pending draft on this explicit post-auth return — never on a bare
      // marketing landing (where a lingering session would silently swallow a
      // leftover draft into the wrong account).
      try {
        const base = window.location.pathname + window.location.search;
        setNext(base + (base.includes("?") ? "&" : "?") + "claim=1");
      } catch {
        setNext("/cards/new?claim=1");
      }
      setOpen(true);
    }
    window.addEventListener(GUEST_GATE_EVENT, onGate as EventListener);
    return () => window.removeEventListener(GUEST_GATE_EVENT, onGate as EventListener);
  }, []);

  // Escape closes; focus moves onto the dialog when it opens (it used to stay
  // behind the backdrop for a keyboard user) and back afterwards.
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogA11y(open, () => setOpen(false), panelRef);

  if (!open) return null;

  const encoded = encodeURIComponent(next);
  const signupHref = `/login?mode=signup&next=${encoded}`;
  const loginHref = `/login?next=${encoded}`;
  const planParam = /[?&]plan=(office|pro)\b/.exec(next)?.[1];
  const pickedPlan = planParam === "office" ? "Office" : planParam === "pro" ? "Pro" : null;

  return (
    <div
      ref={panelRef}
      className="fixed inset-0 z-[100] flex items-center justify-center px-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="guest-gate-title"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close"
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />

      {/* Card. `sc-app` puts it in the app theme system, so over the (always
          white) card builder it is a light sheet like the page, not a dark box
          dropped on a white screen (2026-09-16 web run). */}
      <div className="sc-app relative w-full max-w-sm">
      <div className="relative w-full rounded-2xl border border-gray-800 bg-gray-900 p-6 shadow-2xl">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-600/15 border border-blue-500/30">
          <svg className="h-6 w-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h2 id="guest-gate-title" className="text-center text-lg font-bold text-white">
          Save your card
        </h2>
        <p className="mt-2 text-center text-sm leading-relaxed text-gray-400">
          {/* A plan already picked on /pricing rides in the URL (?plan=…):
              say so, instead of promising a plan choice they already made. */}
          {pickedPlan
            ? <>Create your account to save it. Next you&apos;ll check out for {pickedPlan}, and your card goes live.</>
            : <>Create your free account to save it. Next you&apos;ll choose your plan, and your card goes live.</>}
        </p>

        <div className="mt-6 space-y-2.5">
          {/* markClaimConsent: choosing an account HERE is the explicit "save this
              draft into that account" moment — the claim flow only ever attaches
              a draft that carries this fresh consent. */}
          <a
            href={signupHref}
            onClick={() => markClaimConsent()}
            className="btn-cta block w-full rounded-full bg-blue-600 px-6 py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-blue-500"
          >
            Create account
          </a>
          <a
            href={loginHref}
            onClick={() => markClaimConsent()}
            className="block w-full rounded-full border border-gray-700 px-6 py-3 text-center text-sm font-semibold text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
          >
            Log in
          </a>
        </div>

        <p className="mt-3 text-center text-[0.6875rem] leading-relaxed text-gray-500">
          By creating an account you agree to our{" "}
          <Link href="/terms" className="underline hover:text-gray-300">Terms</Link> and{" "}
          <Link href="/privacy" className="underline hover:text-gray-300">Privacy Policy</Link>.
        </p>

        <button
          type="button"
          onClick={() => setOpen(false)}
          className="mt-4 block w-full text-center text-xs text-gray-500 transition-colors hover:text-gray-300"
        >
          Keep editing
        </button>
      </div>
      </div>
    </div>
  );
}
