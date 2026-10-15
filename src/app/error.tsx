"use client";

import { useEffect } from "react";
import { isChunkLoadError, recoverFromChunkError } from "@/lib/chunk-reload";

// App-wide error boundary — without this, an uncaught error anywhere renders
// Next.js's default unstyled error screen instead of anything on-brand.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // A page from before a deploy asking for a chunk that no longer exists.
  // reset() re-renders the same dead import, so "Try again" could never work;
  // only a fresh document can (lib/chunk-reload, audit NS-06).
  const staleDeploy = isChunkLoadError(error);
  useEffect(() => {
    if (staleDeploy && recoverFromChunkError()) return;
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
  }, [error, staleDeploy]);

  return (
    // `sc-app` is what the light-mode layer in globals.css is scoped to, so
    // without it this screen stayed black for someone running the app in light
    // mode — a jarring, unbranded surface at the worst possible moment
    // (audit 2026-09-29).
    <div className="sc-app min-h-screen bg-gray-950 flex items-center justify-center px-5">
      <div className="text-center max-w-sm">
        <h1 className="text-2xl font-bold text-white mb-3">Something went wrong</h1>
        <p className="text-gray-500 text-sm mb-6">
          We hit an unexpected error. Try again, or head back to your dashboard — nothing you have saved is affected.
        </p>
        <button
          onClick={() => (staleDeploy ? window.location.reload() : reset())}
          className="bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm px-5 py-2.5 rounded-full transition-colors"
        >
          Try again
        </button>
        {/* A single button that only retries is a dead end when the thing that
            crashed crashes again. A plain <a>, not next/link: the router is
            part of what may have failed. */}
        <p className="mt-5">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a plain <a> on purpose: this is the crash boundary, so the client router is part of what may have failed. A full document load is the only navigation guaranteed to work here. */}
          <a href="/dashboard" className="text-gray-400 hover:text-white text-xs font-medium transition-colors">
            Go to my dashboard
          </a>
        </p>
      </div>
    </div>
  );
}
