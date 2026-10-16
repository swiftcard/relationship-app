"use client";

import { useEffect } from "react";
import SwiftCardLogo from "@/components/SwiftCardLogo";

// App-wide error boundary — without this, an uncaught error anywhere renders
// Next.js's default unstyled error screen instead of anything on-brand.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app error boundary]", error);
    // Report the crash so a page-level failure any user hits is visible to the
    // team (React boundary errors never surface as window.onerror). Best-effort.
    try {
      fetch("/api/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: "react.boundary",
          message: error?.message || "render error",
          stack: error?.stack ?? "",
          url: typeof location !== "undefined" ? location.href : "",
        }),
        keepalive: true,
      }).catch(() => {});
    } catch { /* never throw from the boundary */ }
  }, [error]);

  return (
    // `sc-app` is what the light-mode layer in globals.css is scoped to, so
    // without it this screen stayed black for someone running the app in light
    // mode — a jarring, unbranded surface at the worst possible moment
    // (audit 2026-09-29). Grays below are picked for that remap: text-white /
    // text-gray-400 / bg-gray-900 / border-gray-700 all flip correctly.
    <div className="sc-app relative min-h-screen overflow-hidden bg-gray-950 flex items-center justify-center px-5 py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse 55% 40% at 50% 40%, rgba(29,78,216,0.14), transparent 70%)" }}
      />
      <div className="relative w-full max-w-sm flex flex-col items-center text-center">
        <div className="mb-10">
          <SwiftCardLogo size={28} onDark />
        </div>

        <div aria-hidden className="mb-7 flex h-16 w-16 items-center justify-center rounded-2xl border border-gray-700 bg-gray-900 shadow-xl ring-8 ring-blue-500/10">
          <svg viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth={1.8} className="h-8 w-8">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold tracking-tight text-white mb-3">Something went wrong</h1>
        <p className="text-gray-400 text-sm leading-relaxed mb-8">
          We hit an unexpected error. Try again, or head back to your dashboard — nothing you have saved is affected.
        </p>

        <div className="flex w-full flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
          <button
            onClick={() => reset()}
            className="bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm px-6 py-3 rounded-full transition-colors shadow-lg shadow-blue-700/25"
          >
            Try again
          </button>
          {/* A single button that only retries is a dead end when the thing that
              crashed crashes again. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a plain <a> on purpose: this is the crash boundary, so the client router is part of what may have failed. A full document load is the only navigation guaranteed to work here. */}
          <a
            href="/dashboard"
            className="border border-gray-700 bg-gray-900 hover:border-gray-500 text-white font-semibold text-sm px-6 py-3 rounded-full transition-colors"
          >
            Go to my dashboard
          </a>
        </div>

        {error?.digest && (
          <p className="mt-8 text-xs text-gray-400">
            Reference <span className="font-mono">{error.digest}</span>
          </p>
        )}
      </div>
    </div>
  );
}
