"use client";

import { useEffect } from "react";
import { isChunkLoadError, recoverFromChunkError } from "@/lib/chunk-reload";

// The Office console's own error boundary (audit F-OFFICE-06). Without it a
// data failure on a teammate's page or their analytics threw away the whole
// console for the site-wide error screen. This renders INSIDE the console's
// layout, so the navigation stays, and the other tabs are one tap away.
export default function OfficeAdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const staleDeploy = isChunkLoadError(error);
  useEffect(() => {
    if (staleDeploy && recoverFromChunkError()) return;
    console.error("[office admin error boundary]", error);
    try {
      fetch("/api/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: "react.boundary.office",
          message: error?.message || "render error",
          stack: error?.stack ?? "",
          url: typeof location !== "undefined" ? location.href : "",
        }),
        keepalive: true,
      }).catch(() => {});
    } catch { /* never throw from the boundary */ }
  }, [error, staleDeploy]);

  return (
    <div role="alert" className="rounded-2xl border border-gray-800 bg-gray-900/60 px-5 py-8 text-center">
      <p className="text-white font-semibold mb-1">Couldn&apos;t load this page</p>
      <p className="text-gray-400 text-sm mb-5">Something went wrong reading your team&apos;s data. Nothing has changed — try again in a moment.</p>
      <button
        type="button"
        onClick={() => (staleDeploy ? location.reload() : reset())}
        className="inline-flex items-center justify-center rounded-full bg-blue-600 hover:bg-blue-500 px-5 py-2 text-sm font-semibold text-white"
      >
        Try again
      </button>
    </div>
  );
}
